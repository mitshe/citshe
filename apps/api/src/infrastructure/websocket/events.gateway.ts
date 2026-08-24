import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { TerminalManagerService } from '../../modules/sessions/services/terminal-manager.service';
import { CliService } from '../../modules/cli/services/cli.service';

// Event type definitions
export interface TaskUpdatePayload {
  taskId: string;
  status: string;
  message?: string;
  agentName?: string;
  progress?: number;
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ],
    credentials: true,
  },
  namespace: '/events',
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private readonly jwtSecret: string;
  private connectedClients = new Map<
    string,
    {
      organizationId?: string;
      userId?: string;
      authenticated: boolean;
      rooms: Set<string>;
      // When a CLI (`ctk_`) token authenticated: the org ids it may access.
      cliOrgIds?: string[];
    }
  >();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly cliService: CliService,
    @Optional() private readonly terminalManager?: TerminalManagerService,
  ) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET') || '';
  }

  afterInit(_server: Server) {
    this.logger.log('WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    this.connectedClients.set(client.id, {
      authenticated: false,
      rooms: new Set(),
    });
    this.logger.log(
      `Client connected: ${client.id} (${this.connectedClients.size} total)`,
    );
  }

  handleDisconnect(client: Socket) {
    this.connectedClients.delete(client.id);
    this.logger.log(
      `Client disconnected: ${client.id} (${this.connectedClients.size} remaining)`,
    );
  }

  /**
   * Authenticate and join organization room
   */
  @SubscribeMessage('authenticate')
  async handleAuthenticate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { organizationId: string; token?: string },
  ) {
    const clientData = this.connectedClients.get(client.id);
    if (!clientData) {
      return { event: 'error', data: { message: 'Client not found' } };
    }

    if (!data.token) {
      this.logger.warn(`Client ${client.id} attempted auth without token`);
      return {
        event: 'error',
        data: { message: 'Authentication token required' },
      };
    }

    // CLI personal access token (`ctk_`): user-scoped, all orgs. No org room —
    // it subscribes to individual sessions verified against its org set.
    if (data.token.startsWith('ctk_')) {
      try {
        const ctx = await this.cliService.resolveToken(data.token);
        clientData.userId = ctx.userId;
        clientData.cliOrgIds = ctx.organizationIds;
        clientData.authenticated = true;
        this.logger.log(`[WS AUTH] CLI client ${client.id} (${ctx.email})`);
        return { event: 'authenticated', data: { cli: true } };
      } catch {
        return { event: 'error', data: { message: 'Invalid CLI token' } };
      }
    }

    let verifiedOrgId: string | undefined;

    try {
      const payload = jwt.verify(data.token, this.jwtSecret) as {
        sub: string;
        orgId: string;
      };
      clientData.userId = payload.sub;
      verifiedOrgId = payload.orgId;
      clientData.authenticated = true;
    } catch (error) {
      this.logger.warn(`Client ${client.id} authentication failed: ${error}`);
      return {
        event: 'error',
        data: { message: 'Invalid or expired token' },
      };
    }

    // Use org from JWT if available, otherwise verify membership
    const requestedOrgId = data.organizationId;
    if (verifiedOrgId && verifiedOrgId !== requestedOrgId) {
      this.logger.warn(
        `Client ${client.id} requested org ${requestedOrgId} but JWT contains ${verifiedOrgId}`,
      );
      return {
        event: 'error',
        data: { message: 'Organization mismatch' },
      };
    }

    // Verify user is member of the organization
    if (!verifiedOrgId) {
      const membership = await this.prisma.organizationMember.findFirst({
        where: {
          userId: clientData.userId,
          organizationId: requestedOrgId,
        },
        select: { id: true },
      });
      if (!membership) {
        // Also check if user is org owner
        const org = await this.prisma.organization.findFirst({
          where: { id: requestedOrgId, ownerId: clientData.userId },
          select: { id: true },
        });
        if (!org) {
          return {
            event: 'error',
            data: { message: 'Not a member of this organization' },
          };
        }
      }
    }

    // Join organization room
    clientData.organizationId = requestedOrgId;
    void client.join(`org:${requestedOrgId}`);
    clientData.rooms.add(`org:${requestedOrgId}`);

    this.logger.log(
      `[WS AUTH] Client ${client.id} authenticated and joined room: org:${data.organizationId}`,
    );
    return {
      event: 'authenticated',
      data: { organizationId: data.organizationId },
    };
  }

  /**
   * Check if a client is authenticated before allowing subscription
   */
  private isClientAuthenticated(client: Socket): boolean {
    const clientData = this.connectedClients.get(client.id);
    return clientData?.authenticated ?? false;
  }

  /**
   * Client subscribes to task updates for an organization
   * Requires authentication
   */
  @SubscribeMessage('subscribe:organization')
  handleSubscribeOrganization(
    @ConnectedSocket() client: Socket,
    @MessageBody() organizationId: string,
  ) {
    if (!this.isClientAuthenticated(client)) {
      return { event: 'error', data: { message: 'Authentication required' } };
    }

    // Verify client is authenticated for this organization
    const clientData = this.connectedClients.get(client.id);
    if (clientData?.organizationId !== organizationId) {
      return {
        event: 'error',
        data: { message: 'Not authorized for this organization' },
      };
    }

    void client.join(`org:${organizationId}`);
    this.logger.log(`Client ${client.id} subscribed to org:${organizationId}`);
    return { event: 'subscribed', data: { organizationId } };
  }

  /**
   * Client subscribes to a specific task
   * Requires authentication and organization ownership verification
   */
  @SubscribeMessage('subscribe:task')
  async handleSubscribeTask(
    @ConnectedSocket() client: Socket,
    @MessageBody() taskId: string,
  ) {
    if (!this.isClientAuthenticated(client)) {
      return { event: 'error', data: { message: 'Authentication required' } };
    }

    const clientData = this.connectedClients.get(client.id);

    // Authorize against the panel org OR the CLI's org set — mirroring
    // handleSubscribeSession. Previously this only accepted `organizationId`,
    // so every CLI client got "Organization not set" and never received task
    // updates. Also makes the tenant-boundary check explicit and consistent.
    let task: { id: string } | null = null;
    if (clientData?.organizationId) {
      task = await this.prisma.task.findFirst({
        where: { id: taskId, organizationId: clientData.organizationId },
        select: { id: true },
      });
    } else if (clientData?.cliOrgIds && clientData.userId) {
      task = await this.prisma.task.findFirst({
        where: { id: taskId, organizationId: { in: clientData.cliOrgIds } },
        select: { id: true },
      });
    }

    if (!task) {
      this.logger.warn(
        `Client ${client.id} attempted to subscribe to task ${taskId} not in their org`,
      );
      return {
        event: 'error',
        data: { message: 'Task not found or not authorized' },
      };
    }

    void client.join(`task:${taskId}`);
    clientData?.rooms.add(`task:${taskId}`);
    this.logger.log(`Client ${client.id} subscribed to task:${taskId}`);
    return { event: 'subscribed', data: { taskId } };
  }

  /**
   * Client unsubscribes from a task
   */
  @SubscribeMessage('unsubscribe:task')
  handleUnsubscribeTask(
    @ConnectedSocket() client: Socket,
    @MessageBody() taskId: string,
  ) {
    void client.leave(`task:${taskId}`);
    this.logger.log(`Client ${client.id} unsubscribed from task:${taskId}`);
    return { event: 'unsubscribed', data: { taskId } };
  }

  /**
   * Emit task status update to all subscribers
   */
  emitTaskUpdate(organizationId: string, payload: TaskUpdatePayload) {
    // Emit to organization room
    this.server.to(`org:${organizationId}`).emit('task:update', payload);

    // Emit to specific task room
    this.server.to(`task:${payload.taskId}`).emit('task:update', payload);

    this.logger.debug(
      `Emitted task update: ${payload.taskId} -> ${payload.status}`,
    );
  }

  /**
   * Emit agent activity log
   */
  emitAgentLog(
    organizationId: string,
    taskId: string,
    log: {
      agentName: string;
      action: string;
      details?: Record<string, unknown>;
    },
  ) {
    const payload = {
      taskId,
      ...log,
      timestamp: new Date().toISOString(),
    };

    this.server.to(`task:${taskId}`).emit('agent:log', payload);
  }

  /**
   * Emit task completion
   */
  emitTaskCompleted(
    organizationId: string,
    taskId: string,
    result: {
      type: string;
      mergeRequestUrl?: string;
      comment?: string;
    },
  ) {
    const payload = { taskId, result };

    this.server.to(`org:${organizationId}`).emit('task:completed', payload);
    this.server.to(`task:${taskId}`).emit('task:completed', payload);
  }

  /**
   * Emit task failure
   */
  emitTaskFailed(organizationId: string, taskId: string, reason: string) {
    const payload = { taskId, reason };

    this.server.to(`org:${organizationId}`).emit('task:failed', payload);
    this.server.to(`task:${taskId}`).emit('task:failed', payload);
  }

  /**
   * Generic method to emit events to organization room
   */
  emitToOrganization(
    organizationId: string,
    event: string,
    payload: Record<string, unknown>,
  ) {
    this.server.to(`org:${organizationId}`).emit(event, payload);
    this.logger.debug(`Emitted ${event} to org:${organizationId}`);
  }

  // ─── Session Terminal Subscriptions ──────────────────────────────

  @SubscribeMessage('subscribe:session')
  async handleSubscribeSession(
    @ConnectedSocket() client: Socket,
    // The web app sends a raw string; the CLI sends `{ sessionId }`.
    @MessageBody() payload: string | { sessionId: string },
  ) {
    if (!this.isClientAuthenticated(client)) {
      return { event: 'error', data: { message: 'Authentication required' } };
    }
    const sessionId =
      typeof payload === 'string' ? payload : payload?.sessionId;
    if (!sessionId) {
      return { event: 'error', data: { message: 'sessionId required' } };
    }

    const clientData = this.connectedClients.get(client.id);

    // Authorize the session: a panel client is scoped to its org; a CLI client
    // (ctk_ token) is scoped to all its orgs.
    let authorized = false;
    if (clientData?.organizationId) {
      const s = await this.prisma.agentSession.findFirst({
        where: { id: sessionId, organizationId: clientData.organizationId },
        select: { id: true },
      });
      authorized = !!s;
    } else if (clientData?.cliOrgIds && clientData.userId) {
      const s = await this.prisma.agentSession.findFirst({
        where: {
          id: sessionId,
          organizationId: { in: clientData.cliOrgIds },
        },
        select: { id: true },
      });
      authorized = !!s;
    }
    if (!authorized) {
      return {
        event: 'error',
        data: { message: 'Session not found or not authorized' },
      };
    }

    void client.join(`session:${sessionId}`);
    clientData?.rooms.add(`session:${sessionId}`);
    this.logger.log(`Client ${client.id} subscribed to session:${sessionId}`);
    return { event: 'subscribed', data: { sessionId } };
  }

  @SubscribeMessage('unsubscribe:session')
  handleUnsubscribeSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() sessionId: string,
  ) {
    void client.leave(`session:${sessionId}`);
    this.logger.log(
      `Client ${client.id} unsubscribed from session:${sessionId}`,
    );
    return { event: 'unsubscribed', data: { sessionId } };
  }

  @SubscribeMessage('session:input')
  handleSessionInput(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { terminalId: string; input: string },
  ) {
    if (!this.isClientAuthenticated(client)) {
      return { event: 'error', data: { message: 'Authentication required' } };
    }

    // Verify client is subscribed to the session room (org ownership checked at subscribe time)
    const sessionId = data.terminalId.split(':')[0];
    const clientData = this.connectedClients.get(client.id);
    if (!clientData?.rooms.has(`session:${sessionId}`)) {
      return {
        event: 'error',
        data: { message: 'Not subscribed to this session' },
      };
    }

    this.terminalManager?.sendInput(data.terminalId, data.input);
  }

  @SubscribeMessage('session:resize')
  handleSessionResize(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { terminalId: string; cols: number; rows: number },
  ) {
    if (!this.isClientAuthenticated(client)) {
      return { event: 'error', data: { message: 'Authentication required' } };
    }

    const sessionId = data.terminalId.split(':')[0];
    const clientData = this.connectedClients.get(client.id);
    if (!clientData?.rooms.has(`session:${sessionId}`)) {
      return;
    }

    this.terminalManager?.resize(data.terminalId, data.cols, data.rows);
  }

  /**
   * Ensure a session's terminal is running and stream it — used by the CLI's
   * `attach` (the web app uses the REST startTerminal). Requires the client to
   * already be subscribed to the session. Returns the current buffer so the CLI
   * shows scrollback on connect.
   */
  @SubscribeMessage('session:attach')
  async handleSessionAttach(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; terminalId?: string },
  ) {
    if (!this.isClientAuthenticated(client)) {
      return { event: 'error', data: { message: 'Authentication required' } };
    }
    const clientData = this.connectedClients.get(client.id);
    const sessionId = data?.sessionId;
    if (!sessionId || !clientData?.rooms.has(`session:${sessionId}`)) {
      return { event: 'error', data: { message: 'Subscribe first' } };
    }
    const terminalId = data.terminalId || `${sessionId}:agent`;

    if (!this.terminalManager) {
      return { event: 'error', data: { message: 'Terminals unavailable' } };
    }

    // Already streaming → just hand back the buffer for scrollback.
    if (this.terminalManager.isActive(terminalId)) {
      return {
        event: 'attached',
        data: {
          terminalId,
          buffer: this.terminalManager.getBuffer(terminalId),
        },
      };
    }

    const session = await this.prisma.agentSession.findFirst({
      where: { id: sessionId },
      select: { status: true, containerId: true },
    });
    if (!session?.containerId || session.status !== 'RUNNING') {
      return { event: 'error', data: { message: 'Session is not running' } };
    }

    await this.terminalManager.start(
      terminalId,
      session.containerId,
      (out) => this.emitSessionOutput(terminalId, out),
      () =>
        this.emitSessionOutput(
          terminalId,
          '\r\n\x1b[90m[Process exited]\x1b[0m\r\n',
        ),
      { cmd: ['bash'] },
    );
    return {
      event: 'attached',
      data: { terminalId, buffer: this.terminalManager.getBuffer(terminalId) },
    };
  }

  /**
   * Emit terminal output (routed by terminalId)
   */
  emitSessionOutput(terminalId: string, output: string) {
    // terminalId format: "sessionId:term-xxx"
    const sessionId = terminalId.split(':')[0];
    this.server.to(`session:${sessionId}`).emit('session:output', {
      terminalId,
      data: output,
    });
  }

  /**
   * Emit session status change
   */
  emitSessionStatus(
    organizationId: string,
    sessionId: string,
    status: string,
    error?: string,
  ) {
    this.server
      .to(`org:${organizationId}`)
      .emit('session:status', { sessionId, status, error });
  }

  emitSnapshotStatus(
    organizationId: string,
    snapshotId: string,
    status: string,
    error?: string,
  ) {
    this.server
      .to(`org:${organizationId}`)
      .emit('snapshot:status', { snapshotId, status, error });
  }

  /**
   * Get connection statistics
   */
  getConnectionStats() {
    return {
      totalConnections: this.connectedClients.size,
      authenticatedConnections: Array.from(
        this.connectedClients.values(),
      ).filter((c) => c.organizationId).length,
    };
  }
}

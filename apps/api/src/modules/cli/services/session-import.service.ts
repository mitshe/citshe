import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import { SessionsService } from '../../sessions/services/sessions.service';
import { SessionContainerService } from '../../sessions/services/session-container.service';
import { EventsGateway } from '../../../infrastructure/websocket/events.gateway';
import { CliUserContext } from './cli.service';

/** Body of `POST /api/v1/cli/sessions/import`. */
export interface ImportSessionInput {
  /** Raw contents of the local `<uuid>.jsonl` history file. */
  jsonl: string;
  /** The conversation uuid (the `.jsonl` basename without the extension). */
  sessionUuid: string;
  /** Absolute path of the local project the history came from (informational). */
  projectPath?: string;
  /** Target org; defaults to the user's first org when omitted. */
  organizationId?: string;
  /** Optional session name; derived from the history when omitted. */
  name?: string;
  /** Original filename (sent by the CLI; unused server-side). */
  filename?: string;
}

/** ~20MB cap on the uploaded history (matches the raised JSON body limit). */
const MAX_JSONL_BYTES = 20 * 1024 * 1024;

/** How long we wait for the freshly-created container to report RUNNING. */
const CONTAINER_READY_TIMEOUT_MS = 90_000;

/**
 * Imports a local Claude Code conversation onto the VPS so it can be resumed
 * there. Given the raw `<uuid>.jsonl`, it:
 *   1. rewrites every line's `cwd` to `/workspace`,
 *   2. creates + starts a repo-less session container,
 *   3. stages the history at the container's `-workspace` project dir, and
 *   4. opens a shared-tmux `agent` window running `claude --resume <uuid>` so
 *      `citshe attach <id>` drops the user straight back into the conversation.
 */
@Injectable()
export class SessionImportService {
  private readonly logger = new Logger(SessionImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
    private readonly containerService: SessionContainerService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  async importSession(
    ctx: CliUserContext,
    input: ImportSessionInput,
  ): Promise<{ session: { id: string; name: string } }> {
    const jsonl = input?.jsonl;
    const sessionUuid = input?.sessionUuid?.trim();

    if (!jsonl || jsonl.trim().length === 0) {
      throw new BadRequestException('jsonl is required and must be non-empty.');
    }
    if (Buffer.byteLength(jsonl, 'utf8') > MAX_JSONL_BYTES) {
      throw new BadRequestException('History file is too large (max 20MB).');
    }
    if (
      !sessionUuid ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(sessionUuid)
    ) {
      throw new BadRequestException('sessionUuid is missing or malformed.');
    }

    // Pick the target org: the requested one (if the user is a member) else
    // the user's first org.
    if (ctx.organizationIds.length === 0) {
      throw new ForbiddenException(
        'You have no portals to import into. Create one in the panel first.',
      );
    }
    let organizationId = ctx.organizationIds[0];
    if (input.organizationId) {
      if (!ctx.organizationIds.includes(input.organizationId)) {
        throw new ForbiddenException('You do not have access to that portal.');
      }
      organizationId = input.organizationId;
    }

    const rewritten = this.rewriteCwd(jsonl);
    const name = this.deriveName(input.name, jsonl);

    // Create the DB row up-front (CREATING) so the session is visible while the
    // container boots.
    const session = await this.prisma.agentSession.create({
      data: {
        organizationId,
        name,
        instructions: '',
        status: 'CREATING',
        createdBy: ctx.userId,
      },
      select: { id: true, name: true },
    });

    try {
      // Attach the org's connected GitHub integration(s) if present (optional —
      // an imported conversation may not need a repo). Mirrors orchestration.
      const gitIntegrations = await this.prisma.integration.findMany({
        where: { organizationId, type: 'GITHUB', status: 'CONNECTED' },
        select: { id: true },
      });
      const integrationIds = gitIntegrations.map((i) => i.id);
      const integrationConfigs =
        await this.sessionsService.resolveIntegrationConfigs(
          integrationIds,
          organizationId,
          undefined,
          session.id,
        );

      // Spin up the container (no repos — imported conversations get an empty
      // /workspace).
      const containerId = await this.containerService.createAndStart(
        {
          sessionId: session.id,
          organizationId,
          repos: [],
          instructions: '',
          integrations:
            integrationConfigs.length > 0 ? integrationConfigs : undefined,
        },
        async (cid) => {
          await this.sessionsService.updateContainerId(session.id, cid);
        },
      );

      await this.sessionsService.updateStatus(
        session.id,
        'RUNNING',
        containerId,
      );
      this.eventsGateway.emitSessionStatus(
        organizationId,
        session.id,
        'RUNNING',
      );

      // Stage the (rewritten) history inside the container and open the resume
      // window.
      await this.stageHistory(containerId, sessionUuid, rewritten);
      await this.startResumeWindow(containerId, sessionUuid);

      return { session };
    } catch (err) {
      const message = (err as Error).message || 'Import failed';
      this.logger.error(`Session import ${session.id} failed: ${message}`);
      await this.sessionsService
        .updateStatus(session.id, 'FAILED')
        .catch(() => undefined);
      this.eventsGateway.emitSessionStatus(
        organizationId,
        session.id,
        'FAILED',
        message,
      );
      throw new BadRequestException(`Failed to import session: ${message}`);
    }
  }

  /**
   * Rewrite each line's `cwd` to `/workspace` so new commands in the resumed
   * conversation run in the container's workspace. Line order is preserved and
   * malformed lines pass through untouched.
   */
  private rewriteCwd(jsonl: string): string {
    // Preserve a trailing newline if present so the file round-trips.
    const trailingNewline = jsonl.endsWith('\n');
    const lines = jsonl.split('\n');
    const out = lines.map((line) => {
      if (line.trim().length === 0) return line;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        obj.cwd = '/workspace';
        return JSON.stringify(obj);
      } catch {
        return line; // tolerate malformed lines
      }
    });
    let result = out.join('\n');
    // split()+join() on a trailing-newline string yields a trailing empty
    // element that join restores; nothing to do. If there was no trailing
    // newline we must not add one.
    if (!trailingNewline && result.endsWith('\n')) {
      result = result.slice(0, -1);
    }
    return result;
  }

  /** Derive a session name from an explicit name or the first user message. */
  private deriveName(explicit: string | undefined, jsonl: string): string {
    if (explicit && explicit.trim()) return explicit.trim().slice(0, 80);
    const first = this.firstUserMessage(jsonl);
    if (first) return `Imported: ${first}`.slice(0, 80);
    return 'Imported session';
  }

  /** Best-effort extraction of the first human message for a friendly name. */
  private firstUserMessage(jsonl: string): string | null {
    for (const line of jsonl.split('\n')) {
      if (line.trim().length === 0) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (obj.type !== 'user') continue;
      const msg = obj.message as
        | { role?: string; content?: unknown }
        | undefined;
      if (!msg || msg.role !== 'user') continue;
      const text = this.extractText(msg.content);
      if (text) return text.replace(/\s+/g, ' ').trim().slice(0, 60);
    }
    return null;
  }

  /** Pull plain text out of a Claude message `content` (string or blocks). */
  private extractText(content: unknown): string | null {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const parts = content
        .map((block) => {
          if (
            block &&
            typeof block === 'object' &&
            (block as { type?: string }).type === 'text'
          ) {
            return (block as { text?: string }).text ?? '';
          }
          return '';
        })
        .filter(Boolean);
      if (parts.length > 0) return parts.join(' ');
    }
    return null;
  }

  /**
   * Write the rewritten history into the container at the `-workspace` project
   * dir, owned by executor. Uses a base64 pipe so arbitrarily-large / binary-ish
   * content survives intact. Waits for the container to be ready first.
   */
  private async stageHistory(
    containerId: string,
    sessionUuid: string,
    jsonl: string,
  ): Promise<void> {
    await this.waitForContainerReady(containerId);

    const dir = '/home/executor/.claude/projects/-workspace';
    const filePath = `${dir}/${sessionUuid}.jsonl`;
    const b64 = Buffer.from(jsonl, 'utf8').toString('base64');

    // Ensure the project dir exists and is owned by executor. execCommand runs
    // as executor with HOME=/home/executor by default.
    await this.containerService.execCommand(
      containerId,
      ['mkdir', '-p', dir],
      '/workspace',
      60_000,
      'executor',
      { throwOnError: true },
    );

    // Write via a base64 heredoc so the payload never hits argv length limits.
    await this.containerService.execCommand(
      containerId,
      [
        'bash',
        '-lc',
        `base64 -d > '${filePath}' <<'CITSHE_EOF'\n${b64}\nCITSHE_EOF`,
      ],
      '/workspace',
      120_000,
      'executor',
      { throwOnError: true },
    );

    this.logger.log(
      `Staged imported history for ${sessionUuid} in ${containerId.slice(0, 12)}`,
    );
  }

  /**
   * Open a shared-tmux `agent` window running `claude --resume <uuid>`. The
   * window name (`agent`) matches what the CLI's `session:attach` derives from
   * `${sessionId}:agent`, so when the user runs `citshe attach <id>` the
   * terminal manager finds THIS window and attaches to the live resumed claude
   * instead of spawning a fresh bash shell.
   */
  private async startResumeWindow(
    containerId: string,
    sessionUuid: string,
  ): Promise<void> {
    const tmux = 'tmux -f /etc/tmux.conf';
    const resume =
      `cd /workspace && export HOME=/home/executor && ` +
      `claude --resume ${sessionUuid} --permission-mode bypassPermissions`;
    // Shell-quote the inner command for `new-window`.
    const runCmd = `bash -lc "${resume.replace(/"/g, '\\"')}"`;

    await this.containerService.execCommand(
      containerId,
      [
        'bash',
        '-lc',
        [
          `${tmux} has-session -t citshe 2>/dev/null || ` +
            `${tmux} new-session -d -s citshe -x 200 -y 50 -c /workspace`,
          // Recreate the agent window fresh, running the resume command.
          `${tmux} kill-window -t citshe:agent 2>/dev/null || true`,
          `${tmux} new-window -t citshe -n agent -c /workspace ${runCmd}`,
        ].join('; '),
      ],
      '/workspace',
      60_000,
      'executor',
      { throwOnError: true },
    );

    this.logger.log(
      `Opened resume window for ${sessionUuid} in ${containerId.slice(0, 12)}`,
    );
  }

  /** Poll `docker inspect` until the container reports running (or times out). */
  private async waitForContainerReady(containerId: string): Promise<void> {
    const deadline = Date.now() + CONTAINER_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const state = await this.containerService.getContainerState(containerId);
      if (state === 'running') return;
      if (state === 'stopped' || state === 'gone') {
        throw new Error(`Container is ${state} — cannot stage history.`);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error('Container did not become ready in time.');
  }
}

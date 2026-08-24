import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';

export interface CliUserContext {
  userId: string;
  email: string;
  organizationIds: string[];
}

/**
 * Backs the citshe CLI: user-scoped personal access tokens (prefix `ctk_`,
 * SHA-256 hashed) that grant access to ALL of a user's organizations, plus the
 * cross-org session list and local-session import.
 */
@Injectable()
export class CliService {
  constructor(private readonly prisma: PrismaService) {}

  private hash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /** Resolve a `ctk_` token → the user + all their org ids. Throws on invalid. */
  async resolveToken(token: string): Promise<CliUserContext> {
    if (!token?.startsWith('ctk_')) {
      throw new UnauthorizedException('Not a CLI token');
    }
    const row = await this.prisma.cliToken.findFirst({
      where: { hashedKey: this.hash(token) },
      select: { id: true, userId: true, expiresAt: true },
    });
    if (!row) throw new UnauthorizedException('Invalid CLI token');
    if (row.expiresAt && row.expiresAt < new Date()) {
      throw new UnauthorizedException('CLI token expired');
    }
    // Best-effort last-used stamp.
    this.prisma.cliToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return this.contextForUser(row.userId);
  }

  /** All org ids a user can see (memberships + owned). */
  async contextForUser(userId: string): Promise<CliUserContext> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        memberships: { select: { organizationId: true } },
        ownedOrganizations: { select: { id: true } },
      },
    });
    if (!user) throw new UnauthorizedException('User not found');
    const orgIds = new Set<string>();
    user.memberships.forEach((m) => orgIds.add(m.organizationId));
    user.ownedOrganizations.forEach((o) => orgIds.add(o.id));
    return {
      userId: user.id,
      email: user.email,
      organizationIds: [...orgIds],
    };
  }

  // ─── Token management (called from the panel) ───────────────────

  /** Mint a token row and return its plaintext (stored only hashed). */
  private async mintToken(userId: string, name: string) {
    const token = `ctk_${crypto.randomBytes(32).toString('hex')}`;
    const created = await this.prisma.cliToken.create({
      data: {
        userId,
        name: name?.slice(0, 100) || 'CLI token',
        prefix: token.slice(0, 12),
        hashedKey: this.hash(token),
      },
      select: { id: true, name: true, prefix: true, createdAt: true },
    });
    return { ...created, token };
  }

  async createToken(userId: string, name: string) {
    // The full token is shown ONCE, here — never stored in the clear.
    return this.mintToken(userId, name);
  }

  // ─── Browser SSO (device authorization, like `gh auth login`) ────

  /** Start a login: the CLI keeps deviceCode, the user approves userCode. */
  async startDeviceAuth() {
    // userCode is short + human-friendly (avoid ambiguous chars).
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const userCode = Array.from(
      { length: 8 },
      () => alphabet[crypto.randomInt(alphabet.length)],
    )
      .join('')
      .replace(/(.{4})(.{4})/, '$1-$2');
    const deviceCode = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    await this.prisma.cliAuthRequest.create({
      data: { deviceCode, userCode, expiresAt },
    });
    return { deviceCode, userCode, expiresIn: 600 };
  }

  /** The CLI polls this with its deviceCode until approved. */
  async pollDeviceAuth(deviceCode: string) {
    const req = await this.prisma.cliAuthRequest.findUnique({
      where: { deviceCode },
    });
    if (!req || req.expiresAt < new Date()) return { status: 'expired' };
    if (req.status === 'denied') return { status: 'denied' };
    if (req.status === 'approved' && req.token) {
      // Deliver the token exactly once, then clear it.
      await this.prisma.cliAuthRequest.update({
        where: { deviceCode },
        data: { token: null },
      });
      return { status: 'approved', token: req.token };
    }
    return { status: 'pending' };
  }

  /** Panel side: look up a pending request by the code the user sees. */
  async getPendingByUserCode(userCode: string) {
    const req = await this.prisma.cliAuthRequest.findUnique({
      where: { userCode: userCode.trim().toUpperCase() },
      select: { id: true, status: true, expiresAt: true, createdAt: true },
    });
    if (!req || req.expiresAt < new Date()) return null;
    return req;
  }

  /** Panel side: the logged-in user approves → mint a token for them. */
  async approveDeviceAuth(userId: string, userCode: string) {
    const code = userCode.trim().toUpperCase();
    const req = await this.prisma.cliAuthRequest.findUnique({
      where: { userCode: code },
    });
    if (!req || req.expiresAt < new Date()) {
      throw new NotFoundException('Login request not found or expired');
    }
    if (req.status !== 'pending') {
      throw new UnauthorizedException('This request was already handled');
    }
    const { token } = await this.mintToken(userId, 'CLI (browser login)');
    await this.prisma.cliAuthRequest.update({
      where: { userCode: code },
      data: { status: 'approved', userId, token },
    });
    return { ok: true };
  }

  async denyDeviceAuth(userCode: string) {
    const code = userCode.trim().toUpperCase();
    await this.prisma.cliAuthRequest
      .update({ where: { userCode: code }, data: { status: 'denied' } })
      .catch(() => undefined);
    return { ok: true };
  }

  async listTokens(userId: string) {
    return this.prisma.cliToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
  }

  async deleteToken(userId: string, id: string) {
    const row = await this.prisma.cliToken.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Token not found');
    await this.prisma.cliToken.delete({ where: { id } });
    return { ok: true };
  }

  // ─── CLI data ───────────────────────────────────────────────────

  async me(ctx: CliUserContext) {
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: ctx.organizationIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return {
      user: { id: ctx.userId, email: ctx.email },
      organizations: orgs,
    };
  }

  /** Sessions across every org the user can see, newest first. */
  async sessions(ctx: CliUserContext) {
    if (ctx.organizationIds.length === 0) return [];
    const rows = await this.prisma.agentSession.findMany({
      where: { organizationId: { in: ctx.organizationIds } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        name: true,
        status: true,
        organizationId: true,
        updatedAt: true,
        organization: { select: { name: true } },
        repositories: {
          select: { repository: { select: { name: true } } },
          take: 1,
        },
      },
    });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      organizationId: s.organizationId,
      organizationName: s.organization?.name ?? '',
      repositoryName: s.repositories[0]?.repository?.name ?? null,
      updatedAt: s.updatedAt,
    }));
  }

  /** Verify a session belongs to one of the user's orgs (for socket attach). */
  async canAccessSession(
    ctx: CliUserContext,
    sessionId: string,
  ): Promise<boolean> {
    if (ctx.organizationIds.length === 0) return false;
    const s = await this.prisma.agentSession.findFirst({
      where: { id: sessionId, organizationId: { in: ctx.organizationIds } },
      select: { id: true },
    });
    return !!s;
  }

  /**
   * Resolve a full session id from an exact id or a short PREFIX (the CLI's
   * `ls` shows shortened ids), scoped to the given orgs. Returns the full id or
   * null (also null if the prefix is ambiguous).
   */
  async resolveSessionId(
    orgIds: string[],
    idOrPrefix: string,
  ): Promise<string | null> {
    if (!idOrPrefix || orgIds.length === 0) return null;
    // Exact match first.
    const exact = await this.prisma.agentSession.findFirst({
      where: { id: idOrPrefix, organizationId: { in: orgIds } },
      select: { id: true },
    });
    if (exact) return exact.id;
    // Prefix match — unique only.
    const matches = await this.prisma.agentSession.findMany({
      where: {
        id: { startsWith: idOrPrefix },
        organizationId: { in: orgIds },
      },
      select: { id: true },
      take: 2,
    });
    return matches.length === 1 ? matches[0].id : null;
  }
}

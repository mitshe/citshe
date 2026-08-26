import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Docker from 'dockerode';
import * as tar from 'tar-fs';
import { PluginsService } from '../../plugins/services/plugins.service';

export interface SessionContainerConfig {
  sessionId: string;
  organizationId: string;
  repos: Array<{ name: string; cloneUrl: string; branch: string }>;
  instructions: string;
  provider?: string; // e.g. CLAUDE_CODE_LOCAL, OPENCLAW
  enableDocker?: boolean;
  enableBrowser?: boolean;
  environment?: {
    memoryMb?: number | null;
    cpuCores?: number | null;
    setupScript?: string | null;
    variables?: Array<{ key: string; value: string }>;
  };
  integrations?: Array<{
    type: string;
    config: Record<string, string>;
  }>;
  skills?: Array<{
    name: string;
    instructions: string;
  }>;
  /**
   * Override the base image. Used when recreating a session from a
   * committed snapshot so /workspace contents are preserved.
   * Defaults to the configured executor image.
   */
  image?: string;
  localPath?: string;
  /**
   * Short-lived signed token that lets a worker create follow-up tasks on the
   * board via POST /api/v1/worker/tasks. Injected as CITSHE_WORKER_TOKEN.
   */
  workerToken?: string;
  /**
   * The task this worker is running, injected as CITSHE_TASK_ID so the agent
   * can attach screenshots to it (citshe-shot).
   */
  workerTaskId?: string;
  /**
   * Env for connected stack tools (CLOUDFLARE_API_TOKEN, VERCEL_TOKEN, …) so the
   * session can act on the stack directly (wrangler/vercel/neonctl). Decrypted
   * from the org's connected plugins.
   */
  stackEnv?: Record<string, string>;
}

/**
 * Manages Docker containers for agent sessions.
 * Container lifecycle, file operations, git status.
 * Terminal management is delegated to TerminalManagerService.
 */
@Injectable()
export class SessionContainerService implements OnModuleInit {
  private readonly logger = new Logger(SessionContainerService.name);
  private docker: Docker;
  private readonly executorImage: string;
  private readonly containerPrefix = 'citshe-session';

  constructor(
    private configService: ConfigService,
    private readonly pluginsService: PluginsService,
  ) {
    this.docker = new Docker();
    this.executorImage =
      this.configService.get<string>('EXECUTOR_IMAGE') ||
      'ghcr.io/mitshe/citshe-executor:latest';
  }

  async onModuleInit() {
    await this.cleanupStaleContainers();
  }

  // ─── Claude auth seeding ──────────────────────────────────────────
  // Each org has its own `citshe-executor-home-<org>` volume, so a NEW portal
  // starts with an empty home and no Claude login ("Not logged in · Please run
  // /login"). To fix this once for all portals, a shared volume named by
  // CLAUDE_AUTH_SEED_VOLUME holds a `.credentials.json`, mounted read-only at
  // /seed. On container start we copy it into the org's home ONLY if that org
  // has no credentials yet — so an already-authed org keeps its own (refreshed)
  // token. Unset the env → no seeding (old behaviour).

  /**
   * Git commit identity env, read from config (GIT_COMMIT_NAME /
   * GIT_COMMIT_EMAIL) — never hardcoded. Sets GIT_AUTHOR_* + GIT_COMMITTER_*
   * so every commit the worker makes is attributed to the configured identity
   * (git honours these over `git config`). Returns [] when not configured.
   */
  private commitIdentityEnv(): string[] {
    const name = this.configService.get<string>('GIT_COMMIT_NAME');
    const email = this.configService.get<string>('GIT_COMMIT_EMAIL');
    if (!name || !email) return [];
    return [
      `GIT_AUTHOR_NAME=${name}`,
      `GIT_AUTHOR_EMAIL=${email}`,
      `GIT_COMMITTER_NAME=${name}`,
      `GIT_COMMITTER_EMAIL=${email}`,
    ];
  }

  /** The shared seed volume name, or null when seeding is disabled. */
  private claudeAuthSeedVolume(): string | null {
    return this.configService.get<string>('CLAUDE_AUTH_SEED_VOLUME') || null;
  }

  /**
   * Is the Claude engine logged in? Reads the shared seed credential (a tiny
   * throwaway container) and checks it has a usable token — a non-empty
   * accessToken, or a refreshToken whose expiry is still in the future. Used to
   * gate the New-project wizard so a build never starts against a dead login.
   * Returns { ok, reason } — ok:true when seeding is disabled (can't tell, so
   * don't block).
   */
  async checkEngineAuth(): Promise<{ ok: boolean; reason?: string }> {
    const vol = this.claudeAuthSeedVolume();
    if (!vol) return { ok: true };
    try {
      const container = await this.docker.createContainer({
        Image: 'alpine',
        Entrypoint: ['sh', '-c'],
        Cmd: ['cat /seed/.credentials.json 2>/dev/null || true'],
        HostConfig: { Binds: [`${vol}:/seed:ro`], AutoRemove: true },
      });
      await container.start();
      const stream = await container.logs({
        stdout: true,
        stderr: false,
        follow: true,
      });
      const raw = await new Promise<string>((resolve) => {
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        stream.on('error', () => resolve(''));
      });
      // Strip docker log framing (8-byte header per frame) then find JSON.
      const jsonStart = raw.indexOf('{');
      if (jsonStart < 0) return { ok: false, reason: 'not-logged-in' };
      const parsed = JSON.parse(raw.slice(jsonStart)) as {
        claudeAiOauth?: {
          accessToken?: string;
          expiresAt?: number;
          refreshToken?: string;
          refreshTokenExpiresAt?: number;
        };
      };
      const oauth = parsed.claudeAiOauth;
      if (!oauth) return { ok: false, reason: 'not-logged-in' };
      // A usable engine = access token that is present AND NOT expired, OR a
      // live refresh token to mint a new one. Presence alone is NOT enough — an
      // expired-but-non-empty token passed the gate and then died in the worker.
      const accessUsable =
        !!oauth.accessToken &&
        typeof oauth.expiresAt === 'number' &&
        oauth.expiresAt > Date.now();
      const canRefresh =
        !!oauth.refreshToken &&
        typeof oauth.refreshTokenExpiresAt === 'number' &&
        oauth.refreshTokenExpiresAt > Date.now();
      if (accessUsable || canRefresh) return { ok: true };
      return { ok: false, reason: 'expired' };
    } catch (err) {
      // Fail CLOSED: if we can't verify the engine login, block the build with a
      // clear reason rather than let it start and die silently in the worker.
      this.logger.warn(`checkEngineAuth failed: ${(err as Error).message}`);
      return { ok: false, reason: 'unknown' };
    }
  }

  /**
   * Bind of the seed volume at /seed. READ-WRITE so a container can push its
   * refreshed Claude token back to the seed (auto-propagation): Claude Code
   * refreshes the access token from the long-lived refresh token, and we sync
   * that fresh token to /seed so NEW portals always seed a working login.
   */
  private claudeAuthSeedBind(): string[] {
    const vol = this.claudeAuthSeedVolume();
    return vol ? [`${vol}:/seed`] : [];
  }

  /**
   * Startup shell that seeds Claude credentials into a fresh org home. Runs as
   * root before dropping to executor; no-op when seeding is off or the org is
   * already authed. Always ends with a trailing "; ".
   */
  private claudeAuthSeedCmd(): string {
    if (!this.claudeAuthSeedVolume()) return '';
    // Copy the seed in when the org's own login is MISSING, BLANK, or STALER
    // than the seed. Previously we only re-seeded on missing/blank tokens, so an
    // org whose token was non-empty-but-expired (and un-refreshable) stayed
    // stuck on a dead login forever even after /seed was healed. A tiny node
    // comparison of expiresAt decides "should I take the seed?". Fails safe:
    // any error → fall back to the old missing/blank check.
    const decide =
      `node -e '` +
      `try{` +
      `const fs=require("fs");` +
      `const S=JSON.parse(fs.readFileSync("/seed/.credentials.json","utf8")).claudeAiOauth||{};` +
      `let M={};try{M=JSON.parse(fs.readFileSync("/home/executor/.claude/.credentials.json","utf8")).claudeAiOauth||{}}catch(e){process.exit(0)/*mine missing → seed*/}` +
      `const mineDead=!M.accessToken||(typeof M.expiresAt==="number"&&M.expiresAt<=Date.now());` +
      `const seedNewer=(S.expiresAt||0)>(M.expiresAt||0);` +
      `process.exit(mineDead||seedNewer?0:1);` +
      `}catch(e){process.exit(1)}` +
      `'`;
    return (
      `if [ -s /seed/.credentials.json ] && ` +
      `( [ ! -s /home/executor/.claude/.credentials.json ] || ${decide} ); then ` +
      `mkdir -p /home/executor/.claude && ` +
      `cp /seed/.credentials.json /home/executor/.claude/.credentials.json && ` +
      `chown -R executor:executor /home/executor/.claude; fi; `
    );
  }

  /**
   * Keep the shared Claude login warm INDEPENDENTLY of any running portal. The
   * access token lives ~8h and was only ever refreshed as a side-effect of an
   * active container — so if every portal idles for >8h, the seed rotted and
   * the next new portal got a dead login ("OAuth session expired"). This spins a
   * throwaway executor that mounts the seed read-write, and — only when the
   * token is within ~2h of expiry — forces a real refresh (a tiny `claude
   * --print`, since `claude auth status` does NOT refresh) and writes the fresh
   * credentials back to the seed. Runs off the watchdog (~every 5 min); the
   * refresh itself fires rarely (near expiry). Best-effort; never throws.
   */
  async keepClaudeAuthWarm(): Promise<void> {
    const vol = this.claudeAuthSeedVolume();
    if (!vol) return;
    // Only act when the seed token is within 2h of expiry (or already dead).
    // Cheap pre-check via a tiny alpine read so we don't spin an executor every
    // 5 min for nothing.
    const NEAR_EXPIRY_MS = 2 * 3600_000;
    try {
      const probe = await this.docker.createContainer({
        Image: 'alpine',
        Entrypoint: ['sh', '-c'],
        Cmd: [
          `grep -o '"expiresAt":[0-9]*' /seed/.credentials.json 2>/dev/null | head -1 | grep -o '[0-9]*' || echo 0`,
        ],
        HostConfig: { Binds: [`${vol}:/seed:ro`], AutoRemove: true },
      });
      await probe.start();
      const logs = await probe.logs({
        stdout: true,
        stderr: false,
        follow: true,
      });
      const raw = await new Promise<string>((resolve) => {
        const chunks: Buffer[] = [];
        logs.on('data', (c: Buffer) => chunks.push(c));
        logs.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        logs.on('error', () => resolve(''));
      });
      const expiresAt = parseInt(raw.replace(/[^0-9]/g, ''), 10) || 0;
      if (expiresAt && expiresAt - Date.now() > NEAR_EXPIRY_MS) return; // still fresh
    } catch {
      return; // can't probe → skip quietly
    }

    // Near expiry: spin a full executor to force a refresh, then push back.
    this.logger.log('Claude seed near expiry — refreshing it (keep-warm).');
    try {
      const refresher = await this.docker.createContainer({
        Image: this.executorImage,
        User: 'root',
        Entrypoint: ['bash', '-c'],
        Cmd: [
          // seed → home, force refresh via a tiny print, push fresh token back.
          `mkdir -p /home/executor/.claude && ` +
            `cp /seed/.credentials.json /home/executor/.claude/.credentials.json && ` +
            `chown -R executor:executor /home/executor/.claude && ` +
            `su -s /bin/bash executor -c 'export HOME=/home/executor; ` +
            `printf ok | claude --print --permission-mode bypassPermissions ` +
            `--output-format stream-json --verbose --max-turns 1 >/dev/null 2>&1 || true' && ` +
            // Only overwrite the seed if the refreshed token is newer.
            `node -e 'const fs=require("fs");` +
            `const S=JSON.parse(fs.readFileSync("/seed/.credentials.json","utf8")).claudeAiOauth||{};` +
            `const M=JSON.parse(fs.readFileSync("/home/executor/.claude/.credentials.json","utf8")).claudeAiOauth||{};` +
            `if((M.expiresAt||0)>(S.expiresAt||0)){fs.copyFileSync("/home/executor/.claude/.credentials.json","/seed/.credentials.json.tmp");fs.renameSync("/seed/.credentials.json.tmp","/seed/.credentials.json");console.log("seed refreshed")}'`,
        ],
        HostConfig: {
          Binds: [`${vol}:/seed:rw`],
          AutoRemove: true,
          NetworkMode: 'bridge',
        },
      });
      await refresher.start();
      await refresher.wait();
      this.logger.log('Claude seed keep-warm cycle done.');
    } catch (err) {
      this.logger.warn(`Claude keep-warm failed: ${(err as Error).message}`);
    }
  }

  /**
   * Remove an org's per-org home volume (citshe-executor-home-<org>) and any of
   * its lingering session containers. Called when a portal is deleted — the DB
   * rows cascade, but the Docker volume (which held the org's Claude auth) and
   * stopped containers would otherwise be orphaned on the host forever.
   * Best-effort; never throws.
   */
  async removeOrgDockerResources(organizationId: string): Promise<void> {
    // Stop+remove any session containers for this org's sessions. We can't map
    // container→org by name (name is by sessionId), so this is handled by the
    // orphan sweep; here we just drop the per-org home volume which IS named by
    // org.
    try {
      const vol = this.docker.getVolume(
        `citshe-executor-home-${organizationId}`,
      );
      await vol.remove({ force: true });
      this.logger.log(`Removed home volume for deleted org ${organizationId}.`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (!/no such volume|not found|404/i.test(msg)) {
        this.logger.warn(
          `Could not remove home volume for ${organizationId}: ${msg}`,
        );
      }
    }
  }

  /**
   * Orphan sweep: remove citshe session containers and per-org home volumes
   * whose backing DB row no longer exists (e.g. an org deleted directly in the
   * DB, or a container left after a crash). Called on startup + periodically.
   * `liveSessionIds` / `liveOrgIds` are the sets that DO exist in the DB.
   * Best-effort; never throws.
   */
  async sweepOrphans(
    liveSessionIds: Set<string>,
    liveOrgIds: Set<string>,
  ): Promise<void> {
    // Orphaned session containers.
    try {
      const containers = await this.docker.listContainers({ all: true });
      for (const c of containers) {
        const name = (c.Names?.[0] || '').replace(/^\//, '');
        const m = name.match(/^citshe-session-(.+)$/);
        if (!m) continue;
        if (liveSessionIds.has(m[1])) continue;
        try {
          const container = this.docker.getContainer(c.Id);
          await container.remove({ force: true });
          this.logger.log(`Swept orphan session container ${name}.`);
        } catch {
          /* best-effort */
        }
      }
    } catch (err) {
      this.logger.warn(
        `Orphan container sweep failed: ${(err as Error).message}`,
      );
    }
    // Orphaned per-org home volumes.
    try {
      const { Volumes } = await this.docker.listVolumes();
      for (const v of Volumes || []) {
        const m = v.Name.match(/^citshe-executor-home-(.+)$/);
        if (!m) continue;
        if (liveOrgIds.has(m[1])) continue;
        try {
          await this.docker.getVolume(v.Name).remove({ force: true });
          this.logger.log(`Swept orphan home volume ${v.Name}.`);
        } catch {
          /* volume may be in use — skip */
        }
      }
    } catch (err) {
      this.logger.warn(`Orphan volume sweep failed: ${(err as Error).message}`);
    }
  }

  // ─── Claude re-login from the panel (no terminal) ────────────────
  // The engine login (Claude subscription) occasionally expires. Instead of
  // making the user SSH in and run `claude /login`, we drive `claude
  // setup-token` (a LONG-LIVED, ~1-year token) from the panel: start() spins a
  // dedicated container, runs setup-token in a tmux window, and returns the
  // authorize URL; the user opens it, approves, copies the code, pastes it in
  // the panel; submit() feeds the code to the waiting process and, on success,
  // writes the fresh long-lived token to the shared seed for all portals.

  private readonly RELOGIN_CONTAINER = 'citshe-relogin';
  private readonly RELOGIN_TMUX = 'tmux -f /etc/tmux.conf';

  /** Run a command in the relogin container; returns stdout (best-effort). */
  private async reloginExec(cmd: string[]): Promise<string> {
    const c = this.docker.getContainer(this.RELOGIN_CONTAINER);
    const exec = await c.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      User: 'executor',
      Env: ['HOME=/home/executor'],
      Tty: false,
    });
    const stream = await exec.start({});
    return new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      stream.on('data', (d: Buffer) => chunks.push(d));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', () => resolve(''));
    });
  }

  /**
   * Start a panel-driven Claude re-login. Spins a dedicated container, launches
   * `claude setup-token` inside a tmux window, waits for the authorize URL to
   * appear, and returns it. The container stays up until submit() (or a reap).
   */
  async reloginStart(): Promise<{ ok: boolean; url?: string; error?: string }> {
    // Clean any leftover container from a previous attempt.
    await this.reloginCleanup();
    try {
      const container = await this.docker.createContainer({
        name: this.RELOGIN_CONTAINER,
        Image: this.executorImage,
        User: 'root',
        Entrypoint: ['bash', '-c'],
        // Keep the container alive and start the shared tmux as executor.
        Cmd: [
          `chown -R executor:executor /home/executor 2>/dev/null; ` +
            `su -s /bin/bash executor -c '${this.RELOGIN_TMUX} new-session -d -s citshe -x 200 -y 50'; ` +
            `sleep 3600`,
        ],
        HostConfig: {
          Binds: this.claudeAuthSeedVolume()
            ? [`${this.claudeAuthSeedVolume()}:/seed:rw`]
            : [],
          AutoRemove: false,
          NetworkMode: 'bridge',
        },
      });
      await container.start();
      // Give tmux a moment, then launch setup-token in a window and pipe its
      // pane to a log we can read the URL from.
      await this.sleepMs(1500);
      await this.reloginExec([
        'bash',
        '-c',
        `export HOME=/home/executor; ` +
          `${this.RELOGIN_TMUX} new-window -t citshe -n login; ` +
          `${this.RELOGIN_TMUX} pipe-pane -t citshe:login -o 'cat >> /tmp/relogin.log'; ` +
          `${this.RELOGIN_TMUX} send-keys -t citshe:login 'claude setup-token' Enter`,
      ]);

      // Poll the log for the authorize URL (up to ~20s).
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const log = await this.reloginExec([
          'sh',
          '-c',
          'cat /tmp/relogin.log 2>/dev/null || true',
        ]);
        const url = this.extractOauthUrl(log);
        if (url) return { ok: true, url };
        await this.sleepMs(1500);
      }
      await this.reloginCleanup();
      return {
        ok: false,
        error: "Couldn't get the sign-in link from Claude. Try again.",
      };
    } catch (err) {
      await this.reloginCleanup();
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * Finish a panel-driven re-login: paste the code into the waiting setup-token
   * process, wait for a fresh credential to be written, sync it to the shared
   * seed, and tear down the container.
   */
  async reloginSubmit(
    code: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const clean = (code || '').trim();
    if (!clean) return { ok: false, error: 'Paste the code from Claude first.' };
    try {
      // Type the code into the waiting prompt.
      await this.reloginExec([
        'bash',
        '-c',
        `export HOME=/home/executor; ` +
          `${this.RELOGIN_TMUX} send-keys -t citshe:login '${clean.replace(/'/g, "")}' Enter`,
      ]);

      // Wait for a valid, non-expired credential to land (up to ~30s).
      const deadline = Date.now() + 30_000;
      let ok = false;
      while (Date.now() < deadline) {
        const check = await this.reloginExec([
          'node',
          '-e',
          `try{const o=require('/home/executor/.claude/.credentials.json').claudeAiOauth||{};` +
            `process.stdout.write(o.accessToken&&(!o.expiresAt||o.expiresAt>Date.now())?'OK':'NO')}catch(e){process.stdout.write('NO')}`,
        ]);
        if (check.includes('OK')) {
          ok = true;
          break;
        }
        await this.sleepMs(2000);
      }
      if (!ok) {
        await this.reloginCleanup();
        return {
          ok: false,
          error: 'That code was rejected or timed out. Start again and retry.',
        };
      }

      // Push the fresh (long-lived) token to the shared seed for all portals.
      await this.reloginExec([
        'sh',
        '-c',
        `cp /home/executor/.claude/.credentials.json /seed/.credentials.json.tmp && ` +
          `mv /seed/.credentials.json.tmp /seed/.credentials.json`,
      ]);
      await this.reloginCleanup();
      return { ok: true };
    } catch (err) {
      await this.reloginCleanup();
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Pull the Claude OAuth authorize URL out of the setup-token pane log. */
  private extractOauthUrl(log: string): string | undefined {
    // The URL may be wrapped in OSC-8 hyperlink escapes and repeated; grab the
    // first clean https://claude.com/…authorize?…state=… occurrence.
    const m = log.match(
      /https:\/\/claude\.com\/[^\s"]*authorize\?[^\s"]*/,
    );
    return m ? m[0] : undefined;
  }

  private async reloginCleanup(): Promise<void> {
    try {
      const c = this.docker.getContainer(this.RELOGIN_CONTAINER);
      await c.remove({ force: true });
    } catch {
      /* not present — fine */
    }
  }

  private sleepMs(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ─── Container Lifecycle ────────────────────────────────────────

  async createAndStart(
    config: SessionContainerConfig,
    onStarted?: (containerId: string) => Promise<void> | void,
  ): Promise<string> {
    const containerName = `${this.containerPrefix}-${config.sessionId}`;

    // Inject connected stack tool credentials (wrangler/vercel/neonctl/…) so the
    // session can act on the stack directly. Best-effort — never block a
    // container start on this.
    if (!config.stackEnv) {
      try {
        const { env } = await this.pluginsService.getSessionEnv(
          config.organizationId,
        );
        config = { ...config, stackEnv: env };
      } catch (err) {
        this.logger.warn(
          `Could not resolve stack env for ${config.organizationId}: ${(err as Error).message}`,
        );
      }
    }

    const sessionConfig = Buffer.from(
      JSON.stringify({
        repos: config.repos,
        instructions: config.instructions,
        provider: config.provider,
        integrations: config.integrations,
        skills: config.skills,
        hasLocalPath: !!config.localPath,
      }),
    ).toString('base64');

    this.logger.log(`Creating session container: ${containerName}`);

    let container: Docker.Container;
    try {
      container = await this.docker.createContainer({
        Image: config.image ?? this.executorImage,
        name: containerName,
        User: 'root',
        Entrypoint: ['bash', '-c'],
        Cmd: [
          `chown -R executor:executor /home/executor 2>/dev/null; ` +
            // Seed Claude auth for a fresh per-org home volume: if this org has
            // no credentials yet, copy them from the shared seed (mounted RO at
            // /seed). Existing/authed orgs keep their own (possibly refreshed)
            // credentials. This is why a NEW portal is "Not logged in" without
            // it — every org gets its own empty /home/executor volume.
            this.claudeAuthSeedCmd() +
            `if [ -d /var/lib/docker ]; then dockerd &>/var/log/dockerd.log & for i in $(seq 1 30); do docker info &>/dev/null && break || sleep 1; done; fi; ` +
            (config.environment?.setupScript
              ? `echo "$SETUP_SCRIPT_B64" | base64 -d > /tmp/.setup.sh && chmod +x /tmp/.setup.sh && su -s /bin/bash executor -c "bash /tmp/.setup.sh" && rm -f /tmp/.setup.sh; `
              : '') +
            `exec su -s /bin/bash executor -c "node /session/server.js"`,
        ],
        ExposedPorts: { '6080/tcp': {} },
        Env: [
          `SESSION_CONFIG=${sessionConfig}`,
          'DISPLAY=:99',
          // FORCE the commit identity via env (git honours GIT_AUTHOR_* /
          // GIT_COMMITTER_* over config). Inherited by tmux + every shell, so
          // the agent can't accidentally commit as "Citshe Builder Agent".
          // Values come from the API env (GIT_COMMIT_NAME / GIT_COMMIT_EMAIL set
          // in .env) — never hardcoded. Skipped entirely when not configured.
          ...this.commitIdentityEnv(),
          // Setup script as base64 (decoded safely in Cmd, avoids shell injection)
          ...(config.environment?.setupScript
            ? [
                `SETUP_SCRIPT_B64=${Buffer.from(config.environment.setupScript).toString('base64')}`,
              ]
            : []),
          // Custom env vars from environment config
          ...(config.environment?.variables?.map(
            (v) => `${v.key}=${v.value}`,
          ) || []),
          // Connected stack tool credentials (wrangler/vercel/neonctl/…).
          ...Object.entries(config.stackEnv || {}).map(([k, v]) => `${k}=${v}`),
          // Let the worker create follow-up tasks (citshe-task) and attach
          // screenshots to its task (citshe-shot).
          ...(config.workerToken
            ? [
                'CITSHE_API_URL=http://api:3001',
                `CITSHE_WORKER_TOKEN=${config.workerToken}`,
                ...(config.workerTaskId
                  ? [`CITSHE_TASK_ID=${config.workerTaskId}`]
                  : []),
              ]
            : []),
        ],
        WorkingDir: '/workspace',
        Labels: {
          'citshe.type': 'session',
          'citshe.session-id': config.sessionId,
          'citshe.organization-id': config.organizationId,
          'citshe.created-at': new Date().toISOString(),
        },
        HostConfig: {
          Binds: [
            `citshe-executor-home-${config.organizationId}:/home/executor`,
            ...this.claudeAuthSeedBind(),
            ...(config.enableDocker
              ? [`citshe-dind-${config.sessionId}:/var/lib/docker`]
              : []),
          ],
          PortBindings: {
            '6080/tcp': [{ HostPort: '0' }], // noVNC on random host port
          },
          ShmSize: 512 * 1024 * 1024, // 512MB shared memory for Chrome
          Memory: (config.environment?.memoryMb || 8192) * 1024 * 1024,
          NanoCpus: (config.environment?.cpuCores || 2) * 1e9,
          PidsLimit: config.enableDocker ? 1024 : 512,
          NetworkMode: process.env.DOCKER_NETWORK || 'bridge',
          // DinD requires privileged mode to run nested Docker daemon
          Privileged: config.enableDocker || false,
          SecurityOpt: config.enableDocker
            ? [] // privileged mode overrides security opts
            : ['no-new-privileges:true'],
          CapDrop: config.enableDocker ? [] : ['ALL'],
          CapAdd: config.enableDocker
            ? [] // privileged grants all capabilities
            : ['CHOWN', 'SETUID', 'SETGID', 'DAC_OVERRIDE'],
        },
      });
    } catch (err) {
      const message = (err as Error).message || '';
      if (message.includes('No such image') || message.includes('not found')) {
        throw new BadRequestException(
          'Executor image not built. Run `just executor-build` on the server.',
        );
      }
      throw new Error(
        `Failed to create session container. Make sure Docker is running. (${message})`,
      );
    }

    await container.start();

    const containerId = container.id;

    // Persist the container id as early as possible (before the potentially
    // long copy/setup steps below). This lets the session be reconciled to
    // RUNNING even if the process restarts mid-boot — otherwise the session
    // could stay stuck in CREATING forever while its container is running.
    if (onStarted) {
      try {
        await onStarted(containerId);
      } catch (err) {
        this.logger.warn(
          `onStarted callback failed for ${containerName}: ${(err as Error).message}`,
        );
      }
    }

    // Copy local folder into container (isolated copy, not a bind mount)
    if (config.localPath) {
      await this.copyLocalPath(container, config.localPath);
    }

    this.logger.log(
      `Session container started: ${containerName} (${containerId.slice(0, 12)})`,
    );

    return containerId;
  }

  private async copyLocalPath(
    container: Docker.Container,
    localPath: string,
  ): Promise<void> {
    const mkdirExec = await container.exec({
      Cmd: ['mkdir', '-p', '/workspace/local'],
      User: 'root',
    });
    await mkdirExec.start({});

    const tarStream = tar.pack(localPath);
    await container.putArchive(tarStream, { path: '/workspace/local' });

    const chownExec = await container.exec({
      Cmd: ['chown', '-R', 'executor:executor', '/workspace/local'],
      User: 'root',
    });
    await chownExec.start({});

    // Signal to server.js that local files are ready
    const touchExec = await container.exec({
      Cmd: ['touch', '/workspace/.local-ready'],
      User: 'root',
    });
    await touchExec.start({});

    this.logger.log(`Copied local path into container: ${localPath}`);
  }

  async stopContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.stop({ t: 5 });
    } catch (err) {
      if (!err.statusCode || err.statusCode !== 304) {
        this.logger.warn(`Failed to stop container: ${(err as Error).message}`);
      }
    }
  }

  async removeContainer(
    containerId: string,
    sessionId?: string,
  ): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.remove({ force: true });
    } catch (err) {
      this.logger.warn(`Failed to remove container: ${(err as Error).message}`);
    }

    // Cleanup DinD volume if exists
    if (sessionId) {
      try {
        const volume = this.docker.getVolume(`citshe-dind-${sessionId}`);
        await volume.remove();
      } catch {
        // Volume may not exist (non-DinD session)
      }
    }
  }

  async isContainerRunning(containerId: string): Promise<boolean> {
    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();
      return info.State.Running === true;
    } catch {
      return false;
    }
  }

  /**
   * Returns container state: 'running', 'stopped' (exists but not running), or 'gone'.
   */
  async getContainerState(
    containerId: string,
  ): Promise<'running' | 'stopped' | 'gone'> {
    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();
      return info.State.Running ? 'running' : 'stopped';
    } catch {
      return 'gone';
    }
  }

  /**
   * Restart a stopped container (e.g. after host reboot / Exited 255).
   */
  async restartContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.start();
    this.logger.log(`Restarted stopped container: ${containerId.slice(0, 12)}`);
  }

  /**
   * Get the host-mapped port for noVNC (port 6080 inside container).
   */
  async getBrowserPort(containerId: string): Promise<number | null> {
    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();
      const portBindings = info.NetworkSettings.Ports['6080/tcp'];
      if (portBindings && portBindings.length > 0) {
        return parseInt(portBindings[0].HostPort, 10);
      }
    } catch {
      // container may not exist
    }
    return null;
  }

  /**
   * Start browser (Xvfb + VNC + noVNC) inside a running container.
   * Idempotent — safe to call multiple times.
   */
  async startBrowser(containerId: string): Promise<void> {
    // Check if Xvfb already running
    const check = await this.execCommand(
      containerId,
      [
        'bash',
        '-c',
        'pgrep -x Xvfb >/dev/null 2>&1 && echo running || echo stopped',
      ],
      '/workspace',
      5000,
      'root',
    );

    if (check.trim() === 'running') {
      return;
    }

    // Start display server (as root — Xvfb needs it)
    await this.execCommand(
      containerId,
      [
        'bash',
        '-c',
        'Xvfb :99 -screen 0 1920x1080x24 >/dev/null 2>&1 &' +
          ' sleep 2 &&' +
          ' x11vnc -display :99 -forever -nopw -shared -rfbport 5900 >/dev/null 2>&1 &' +
          ' /opt/novnc/utils/novnc_proxy --vnc localhost:5900 --listen 6080 >/dev/null 2>&1 &',
      ],
      '/workspace',
      10000,
      'root',
    );

    // Start window manager + Chrome (as executor user)
    await this.execCommand(
      containerId,
      [
        'bash',
        '-c',
        'export DISPLAY=:99 &&' +
          ' fluxbox >/dev/null 2>&1 &' +
          ' sleep 1 &&' +
          ' CHROME=$(which google-chrome-stable 2>/dev/null || which google-chrome 2>/dev/null || which chromium 2>/dev/null || find ~/.cache/ms-playwright -name chrome -type f 2>/dev/null | head -1) &&' +
          ' if [ -n "$CHROME" ]; then' +
          '   "$CHROME" --no-sandbox --disable-dev-shm-usage --remote-debugging-port=9222 --start-maximized >/dev/null 2>&1 &' +
          ' fi',
      ],
      '/workspace',
      10000,
      'executor',
    );

    this.logger.log(`Browser started in container ${containerId.slice(0, 12)}`);
  }

  /**
   * Get the container's internal IP address (for proxying noVNC etc.)
   */
  async getContainerIp(containerId: string): Promise<string | null> {
    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();
      const networkName = process.env.DOCKER_NETWORK || 'bridge';
      const network = info.NetworkSettings.Networks[networkName];
      return network?.IPAddress || null;
    } catch {
      return null;
    }
  }

  // ─── Clone Operations ───────────────────────────────────────────

  /**
   * Commit a container's current state to a Docker image (snapshot).
   * Returns the image name in format "citshe-clone:{sessionId}".
   */
  async commitContainer(
    containerId: string,
    imageTag: string,
  ): Promise<string> {
    const container = this.docker.getContainer(containerId);
    const repo = 'citshe-clone';

    // Copy bind-mounted local files into container filesystem before commit
    // (docker commit doesn't include bind mount contents)
    try {
      await this.execCommand(
        containerId,
        [
          'bash',
          '-c',
          `mkdir -p /workspace/project && if [ -d /workspace/local ]; then rsync -a --exclude='node_modules' --exclude='vendor' --exclude='__pycache__' --exclude='.venv' --exclude='target' /workspace/local/ /workspace/project/ && chown -R executor:executor /workspace/project; fi`,
        ],
        '/workspace',
        600000, // 10 min timeout for large projects
      );
      this.logger.log('Copied local mount to /workspace/project for snapshot');
    } catch (err) {
      this.logger.warn(
        `Could not copy local mount for snapshot: ${(err as Error).message}`,
      );
    }

    await container.commit({
      repo,
      tag: imageTag,
      comment: `Snapshot ${imageTag}`,
    });
    const imageName = `${repo}:${imageTag}`;
    this.logger.log(
      `Committed container ${containerId.slice(0, 12)} → image ${imageName}`,
    );
    return imageName;
  }

  /**
   * Create and start a container from a previously committed image.
   * Simplified variant of createAndStart — skips repo cloning and setup scripts
   * since those are already baked into the committed image.
   */
  async createFromCommittedImage(
    image: string,
    config: {
      sessionId: string;
      organizationId: string;
      enableDocker?: boolean;
      environment?: { memoryMb?: number | null; cpuCores?: number | null };
    },
  ): Promise<string> {
    const containerName = `${this.containerPrefix}-${config.sessionId}`;
    this.logger.log(
      `Creating cloned container from image ${image}: ${containerName}`,
    );

    const container = await this.docker.createContainer({
      Image: image,
      name: containerName,
      User: 'root',
      Entrypoint: ['bash', '-c'],
      Cmd: [
        [
          'chown -R executor:executor /home/executor 2>/dev/null',
          this.claudeAuthSeedCmd().replace(/;\s*$/, ''),
          config.enableDocker
            ? 'if [ -d /var/lib/docker ]; then dockerd &>/var/log/dockerd.log & for i in $(seq 1 30); do docker info &>/dev/null && break || sleep 1; done; fi'
            : '',
          'exec su -s /bin/bash executor -c "node /session/server.js"',
        ]
          .filter(Boolean)
          .join('; '),
      ],
      WorkingDir: '/workspace',
      Labels: {
        'citshe.type': 'session',
        'citshe.session-id': config.sessionId,
        'citshe.organization-id': config.organizationId,
        'citshe.created-at': new Date().toISOString(),
        'citshe.cloned': 'true',
      },
      HostConfig: {
        Binds: [
          `citshe-executor-home-${config.organizationId}:/home/executor`,
          ...this.claudeAuthSeedBind(),
          ...(config.enableDocker
            ? [`citshe-dind-${config.sessionId}:/var/lib/docker`]
            : []),
        ],
        Memory: (config.environment?.memoryMb || 4096) * 1024 * 1024,
        NanoCpus: (config.environment?.cpuCores || 2) * 1e9,
        PidsLimit: config.enableDocker ? 1024 : 512,
        NetworkMode: process.env.DOCKER_NETWORK || 'bridge',
        Privileged: config.enableDocker || false,
        SecurityOpt: config.enableDocker ? [] : ['no-new-privileges:true'],
        CapDrop: config.enableDocker ? [] : ['ALL'],
        CapAdd: config.enableDocker
          ? []
          : ['CHOWN', 'SETUID', 'SETGID', 'DAC_OVERRIDE'],
      },
    });

    await container.start();

    const containerId = container.id;
    this.logger.log(
      `Cloned container started: ${containerName} (${containerId.slice(0, 12)})`,
    );
    return containerId;
  }

  /**
   * Remove a Docker image (used to cleanup after clone).
   */
  async removeImage(imageName: string): Promise<void> {
    try {
      const image = this.docker.getImage(imageName);
      await image.remove();
      this.logger.log(`Removed clone image: ${imageName}`);
    } catch (err) {
      this.logger.warn(
        `Failed to remove image ${imageName}: ${(err as Error).message}`,
      );
    }
  }

  async getImageSize(imageName: string): Promise<bigint | null> {
    try {
      const image = this.docker.getImage(imageName);
      const info = await image.inspect();
      return BigInt(info.Size || 0);
    } catch {
      return null;
    }
  }

  // ─── File Operations ────────────────────────────────────────────

  async readFile(containerId: string, filePath: string): Promise<string> {
    return this.execCommand(containerId, ['cat', filePath]);
  }

  async writeFile(
    containerId: string,
    filePath: string,
    content: string,
  ): Promise<void> {
    const container = this.docker.getContainer(containerId);

    const exec = await container.exec({
      Cmd: ['tee', filePath],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      User: 'executor',
      Tty: false,
    });

    await new Promise<void>((resolve, reject) => {
      exec.start({ hijack: true, stdin: true }, (err, stream) => {
        if (err || !stream) {
          reject(err instanceof Error ? err : new Error('No stream'));
          return;
        }
        stream.write(content);
        stream.end();
        stream.on('end', () => resolve());
        stream.on('error', reject);
      });
    });
  }

  async getFileTree(
    containerId: string,
    basePath = '/workspace',
  ): Promise<string[]> {
    const output = await this.execCommand(containerId, [
      'find',
      basePath,
      '-type',
      'f',
      '-not',
      '-path',
      '*/node_modules/*',
      '-not',
      '-path',
      '*/.git/*',
      '-not',
      '-path',
      '*/.claude/*',
      '-maxdepth',
      '5',
    ]);

    return output
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
  }

  async getGitStatus(
    containerId: string,
  ): Promise<Array<{ path: string; status: string }>> {
    const repoList = await this.execCommand(containerId, [
      'find',
      '/workspace',
      '-maxdepth',
      '2',
      '-name',
      '.git',
      '-type',
      'd',
    ]);

    const results: Array<{ path: string; status: string }> = [];

    for (const gitDir of repoList.split('\n').filter(Boolean)) {
      const repoDir = gitDir.replace('/.git', '');
      const repoName = repoDir.replace('/workspace/', '');

      const statusOutput = await this.execCommand(
        containerId,
        ['git', 'status', '--porcelain', '-unormal'],
        repoDir,
      );

      for (const line of statusOutput.split('\n').filter(Boolean)) {
        const xy = line.substring(0, 2);
        const file = line.substring(3);

        let status: string;
        if (xy[0] === '?' && xy[1] === '?') status = 'untracked';
        else if (xy[0] === 'A' || xy[1] === 'A') status = 'added';
        else if (xy[0] === 'M' || xy[1] === 'M') status = 'modified';
        else if (xy[0] === 'D' || xy[1] === 'D') status = 'deleted';
        else if (xy[0] === 'R') status = 'renamed';
        else status = 'changed';

        results.push({ path: `${repoName}/${file}`, status });
      }
    }

    return results;
  }

  // ─── Exec Helper ────────────────────────────────────────────────

  async execCommand(
    containerId: string,
    cmd: string[],
    workDir = '/workspace',
    timeoutMs = 60000,
    user = 'executor',
    options: {
      throwOnError?: boolean;
      /** Called with demuxed text as it streams in (for live "watch"). */
      onData?: (text: string) => void;
    } = {},
  ): Promise<string> {
    const container = this.docker.getContainer(containerId);

    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      User: user,
      WorkingDir: workDir,
      Tty: false,
      // docker exec doesn't set HOME for a -u user; without this it stays
      // /root, so tools that read ~/.claude (claude auth) or ~/bin (citshe-task,
      // citshe-shot) look in the wrong home and fail.
      Env: user === 'executor' ? ['HOME=/home/executor'] : undefined,
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Command timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      exec.start({}, (err, stream) => {
        if (err || !stream) {
          clearTimeout(timer);
          // Preserve legacy behaviour for callers that don't opt in, but let
          // opt-in callers detect the failure to start the exec.
          if (options.throwOnError) {
            reject(
              err instanceof Error
                ? err
                : new Error('Failed to start command in container'),
            );
          } else {
            resolve('');
          }
          return;
        }

        const chunks: Buffer[] = [];
        // Incrementally demux so we can stream text live to options.onData
        // (a Docker frame can straddle chunk boundaries — keep a running
        // buffer and only consume complete frames).
        let pending = Buffer.alloc(0);
        let liveStdout = '';
        let liveStderr = '';
        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          if (!options.onData) return;
          pending = Buffer.concat([pending, chunk]);
          let off = 0;
          while (off + 8 <= pending.length) {
            const type = pending[off];
            const size = pending.readUInt32BE(off + 4);
            if (off + 8 + size > pending.length) break;
            const text = pending
              .slice(off + 8, off + 8 + size)
              .toString('utf8');
            if (type === 2) liveStderr += text;
            else liveStdout += text;
            try {
              options.onData(text);
            } catch {
              /* ignore consumer errors */
            }
            off += 8 + size;
          }
          pending = pending.slice(off);
        });
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        stream.on('end', async () => {
          clearTimeout(timer);
          const data = Buffer.concat(chunks);
          // Demux Docker multiplexed stream (header byte 0: 1=stdout, 2=stderr)
          let stdout = '';
          let stderr = '';
          let offset = 0;
          while (offset < data.length) {
            if (offset + 8 > data.length) break;
            const type = data[offset];
            const size = data.readUInt32BE(offset + 4);
            if (offset + 8 + size > data.length) break;
            const text = data
              .slice(offset + 8, offset + 8 + size)
              .toString('utf8');
            if (type === 2) {
              stderr += text;
            } else {
              stdout += text;
            }
            offset += 8 + size;
          }
          // Silence unused-var lint for the live accumulators (kept for clarity).
          void liveStdout;
          void liveStderr;

          if (options.throwOnError) {
            try {
              const info = await exec.inspect();
              if (info.ExitCode && info.ExitCode !== 0) {
                const detail = (stderr || stdout).trim();
                reject(
                  new Error(
                    `Command exited with code ${info.ExitCode}${
                      detail ? `: ${detail}` : ''
                    }`,
                  ),
                );
                return;
              }
            } catch (inspectErr) {
              reject(
                inspectErr instanceof Error
                  ? inspectErr
                  : new Error('Failed to inspect command result'),
              );
              return;
            }
          }

          resolve(stdout);
        });
        stream.on('error', (streamErr: Error) => {
          clearTimeout(timer);
          if (options.throwOnError) {
            reject(streamErr);
          } else {
            resolve('');
          }
        });
      });
    });
  }

  // ─── Cleanup ────────────────────────────────────────────────────

  private async cleanupStaleContainers(): Promise<void> {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: { label: ['citshe.type=session'] },
      });

      const maxAge = 48 * 60 * 60 * 1000;
      const now = Date.now();

      for (const containerInfo of containers) {
        const createdAt = containerInfo.Labels['citshe.created-at'];
        if (createdAt && now - new Date(createdAt).getTime() > maxAge) {
          this.logger.log(
            `Cleaning up stale container: ${containerInfo.Names[0]}`,
          );
          await this.removeContainer(
            containerInfo.Id,
            containerInfo.Labels['citshe.session-id'],
          );
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to cleanup: ${(err as Error).message}`);
    }
  }
}

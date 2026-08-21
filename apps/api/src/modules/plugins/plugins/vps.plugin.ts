import { randomUUID } from 'crypto';
import { Client } from 'ssh2';
import { PluginType } from '@prisma/client';
import {
  PluginConfig,
  PluginStatus,
  StackPlugin,
  PluginMetric,
  PluginActionResult,
  PluginResourceGroup,
  HealthState,
} from './plugin.interface';
import { pluginRegistry } from './plugin.registry';

/** One SSH server inside the VPS plugin's list. */
interface VpsServer {
  id: string;
  label: string;
  host: string;
  port?: number | string;
  username: string;
  authMethod?: 'key' | 'password';
  privateKey?: string;
  passphrase?: string;
  password?: string;
}

/** New config shape: a list of servers (plus the generic selection blob). */
interface VpsConfig {
  servers: VpsServer[];
  selection?: Record<string, unknown>;
}

/** Old single-host config shape (pre-multi-server) — kept for back-compat read. */
interface LegacyVpsConfig {
  label?: string;
  host?: string;
  port?: number | string;
  username?: string;
  authMethod?: 'key' | 'password';
  privateKey?: string;
  passphrase?: string;
  password?: string;
}

const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Normalize a pasted PEM private key: strip carriage returns, trim surrounding
 * whitespace, and guarantee exactly one trailing newline. Web textareas often
 * mangle line endings, which makes ssh2 reject the key ("Unsupported key
 * format").
 */
function normalizeKey(raw: string): string {
  const cleaned = raw.replace(/\r/g, '').trim();
  if (!cleaned.includes('BEGIN')) {
    throw new Error(
      'Paste the full PEM private key (-----BEGIN ... END-----).',
    );
  }
  return cleaned + '\n';
}

/** Per-server probe result. */
interface ServerHealth {
  state: HealthState; // ok / warn / down
  headline: string;
  metrics: PluginMetric[];
  meta: string; // compact one-liner shown in the resource row
}

/**
 * VPS plugin: holds a LIST of servers and SSHes into each (Hetzner /
 * DigitalOcean / anything) with a key or password to read health — up/down,
 * load, disk %, RAM %, uptime. Read-only status; the only writes are managing
 * the server list (add/remove) via runAction, which persists config.
 *
 * Config: { servers: VpsServer[] }. Backward-compatible with the old
 * single-host shape ({ host, username, ... }) — read as a one-element list.
 */
class VpsPlugin implements StackPlugin {
  type = PluginType.VPS;

  /** Read config as the new list shape, migrating the old single-host shape. */
  private servers(config: PluginConfig): VpsServer[] {
    const c = config as unknown as VpsConfig & LegacyVpsConfig;
    if (Array.isArray(c.servers)) return c.servers;
    // Legacy single-host config: treat as a one-server list at read time.
    if (c.host && c.username) {
      return [
        {
          id: 'legacy',
          label: c.label || c.host,
          host: c.host,
          port: c.port,
          username: c.username,
          authMethod: c.authMethod,
          privateKey: c.privateKey,
          passphrase: c.passphrase,
          password: c.password,
        },
      ];
    }
    return [];
  }

  /** Open an SSH session, run one command, return stdout. */
  private exec(server: VpsServer, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let settled = false;
      const done = (err: Error | null, out?: string) => {
        if (settled) return;
        settled = true;
        conn.end();
        if (err) reject(err);
        else resolve(out ?? '');
      };

      const timer = setTimeout(
        () => done(new Error('SSH connection timed out')),
        CONNECT_TIMEOUT_MS,
      );

      conn
        .on('ready', () => {
          conn.exec(command, (err, stream) => {
            if (err) {
              clearTimeout(timer);
              return done(err);
            }
            let out = '';
            stream
              .on('close', () => {
                clearTimeout(timer);
                done(null, out);
              })
              .on('data', (d: Buffer) => (out += d.toString()))
              .stderr.on('data', () => {
                /* ignore stderr for status commands */
              });
          });
        })
        .on('error', (err) => {
          clearTimeout(timer);
          done(err);
        })
        .connect({
          host: server.host,
          port: server.port ? Number(server.port) : 22,
          username: server.username,
          readyTimeout: CONNECT_TIMEOUT_MS,
          ...(server.authMethod === 'password' ||
          (server.password && !server.privateKey)
            ? { password: server.password }
            : {
                privateKey: normalizeKey(server.privateKey ?? ''),
                passphrase: server.passphrase || undefined,
              }),
        });
    });
  }

  /** Probe one server for health — SSH + parse one round-trip of metrics. */
  private async probe(server: VpsServer): Promise<ServerHealth> {
    // One round-trip: gather everything with a single command.
    //   UPTIME|<pretty uptime>
    //   LOAD|<1min load>
    //   CPUS|<nproc>
    //   MEM|<used>|<total>   (MB)
    //   DISK|<used%>|<mount>
    const script = [
      "echo UPTIME\\|$(uptime -p 2>/dev/null | sed 's/^up //' || echo '?')",
      "echo LOAD\\|$(cat /proc/loadavg | awk '{print $1}')",
      'echo CPUS\\|$(nproc 2>/dev/null || echo 1)',
      "echo MEM\\|$(free -m | awk '/^Mem:/{print $3\"|\"$2}')",
      "echo DISK\\|$(df -P / | awk 'NR==2{print $5\"|\"$6}')",
    ].join('; ');

    let raw: string;
    try {
      raw = await this.exec(server, script);
    } catch (err) {
      return {
        state: 'down',
        headline: 'Down',
        metrics: [],
        meta: (err as Error).message,
      };
    }

    const fields = new Map<string, string[]>();
    for (const line of raw.split('\n')) {
      const [key, ...rest] = line.trim().split('|');
      if (key) fields.set(key, rest);
    }

    const metrics: PluginMetric[] = [];
    let state: HealthState = 'ok';
    let headline = 'Up';
    const metaParts: string[] = [];

    const uptime = fields.get('UPTIME')?.[0];
    if (uptime && uptime !== '?') {
      metrics.push({ label: 'Uptime', value: uptime });
    }

    const load = parseFloat(fields.get('LOAD')?.[0] ?? '');
    const cpus = parseInt(fields.get('CPUS')?.[0] ?? '1', 10) || 1;
    if (!Number.isNaN(load)) {
      const ratio = load / cpus;
      metrics.push({
        label: 'Load',
        value: load.toFixed(2),
        hint: `${cpus} cpu`,
        state: ratio > 1 ? 'warn' : 'ok',
      });
      metaParts.push(`load ${load.toFixed(2)}`);
      if (ratio > 1.5) {
        state = 'warn';
        headline = 'High load';
      }
    }

    const mem = fields.get('MEM');
    if (mem && mem.length >= 2) {
      const used = parseInt(mem[0], 10);
      const total = parseInt(mem[1], 10);
      if (total > 0) {
        const pct = Math.round((used / total) * 100);
        metrics.push({
          label: 'RAM',
          value: `${pct}%`,
          hint: `${(used / 1024).toFixed(1)}/${(total / 1024).toFixed(1)} GB`,
          state: pct > 90 ? 'down' : pct > 75 ? 'warn' : 'ok',
        });
        metaParts.push(`ram ${pct}%`);
        if (pct > 90) {
          state = 'down';
          headline = 'RAM critical';
        } else if (pct > 75 && state === 'ok') {
          state = 'warn';
        }
      }
    }

    const disk = fields.get('DISK');
    if (disk && disk.length >= 1) {
      const pct = parseInt(disk[0].replace('%', ''), 10);
      if (!Number.isNaN(pct)) {
        metrics.push({
          label: 'Disk',
          value: `${pct}%`,
          hint: disk[1] || '/',
          state: pct > 90 ? 'down' : pct > 80 ? 'warn' : 'ok',
        });
        metaParts.push(`disk ${pct}%`);
        if (pct > 90) {
          state = 'down';
          headline = 'Disk full';
        } else if (pct > 80 && state === 'ok') {
          state = 'warn';
        }
      }
    }

    return {
      state,
      headline,
      metrics,
      meta: metaParts.length ? metaParts.join(' · ') : 'reachable',
    };
  }

  async testConnection(config: PluginConfig) {
    const servers = this.servers(config);
    if (servers.length === 0) {
      return { ok: false, error: 'Add at least one server.' };
    }
    for (const s of servers) {
      if (!s.host || !s.username || !(s.privateKey || s.password)) {
        return {
          ok: false,
          error: `${s.label || s.host || 'A server'}: host, username and a key or password are required.`,
        };
      }
    }
    // Valid if at least one server is reachable.
    const results = await Promise.allSettled(
      servers.map((s) => this.exec(s, 'echo ok')),
    );
    const reachable = results.some((r) => r.status === 'fulfilled');
    if (reachable) return { ok: true };
    const firstErr = results.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    return {
      ok: false,
      error:
        (firstErr?.reason as Error | undefined)?.message ??
        'No server was reachable.',
    };
  }

  async getStatus(config: PluginConfig): Promise<PluginStatus> {
    const servers = this.servers(config);
    if (servers.length === 0) {
      return {
        type: this.type,
        connected: false,
        headline: { label: 'No servers', state: 'idle' },
        metrics: [],
      };
    }

    const healths = await Promise.all(servers.map((s) => this.probe(s)));

    const up = healths.filter((h) => h.state !== 'down').length;
    const down = healths.length - up;
    const anyWarn = healths.some((h) => h.state === 'warn');

    let headline: { label: string; state: HealthState };
    if (down === healths.length) {
      headline = { label: 'All down', state: 'down' };
    } else if (down > 0) {
      headline = { label: `${down} down`, state: 'down' };
    } else if (anyWarn) {
      headline = { label: 'Degraded', state: 'warn' };
    } else {
      headline = { label: 'All up', state: 'ok' };
    }

    const metrics: PluginMetric[] = [
      { label: 'Servers', value: String(healths.length) },
      {
        label: 'Up',
        value: `${up}/${healths.length}`,
        state: down > 0 ? 'down' : anyWarn ? 'warn' : 'ok',
      },
    ];
    if (down > 0) {
      metrics.push({ label: 'Down', value: String(down), state: 'down' });
    }

    return {
      type: this.type,
      connected: up > 0,
      headline,
      metrics,
    };
  }

  /** Expose each server as a resource row (label/host + health + meta). */
  async listResources(config: PluginConfig): Promise<PluginResourceGroup[]> {
    const servers = this.servers(config);
    if (servers.length === 0) return [];

    const healths = await Promise.all(servers.map((s) => this.probe(s)));

    return [
      {
        kind: 'servers',
        label: 'Servers',
        items: servers.map((s, i) => ({
          id: s.id,
          name: s.label || s.host,
          state: healths[i].state,
          meta: `${s.host} · ${healths[i].meta}`,
        })),
      },
    ];
  }

  /**
   * Manage the server list. runAction has no DB access, so we return the new
   * `config` and the service re-encrypts/persists it.
   *  - add-server: params are the VpsServer fields (id auto-assigned).
   *  - remove-server: params { id }.
   */
  async runAction(
    config: PluginConfig,
    actionId: string,
    input?: Record<string, unknown>,
  ): Promise<PluginActionResult> {
    const servers = this.servers(config);
    const selection = (config as unknown as VpsConfig).selection;

    if (actionId === 'add-server') {
      const p = (input ?? {}) as Partial<VpsServer>;
      if (!p.host || !p.username) {
        return { ok: false, message: 'Host and user are required.' };
      }
      if (!p.privateKey && !p.password) {
        return { ok: false, message: 'A private key or password is required.' };
      }
      const server: VpsServer = {
        id: randomUUID(),
        label: (p.label || p.host).toString(),
        host: p.host.toString(),
        port: p.port,
        username: p.username.toString(),
        authMethod: p.authMethod === 'password' ? 'password' : 'key',
        privateKey: p.privateKey,
        passphrase: p.passphrase,
        password: p.password,
      };
      // Validate reachability before saving.
      try {
        await this.exec(server, 'echo ok');
      } catch (err) {
        return {
          ok: false,
          message: `Couldn't reach the server: ${(err as Error).message}`,
        };
      }
      const next: VpsConfig = { servers: [...servers, server] };
      if (selection) next.selection = selection;
      return {
        ok: true,
        message: `Added ${server.label}.`,
        config: next as unknown as PluginConfig,
      };
    }

    if (actionId === 'remove-server') {
      const id = (input?.id ?? '').toString();
      const kept = servers.filter((s) => s.id !== id);
      if (kept.length === servers.length) {
        return { ok: false, message: 'Server not found.' };
      }
      const next: VpsConfig = { servers: kept };
      if (selection) next.selection = selection;
      return {
        ok: true,
        message: 'Server removed.',
        config: next as unknown as PluginConfig,
      };
    }

    return { ok: false, message: `Unknown action: ${actionId}` };
  }
}

pluginRegistry.register(new VpsPlugin());

import { Client } from 'ssh2';
import { PluginType } from '@prisma/client';
import {
  PluginConfig,
  PluginStatus,
  StackPlugin,
  PluginMetric,
  HealthState,
} from './plugin.interface';
import { pluginRegistry } from './plugin.registry';

interface VpsConfig {
  host: string;
  port?: number | string;
  username: string;
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

/**
 * VPS plugin: SSH into a box (Hetzner / DigitalOcean / anything) with a private
 * key and read its health — up/down, load, disk %, RAM %, uptime. Read-only:
 * we only run status commands, never mutate. Works with any provider since it's
 * plain SSH; no vendor API needed.
 */
class VpsPlugin implements StackPlugin {
  type = PluginType.VPS;

  private cfg(config: PluginConfig): VpsConfig {
    return config as unknown as VpsConfig;
  }

  /** Open an SSH session, run one command, return stdout. */
  private exec(config: VpsConfig, command: string): Promise<string> {
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
          host: config.host,
          port: config.port ? Number(config.port) : 22,
          username: config.username,
          readyTimeout: CONNECT_TIMEOUT_MS,
          ...(config.authMethod === 'password' ||
          (config.password && !config.privateKey)
            ? { password: config.password }
            : {
                privateKey: normalizeKey(config.privateKey ?? ''),
                passphrase: config.passphrase || undefined,
              }),
        });
    });
  }

  async testConnection(config: PluginConfig) {
    const c = this.cfg(config);
    if (!c.host || !c.username || !(c.privateKey || c.password)) {
      return {
        ok: false,
        error: 'Host, username and a key or password are required.',
      };
    }
    try {
      await this.exec(c, 'echo ok');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async getStatus(config: PluginConfig): Promise<PluginStatus> {
    const c = this.cfg(config);
    const metrics: PluginMetric[] = [];
    let headline: { label: string; state: HealthState } = {
      label: 'Up',
      state: 'ok',
    };

    // One round-trip: gather everything with a single command.
    // Format (line-per-metric, easy to parse):
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
      raw = await this.exec(c, script);
    } catch (err) {
      return {
        type: this.type,
        connected: false,
        headline: { label: 'Down', state: 'down' },
        metrics: [],
        error: (err as Error).message,
      };
    }

    const fields = new Map<string, string[]>();
    for (const line of raw.split('\n')) {
      const [key, ...rest] = line.trim().split('|');
      if (key) fields.set(key, rest);
    }

    const uptime = fields.get('UPTIME')?.[0];
    if (uptime && uptime !== '?') {
      metrics.push({ label: 'Uptime', value: uptime });
    }

    const load = parseFloat(fields.get('LOAD')?.[0] ?? '');
    const cpus = parseInt(fields.get('CPUS')?.[0] ?? '1', 10) || 1;
    if (!Number.isNaN(load)) {
      // load relative to core count: >1x per core is a warning.
      const ratio = load / cpus;
      metrics.push({
        label: 'Load',
        value: load.toFixed(2),
        hint: `${cpus} cpu`,
        state: ratio > 1 ? 'warn' : 'ok',
      });
      if (ratio > 1.5) headline = { label: 'High load', state: 'warn' };
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
        if (pct > 90) headline = { label: 'RAM critical', state: 'down' };
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
        if (pct > 90) headline = { label: 'Disk full', state: 'down' };
      }
    }

    if (metrics.length === 0) {
      metrics.push({ label: 'VPS', value: 'reachable' });
    }

    return {
      type: this.type,
      connected: true,
      headline,
      metrics,
    };
  }
}

pluginRegistry.register(new VpsPlugin());

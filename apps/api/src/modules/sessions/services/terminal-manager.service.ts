import { Injectable, Logger } from '@nestjs/common';
import Docker from 'dockerode';
import { Duplex } from 'stream';

export interface TerminalInstance {
  exec: Docker.Exec;
  stream: Duplex;
  containerId: string;
}

/**
 * Manages multiple terminal instances (bash/claude) inside Docker containers.
 * Each terminal has a unique ID and its own output buffer.
 */
@Injectable()
export class TerminalManagerService {
  private readonly logger = new Logger(TerminalManagerService.name);
  private docker: Docker;

  private readonly terminals = new Map<string, TerminalInstance>();
  private readonly outputBuffers = new Map<string, string>();
  private readonly MAX_BUFFER_SIZE = 512 * 1024; // 512KB

  constructor() {
    this.docker = new Docker();
  }

  /**
   * Start a terminal (bash, claude, etc.) inside a container.
   */
  async start(
    terminalId: string,
    containerId: string,
    onData: (data: string) => void,
    onEnd: () => void,
    options?: { cmd?: string[]; clearBuffer?: boolean },
  ): Promise<void> {
    this.close(terminalId);

    if (options?.clearBuffer) {
      this.outputBuffers.delete(terminalId);
    }

    const container = this.docker.getContainer(containerId);
    const cmd = options?.cmd || ['bash'];

    const exec = await container.exec({
      // Attach to a tmux window so multiple citshe clients can share the same
      // terminal (watch + take over). The window name is derived from the
      // terminalId; it's created on first attach running `cmd`, and reused
      // afterwards. Falls back to plain `cmd` if tmux isn't in the image.
      Cmd: ['bash', '-lc', this.buildTmuxAttachCommand(terminalId, cmd)],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      User: 'executor',
      WorkingDir: '/workspace',
      Env: ['TERM=xterm-256color', 'HOME=/home/executor'],
      // Start roomy instead of Docker's default 80×24 so full-screen TUIs
      // (Claude Code) don't render in a narrow band before the client's
      // fit/resize lands. [rows, cols].
      ConsoleSize: [40, 160],
    });

    const stream: Duplex = await new Promise((resolve, reject) => {
      exec.start({ hijack: true, stdin: true, Tty: true }, (err, s) => {
        if (err || !s) {
          reject(err instanceof Error ? err : new Error('No stream returned'));
          return;
        }
        resolve(s);
      });
    });

    this.terminals.set(terminalId, { exec, stream, containerId });

    if (!this.outputBuffers.has(terminalId)) {
      this.outputBuffers.set(terminalId, '');
    }

    stream.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');

      let buf = (this.outputBuffers.get(terminalId) || '') + text;
      if (buf.length > this.MAX_BUFFER_SIZE) {
        buf = buf.slice(buf.length - this.MAX_BUFFER_SIZE);
      }
      this.outputBuffers.set(terminalId, buf);

      onData(text);
    });

    stream.on('end', () => {
      this.terminals.delete(terminalId);
      onEnd();
    });

    stream.on('error', (err) => {
      this.logger.warn(`Terminal ${terminalId} error: ${err.message}`);
      this.terminals.delete(terminalId);
      onEnd();
    });

    this.logger.log(`Terminal started: ${terminalId} [${cmd.join(' ')}]`);
  }

  /** tmux window name for a terminalId (the part after ':' , sanitized). */
  private windowName(terminalId: string): string {
    const raw = terminalId.split(':').slice(1).join(':') || 'main';
    return raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40);
  }

  /**
   * Build the shell command that attaches this exec to a tmux window in the
   * shared "citshe" session. Creates the window (running `cmd`) if it doesn't
   * exist yet, then attaches read-write and selects it. If tmux isn't present
   * (older executor image), just run `cmd` directly so terminals still work.
   */
  private buildTmuxAttachCommand(terminalId: string, cmd: string[]): string {
    const win = this.windowName(terminalId);
    // Shell-quote the command the window should run.
    const runCmd = cmd.map((c) => `'${c.replace(/'/g, `'\\''`)}'`).join(' ');
    const tmux = 'tmux -f /etc/tmux.conf';
    return (
      `if command -v tmux >/dev/null 2>&1; then ` +
      // Ensure the shared session exists (session-server usually made it).
      `${tmux} has-session -t citshe 2>/dev/null || ${tmux} new-session -d -s citshe -x 200 -y 50 -c /workspace; ` +
      // Create this window if missing, running the requested command.
      `${tmux} list-windows -t citshe -F '#W' 2>/dev/null | grep -qx '${win}' || ` +
      `${tmux} new-window -t citshe -n '${win}' -c /workspace ${runCmd}; ` +
      // Attach and jump to it (read-write; multiple clients allowed).
      `exec ${tmux} attach -t citshe \\; select-window -t '${win}'; ` +
      `else exec ${runCmd}; fi`
    );
  }

  /**
   * Send raw input (keystrokes) to a terminal.
   */
  sendInput(terminalId: string, data: string): boolean {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return false;

    try {
      terminal.stream.write(data);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resize terminal PTY to match frontend dimensions.
   */
  async resize(terminalId: string, cols: number, rows: number): Promise<void> {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;

    try {
      await terminal.exec.resize({ h: rows, w: cols });
    } catch {
      // Container may have stopped
    }
  }

  /**
   * Get buffered output for reconnect.
   */
  getBuffer(terminalId: string): string {
    return this.outputBuffers.get(terminalId) || '';
  }

  /**
   * Close a single terminal.
   */
  close(terminalId: string): void {
    const terminal = this.terminals.get(terminalId);
    if (terminal) {
      try {
        terminal.stream.end();
      } catch {
        // ignore
      }
      this.terminals.delete(terminalId);
    }
  }

  /**
   * Close all terminals matching a prefix (e.g. all terminals for a session).
   */
  closeByPrefix(prefix: string): void {
    for (const [id] of this.terminals) {
      if (id.startsWith(prefix)) {
        this.close(id);
      }
    }
    // Also clean buffers
    for (const [id] of this.outputBuffers) {
      if (id.startsWith(prefix)) {
        this.outputBuffers.delete(id);
      }
    }
  }

  /**
   * Check if a terminal is active.
   */
  isActive(terminalId: string): boolean {
    return this.terminals.has(terminalId);
  }
}

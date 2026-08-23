import chalk from "chalk";
import { io, type Socket } from "socket.io-client";
import { requireConfig } from "../api.js";
import {
  SOCKET_EVENTS,
  SOCKET_PATH,
  defaultTerminalId,
} from "../constants.js";

export interface AttachOptions {
  terminal?: string;
}

/** Ctrl-] — the classic "escape to detach" key (like telnet). */
const DETACH_BYTE = 0x1d;

export async function attachCommand(
  sessionId: string,
  options: AttachOptions,
): Promise<void> {
  const config = await requireConfig();
  const terminalId = options.terminal || defaultTerminalId(sessionId);

  const stdin = process.stdin;
  const stdout = process.stdout;

  console.log(
    chalk.dim(
      `Connecting to ${config.wsBase} …  (detach with Ctrl-] or ~. )`,
    ),
  );

  const socket: Socket = io(config.wsBase, {
    path: SOCKET_PATH,
    transports: ["websocket", "polling"],
    reconnection: true,
    // Send the ctk_ token both in auth handshake and via the explicit
    // `authenticate` event below, so either backend style works.
    auth: { token: config.token },
  });

  let detached = false;
  let rawEnabled = false;

  const restoreTty = () => {
    if (rawEnabled && stdin.isTTY) {
      try {
        stdin.setRawMode(false);
      } catch {
        /* ignore */
      }
      rawEnabled = false;
    }
    stdin.pause();
  };

  const detach = (reason?: string, code = 0) => {
    if (detached) return;
    detached = true;
    stdin.removeListener("data", onStdin);
    stdout.removeListener("resize", sendResize);
    restoreTty();
    socket.disconnect();
    if (reason) console.log(`\n${chalk.dim(reason)}`);
    process.exit(code);
  };

  const sendResize = () => {
    socket.emit(SOCKET_EVENTS.sessionResize, {
      terminalId,
      cols: stdout.columns || 80,
      rows: stdout.rows || 24,
    });
  };

  // --- local input --------------------------------------------------------
  // "~." escape works when it appears at the start of a fresh line.
  let atLineStart = true;
  let sawTilde = false;

  const onStdin = (chunk: Buffer) => {
    // Ctrl-] detaches immediately, regardless of position.
    if (chunk.length === 1 && chunk[0] === DETACH_BYTE) {
      detach("Detached.");
      return;
    }

    // "~." sequence at start of a line detaches.
    for (const byte of chunk) {
      if (sawTilde) {
        if (byte === 0x2e /* . */) {
          detach("Detached.");
          return;
        }
        sawTilde = false;
      } else if (atLineStart && byte === 0x7e /* ~ */) {
        sawTilde = true;
        atLineStart = false;
        continue;
      }
      atLineStart = byte === 0x0d || byte === 0x0a;
    }

    socket.emit(SOCKET_EVENTS.sessionInput, {
      terminalId,
      input: chunk.toString("utf8"),
    });
  };

  // --- socket wiring -------------------------------------------------------
  socket.on("connect", () => {
    socket.emit(SOCKET_EVENTS.authenticate, { token: config.token });
  });

  socket.on(SOCKET_EVENTS.authenticated, () => {
    // Join the session room, then ensure the terminal is running and stream it.
    socket.emit(SOCKET_EVENTS.subscribeSession, { sessionId });
    socket.emit(
      SOCKET_EVENTS.sessionAttach,
      { sessionId, terminalId },
      (ack?: { event?: string; data?: { buffer?: string; message?: string } }) => {
        if (ack?.event === "error") {
          detach(chalk.red(`Attach failed: ${ack.data?.message ?? "unknown"}`), 1);
          return;
        }
        // Paint existing scrollback first.
        if (typeof ack?.data?.buffer === "string") stdout.write(ack.data.buffer);

        // Enter raw mode and start forwarding keystrokes.
        if (stdin.isTTY) {
          stdin.setRawMode(true);
          rawEnabled = true;
        }
        stdin.resume();
        stdin.on("data", onStdin);
        stdout.on("resize", sendResize);
        sendResize();

        console.log(
          chalk.green(`\n✓ Attached to ${sessionId}.`) +
            chalk.dim("  Ctrl-] to detach.\n"),
        );
      },
    );
  });

  socket.on(SOCKET_EVENTS.sessionOutput, (payload: {
    terminalId?: string;
    data?: string;
  }) => {
    // Only render output for the terminal we asked for.
    if (payload.terminalId && payload.terminalId !== terminalId) return;
    if (typeof payload.data === "string") stdout.write(payload.data);
  });

  socket.on(SOCKET_EVENTS.error, (payload: { message?: string }) => {
    detach(
      chalk.red(`Server error: ${payload?.message || "unknown"}`),
      1,
    );
  });

  socket.on("connect_error", (err: Error) => {
    detach(
      chalk.red(`Connection failed: ${err.message}`),
      1,
    );
  });

  socket.on("disconnect", (reason: string) => {
    if (!detached) {
      detach(chalk.dim(`Disconnected (${reason}).`), reason === "io server disconnect" ? 1 : 0);
    }
  });

  // Clean up on Ctrl-C / termination.
  process.on("SIGINT", () => detach("Detached.", 0));
  process.on("SIGTERM", () => detach(undefined, 0));
}

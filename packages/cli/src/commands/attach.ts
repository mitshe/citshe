import chalk from "chalk";
import { io, type Socket } from "socket.io-client";
import { requireConfig, getSessions, CliError } from "../api.js";
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
  idOrPrefix: string,
  options: AttachOptions,
): Promise<void> {
  const config = await requireConfig();

  // `ls` shows shortened ids, so resolve the full id from an exact match or a
  // unique prefix before we build the terminal id / socket rooms.
  const { sessions } = await getSessions(config);
  const matches = sessions.filter(
    (s) => s.id === idOrPrefix || s.id.startsWith(idOrPrefix),
  );
  if (matches.length === 0) {
    throw new CliError(
      `No session matches "${idOrPrefix}". Run \`citshe ls\` to see ids.`,
    );
  }
  if (matches.length > 1) {
    throw new CliError(
      `"${idOrPrefix}" is ambiguous (${matches.length} sessions). Use more characters.`,
    );
  }
  const sessionId = matches[0].id;
  const terminalId = options.terminal || defaultTerminalId(sessionId);

  const stdin = process.stdin;
  const stdout = process.stdout;

  // Briefly ignore stdin right after attaching, to swallow terminal
  // auto-responses (Device Attributes etc.) that would otherwise be typed in.
  let inputGraceUntil = 0;

  console.log(
    chalk.dim(`Connecting to ${config.wsBase} …  (detach with Ctrl-] or ~. )`),
  );

  // The gateway lives on the "/events" namespace (same as the web app).
  const socket: Socket = io(`${config.wsBase}/events`, {
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

    // Drop the terminal's own auto-replies (DA/DA2 like ESC [ > … c, and the
    // XTVERSION reply ESC P > | iTerm2 … ESC \) in the grace window so they
    // aren't typed into the shell. These are pure escape sequences with no
    // Enter, so a real keystroke is never swallowed.
    if (Date.now() < inputGraceUntil) {
      const s = chunk.toString("utf8");
      const isAutoReply =
        /^\x1b/.test(s) &&
        !/[\r\n]/.test(s) &&
        (/\x1b\[[>=?]?[0-9;]*[cnq]/.test(s) ||
          /\x1bP>?\|/.test(s) ||
          /iTerm2|\d+;\d+;\d+c/.test(s));
      if (isAutoReply) return;
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
  // The gateway (NestJS) replies with EVENTS, not socket.io acks, so we drive
  // the handshake off events: connect → authenticate → `authenticated` →
  // subscribe → `subscribed` → session:attach → `attached`.
  let authedOnce = false;
  let attachedOnce = false;

  socket.on("connect", () => {
    socket.emit(SOCKET_EVENTS.authenticate, { token: config.token });
  });

  socket.on(SOCKET_EVENTS.authenticated, () => {
    if (authedOnce) return;
    authedOnce = true;
    socket.emit(SOCKET_EVENTS.subscribeSession, { sessionId });
  });

  socket.on("subscribed", () => {
    socket.emit(SOCKET_EVENTS.sessionAttach, { sessionId, terminalId });
  });

  socket.on(
    "attached",
    (data?: { terminalId?: string; buffer?: string }) => {
      if (attachedOnce) return;
      attachedOnce = true;
      startAttach(data);
    },
  );

  const startAttach = (data?: { buffer?: string }) => {
    // Paint existing scrollback first — but strip terminal capability QUERIES
    // (Device Attributes, cursor-position, etc.) from the replayed buffer.
    // Otherwise our local terminal (e.g. iTerm2) answers them and the reply
    // lands as typed input at the shell prompt (the "iTerm2 3.6.10…" garbage).
    if (typeof data?.buffer === "string" && data.buffer) {
      stdout.write(stripQueries(data.buffer));
    }
    // Enter raw mode and start forwarding keystrokes.
    if (stdin.isTTY) {
      stdin.setRawMode(true);
      rawEnabled = true;
    }
    stdin.resume();
    stdin.on("data", onStdin);
    stdout.on("resize", sendResize);
    sendResize();

    // Swallow any late auto-responses (DA/DA2) the terminal emits right after
    // the replay, so they don't get typed into the shell.
    inputGraceUntil = Date.now() + 900;

    const name = matches[0].name || sessionId;
    console.log(
      "\n" +
        chalk.green("  ● Attached") +
        chalk.dim(` to citshe session `) +
        chalk.bold(name) +
        chalk.dim(` (on your VPS, inside tmux)\n`) +
        chalk.dim("    Detach: ") +
        chalk.bold("Ctrl-]") +
        chalk.dim("   ·   this is a shared session — don't ") +
        chalk.bold("exit") +
        chalk.dim(" unless you mean to close it\n"),
    );
  };

  socket.on(SOCKET_EVENTS.sessionOutput, (payload: {
    terminalId?: string;
    data?: string;
  }) => {
    // Only render output for the terminal we asked for.
    if (payload.terminalId && payload.terminalId !== terminalId) return;
    // Strip terminal capability queries so our local terminal never answers
    // them (its reply would be typed into the shell).
    if (typeof payload.data === "string") stdout.write(stripQueries(payload.data));
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

/**
 * Remove terminal capability QUERIES from replayed scrollback so the local
 * terminal doesn't answer them (its answer would be typed into the shell):
 * Device Attributes `ESC [ c` / `ESC [ > c`, and DECRQSS-style `ESC P … ESC \`.
 */
function stripQueries(s: string): string {
  return (
    s
      // Primary/secondary Device Attributes: ESC [ c, ESC [ > c, ESC [ = c …
      .replace(/\x1b\[[>=?]?[0-9;]*c/g, "")
      // XTVERSION / name-version query: ESC [ > q
      .replace(/\x1b\[>[0-9;]*q/g, "")
      // Cursor-position report request: ESC [ 6 n (and other DSR ESC [ … n).
      .replace(/\x1b\[[0-9;?]*n/g, "")
      // DCS query/response wrappers: ESC P … ESC \.
      .replace(/\x1bP[^\x1b]*\x1b\\/g, "")
  );
}

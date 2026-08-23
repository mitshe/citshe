/**
 * Central place for the wire-level conventions the CLI relies on.
 *
 * The socket event names below are citshe's convention (they mirror the ones
 * the web app uses). If the backend ever renames an event, change it here in
 * one spot and every command follows.
 */

/** Default citshe API host. Overridable per-login with `--api-base`. */
export const DEFAULT_API_BASE = "https://rangopanel.mitshe.com";

/** Personal access tokens the user pastes from the panel start with this. */
export const TOKEN_PREFIX = "ctk_";

/** Path of the local config file (relative to the user's home dir). */
export const CONFIG_DIR_NAME = ".citshe";
export const CONFIG_FILE_NAME = "config.json";

/** socket.io connection path (server default). */
export const SOCKET_PATH = "/socket.io";

/**
 * Socket.io event names — must match apps/api events.gateway.ts.
 * Keep these grouped so the backend can be matched 1:1.
 */
export const SOCKET_EVENTS = {
  /** client -> server: authenticate the socket with the ctk_ token. */
  authenticate: "authenticate",
  /** server -> client: emitted once the socket is authenticated. */
  authenticated: "authenticated",
  /** server -> client: emitted on any auth/subscription failure. */
  error: "error",
  /** client -> server: join a session's output room. */
  subscribeSession: "subscribe:session",
  /** client -> server: leave a session's output room. */
  unsubscribeSession: "unsubscribe:session",
  /** client -> server: ensure the session terminal is running + stream it. */
  sessionAttach: "session:attach",
  /** server -> client: a chunk of terminal output `{ terminalId, data }`. */
  sessionOutput: "session:output",
  /** client -> server: forward a keystroke `{ terminalId, input }`. */
  sessionInput: "session:input",
  /** client -> server: report the local TTY size `{ terminalId, cols, rows }`. */
  sessionResize: "session:resize",
} as const;

/** The default terminal within a session follows this id convention. */
export function defaultTerminalId(sessionId: string): string {
  return `${sessionId}:agent`;
}

/** REST endpoints (paths appended to the configured apiBase). */
export const API_ROUTES = {
  me: "/api/v1/cli/me",
  sessions: "/api/v1/cli/sessions",
  importSession: "/api/v1/cli/sessions/import",
} as const;

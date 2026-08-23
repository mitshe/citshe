import { API_ROUTES } from "./constants.js";
import { loadConfig, type CliConfig } from "./config.js";

/** Thrown for well-understood, user-facing failures. */
export class CliError extends Error {}

/** Thrown specifically on 401 so callers can suggest `citshe login`. */
export class AuthError extends CliError {
  constructor(message = "Your token is invalid or expired.") {
    super(message);
  }
}

export interface CliUser {
  id: string;
  email?: string;
  name?: string;
}

export interface CliOrganization {
  id: string;
  name: string;
}

export interface CliMeResponse {
  user: CliUser;
  organizations: CliOrganization[];
}

export interface CliSession {
  id: string;
  name: string;
  status: string;
  organizationId: string;
  organizationName: string;
  repositoryName?: string;
  updatedAt: string;
}

export interface CliSessionsResponse {
  sessions: CliSession[];
}

export interface ImportSessionResponse {
  session: { id: string; name?: string };
}

interface RequestOptions {
  method?: string;
  /** JSON body — serialized automatically. */
  body?: unknown;
  /** Bearer token; overrides the stored config token when provided. */
  token: string;
  apiBase: string;
}

/**
 * Low-level fetch wrapper: attaches the bearer token, parses JSON, and maps
 * common failures to friendly errors.
 */
export async function apiRequest<T>(
  routePath: string,
  opts: RequestOptions,
): Promise<T> {
  const url = `${opts.apiBase}${routePath}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: "application/json",
        ...(opts.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    throw new CliError(
      `Could not reach ${opts.apiBase} — check your connection or --api-base.\n  (${(err as Error).message})`,
    );
  }

  if (res.status === 401) {
    throw new AuthError();
  }

  if (!res.ok) {
    let detail = "";
    try {
      const data = (await res.json()) as { message?: string; error?: string };
      detail = data.message || data.error || "";
    } catch {
      /* body was not JSON */
    }
    throw new CliError(
      `Request to ${routePath} failed (${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Resolve the active config or throw a friendly error telling the user to log
 * in. Use this in every command that needs auth.
 */
export async function requireConfig(): Promise<CliConfig> {
  const config = await loadConfig();
  if (!config) {
    throw new CliError("You are not logged in. Run `citshe login` first.");
  }
  return config;
}

// --- Typed endpoint helpers -------------------------------------------------

export function getMe(token: string, apiBase: string): Promise<CliMeResponse> {
  return apiRequest<CliMeResponse>(API_ROUTES.me, { token, apiBase });
}

export function getSessions(
  config: CliConfig,
): Promise<CliSessionsResponse> {
  return apiRequest<CliSessionsResponse>(API_ROUTES.sessions, {
    token: config.token,
    apiBase: config.apiBase,
  });
}

export function importSession(
  config: CliConfig,
  body: {
    filename: string;
    jsonl: string;
    projectPath: string;
    sessionUuid: string;
    organizationId?: string;
  },
): Promise<ImportSessionResponse> {
  return apiRequest<ImportSessionResponse>(API_ROUTES.importSession, {
    method: "POST",
    token: config.token,
    apiBase: config.apiBase,
    body,
  });
}

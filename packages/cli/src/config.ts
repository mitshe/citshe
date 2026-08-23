import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CONFIG_DIR_NAME,
  CONFIG_FILE_NAME,
  DEFAULT_API_BASE,
} from "./constants.js";

export interface CliConfig {
  /** The ctk_ personal access token. */
  token: string;
  /** Base URL for REST calls, e.g. https://rangopanel.mitshe.com */
  apiBase: string;
  /** Base URL for the socket.io connection (usually same host as apiBase). */
  wsBase: string;
}

export function configDir(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

export function configPath(): string {
  return path.join(configDir(), CONFIG_FILE_NAME);
}

/**
 * Load the saved config. Returns null when the user has not logged in yet
 * (rather than throwing) so callers can print a friendly hint.
 */
export async function loadConfig(): Promise<CliConfig | null> {
  try {
    const raw = await fs.readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<CliConfig>;
    if (!parsed.token || !parsed.apiBase) return null;
    return {
      token: parsed.token,
      apiBase: parsed.apiBase,
      wsBase: parsed.wsBase || parsed.apiBase,
    };
  } catch {
    return null;
  }
}

/** Persist config with 0600 perms so the token is not world-readable. */
export async function saveConfig(config: CliConfig): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true, mode: 0o700 });
  const data = JSON.stringify(config, null, 2) + "\n";
  await fs.writeFile(configPath(), data, { mode: 0o600 });
  // writeFile only applies mode when creating; enforce it for existing files.
  await fs.chmod(configPath(), 0o600);
}

/** Remove the config file. Returns true if a file was actually removed. */
export async function clearConfig(): Promise<boolean> {
  try {
    await fs.unlink(configPath());
    return true;
  } catch {
    return false;
  }
}

/** Normalise a user-supplied base URL: trim, add scheme, strip trailing slash. */
export function normalizeBase(input: string): string {
  let v = input.trim();
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  return v.replace(/\/+$/, "");
}

export { DEFAULT_API_BASE };

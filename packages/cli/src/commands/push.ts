import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import {
  importSession,
  requireConfig,
  getMe,
  AuthError,
  CliError,
} from "../api.js";

export interface PushOptions {
  org?: string;
}

/**
 * Claude Code stores per-project history under
 *   ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl
 * where <encoded-cwd> is the absolute path with every "/" replaced by "-".
 */
function encodeProjectPath(absPath: string): string {
  return absPath.replace(/\//g, "-");
}

async function findNewestJsonl(
  dir: string,
): Promise<{ file: string; mtime: number } | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  let best: { file: string; mtime: number } | null = null;
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const full = path.join(dir, name);
    try {
      const stat = await fs.stat(full);
      if (!best || stat.mtimeMs > best.mtime) {
        best = { file: full, mtime: stat.mtimeMs };
      }
    } catch {
      /* skip unreadable */
    }
  }
  return best;
}

export async function pushCommand(
  projectPathArg: string | undefined,
  options: PushOptions,
): Promise<void> {
  const config = await requireConfig();

  const projectPath = path.resolve(projectPathArg || process.cwd());
  const encoded = encodeProjectPath(projectPath);
  const projectDir = path.join(os.homedir(), ".claude", "projects", encoded);

  const newest = await findNewestJsonl(projectDir);
  if (!newest) {
    throw new CliError(
      `No Claude Code history found for:\n  ${projectPath}\n` +
        `Looked in: ${projectDir}\n` +
        `Run Claude Code in that project first, or pass a project path.`,
    );
  }

  const filename = path.basename(newest.file);
  const sessionUuid = filename.replace(/\.jsonl$/, "");
  const jsonl = await fs.readFile(newest.file, "utf8");

  // Resolve the target org: explicit --org, else the user's first org.
  let organizationId = options.org;
  if (!organizationId) {
    try {
      const me = await getMe(config.token, config.apiBase);
      organizationId = me.organizations[0]?.id;
    } catch (err) {
      if (err instanceof AuthError) {
        throw new CliError("Your token is invalid or expired. Run `citshe login`.");
      }
      throw err;
    }
    if (!organizationId) {
      throw new CliError(
        "You have no portals to import into. Create one in the panel first.",
      );
    }
  }

  console.log(
    chalk.dim(
      `Importing ${filename} (${(jsonl.length / 1024).toFixed(1)} KB) …`,
    ),
  );

  const result = await importSession(config, {
    filename,
    jsonl,
    projectPath,
    sessionUuid,
    organizationId,
  });

  const id = result.session.id;
  console.log(`${chalk.green("✓")} Imported as session ${chalk.bold(id)}`);
  console.log(chalk.dim(`  Attach with: citshe attach ${id}`));
}

import chalk from "chalk";
import { getSessions, requireConfig, type CliSession } from "../api.js";
import { relativeTime, shortId } from "../utils.js";

export interface LsOptions {
  json?: boolean;
}

function statusDot(status: string): string {
  return status?.toUpperCase() === "RUNNING"
    ? chalk.green("●")
    : chalk.dim("○");
}

export async function lsCommand(options: LsOptions): Promise<void> {
  const config = await requireConfig();
  const { sessions } = await getSessions(config);

  if (options.json) {
    console.log(JSON.stringify({ sessions }, null, 2));
    return;
  }

  if (!sessions.length) {
    console.log(
      chalk.dim("No sessions yet. Start one from the panel, or run `citshe push`."),
    );
    return;
  }

  // Group by organization, preserving first-seen order.
  const groups = new Map<string, { name: string; items: CliSession[] }>();
  for (const s of sessions) {
    const key = s.organizationId;
    if (!groups.has(key)) {
      groups.set(key, { name: s.organizationName || key, items: [] });
    }
    groups.get(key)!.items.push(s);
  }

  let first = true;
  for (const { name, items } of groups.values()) {
    if (!first) console.log("");
    first = false;

    console.log(chalk.bold.underline(name));

    // Column widths for id + name so rows line up within the group.
    const idW = Math.max(...items.map((s) => shortId(s.id).length), 8);
    const nameW = Math.min(
      Math.max(...items.map((s) => (s.name || "").length), 4),
      32,
    );

    for (const s of items) {
      const id = shortId(s.id).padEnd(idW);
      const nm = (s.name || chalk.dim("(unnamed)")).slice(0, nameW).padEnd(nameW);
      const repo = s.repositoryName ? chalk.cyan(s.repositoryName) : chalk.dim("—");
      const when = chalk.dim(relativeTime(s.updatedAt));
      console.log(
        `  ${statusDot(s.status)} ${chalk.dim(id)}  ${nm}  ${repo}  ${when}`,
      );
    }
  }

  console.log(
    chalk.dim(`\nAttach with: citshe attach <id>`),
  );
}

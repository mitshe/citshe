import chalk from "chalk";
import { getMe, AuthError, CliError } from "../api.js";
import {
  saveConfig,
  clearConfig,
  normalizeBase,
  configPath,
  DEFAULT_API_BASE,
} from "../config.js";
import { TOKEN_PREFIX } from "../constants.js";
import { promptHidden } from "../utils.js";

export interface LoginOptions {
  apiBase?: string;
}

export async function loginCommand(
  tokenArg: string | undefined,
  options: LoginOptions,
): Promise<void> {
  const apiBase = normalizeBase(options.apiBase || DEFAULT_API_BASE);

  let token = tokenArg?.trim();
  if (!token) {
    token = await promptHidden(
      `Paste your citshe personal access token (${TOKEN_PREFIX}...): `,
    );
  }

  if (!token) {
    throw new CliError("No token provided.");
  }
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new CliError(
      `That does not look like a citshe token — it should start with "${TOKEN_PREFIX}".`,
    );
  }

  let me;
  try {
    me = await getMe(token, apiBase);
  } catch (err) {
    if (err instanceof AuthError) {
      throw new CliError(
        "That token was rejected. Generate a fresh one in the panel and try again.",
      );
    }
    throw err;
  }

  // wsBase defaults to the same host as apiBase (socket.io shares the origin).
  await saveConfig({ token, apiBase, wsBase: apiBase });

  console.log(
    `\n${chalk.green("✓")} Logged in as ${chalk.bold(
      me.user.name || me.user.email || me.user.id,
    )}`,
  );
  console.log(chalk.dim(`  Config saved to ${configPath()} (chmod 600)`));

  if (me.organizations.length) {
    console.log(chalk.dim("\n  Portals:"));
    for (const org of me.organizations) {
      console.log(`    ${chalk.cyan("•")} ${org.name} ${chalk.dim(org.id)}`);
    }
  } else {
    console.log(chalk.dim("\n  No portals yet."));
  }
}

export async function logoutCommand(): Promise<void> {
  const removed = await clearConfig();
  if (removed) {
    console.log(`${chalk.green("✓")} Logged out. Local token removed.`);
  } else {
    console.log(chalk.dim("You were not logged in."));
  }
}

import chalk from "chalk";
import {
  getMe,
  AuthError,
  CliError,
  startDeviceAuth,
  pollDeviceAuth,
} from "../api.js";
import {
  saveConfig,
  clearConfig,
  normalizeBase,
  configPath,
} from "../config.js";
import { TOKEN_PREFIX, ENV_API_BASE } from "../constants.js";
import { prompt, openBrowser } from "../utils.js";

export interface LoginOptions {
  apiBase?: string;
  token?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function loginCommand(
  tokenArg: string | undefined,
  options: LoginOptions,
): Promise<void> {
  // 1) Panel URL — from --api-base, the CITSHE_API_BASE env, or a prompt.
  //    citshe is self-hosted; there is NO default panel address.
  let base = options.apiBase || process.env[ENV_API_BASE];
  if (!base) {
    base = await prompt(
      "Your citshe panel URL (e.g. https://panel.example.com): ",
    );
  }
  if (!base?.trim()) {
    throw new CliError(
      "A panel URL is required. Pass --api-base <url> or set CITSHE_API_BASE.",
    );
  }
  const apiBase = normalizeBase(base);

  // 2) Get a token — a pasted one (--token / arg) short-circuits; otherwise
  //    do the browser SSO device flow.
  const pasted = (options.token || tokenArg)?.trim();
  const token = pasted
    ? verifyPasted(pasted)
    : await browserLogin(apiBase);

  // 3) Verify + save.
  let me;
  try {
    me = await getMe(token, apiBase);
  } catch (err) {
    if (err instanceof AuthError) {
      throw new CliError("That token was rejected. Try `citshe login` again.");
    }
    throw err;
  }

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
  }
}

function verifyPasted(token: string): string {
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new CliError(
      `That does not look like a citshe token — it should start with "${TOKEN_PREFIX}".`,
    );
  }
  return token;
}

/** Browser SSO: open the panel, poll until the user authorizes. */
async function browserLogin(apiBase: string): Promise<string> {
  const { deviceCode, userCode, expiresIn } = await startDeviceAuth(apiBase);
  const verifyUrl = `${apiBase}/cli/authorize?code=${encodeURIComponent(userCode)}`;

  console.log(
    `\n  Opening your browser to authorize this device.\n` +
      `  If it doesn't open, visit: ${chalk.cyan(verifyUrl)}\n` +
      `  Confirmation code: ${chalk.bold(userCode)}\n`,
  );
  openBrowser(verifyUrl);
  process.stdout.write(chalk.dim("  Waiting for authorization… "));

  const deadline = Date.now() + expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(2500);
    const res = await pollDeviceAuth(apiBase, deviceCode);
    if (res.status === "approved" && res.token) {
      process.stdout.write(chalk.green("done\n"));
      return res.token;
    }
    if (res.status === "denied") {
      process.stdout.write("\n");
      throw new CliError("Login was denied in the browser.");
    }
    if (res.status === "expired") break;
    process.stdout.write(chalk.dim("."));
  }
  process.stdout.write("\n");
  throw new CliError("Login timed out. Run `citshe login` to try again.");
}

export async function logoutCommand(): Promise<void> {
  const removed = await clearConfig();
  if (removed) {
    console.log(`${chalk.green("✓")} Logged out. Local token removed.`);
  } else {
    console.log(chalk.dim("You were not logged in."));
  }
}

import { Command } from "commander";
import chalk from "chalk";
import { CliError, AuthError } from "./api.js";
import { DEFAULT_API_BASE } from "./config.js";
import { loginCommand, logoutCommand } from "./commands/login.js";
import { lsCommand } from "./commands/ls.js";
import { attachCommand } from "./commands/attach.js";
import { pushCommand } from "./commands/push.js";

/** Wrap an async action so thrown CliErrors print cleanly (no stack trace). */
function action<A extends unknown[]>(
  fn: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (err) {
      if (err instanceof AuthError) {
        console.error(
          `${chalk.red("✗")} ${err.message}\n  ${chalk.dim("Run `citshe login` to sign in again.")}`,
        );
      } else if (err instanceof CliError) {
        console.error(`${chalk.red("✗")} ${err.message}`);
      } else {
        console.error(
          `${chalk.red("✗")} Unexpected error: ${(err as Error).message}`,
        );
      }
      process.exit(1);
    }
  };
}

const program = new Command();

program
  .name("citshe")
  .description(
    "Thin local client for the citshe panel — attach to Claude Code worker sessions on your VPS.",
  )
  .version("0.1.0");

program
  .command("login")
  .argument("[token]", "your ctk_ personal access token")
  .option(
    "--api-base <url>",
    "citshe API base URL",
    DEFAULT_API_BASE,
  )
  .description("Save and verify your citshe access token")
  .action(action(async (token: string | undefined, opts: { apiBase: string }) => {
    await loginCommand(token, { apiBase: opts.apiBase });
  }));

program
  .command("logout")
  .description("Remove the saved token from this machine")
  .action(action(async () => {
    await logoutCommand();
  }));

program
  .command("ls")
  .description("List your sessions, grouped by portal")
  .option("--json", "output raw JSON")
  .action(action(async (opts: { json?: boolean }) => {
    await lsCommand({ json: opts.json });
  }));

program
  .command("attach")
  .argument("<sessionId>", "the session to attach to")
  .option("--terminal <id>", "terminal id override (default <sessionId>:agent)")
  .description("Attach your local terminal to a session on the VPS")
  .action(action(async (sessionId: string, opts: { terminal?: string }) => {
    await attachCommand(sessionId, { terminal: opts.terminal });
  }));

program
  .command("push")
  .argument("[projectPath]", "local project path (default: cwd)")
  .option("--org <id>", "portal (organization) id to import into")
  .description("Import the newest local Claude Code session into a portal")
  .action(action(async (projectPath: string | undefined, opts: { org?: string }) => {
    await pushCommand(projectPath, { org: opts.org });
  }));

program.parseAsync(process.argv).catch((err) => {
  console.error(`${chalk.red("✗")} ${(err as Error).message}`);
  process.exit(1);
});

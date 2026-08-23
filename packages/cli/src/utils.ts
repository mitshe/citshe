import readline from "node:readline";

/** Prompt the user for a line of input on the terminal (no extra deps). */
export function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Prompt without echoing input (used for pasting the token). Falls back to a
 * normal prompt when stdin is not a TTY.
 */
export function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) return prompt(question);

  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(question);

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    let value = "";
    const finish = () => {
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    const onData = (buf: Buffer) => {
      const byte = buf[0];
      // Enter (CR / LF) or Ctrl-D -> submit
      if (byte === 0x0d || byte === 0x0a || byte === 0x04) {
        finish();
        stdout.write("\n");
        resolve(value.trim());
        return;
      }
      // Ctrl-C -> abort
      if (byte === 0x03) {
        finish();
        stdout.write("\n");
        process.exit(130);
        return;
      }
      // Backspace / DEL
      if (byte === 0x7f || byte === 0x08) {
        value = value.slice(0, -1);
        return;
      }
      value += buf.toString("utf8");
    };
    stdin.on("data", onData);
  });
}

/** Compact human-friendly "time ago" from an ISO / date string. */
export function relativeTime(value: string | number | Date): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "ago" : "from now";

  const units: [number, string][] = [
    [60_000, "s"],
    [3_600_000, "m"],
    [86_400_000, "h"],
    [604_800_000, "d"],
    [2_629_800_000, "w"],
    [31_557_600_000, "mo"],
  ];

  if (abs < 60_000) return "just now";
  for (let i = units.length - 1; i >= 0; i--) {
    const [ms, label] = units[i];
    if (abs >= ms) {
      return `${Math.floor(abs / ms)}${label} ${suffix}`;
    }
  }
  return `${Math.floor(abs / 31_557_600_000)}y ${suffix}`;
}

/** Shorten a session/uuid id for compact table display. */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

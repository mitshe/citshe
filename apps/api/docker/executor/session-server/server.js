#!/usr/bin/env node

/**
 * Session Server - runs inside the executor container to keep it alive
 * and set up the workspace for interactive AI sessions.
 *
 * Reads SESSION_CONFIG env var (base64 JSON):
 * {
 *   repos: [{ name, cloneUrl, branch }],
 *   instructions: string,
 *   provider: string,
 *   integrations: [{ type, config }],
 *   skills: [{ name, instructions }]
 * }
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKSPACE = '/workspace';
const HOME_DIR = process.env.HOME || '/home/executor';

function log(message) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ type: 'log', level: 'info', message, timestamp }));
}

function logError(message) {
  const timestamp = new Date().toISOString();
  console.error(JSON.stringify({ type: 'log', level: 'error', message, timestamp }));
}

function waitForFile(filePath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (fs.existsSync(filePath)) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out waiting for ${filePath}`));
        return;
      }
      setTimeout(check, 200);
    };
    check();
  });
}

function execSilent(cmd, options = {}) {
  try {
    execSync(cmd, { stdio: 'pipe', ...options });
    return true;
  } catch {
    return false;
  }
}

function setupGitCredentialStore() {
  execSilent('git config --global credential.helper store');
}

/**
 * Install a global git pre-commit hook that BLOCKS commits containing
 * token-shaped secrets, so the agent can never accidentally commit a connected
 * token (CF/Vercel/Neon) into the repo — which could be public. Scoped to
 * value-assignment patterns to avoid blocking docs that merely mention a key
 * name. Second layer behind the prompt's SECRETS rule.
 */
function installSecretScanHook() {
  try {
    const hooksDir = path.join(HOME_DIR, '.git-hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const hook = [
      '#!/bin/bash',
      '# citshe: block committing secret-shaped values (tokens/keys/db urls).',
      'staged=$(git diff --cached -U0 | grep "^+" | grep -v "^+++" || true)',
      '# Known secret env-var assignments with a real-looking value, or a live',
      '# Postgres URL with credentials. Deliberately narrow to avoid false hits.',
      'if echo "$staged" | grep -Eq \\',
      '  "(CLOUDFLARE_API_TOKEN|VERCEL_TOKEN|NEON_API_KEY|CLOUDFLARE_ACCOUNT_ID|GITHUB_TOKEN|GH_TOKEN)[\\"\\x27 ]*[:=][\\"\\x27 ]*[A-Za-z0-9_-]{16,}"; then',
      '  echo "citshe: refusing to commit — a secret token value is staged." >&2',
      '  echo "Keep secrets in env vars / host config, not in the repo." >&2',
      '  exit 1',
      'fi',
      'if echo "$staged" | grep -Eq "postgres(ql)?://[^ :@\\"\\x27]+:[^ @\\"\\x27]+@"; then',
      '  echo "citshe: refusing to commit — a database URL with credentials is staged." >&2',
      '  exit 1',
      'fi',
      'exit 0',
      '',
    ].join('\n');
    const hookPath = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(hookPath, hook, { mode: 0o755 });
    // Point ALL repos in this container at the shared hooks dir.
    execSilent(`git config --global core.hooksPath ${JSON.stringify(hooksDir)}`);
    log('Installed git secret-scan pre-commit hook.');
  } catch (err) {
    log('Could not install secret-scan hook: ' + err.message);
  }
}

/**
 * Set the git commit author from the identity citshe injects via env
 * (GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL, sourced from the API's GIT_COMMIT_*
 * config). Nothing is hardcoded here. Deploy providers like Vercel reject
 * placeholder authors, so a real identity must be configured on the server.
 */
function configureGitAuthor() {
  // Identity comes from env (injected by citshe from GIT_COMMIT_NAME/EMAIL).
  // Never hardcoded here — if unset, leave the image's baked git config as-is.
  const name = process.env.GIT_AUTHOR_NAME;
  const email = process.env.GIT_AUTHOR_EMAIL;
  if (!name || !email) {
    log('Git author not configured via env — leaving existing git config.');
    return;
  }

  // Layer 1 — global git config (user.name/email).
  execSilent(`git config --global user.name ${JSON.stringify(name)}`);
  execSilent(`git config --global user.email ${JSON.stringify(email)}`);

  // Layer 2 — FORCE the identity via env in every shell Claude spawns. Git
  // honours GIT_AUTHOR_* / GIT_COMMITTER_* over config, so even if the agent
  // runs `git config` itself or the config is missing, commits are attributed
  // to the configured identity. Persisted to the executor's bash profile so
  // it's always exported. Without this, Claude sometimes invents an author.
  try {
    const profile = path.join(HOME_DIR, '.bashrc');
    const block =
      '\n# citshe: force commit identity (do not change)\n' +
      `export GIT_AUTHOR_NAME=${JSON.stringify(name)}\n` +
      `export GIT_AUTHOR_EMAIL=${JSON.stringify(email)}\n` +
      `export GIT_COMMITTER_NAME=${JSON.stringify(name)}\n` +
      `export GIT_COMMITTER_EMAIL=${JSON.stringify(email)}\n`;
    const existing = fs.existsSync(profile)
      ? fs.readFileSync(profile, 'utf-8')
      : '';
    if (!existing.includes('citshe: force commit identity')) {
      fs.appendFileSync(profile, block);
    }
  } catch (err) {
    log('Could not persist git identity to profile: ' + err.message);
  }

  log(`Git author set to ${name} <${email}>`);
}

function extractAndStoreGitCredentials(cloneUrl) {
  if (!cloneUrl.startsWith('https://')) return;

  try {
    const url = new URL(cloneUrl);
    if (!url.username && !url.password) return;

    const credLine = `${url.protocol}//${url.username}:${url.password}@${url.hostname}`;
    const credStorePath = path.join(HOME_DIR, '.git-credentials');
    const existing = fs.existsSync(credStorePath)
      ? fs.readFileSync(credStorePath, 'utf-8')
      : '';

    if (!existing.includes(`@${url.hostname}`)) {
      fs.appendFileSync(credStorePath, credLine + '\n', { mode: 0o600 });
    }
  } catch {}
}

function cloneRepositories(repos) {
  if (!repos || repos.length === 0) return;

  setupGitCredentialStore();

  for (const repo of repos) {
    const repoDir = path.join(WORKSPACE, repo.name);

    if (fs.existsSync(repoDir)) {
      log(`Repository ${repo.name} already exists, pulling latest`);
      try {
        execSync(`git -C ${repoDir} pull --ff-only`, { stdio: 'pipe' });
      } catch (e) {
        logError(`Failed to pull ${repo.name}: ${e.message}`);
      }
      continue;
    }

    log(`Cloning ${repo.name}`);
    try {
      const branch = repo.branch || 'main';
      extractAndStoreGitCredentials(repo.cloneUrl);
      execSync(
        `git clone --branch ${branch} --single-branch ${repo.cloneUrl} ${repoDir}`,
        { stdio: 'pipe', timeout: 120000 },
      );
      log(`Cloned ${repo.name} successfully`);
    } catch (e) {
      logError(`Failed to clone ${repo.name}: ${e.message}`);
    }
  }
}

/**
 * Convert SSH remotes to HTTPS with token auth for all git repos in workspace.
 * Handles local-mounted folders that have git@host:org/repo.git origins.
 */
function rewriteSshRemotes(integrations) {
  if (!integrations || integrations.length === 0) return;

  // Build a map: hostname → { username, password } for HTTPS auth
  const hostCredentials = new Map();
  for (const integration of integrations) {
    const cfg = integration.config;
    const token = cfg.accessToken || cfg.apiToken || cfg.token;
    if (!token) continue;

    if (integration.type === 'GITLAB') {
      const host = cfg.baseUrl ? new URL(cfg.baseUrl).hostname : 'gitlab.com';
      hostCredentials.set(host, { username: 'oauth2', password: token });
    } else if (integration.type === 'GITHUB') {
      hostCredentials.set('github.com', { username: token, password: 'x-oauth-basic' });
    }
  }

  if (hostCredentials.size === 0) return;

  // Find all git repos in /workspace (including mounted local ones)
  const dirs = [];
  try {
    const entries = fs.readdirSync(WORKSPACE, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(WORKSPACE, entry.name);
        if (fs.existsSync(path.join(fullPath, '.git'))) {
          dirs.push(fullPath);
        }
      }
    }
  } catch {}

  for (const repoDir of dirs) {
    try {
      const remoteUrl = execSync(`git -C ${repoDir} remote get-url origin`, {
        stdio: 'pipe',
      }).toString().trim();

      // Match SSH format: git@host:org/repo.git
      const sshMatch = remoteUrl.match(/^git@([^:]+):(.+)$/);
      if (!sshMatch) continue;

      const [, host, repoPath] = sshMatch;
      const creds = hostCredentials.get(host);
      if (!creds) continue;

      const httpsUrl = `https://${creds.username}:${creds.password}@${host}/${repoPath}`;
      execSync(`git -C ${repoDir} remote set-url origin ${httpsUrl}`, { stdio: 'pipe' });
      execSync(`git -C ${repoDir} remote set-url --push origin ${httpsUrl}`, { stdio: 'pipe' });
      log(`Rewrote SSH remote to HTTPS for ${path.basename(repoDir)} (${host})`);
    } catch {}
  }
}

function writeInstructions(instructions, provider) {
  if (!instructions) return;

  const providerNormalized = (provider || '').toUpperCase();

  if (providerNormalized === 'OPENCLAW') {
    fs.writeFileSync(path.join(WORKSPACE, 'SOUL.md'), instructions, 'utf-8');
    log('Written SOUL.md with session instructions (OpenClaw)');
  } else if (providerNormalized === 'CLAUDE_CODE_LOCAL') {
    fs.writeFileSync(path.join(WORKSPACE, 'CLAUDE.md'), instructions, 'utf-8');
    log('Written CLAUDE.md with session instructions (Claude Code)');
  } else {
    fs.writeFileSync(path.join(WORKSPACE, 'CLAUDE.md'), instructions, 'utf-8');
    fs.writeFileSync(path.join(WORKSPACE, 'SOUL.md'), instructions, 'utf-8');
    log('Written CLAUDE.md + SOUL.md with session instructions');
  }
}

function installSkills(skills) {
  if (!skills || skills.length === 0) return;

  const commandsDir = path.join(HOME_DIR, '.claude', 'commands');
  fs.mkdirSync(commandsDir, { recursive: true });

  for (const skill of skills) {
    const slug = skill.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const filePath = path.join(commandsDir, `${slug}.md`);
    fs.writeFileSync(filePath, skill.instructions, 'utf-8');
  }

  log(`Installed ${skills.length} skill(s) as slash commands`);
}

/**
 * Pre-accept Claude Code's one-time "Bypass Permissions" and workspace-trust
 * dialogs so the agent (and you, on take-over) never sit on that prompt. The
 * container is the sandbox this warning is about, so accepting is correct here.
 */
function preacceptClaudeBypass() {
  // The reliable way to skip the interactive "Bypass Permissions mode"
  // acknowledgment is to make bypass the DEFAULT permission mode in
  // ~/.claude/settings.json. The older ~/.claude.json flags
  // (bypassPermissionsModeAccepted / hasTrustDialogAccepted) are not honored by
  // current Claude Code versions, so relying on them let the dialog reappear.
  try {
    const dir = path.join(HOME_DIR, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'settings.json');
    let cfg = {};
    try {
      cfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      cfg = {};
    }
    cfg.permissions = { ...(cfg.permissions || {}), defaultMode: 'bypassPermissions' };
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf-8');
    log('Set Claude defaultMode=bypassPermissions (skips the acknowledgment)');
  } catch (err) {
    log('Could not configure Claude bypass mode: ' + err.message);
  }

  // Best-effort: also keep the legacy trust flags for the "trust this folder"
  // prompt, which is separate from the bypass acknowledgment.
  try {
    const file = path.join(HOME_DIR, '.claude.json');
    let cfg = {};
    try {
      cfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      cfg = {};
    }
    cfg.hasTrustDialogAccepted = true;
    cfg.hasCompletedProjectOnboarding = true;
    cfg.projects = cfg.projects || {};
    cfg.projects['/workspace'] = {
      ...(cfg.projects['/workspace'] || {}),
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    };
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch {
    // non-fatal
  }
}

/**
 * Install the `citshe-task` helper so the agent can add follow-up tasks to the
 * board: `citshe-task "title" ["description"]`. Uses CITSHE_API_URL +
 * CITSHE_WORKER_TOKEN injected into the container by the orchestrator.
 */
function installCitsheTaskCli() {
  if (!process.env.CITSHE_WORKER_TOKEN || !process.env.CITSHE_API_URL) return;
  const binDir = '/home/executor/bin';
  try {
    fs.mkdirSync(binDir, { recursive: true });
    const script = [
      '#!/bin/bash',
      '# citshe-task "title" ["description"] — add a task to the board.',
      'set -e',
      'TITLE="$1"; DESC="$2"',
      'if [ -z "$TITLE" ]; then echo "usage: citshe-task <title> [description]" >&2; exit 1; fi',
      'jq -n --arg t "$TITLE" --arg d "$DESC" \'{title:$t, description:$d}\' | \\',
      '  curl -sS -X POST "$CITSHE_API_URL/api/v1/worker/tasks" \\',
      '    -H "Authorization: Bearer $CITSHE_WORKER_TOKEN" \\',
      '    -H "Content-Type: application/json" -d @-',
      'echo',
    ].join('\n');
    fs.writeFileSync(path.join(binDir, 'citshe-task'), script, { mode: 0o755 });
    log('Installed citshe-task CLI (agent can add tasks to the board)');
  } catch (err) {
    log('Could not install citshe-task CLI: ' + err.message);
  }
}

/**
 * Install `citshe-stream <out-file>` — a formatter for `claude --print
 * --output-format stream-json`. Reads the JSON event stream on stdin, prints a
 * clean, human-readable LIVE transcript to the pane (Claude's text as it
 * streams, plus "› Edit file.astro" / "› Bash: npm run build" tool lines), and
 * writes ONLY Claude's final plain text to <out-file> for the task summary.
 * Without this the worker ran headless `--print` which shows nothing until the
 * very end (the "Claude thinks in memory / dead terminal" problem).
 */
/**
 * Guarantee ~/bin is on PATH for EVERY shell in the container.
 *
 * The Dockerfile sets `ENV PATH=/home/executor/bin:...`, but /etc/profile
 * resets PATH from scratch for login shells, and tmux runs a shell whose PATH
 * is frozen before ~/bin exists — so `citshe-stream`, `citshe-task`, etc.
 * (installed into ~/bin at runtime) come up "command not found". Append an
 * idempotent PATH export to the shell rc files so any shell finds them.
 */
function ensureBinOnPath() {
  const binDir = '/home/executor/bin';
  const marker = '# --- citshe bin path ---';
  const block = `\n${marker}\ncase ":$PATH:" in *":${binDir}:"*) ;; *) export PATH="${binDir}:$PATH";; esac\n`;
  for (const rc of ['.bashrc', '.profile', '.zshrc']) {
    const p = path.join(HOME_DIR, rc);
    try {
      const existing = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
      if (!existing.includes(marker)) fs.appendFileSync(p, block);
    } catch (err) {
      log(`Could not ensure ~/bin on PATH in ${rc}: ${err.message}`);
    }
  }
}

function installCitsheStreamCli() {
  const binDir = '/home/executor/bin';
  try {
    fs.mkdirSync(binDir, { recursive: true });
    const script = String.raw`#!/usr/bin/env node
// citshe-stream <out-file> — render claude stream-json to a live transcript.
const fs = require('fs');
const outFile = process.argv[2] || '/dev/null';
let buf = '';
let finalText = '';         // accumulates Claude's final assistant text
let lastWasText = false;    // pretty spacing between text and tool lines
const W = (s) => process.stdout.write(s);
const toolLine = (name, input) => {
  let detail = '';
  try {
    if (input) {
      if (input.file_path) detail = input.file_path.replace(/^\/workspace\//, '');
      else if (input.command) detail = String(input.command).split('\n')[0].slice(0, 80);
      else if (input.url) detail = input.url;
      else if (input.pattern) detail = input.pattern;
      else if (input.description) detail = input.description;
    }
  } catch {}
  return '\x1b[38;5;39m›\x1b[0m \x1b[1m' + name + '\x1b[0m' + (detail ? '  \x1b[2m' + detail + '\x1b[0m' : '');
};
const handle = (ev) => {
  try {
    const t = ev.type;
    // Live text as it streams (partial deltas).
    if (t === 'stream_event' && ev.event) {
      const e = ev.event;
      if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') {
        W(e.delta.text || '');
        finalText += e.delta.text || '';
        lastWasText = true;
      }
      return;
    }
    // A completed assistant message: surface any tool_use as a "› tool" line.
    if (t === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
      for (const b of ev.message.content) {
        if (b.type === 'tool_use') {
          if (lastWasText) { W('\n'); lastWasText = false; }
          W(toolLine(b.name, b.input) + '\n');
        }
      }
      return;
    }
    // Final result — print a blank line to close the transcript.
    if (t === 'result') {
      if (lastWasText) W('\n');
      return;
    }
  } catch {}
};
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { W(line + '\n'); continue; }
    handle(ev);
  }
});
process.stdin.on('end', () => {
  if (buf.trim()) { try { handle(JSON.parse(buf)); } catch {} }
  try { fs.writeFileSync(outFile, finalText.trim() + '\n'); } catch {}
  process.exit(0);
});
`;
    fs.writeFileSync(path.join(binDir, 'citshe-stream'), script, { mode: 0o755 });
    log('Installed citshe-stream (live claude transcript formatter)');
  } catch (err) {
    log('Could not install citshe-stream: ' + err.message);
  }
}

/**
 * Install `citshe-shot <url|file.png> [caption]` so the agent can attach a
 * screenshot to its task's activity feed while testing. A URL is rendered with
 * headless Chromium (Playwright); a file path is uploaded as-is. Needs
 * CITSHE_TASK_ID (the task the worker runs) in addition to the worker token.
 */
function installCitsheShotCli() {
  if (
    !process.env.CITSHE_WORKER_TOKEN ||
    !process.env.CITSHE_API_URL ||
    !process.env.CITSHE_TASK_ID
  )
    return;
  const binDir = '/home/executor/bin';
  try {
    fs.mkdirSync(binDir, { recursive: true });
    const script = [
      '#!/bin/bash',
      '# citshe-shot <url|file.png> [caption] — attach a screenshot to this task.',
      'set -e',
      'SRC="$1"; CAPTION="$2"',
      'if [ -z "$SRC" ]; then echo "usage: citshe-shot <url|file.png> [caption]" >&2; exit 1; fi',
      'OUT="$(mktemp --suffix=.png)"',
      'if echo "$SRC" | grep -qE \'^https?://\'; then',
      '  # Render the URL with the Chromium that ships in the executor image.',
      '  PW="npx playwright"; command -v playwright >/dev/null 2>&1 && PW="playwright"',
      '  $PW screenshot --full-page --wait-for-timeout=1500 "$SRC" "$OUT" >/dev/null 2>&1',
      'else',
      '  cp "$SRC" "$OUT"',
      'fi',
      // Base64 to a file, then jq --rawfile — a full-page PNG is far bigger than
      // ARG_MAX, so it must NOT be passed as a shell arg (that was the
      // "jq: Argument list too long" failure).
      'B64F="$(mktemp)"',
      'base64 -w0 "$OUT" > "$B64F"',
      'jq -n --rawfile img "$B64F" --arg cap "$CAPTION" \'{image:$img, caption:$cap, mimeType:"image/png"}\' | \\',
      '  curl -sS -X POST "$CITSHE_API_URL/api/v1/worker/tasks/$CITSHE_TASK_ID/screenshot" \\',
      '    -H "Authorization: Bearer $CITSHE_WORKER_TOKEN" \\',
      '    -H "Content-Type: application/json" -d @-',
      'rm -f "$OUT" "$B64F"',
      'echo',
    ].join('\n');
    fs.writeFileSync(path.join(binDir, 'citshe-shot'), script, { mode: 0o755 });
    log('Installed citshe-shot CLI (agent can attach screenshots to the task)');
  } catch (err) {
    log('Could not install citshe-shot CLI: ' + err.message);
  }
}

/**
 * Install the "citshe" Claude Code skill so the agent natively understands how
 * to talk back to citshe (narrate progress, set status, screenshot, add tasks).
 * A real skill (~/.claude/skills/citshe/SKILL.md + scripts) beats loose CLIs:
 * Claude reads the description and knows WHEN to use each action.
 */
function installCitsheSkill() {
  // Install the skill for EVERY session, not just task workers. The Stack-tools
  // section (wrangler/vercel/neonctl) is the main value for a plain terminal and
  // needs no worker token. The reporting scripts (note/status/shot/task) require
  // CITSHE_WORKER_TOKEN + CITSHE_API_URL, so we only wire those in when present.
  const hasReporting =
    !!process.env.CITSHE_WORKER_TOKEN && !!process.env.CITSHE_API_URL;
  const hasTask = !!process.env.CITSHE_TASK_ID;
  try {
    const skillDir = path.join(HOME_DIR, '.claude', 'skills', 'citshe');
    const scriptsDir = path.join(skillDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });

    const reportingSections = hasReporting
      ? [
          'You are running as a worker for a task shown in the citshe panel. Keep',
          'the human in the loop by reporting through these scripts. Environment',
          'variables (CITSHE_API_URL, CITSHE_WORKER_TOKEN, CITSHE_TASK_ID) are set.',
          '',
          '## Narrate progress (note)',
          'Leave a short note in the task activity at meaningful points.',
          '```bash',
          '${CLAUDE_SKILL_DIR}/scripts/citshe-note.sh "Cloned repo, running the dev server"',
          '```',
          '',
          '## Set task status',
          'Move the task as you work: `in-progress` when you start, `review` when the',
          'work is ready for a human, or `done` if it is fully complete.',
          '```bash',
          '${CLAUDE_SKILL_DIR}/scripts/citshe-status.sh review',
          '```',
          '',
          '## Attach a screenshot (proof for web work)',
          'When you test a running web app, capture the page and attach it.',
          '```bash',
          '${CLAUDE_SKILL_DIR}/scripts/citshe-shot.sh http://localhost:3000 "Home page after the change"',
          '```',
          '',
          '## Add a follow-up task',
          'For real, actionable follow-ups that are out of scope for this task.',
          '```bash',
          '${CLAUDE_SKILL_DIR}/scripts/citshe-task.sh "Short title" "One-line description"',
          '```',
          '',
          '## Report a deployed site (build tasks)',
          'When you build a project from scratch and deploy it live, report the URL',
          'so the panel shows an "Open site" button.',
          '```bash',
          '${CLAUDE_SKILL_DIR}/scripts/citshe-site.sh "https://my-project.pages.dev"',
          '```',
          '',
        ]
      : [
          'You are running in an interactive citshe terminal session (not a task',
          'worker). There is no task to report against, but the portal\'s connected',
          'stack tools are available as environment variables — see below.',
          '',
        ];

    const skillMd = [
      '---',
      'name: citshe',
      'description: >-',
      '  Act on this portal from a citshe session. Use the connected stack tools',
      '  (Cloudflare/Vercel/Neon/Expo via wrangler/vercel/neonctl/eas, exposed as',
      '  env vars) to deploy, inspect, and manage hosting and databases. When',
      '  running as a task worker, also report progress back to the panel: narrate',
      '  (note), move the task to Review/Done (status), attach a screenshot (shot),',
      '  and add follow-up tasks (task).',
      'allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/*)',
      '---',
      '',
      '# citshe — act on this portal',
      '',
      ...reportingSections,
      '## Stack tools (deploy / DB / hosting)',
      'The connected tools for this portal are exposed as environment variables,',
      'so you can act on the stack directly. Check which are set and use the',
      'matching CLI:',
      '- `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`) → `wrangler` for Pages/Workers/R2/DNS.',
      '- `VERCEL_TOKEN` → `vercel --token $VERCEL_TOKEN` for deploys/projects/domains.',
      '- `NEON_API_KEY` → `neonctl` for Postgres branches/projects.',
      '- `EXPO_TOKEN` → `eas` for EAS builds/submits.',
      '- `GOOGLE_ADS_*` → the Google Ads API (no bundled CLI).',
      'Run `env | grep -E "CLOUDFLARE|VERCEL|NEON|EXPO|GOOGLE_ADS"` to see what is',
      'available. Only what the user connected in citshe is present.',
      '',
      'Do not spam — notes and tasks should be meaningful, not play-by-play.',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMd, 'utf-8');

    // The reporting scripts only make sense with a worker token + task. Skip
    // them for plain terminal sessions — the SKILL.md already omits their docs.
    if (!hasReporting) {
      log('Installed citshe Claude Code skill (stack tools only — no task context)');
      return;
    }

    const shebang = '#!/bin/bash';
    const guard = (needTask) =>
      [
        'set -e',
        'if [ -z "$CITSHE_API_URL" ] || [ -z "$CITSHE_WORKER_TOKEN" ]; then',
        '  echo "citshe env not set" >&2; exit 1; fi',
        needTask
          ? 'if [ -z "$CITSHE_TASK_ID" ]; then echo "no CITSHE_TASK_ID (not a task worker)" >&2; exit 1; fi'
          : '',
      ]
        .filter(Boolean)
        .join('\n');

    // note
    fs.writeFileSync(
      path.join(scriptsDir, 'citshe-note.sh'),
      [
        shebang,
        guard(true),
        'TEXT="$1"',
        'if [ -z "$TEXT" ]; then echo "usage: citshe-note.sh <text>" >&2; exit 1; fi',
        'jq -n --arg t "$TEXT" \'{text:$t}\' | \\',
        '  curl -sS -X POST "$CITSHE_API_URL/api/v1/worker/tasks/$CITSHE_TASK_ID/note" \\',
        '    -H "Authorization: Bearer $CITSHE_WORKER_TOKEN" -H "Content-Type: application/json" -d @-',
        'echo',
      ].join('\n'),
      { mode: 0o755 },
    );

    // status
    fs.writeFileSync(
      path.join(scriptsDir, 'citshe-status.sh'),
      [
        shebang,
        guard(true),
        'S="$1"',
        'if [ -z "$S" ]; then echo "usage: citshe-status.sh <in-progress|review|done>" >&2; exit 1; fi',
        'jq -n --arg s "$S" \'{status:$s}\' | \\',
        '  curl -sS -X POST "$CITSHE_API_URL/api/v1/worker/tasks/$CITSHE_TASK_ID/status" \\',
        '    -H "Authorization: Bearer $CITSHE_WORKER_TOKEN" -H "Content-Type: application/json" -d @-',
        'echo',
      ].join('\n'),
      { mode: 0o755 },
    );

    // site (report the live URL of a deployed build task)
    fs.writeFileSync(
      path.join(scriptsDir, 'citshe-site.sh'),
      [
        shebang,
        guard(true),
        'URL="$1"',
        'if [ -z "$URL" ]; then echo "usage: citshe-site.sh <live-url>" >&2; exit 1; fi',
        'jq -n --arg u "$URL" \'{url:$u}\' | \\',
        '  curl -sS -X POST "$CITSHE_API_URL/api/v1/worker/tasks/$CITSHE_TASK_ID/site" \\',
        '    -H "Authorization: Bearer $CITSHE_WORKER_TOKEN" -H "Content-Type: application/json" -d @-',
        'echo',
      ].join('\n'),
      { mode: 0o755 },
    );

    // shot (reuse the ~/bin/citshe-shot logic: render URL or upload a file)
    fs.writeFileSync(
      path.join(scriptsDir, 'citshe-shot.sh'),
      [
        shebang,
        guard(true),
        'SRC="$1"; CAPTION="$2"',
        'if [ -z "$SRC" ]; then echo "usage: citshe-shot.sh <url|file.png> [caption]" >&2; exit 1; fi',
        'OUT="$(mktemp --suffix=.png)"',
        "if echo \"$SRC\" | grep -qE '^https?://'; then",
        '  PW="npx playwright"; command -v playwright >/dev/null 2>&1 && PW="playwright"',
        '  $PW screenshot --full-page --wait-for-timeout=1500 "$SRC" "$OUT" >/dev/null 2>&1',
        'else cp "$SRC" "$OUT"; fi',
        'B64F="$(mktemp)"; base64 -w0 "$OUT" > "$B64F"',
        'jq -n --rawfile img "$B64F" --arg cap "$CAPTION" \'{image:$img, caption:$cap, mimeType:"image/png"}\' | \\',
        '  curl -sS -X POST "$CITSHE_API_URL/api/v1/worker/tasks/$CITSHE_TASK_ID/screenshot" \\',
        '    -H "Authorization: Bearer $CITSHE_WORKER_TOKEN" -H "Content-Type: application/json" -d @-',
        'rm -f "$OUT" "$B64F"; echo',
      ].join('\n'),
      { mode: 0o755 },
    );

    // task
    fs.writeFileSync(
      path.join(scriptsDir, 'citshe-task.sh'),
      [
        shebang,
        guard(false),
        'TITLE="$1"; DESC="$2"',
        'if [ -z "$TITLE" ]; then echo "usage: citshe-task.sh <title> [description]" >&2; exit 1; fi',
        'jq -n --arg t "$TITLE" --arg d "$DESC" \'{title:$t, description:$d}\' | \\',
        '  curl -sS -X POST "$CITSHE_API_URL/api/v1/worker/tasks" \\',
        '    -H "Authorization: Bearer $CITSHE_WORKER_TOKEN" -H "Content-Type: application/json" -d @-',
        'echo',
      ].join('\n'),
      { mode: 0o755 },
    );

    log(
      'Installed citshe Claude Code skill' +
        (hasTask ? '' : ' (no task context — task-add only)'),
    );
  } catch (err) {
    log('Could not install citshe skill: ' + err.message);
  }
}

function getToken(config) {
  return config.accessToken || config.apiToken || config.token || config.apiKey || null;
}

function escapeShellValue(value) {
  return String(value).replace(/"/g, '\\"');
}

function configureGitHub(config) {
  const token = config.accessToken;
  if (!token) return;

  const credStorePath = path.join(HOME_DIR, '.git-credentials');
  const existing = fs.existsSync(credStorePath) ? fs.readFileSync(credStorePath, 'utf-8') : '';
  if (!existing.includes('@github.com')) {
    fs.appendFileSync(credStorePath, `https://${token}:x-oauth-basic@github.com\n`, { mode: 0o600 });
  }

  const ghConfigDir = path.join(HOME_DIR, '.config', 'gh');
  fs.mkdirSync(ghConfigDir, { recursive: true });
  fs.writeFileSync(
    path.join(ghConfigDir, 'hosts.yml'),
    [
      'github.com:',
      `    oauth_token: ${token}`,
      '    git_protocol: https',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );

  execSilent('gh auth setup-git', {
    env: { ...process.env, GH_TOKEN: token, HOME: HOME_DIR },
  });

  log('GitHub: git credentials + gh CLI configured');
}

function configureGitLab(config) {
  const token = config.accessToken;
  if (!token) return;

  const hostname = config.baseUrl ? new URL(config.baseUrl).hostname : 'gitlab.com';

  const credStorePath = path.join(HOME_DIR, '.git-credentials');
  const existing = fs.existsSync(credStorePath) ? fs.readFileSync(credStorePath, 'utf-8') : '';
  if (!existing.includes(`@${hostname}`)) {
    fs.appendFileSync(credStorePath, `https://oauth2:${token}@${hostname}\n`, { mode: 0o600 });
  }

  execSilent(`glab auth login --hostname ${hostname} --token ${token}`, {
    env: { ...process.env, HOME: HOME_DIR },
  });

  log(`GitLab: git credentials + glab CLI configured for ${hostname}`);
}

function configureJira(config) {
  if (!config.baseUrl || !config.email || !(config.apiToken || config.token)) return;

  const jiraConfigDir = path.join(HOME_DIR, '.config', '.jira');
  fs.mkdirSync(jiraConfigDir, { recursive: true });
  fs.writeFileSync(
    path.join(jiraConfigDir, '.config.yml'),
    [
      `server: ${config.baseUrl}`,
      `login: ${config.email}`,
      `api_token: ${config.apiToken || config.token}`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );

  log(`Jira: CLI configured for ${config.baseUrl}`);
}

function configureLinear(config) {
  if (!config.apiKey) return;
  log('Linear: API key available via LINEAR_API_KEY env var');
}

function configureTrello(config) {
  if (!config.apiKey || !config.apiToken) return;
  log('Trello: API credentials available via TRELLO_API_KEY / TRELLO_API_TOKEN env vars');
}

function configureSlack(config) {
  if (!config.botToken && !config.webhookUrl) return;
  log('Slack: credentials available via SLACK_BOT_TOKEN env var');
}

function configureDiscord(config) {
  if (!config.webhookUrl) return;
  log('Discord: webhook available via DISCORD_WEBHOOK_URL env var');
}

function configureTelegram(config) {
  if (!config.botToken) return;
  log('Telegram: bot token available via TELEGRAM_BOT_TOKEN env var');
}

const CLI_CONFIGURATORS = {
  GITHUB: configureGitHub,
  GITLAB: configureGitLab,
  JIRA: configureJira,
  LINEAR: configureLinear,
  TRELLO: configureTrello,
  SLACK: configureSlack,
  DISCORD: configureDiscord,
  TELEGRAM: configureTelegram,
};

function setupIntegrations(integrations) {
  if (!integrations || integrations.length === 0) return;

  const mitsheDir = path.join(HOME_DIR, '.mitshe');
  fs.mkdirSync(mitsheDir, { recursive: true });

  fs.writeFileSync(
    path.join(mitsheDir, 'integrations.json'),
    JSON.stringify(integrations, null, 2),
    { mode: 0o600 },
  );

  setupGitCredentialStore();

  const envExports = [];

  for (const integration of integrations) {
    const type = integration.type.toUpperCase();
    const config = integration.config;

    for (const [key, value] of Object.entries(config)) {
      if (!value) continue;
      const envKey = `${type}_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
      process.env[envKey] = String(value);
      envExports.push(`export ${envKey}="${escapeShellValue(value)}"`);
    }

    // Well-known env vars expected by CLI tools
    const token = getToken(config);
    if (type === 'GITHUB' && token) {
      process.env.GH_TOKEN = token;
      process.env.GITHUB_TOKEN = token;
      envExports.push(`export GH_TOKEN="${escapeShellValue(token)}"`);
      envExports.push(`export GITHUB_TOKEN="${escapeShellValue(token)}"`);
    } else if (type === 'GITLAB' && token) {
      process.env.GITLAB_TOKEN = token;
      envExports.push(`export GITLAB_TOKEN="${escapeShellValue(token)}"`);
      if (config.baseUrl) {
        process.env.GITLAB_HOST = config.baseUrl;
        envExports.push(`export GITLAB_HOST="${escapeShellValue(config.baseUrl)}"`);
      }
    } else if (type === 'LINEAR' && token) {
      process.env.LINEAR_API_KEY = token;
      envExports.push(`export LINEAR_API_KEY="${escapeShellValue(token)}"`);
    }

    // Run type-specific CLI configuration
    const configurator = CLI_CONFIGURATORS[type];
    if (configurator) {
      try {
        configurator(config);
      } catch (e) {
        log(`${type}: CLI setup failed — ${e.message}`);
      }
    }
  }

  // Persist env vars so all new shells (bash, zsh, su) inherit them
  if (envExports.length > 0) {
    const envBlock = `\n# --- mitshe integrations ---\n${envExports.join('\n')}\n`;
    const bashrcPath = path.join(HOME_DIR, '.bashrc');
    const profilePath = path.join(HOME_DIR, '.profile');
    const zshrcPath = path.join(HOME_DIR, '.zshrc');

    fs.appendFileSync(bashrcPath, envBlock);
    fs.appendFileSync(profilePath, envBlock);
    if (fs.existsSync(zshrcPath)) {
      fs.appendFileSync(zshrcPath, envBlock);
    }
  }

  log(`Configured ${integrations.length} integration(s): ${integrations.map((i) => i.type).join(', ')}`);
}

async function setup() {
  const configB64 = process.env.SESSION_CONFIG;
  if (!configB64) {
    log('No SESSION_CONFIG provided, starting with empty workspace');
    fs.mkdirSync(WORKSPACE, { recursive: true });
    return;
  }

  const config = JSON.parse(Buffer.from(configB64, 'base64').toString('utf-8'));

  fs.mkdirSync(WORKSPACE, { recursive: true });

  // Order matters: integrations first (sets up git credentials),
  // then clone repos (uses those credentials)
  setupIntegrations(config.integrations);
  cloneRepositories(config.repos);

  // Wait for local files to be copied (API does docker cp after start)
  if (config.hasLocalPath) {
    await waitForFile('/workspace/.local-ready', 60000);
  }

  rewriteSshRemotes(config.integrations);
  writeInstructions(config.instructions, config.provider);
  configureGitAuthor();
  installSecretScanHook();
  installSkills(config.skills);
  ensureBinOnPath();
  installCitsheStreamCli();
  installCitsheTaskCli();
  installCitsheShotCli();
  installCitsheSkill();
  preacceptClaudeBypass();
  startTmux();
  startClaudeAuthSeedSync();

  log('Session workspace setup complete');
}

/**
 * Auto-propagate a refreshed Claude login to the shared seed volume.
 *
 * Each portal has its own home volume, so a login only lives in one container.
 * Claude Code refreshes the short-lived access token from the long-lived
 * refresh token; when it does, we copy the fresh credentials to /seed (mounted
 * RW) so NEW portals always seed a WORKING login instead of an expired one.
 *
 * We only push when OUR token's accessToken is non-empty AND its expiresAt is
 * newer than the seed's — so a stale container never overwrites a fresher seed.
 * The write is atomic (temp file + rename). No-op if /seed isn't mounted.
 */
function startClaudeAuthSeedSync() {
  const SEED = '/seed/.credentials.json';
  const MINE = path.join(HOME_DIR, '.claude', '.credentials.json');
  if (!fs.existsSync('/seed')) return; // seed not mounted → nothing to do

  const readExpiry = (file) => {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const o = j.claudeAiOauth || {};
      if (!o.accessToken) return null; // blank token → useless
      return typeof o.expiresAt === 'number' ? o.expiresAt : 0;
    } catch {
      return null;
    }
  };

  const syncOnce = () => {
    try {
      const mine = readExpiry(MINE);
      if (mine == null) return; // our token is blank/unreadable
      const seed = readExpiry(SEED);
      // Push when the seed is missing/blank, or ours is strictly newer.
      if (seed == null || mine > seed) {
        const tmp = '/seed/.credentials.json.tmp';
        fs.copyFileSync(MINE, tmp);
        fs.renameSync(tmp, SEED); // atomic replace
        log('Synced refreshed Claude login to the shared seed.');
      }
    } catch (err) {
      // Best-effort — never let seed sync affect the session.
      log('Claude seed sync skipped: ' + err.message);
    }
  };

  // Sync shortly after start (Claude may refresh on first run), then hourly.
  setTimeout(syncOnce, 60_000);
  setInterval(syncOnce, 60 * 60_000);
}

/**
 * Start the one shared tmux session ("citshe"). Every citshe terminal attaches
 * to a window in this session, so multiple clients can watch/type on the same
 * window (and the agent runs in a window you can take over).
 */
function startTmux() {
  try {
    // Detached session with a roomy default size; if tmux is missing (older
    // image) this no-ops and terminals fall back to plain bash.
    execSilent(
      'tmux -f /etc/tmux.conf has-session -t citshe 2>/dev/null || ' +
        'tmux -f /etc/tmux.conf new-session -d -s citshe -x 200 -y 50 -c /workspace',
      { shell: '/bin/bash' },
    );
    log('tmux session "citshe" ready');
  } catch (err) {
    log('tmux not available, terminals will use plain bash: ' + err.message);
  }
}

process.on('SIGTERM', () => {
  log('Received SIGTERM, shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  log('Received SIGINT, shutting down');
  process.exit(0);
});

setup()
  .then(() => {
    log('Session server running, waiting for commands...');
    setInterval(() => {}, 30000);
  })
  .catch((err) => {
    logError(`Setup failed: ${err.message}`);
    process.exit(1);
  });

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
  installSkills(config.skills);

  log('Session workspace setup complete');
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

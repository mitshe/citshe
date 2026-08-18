# citshe

> Slimmed-down agent-orchestration panel: Claude Code + GitHub + terminal in your browser, from your phone.

[![CI](https://github.com/citshe/citshe/actions/workflows/ci.yml/badge.svg)](https://github.com/citshe/citshe/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

citshe is a lean fork of [mitshe](https://github.com/mitshe/mitshe), focused on the essentials: run **Claude Code** in isolated Docker threads, wire them to **GitHub**, and drive the whole thing from an in-browser **terminal** — including from a phone. Every task gets its own thread (an isolated container with Claude Code, terminal, and git). Switch between threads like tabs. Self-hosted, bring your own API keys.

## Install

```bash
docker run -d \
  --name citshe \
  -p 3000:3000 \
  -p 3001:3001 \
  -v citshe-data:/build/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --restart unless-stopped \
  ghcr.io/citshe/citshe:latest
```

Opens **http://localhost:3000** when ready.

## Update

```bash
docker pull ghcr.io/citshe/citshe:latest
docker stop citshe && docker rm citshe
docker run -d \
  --name citshe \
  -p 3000:3000 \
  -p 3001:3001 \
  -v citshe-data:/build/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --restart unless-stopped \
  ghcr.io/citshe/citshe:latest
```

Your data is preserved in the `citshe-data` Docker volume.

## Features

- **Threads** — isolated Docker containers per task, with terminal, file editor, git
- **Mobile-first panel** — manage your portals and threads from the browser, including from a phone
- **Branch management** — select branch per thread, push & create PRs directly
- **Integrations** — GitHub
- **Claude Code** — powered by Claude, BYOK (bring your own API key)
- **Self-hosted** — your data, your keys, single Docker container with SQLite

_Planned:_ orchestrator + workers.

## Develop

```bash
git clone https://github.com/citshe/citshe.git
cd citshe
just setup

cp .env.example .env
cp apps/api/.env.example apps/api/.env

just executor-build
just dev
```

App: http://localhost:3000 | API: http://localhost:3001 | Run `just` for all commands.

## License

MIT

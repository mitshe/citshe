# citshe

> A phone-first command panel for shipping and maintaining a portfolio of web apps.

[![CI](https://github.com/mitshe/citshe/actions/workflows/ci.yml/badge.svg)](https://github.com/mitshe/citshe/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Delegate work to **Claude Code** workers, run terminals in your browser, and see
your whole stack live — without opening five dashboards.

You run several small products. Each has a repo, a deploy target, a database,
DNS, maybe an app store — checking on them means five browser tabs. citshe pulls
it into **one portal per project**: connect a repo and your stack tools, and get
one screen that answers *"is it live, did the deploy pass, did the migration
run?"* and lets you delegate the next change to an AI worker. All from your phone.

## Features

- **Tasks → AI workers** — a kanban board with a **Queue** column. Line tasks up
  in the order you want them taken, flip **auto-pull** on, and Claude Code
  workers pull each one, do the work in an isolated container, and open a PR.
  Turn it off to work through them by hand.
- **Browser terminals** — one tap opens a real Claude Code terminal in a
  per-project container, usable from a phone with an on-screen key bar.
- **Stack at a glance** — connect Cloudflare · Vercel · Neon · VPS · Expo · Apple
  Developer and see live status, metrics and charts (deploys, traffic, compute
  activity, certificate expiry) per portal.
- **Repo overview** — CI status, recent commits, open PRs and branches, with
  quick links straight to GitHub.
- **Self-hosted** — your data, your keys (BYOK), JWT auth.

## Two AI pillars

- **Agent engine** — the **Claude Code CLI** runs in a container on your
  **subscription** (`claude /login`), not per-token API billing.
- **Panel AI** — an optional bring-your-own key (OpenRouter or Claude API) for
  small in-panel helpers (task refine, summaries).

## How it works

Each project is a **portal** (an organization). A portal ties together a GitHub
repo, your stack tools, and the tasks/terminals you run against it.

1. **Connect a repo** — citshe pulls its CI status, branches, PRs and commits
   over the GitHub App, and Claude analyzes the stack.
2. **Delegate a task** — write a rough note; Panel AI helps shape it. Drop it in
   the **Queue** in the order you want, or run it by hand.
3. **A worker runs it** — the api spawns a **Docker container** (the executor
   image) running the Claude Code CLI, clones the repo, does the work, and opens
   a PR. You watch the terminal live over a WebSocket — from your phone if you
   want. With **auto-pull** on, a BullMQ/Redis queue feeds workers one task at a
   time per portal.
4. **See the result** — the PR link, CI status, and stack health (deploys,
   traffic, cert expiry) all land back on the portal's home screen.

Under the hood: the **web** (Next.js) app proxies same-origin `/api/v1` calls to
the **api** (NestJS), which owns Prisma/Postgres, the BullMQ queue on Redis, the
GitHub/AI adapters, and the Docker executor it drives via the Docker socket.
Everything is self-hosted; your connected keys are encrypted at rest
(AES-256-GCM).

## Deploy on your own server

Run the whole thing on a VPS with Docker, its own Postgres/Redis, and a
**Cloudflare Tunnel** as the only ingress — so the only open port is SSH. The
images are published to GHCR (public), so you just pull and run.

```bash
# on a fresh Ubuntu/Debian VPS
curl -fsSL https://get.docker.com | sh
mkdir -p /opt/citshe && cd /opt/citshe
curl -fsSLO https://raw.githubusercontent.com/mitshe/citshe/master/docker/prod/docker-compose.yml
curl -fsSL  https://raw.githubusercontent.com/mitshe/citshe/master/docker/prod/.env.example -o .env
chmod 600 .env
# fill in .env (domain + generated secrets + Cloudflare tunnel token), then:
docker compose pull && docker compose up -d
```

**Full step-by-step guide (firewall, Cloudflare Tunnel, Access login wall,
backups, troubleshooting): [docs/DEPLOY.md](./docs/DEPLOY.md).**

## Stack

Turborepo monorepo — **Next.js** (web) · **NestJS** (api) · **Prisma /
PostgreSQL** · **Redis / BullMQ** · a Docker executor with WebSocket terminals.

## Develop

Requires **Node 20+**, **pnpm 9**, **Docker**, and [`just`](https://github.com/casey/just).

```bash
git clone https://github.com/mitshe/citshe.git
cd citshe

# copy env templates, then fill in the secrets (see below)
cp .env.example .env
cp apps/api/.env.example apps/api/.env

just setup            # install deps + generate the Prisma client
just executor-build   # build the Claude Code worker/terminal image
just dev              # start Postgres + Redis + the api & web dev servers
```

App: **http://localhost:3000** · API: **http://localhost:3001** · run `just` for
all commands.

### Secrets

Generate the two required secrets and put them in `.env`:

```bash
openssl rand -hex 32   # -> ENCRYPTION_KEY
openssl rand -hex 32   # -> JWT_SECRET
```

`ENCRYPTION_KEY` encrypts your connected keys (AES-256-GCM) and must stay stable
— changing it orphans previously encrypted data.

### Using the agent engine

The worker/terminal containers run the Claude Code CLI on **your Claude
subscription**, not an API key. The first time you open a terminal, run
`claude /login` inside it once to authenticate; the login persists per portal.

## License

[MIT](./LICENSE)

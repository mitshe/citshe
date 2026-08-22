/**
 * Documentation content for all pages.
 * The key is the slug (e.g., "" for intro, "quickstart" for the quick start page).
 */
export const docsContent: Record<string, string> = {
  "": `# Welcome to citshe

Manage your projects with AI from the browser — even from your phone. citshe runs Claude Code inside isolated Docker containers, connected to your GitHub repositories, with a terminal you can drive from anywhere.

:::info
**New here?** Get up and running in 5 minutes with the [Quick Start Guide](/docs/quickstart).
:::

## What can you do?

<cards>
<card title="AI-Assisted Development" icon="sparkles" href="/docs/integrations/claude-code">
Run Claude Code in isolated containers to review code, fix bugs, and implement changes.
</card>
<card title="Browser Terminal" icon="book" href="/docs/workspace/sessions">
Launch threads with a full terminal, usable from desktop or mobile.
</card>
<card title="GitHub Integration" icon="git" href="/docs/integrations/github">
Connect your repositories — branches, commits, and pull requests.
</card>
</cards>

## Next steps

:::steps
### Connect your tools
Go to [Settings → Integrations](/settings/integrations) and connect GitHub.

### Start your first thread
Follow the [Quick Start Guide](/docs/quickstart) to launch a Workspace thread.

### Explore Claude Code
Learn how to use [Claude Code](/docs/integrations/claude-code) inside your threads.
:::
`,

  quickstart: `# Quick Start Guide

Launch your first Workspace thread in 5 minutes.

:::info
**Prerequisites:** Connect GitHub first at [Settings → Integrations](/settings/integrations).
:::

## Step 1: Connect a repository

1. Go to [Settings → Integrations](/settings/integrations) and connect GitHub
2. Go to [Repos](/repos) and connect your repos
3. Enable the repository you want to work with

## Step 2: Start a thread

Threads run Claude Code inside an isolated Docker container.

1. Go to **Threads** in the sidebar
2. Click **New Thread** (or use the one-tap launcher on Home)
3. Pick your repository and start the session

:::tip
The one-tap launcher on Home creates a thread with sensible defaults and drops you straight into the terminal.
:::

## Step 3: Give the agent a task

1. Type an instruction in the thread, e.g. \`Fix the failing login test\`
2. Claude Code runs in the container and streams its output
3. Review the changes and let it open a pull request

## Step 4: Review on GitHub

1. Open the pull request the agent created
2. Review the diff and merge when ready

## Next steps

- [Threads](/docs/workspace/sessions) — Work in the browser terminal
- [Claude Code](/docs/integrations/claude-code) — AI-assisted development
- [GitHub Integration](/docs/integrations/github) — Connect your repositories
`,

  integrations: `# Integrations

Connect your tools to citshe. Automate across Git providers and your knowledge base.

## Git Providers

<cards>
<card title="GitHub" icon="git" href="/docs/integrations/github">
Branches, commits, PRs. Trigger on push, PR, release events.
</card>
<card title="GitLab" icon="git" href="/docs/integrations/gitlab">
Branches, MRs, pipelines. Self-hosted supported.
</card>
</cards>

## Knowledge Base

<cards>
<card title="Obsidian" icon="book" href="/docs/integrations/obsidian">
Search notes, create entries, build automated knowledge bases.
</card>
</cards>

## Setup Pattern

All integrations follow the same steps:

:::steps
### Create Token
Generate an API token in the external service with required permissions.

### Connect in citshe
[Settings → Integrations](/settings/integrations) → Click **Connect**

### Enter Credentials
Paste your token and any required URLs (for self-hosted services).

### Test & Save
Click **Test Connection** to verify, then **Save**.
:::

## Security

:::info
**Encrypted credentials.** AES-256-GCM encryption for all tokens. Decrypted only at runtime, never logged or stored in plaintext.
:::

| Feature | Description |
|---------|-------------|
| **Encryption** | AES-256-GCM at rest |
| **Permissions** | Minimal required scopes |
| **Revocation** | Disconnect anytime |
| **Rotation** | Re-authenticate to rotate tokens |
| **Audit logs** | Available on Enterprise |

## Coming Soon

- **Notion** — Docs and databases
- **Discord** — Team communication
`,

  "integrations/github": `# GitHub

Automate Git operations — branches, commits, pull requests.

## Setup

:::steps
### Create a Fine-grained Token

1. Go to [GitHub → Fine-grained tokens](https://github.com/settings/tokens?type=beta)
2. Click **Generate new token**
3. Set expiration (90 days recommended)
4. Select repositories to grant access
5. Add permissions listed below

### Connect to citshe

1. Go to [Settings → Integrations](/settings/integrations)
2. Click **Connect** on GitHub
3. Paste your token
4. Click **Test Connection** → **Save**

### Enable Repositories

1. Go to [Repos](/repos)
2. Click **Sync from GitHub**
3. Toggle on repos you want to use
:::

### Required Permissions

| Permission | Access | Purpose |
|------------|--------|---------|
| **Contents** | Read and write | Read files, create commits |
| **Pull requests** | Read and write | Create and manage PRs |
| **Metadata** | Read-only | Access repo info |

:::warning
**Token security:** GitHub only shows tokens once. Store securely. Rotate every 90 days.
:::

## Available Nodes

### Triggers

<nodelist>
<node type="trigger" name="Push" desc="When code is pushed to a branch" />
<node type="trigger" name="Pull Request" desc="When PR is opened, updated, or merged" />
<node type="trigger" name="Release" desc="When a release is published" />
</nodelist>

### Actions

<nodelist>
<node type="git" name="Create Branch" desc="Create a new branch from base" />
<node type="git" name="Commit Files" desc="Commit file changes to a branch" />
<node type="git" name="Create PR" desc="Open a pull request" />
<node type="git" name="Merge PR" desc="Merge a pull request" />
<node type="git" name="Get Diff" desc="Fetch diff between branches or commits" />
<node type="git" name="Get File" desc="Read file contents from a branch" />
</nodelist>

## Examples

### Auto-create a feature branch

<example>
**Create Branch:**
| Field | Value |
|-------|-------|
| **Repository** | \`{{project.repository}}\` |
| **Branch Name** | \`feature/{{issueKey}}-{{summary | slugify}}\` |
| **Base** | \`main\` |

→ Creates \`feature/PROJ-123-add-login-page\`
</example>

### AI Code Review on PR

<example>
**Trigger:** Pull Request Opened

**Get Diff:**
| Field | Value |
|-------|-------|
| **PR Number** | \`{{trigger.prNumber}}\` |

**AI Code Review:**
| Field | Value |
|-------|-------|
| **Diff** | \`{{nodes.get_diff.content}}\` |
| **Focus** | \`security, performance\` |

**Comment on PR:**
| Field | Value |
|-------|-------|
| **Body** | \`## AI Review\\n{{nodes.ai_review.summary}}\` |
</example>

## Node Outputs

<outputref>
{{nodes.create_branch.name}} → "feature/PROJ-123"
{{nodes.create_branch.url}} → "https://github.com/org/repo/tree/feature/PROJ-123"
{{nodes.create_pr.number}} → 42
{{nodes.create_pr.url}} → "https://github.com/org/repo/pull/42"
{{nodes.get_diff.content}} → "diff --git a/file.ts..."
</outputref>
`,

  "integrations/gitlab": `# GitLab

Automate Git operations with GitLab — branches, merge requests, pipelines.

## Setup

:::steps
### Create Personal Access Token

1. Go to GitLab → **Preferences → Access Tokens**
2. For self-hosted: \`https://your-gitlab.com/-/profile/personal_access_tokens\`
3. Token name: \`citshe\`
4. Expiration: 90 days (recommended)
5. Select scopes listed below

### Connect to citshe

1. Go to [Settings → Integrations](/settings/integrations)
2. Click **Connect** on GitLab
3. Enter your GitLab URL and token
4. Click **Test Connection** → **Save**

### Enable Projects

1. Go to [Repos](/repos)
2. Click **Sync from GitLab**
3. Toggle on projects you want to use
:::

### Required Token Scopes

| Scope | Purpose |
|-------|---------|
| \`api\` | Full API access |
| \`read_repository\` | Clone repositories |
| \`write_repository\` | Push code |

:::info
**Self-hosted GitLab:** Fully supported. Just enter your GitLab instance URL during setup.
:::

## Available Nodes

### Triggers

<nodelist>
<node type="trigger" name="Push" desc="When code is pushed to a branch" />
<node type="trigger" name="Merge Request" desc="When MR is opened, updated, or merged" />
<node type="trigger" name="Pipeline" desc="When pipeline status changes" />
<node type="trigger" name="Tag" desc="When a tag is created" />
</nodelist>

### Actions

<nodelist>
<node type="git" name="Create Branch" desc="Create a new branch from ref" />
<node type="git" name="Commit Files" desc="Commit file changes" />
<node type="git" name="Create MR" desc="Open a merge request" />
<node type="git" name="Merge MR" desc="Merge a merge request" />
<node type="git" name="Get Diff" desc="Fetch MR or branch diff" />
<node type="git" name="Add MR Comment" desc="Comment on a merge request" />
<node type="git" name="Trigger Pipeline" desc="Start a CI/CD pipeline" />
</nodelist>

## Examples

### Auto-create Branch and Draft MR

<example>
**Create Branch:**
| Field | Value |
|-------|-------|
| **Project** | \`{{project.gitlabPath}}\` |
| **Branch Name** | \`feature/{{issueKey}}\` |
| **Ref** | \`main\` |

**Create MR (Draft):**
| Field | Value |
|-------|-------|
| **Source Branch** | \`feature/{{issueKey}}\` |
| **Target Branch** | \`main\` |
| **Title** | \`Draft: {{summary}}\` |
| **Description** | \`Closes {{issueKey}}\` |
</example>

### AI Code Review on MR

<example>
**Trigger:** Merge Request Opened

**Get Diff:**
| Field | Value |
|-------|-------|
| **MR IID** | \`{{trigger.mr.iid}}\` |

**AI Code Review:**
| Field | Value |
|-------|-------|
| **Diff** | \`{{nodes.get_diff.content}}\` |
| **Focus** | \`security, performance, best practices\` |

**Add MR Comment:**
| Field | Value |
|-------|-------|
| **MR IID** | \`{{trigger.mr.iid}}\` |
| **Body** | \`## AI Code Review\\n\\n{{nodes.ai_review.summary}}\\n\\n**Score:** {{nodes.ai_review.score}}/10\` |
</example>

### Auto-merge on Pipeline Success

<example>
**Trigger:** Pipeline Succeeded (branch = \`main\`)

**Condition:**
\`{{trigger.mr.approvals >= 2}}\`

**Merge MR:**
| Field | Value |
|-------|-------|
| **MR IID** | \`{{trigger.mr.iid}}\` |
| **Squash** | \`true\` |
| **Delete Source** | \`true\` |
</example>

## Node Outputs

<outputref>
{{trigger.mr.iid}} → 42
{{trigger.mr.title}} → "Add login feature"
{{trigger.mr.source_branch}} → "feature/PROJ-123"
{{nodes.create_mr.web_url}} → "https://gitlab.com/org/repo/-/merge_requests/42"
{{nodes.create_branch.name}} → "feature/PROJ-123"
{{nodes.get_diff.content}} → "diff --git a/file.ts..."
</outputref>
`,

  "integrations/obsidian": `# Obsidian

Connect your Obsidian vault to automate note-taking and knowledge management.

## What is Obsidian?

[Obsidian](https://obsidian.md) is a powerful knowledge base that works on top of local Markdown files. With citshe, you can:

- **Search your notes** and use them as context for AI
- **Create notes** automatically from agent outputs
- **Update existing notes** with new information
- **Build knowledge bases** that grow with your work

## Setup

:::steps
### Install Local REST API Plugin

1. Open Obsidian → **Settings → Community plugins**
2. Browse and search for **Local REST API**
3. Install and **Enable** the plugin
4. Go to plugin settings and **copy the API key**

### Start Obsidian

The plugin only works when Obsidian is running. Keep it open or running in background.

### Connect to citshe

1. Go to [Settings → Integrations](/settings/integrations)
2. Click **Connect** on Obsidian
3. Enter your API key
4. URL: \`https://127.0.0.1:27124\` (default)
5. Click **Test Connection** → **Save**
:::

:::warning
**Obsidian must be running** for the integration to work. The Local REST API plugin serves requests only when the app is open.
:::

## Available Nodes

### Actions

<nodelist>
<node type="action" name="Get Note" desc="Fetch note content by path" />
<node type="action" name="Create Note" desc="Create a new note in your vault" />
<node type="action" name="Update Note" desc="Replace note content" />
<node type="action" name="Append to Note" desc="Add content to end of note" />
<node type="action" name="Search Notes" desc="Search across your vault" />
</nodelist>

## Examples

### Save AI Summary to Obsidian

<example>
**AI Analyze:**
| Field | Value |
|-------|-------|
| **Content** | \`{{description}}\` |
| **Instruction** | \`Summarize the resolution in 2-3 sentences\` |

**Obsidian Create Note:**
| Field | Value |
|-------|-------|
| **Path** | \`Projects/{{projectKey}}/{{issueKey}}.md\` |
| **Content** | See below |

\`\`\`markdown
# {{issueKey}}: {{summary}}

**Status:** Resolved

## Summary
{{nodes.ai_analyze.result.summary}}
\`\`\`
</example>

### Build Meeting Notes from PR

<example>
**Trigger:** GitHub PR Merged

**AI Prompt:**
| Field | Value |
|-------|-------|
| **Prompt** | \`Create a changelog entry for: {{trigger.pr.title}}\\n\\nChanges:\\n{{trigger.pr.body}}\` |

**Obsidian Append to Note:**
| Field | Value |
|-------|-------|
| **Path** | \`Changelog/{{trigger.mergedAt | formatDate:'YYYY-MM'}}.md\` |
| **Content** | \`\\n## {{trigger.pr.title}}\\n{{nodes.ai_prompt.content}}\\n\` |
</example>

### Search Knowledge Base for Context

<example>
**Obsidian Search:**
| Field | Value |
|-------|-------|
| **Query** | \`{{question}}\` |
| **Limit** | \`5\` |

**AI Prompt:**
| Field | Value |
|-------|-------|
| **System** | \`You are a helpful assistant with access to a knowledge base.\` |
| **Prompt** | \`Question: {{question}}\\n\\nRelevant notes:\\n{{nodes.search.notes | map:'content' | join:'\\n---\\n'}}\` |
</example>

## Node Outputs

<outputref>
{{nodes.get_note.content}} → "# Note Title\\n\\nNote content..."
{{nodes.get_note.path}} → "folder/note.md"
{{nodes.get_note.frontmatter.tags}} → ["tag1", "tag2"]
{{nodes.search.notes}} → Array of matching notes
{{nodes.search.notes[0].path}} → "matching/note.md"
{{nodes.create_note.path}} → "new/note.md"
</outputref>

## Path Syntax

Notes are referenced by their path relative to vault root:

| Path | Description |
|------|-------------|
| \`note.md\` | Note in vault root |
| \`folder/note.md\` | Note in folder |
| \`folder/sub/note.md\` | Nested folders |

:::tip
You can omit the \`.md\` extension — it's added automatically.
:::

## Frontmatter

Access YAML frontmatter from notes:

<example>
**Note content:**
\`\`\`markdown
---
tags: [project, active]
status: in-progress
assignee: john
---

# Project Notes
...
\`\`\`

**Access in expressions:**
\`\`\`
{{nodes.get_note.frontmatter.tags}} → ["project", "active"]
{{nodes.get_note.frontmatter.status}} → "in-progress"
\`\`\`
</example>

## Best Practices

:::info
**Organize by project.** Use folder structure like \`Projects/PROJ/\` to keep notes organized.
:::

:::tip
**Use templates.** Create consistent note formats with frontmatter for better searchability.
:::

:::warning
**Mind the size.** Very large notes (>100KB) may slow down searches. Split into smaller files.
:::
`,

  "deployment/light": `# Light Mode

Run citshe as a single Docker container. Perfect for personal use, demos, and trying out the platform.

## What is Light Mode?

Light Mode bundles everything into **one Docker container**:
- Next.js frontend
- NestJS backend
- SQLite database
- Redis (embedded)

No external dependencies. Just Docker.

## Quick Start

\`\`\`bash
docker run -d -p 3000:3000 -p 3001:3001 \\
  -v citshe-data:/app/data \\
  ghcr.io/citshe/light:latest
\`\`\`

Open [http://localhost:3000](http://localhost:3000).

That's it. You're running citshe.

## Data Persistence

All data is stored in a single volume:

| Path | Contents |
|------|----------|
| \`/app/data/citshe.db\` | SQLite database |
| \`/app/data/redis/\` | Redis persistence |

:::warning
**Backup your volume.** The \`citshe-data\` volume contains all your threads, tasks, and settings.
:::

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| \`PORT\` | \`3000\` | Web UI port |
| \`API_PORT\` | \`3001\` | API port |
| \`ENCRYPTION_KEY\` | auto-generated | For credential encryption |

### With custom encryption key

\`\`\`bash
docker run -d -p 3000:3000 -p 3001:3001 \\
  -v citshe-data:/app/data \\
  -e ENCRYPTION_KEY="your-32-byte-hex-key" \\
  ghcr.io/citshe/light:latest
\`\`\`

Generate a secure key:
\`\`\`bash
openssl rand -hex 32
\`\`\`

## Docker Compose

For easier management, use Docker Compose:

\`\`\`yaml
# docker-compose.yml
services:
  citshe:
    image: ghcr.io/citshe/light:latest
    ports:
      - "3000:3000"
      - "3001:3001"
    volumes:
      - citshe-data:/app/data
    restart: unless-stopped

volumes:
  citshe-data:
\`\`\`

\`\`\`bash
docker compose up -d
\`\`\`

## Upgrading

\`\`\`bash
docker compose pull
docker compose up -d
\`\`\`

Your data is preserved in the volume.

## Limitations

Light Mode is great for personal use but has constraints:

| Feature | Light Mode | Production |
|---------|------------|------------|
| **Database** | SQLite | PostgreSQL |
| **Scaling** | Single instance | Horizontal |
| **Backups** | Manual | Automated |
| **Team** | 1 user | Multi-user |

:::info
**Scaling up?** See [Selfhosted](/docs/deployment/selfhosted) for team deployments with PostgreSQL.
:::

## Troubleshooting

### Container won't start

Check logs:
\`\`\`bash
docker logs citshe
\`\`\`

### Permission errors

Ensure the data volume is writable:
\`\`\`bash
docker exec citshe ls -la /app/data
\`\`\`

### Port conflicts

Change ports if 3000/3001 are in use:
\`\`\`bash
docker run -p 8080:3000 -p 8081:3001 ...
\`\`\`
`,

  "deployment/selfhosted": `# Selfhosted Deployment

Deploy citshe for your team with user accounts, organizations, and PostgreSQL.

## Overview

Selfhosted mode provides:
- **User authentication** (email/password, no external provider needed)
- **Organizations** for team management
- **PostgreSQL** for production-grade data storage
- **Horizontal scaling** across multiple instances

## Architecture

\`\`\`
                    ┌─────────────┐
                    │   Browser   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   Nginx     │ (optional reverse proxy)
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
    │  Web (3000) │ │  API (3001) │ │  Worker     │
    └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
           │               │               │
           └───────────────┼───────────────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
    │ PostgreSQL  │ │    Redis    │ │ (Optional)  │
    └─────────────┘ └─────────────┘ │   S3/Minio  │
                                    └─────────────┘
\`\`\`

## Quick Start

### 1. Clone the repository

\`\`\`bash
git clone https://github.com/citshe/citshe.git
cd citshe
\`\`\`

### 2. Configure environment

\`\`\`bash
cp .env.example .env
\`\`\`

Edit \`.env\`:
\`\`\`bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/citshe

# Redis
REDIS_URL=redis://localhost:6379

# Security (generate with: openssl rand -hex 32)
ENCRYPTION_KEY=your-32-byte-hex-key
JWT_SECRET=your-jwt-secret

\`\`\`

### 3. Start infrastructure

\`\`\`bash
just infra
\`\`\`

This starts PostgreSQL and Redis in Docker.

### 4. Run migrations

\`\`\`bash
just db-migrate
\`\`\`

### 5. Start the application

\`\`\`bash
just dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) and create your first account.

## Docker Compose (Production)

For production, use the full Docker Compose stack:

\`\`\`yaml
# docker-compose.prod.yml
services:
  web:
    image: ghcr.io/citshe/web:latest
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://api:3001
    depends_on:
      - api

  api:
    image: ghcr.io/citshe/api:latest
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/citshe
      - REDIS_URL=redis://redis:6379
      - ENCRYPTION_KEY=\${ENCRYPTION_KEY}
      - JWT_SECRET=\${JWT_SECRET}
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:16-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=citshe

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

volumes:
  postgres_data:
  redis_data:
\`\`\`

\`\`\`bash
docker compose -f docker-compose.prod.yml up -d
\`\`\`

## User Management

### First user

The first user to register becomes the **organization owner**.

### Inviting users

1. Go to **Settings → Team**
2. Click **Invite Member**
3. Enter email and select role

### Roles

| Role | Permissions |
|------|-------------|
| **Owner** | Full access, manage billing, delete org |
| **Admin** | Manage members, all threads and tasks |
| **Member** | Create and edit own threads and tasks |
| **Viewer** | View-only access |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| \`DATABASE_URL\` | Yes | PostgreSQL connection string |
| \`REDIS_URL\` | Yes | Redis connection string |
| \`ENCRYPTION_KEY\` | Yes | 32-byte hex key for credential encryption |
| \`JWT_SECRET\` | Yes | Secret for JWT token signing |
| \`NEXT_PUBLIC_API_URL\` | No | API URL (default: http://localhost:3001) |

## SSL/HTTPS

For production, always use HTTPS. Use a reverse proxy like Nginx or Caddy:

### Caddy (recommended)

\`\`\`
citshe.yourdomain.com {
    reverse_proxy localhost:3000
}

api.citshe.yourdomain.com {
    reverse_proxy localhost:3001
}
\`\`\`

### Nginx

\`\`\`nginx
server {
    listen 443 ssl;
    server_name citshe.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}
\`\`\`

## Backups

### PostgreSQL

\`\`\`bash
# Backup
pg_dump -h localhost -U postgres citshe > backup.sql

# Restore
psql -h localhost -U postgres citshe < backup.sql
\`\`\`

### Full backup script

\`\`\`bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump -h localhost -U postgres citshe > backup_$DATE.sql
gzip backup_$DATE.sql
# Upload to S3, etc.
\`\`\`

## Scaling

### Horizontal scaling

Run multiple API instances behind a load balancer:

\`\`\`yaml
services:
  api:
    image: ghcr.io/citshe/api:latest
    deploy:
      replicas: 3
    # ... rest of config
\`\`\`

Redis handles session sharing and queue coordination automatically.

## Monitoring

### Health checks

\`\`\`bash
# API health
curl http://localhost:3001/health

# Web health
curl http://localhost:3000/api/health
\`\`\`

### Logs

\`\`\`bash
docker compose logs -f api
docker compose logs -f web
\`\`\`

## Troubleshooting

### Database connection failed

Check PostgreSQL is running and accessible:
\`\`\`bash
psql -h localhost -U postgres -d citshe -c "SELECT 1"
\`\`\`

### Redis connection failed

\`\`\`bash
redis-cli ping
\`\`\`

### Migrations failed

Run manually:
\`\`\`bash
npx prisma migrate deploy
\`\`\`
`,

  api: `# REST API

Access citshe programmatically. Interactive Swagger docs available at \`/api\` on your API server.

## Authentication

\`\`\`bash
curl http://localhost:3001/api/v1/tasks -H "Authorization: Bearer YOUR_API_KEY"
\`\`\`

Get your key at [Settings - API Keys](/settings/api-keys).

:::warning
Keep your API key secret. Never commit to version control.
:::

## Endpoints

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| \`GET\` | \`/api/v1/tasks\` | List tasks |
| \`POST\` | \`/api/v1/tasks\` | Create task |
| \`GET\` | \`/api/v1/tasks/:id\` | Get task |
| \`PUT\` | \`/api/v1/tasks/:id\` | Update task |
| \`DELETE\` | \`/api/v1/tasks/:id\` | Delete task |
| \`POST\` | \`/api/v1/tasks/:id/process\` | Start AI processing |

### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| \`GET\` | \`/api/v1/sessions\` | List sessions (filter: ?status=RUNNING&projectId=...) |
| \`POST\` | \`/api/v1/sessions\` | Create and start session |
| \`GET\` | \`/api/v1/sessions/:id\` | Get session with messages |
| \`DELETE\` | \`/api/v1/sessions/:id\` | Delete session and stop container |
| \`POST\` | \`/api/v1/sessions/:id/pause\` | Pause session |
| \`POST\` | \`/api/v1/sessions/:id/resume\` | Resume paused/stopped session |
| \`POST\` | \`/api/v1/sessions/:id/stop\` | Stop session (container stays for resume) |
| \`POST\` | \`/api/v1/sessions/:id/exec\` | Execute command in container (non-interactive) |
| \`POST\` | \`/api/v1/sessions/:id/terminals\` | Start a terminal (bash or agent) |
| \`DELETE\` | \`/api/v1/sessions/:id/terminals/:terminalId\` | Close a terminal |
| \`GET\` | \`/api/v1/sessions/:id/files\` | List files in workspace |
| \`GET\` | \`/api/v1/sessions/:id/file?path=...\` | Read file content |
| \`POST\` | \`/api/v1/sessions/:id/file\` | Write file content |
| \`DELETE\` | \`/api/v1/sessions/:id/file?path=...\` | Delete file |
| \`GET\` | \`/api/v1/sessions/:id/git-status\` | Get git status |

### Presets

| Method | Endpoint | Description |
|--------|----------|-------------|
| \`GET\` | \`/api/v1/presets\` | List presets |
| \`POST\` | \`/api/v1/presets\` | Create preset |
| \`GET\` | \`/api/v1/presets/:id\` | Get preset |
| \`PUT\` | \`/api/v1/presets/:id\` | Update preset |
| \`DELETE\` | \`/api/v1/presets/:id\` | Delete preset |

### Environments

| Method | Endpoint | Description |
|--------|----------|-------------|
| \`GET\` | \`/api/v1/environments\` | List environments |
| \`POST\` | \`/api/v1/environments\` | Create environment |
| \`GET\` | \`/api/v1/environments/:id\` | Get environment |
| \`PUT\` | \`/api/v1/environments/:id\` | Update environment |
| \`DELETE\` | \`/api/v1/environments/:id\` | Delete environment |

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| \`GET\` | \`/api/v1/projects\` | List projects |
| \`POST\` | \`/api/v1/projects\` | Create project |
| \`GET\` | \`/api/v1/projects/:id\` | Get project |
| \`PUT\` | \`/api/v1/projects/:id\` | Update project |
| \`DELETE\` | \`/api/v1/projects/:id\` | Delete project |

### Integrations

| Method | Endpoint | Description |
|--------|----------|-------------|
| \`GET\` | \`/api/v1/integrations\` | List integrations |
| \`POST\` | \`/api/v1/integrations\` | Create integration |
| \`POST\` | \`/api/v1/integrations/:id/test\` | Test connection |
| \`DELETE\` | \`/api/v1/integrations/:id\` | Delete integration |

### AI Credentials

| Method | Endpoint | Description |
|--------|----------|-------------|
| \`GET\` | \`/api/v1/ai-credentials\` | List AI credentials |
| \`POST\` | \`/api/v1/ai-credentials\` | Create credential |
| \`POST\` | \`/api/v1/ai-credentials/:id/test\` | Test connection |
| \`DELETE\` | \`/api/v1/ai-credentials/:id\` | Delete credential |

### Repositories

| Method | Endpoint | Description |
|--------|----------|-------------|
| \`GET\` | \`/api/v1/repositories\` | List repositories |
| \`GET\` | \`/api/v1/repositories/remote\` | List remote repos from providers |
| \`POST\` | \`/api/v1/repositories/sync/existing\` | Sync existing repos |
| \`POST\` | \`/api/v1/repositories/sync/selective\` | Import selected repos |
| \`DELETE\` | \`/api/v1/repositories/:id\` | Delete repository |
| \`DELETE\` | \`/api/v1/repositories/bulk\` | Bulk delete |

## Rate Limits

| Type | Limit |
|------|-------|
| Standard | 100/min |
| AI processing | 20/min |

## Examples

### Create a session

\`\`\`bash
curl -X POST http://localhost:3001/api/v1/sessions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Fix login bug",
    "repositoryIds": ["repo_123"],
    "aiCredentialId": "cred_456",
    "instructions": "Fix the login bug in the auth flow"
  }'
\`\`\`

### Execute command in session

\`\`\`bash
curl -X POST http://localhost:3001/api/v1/sessions/sess_123/exec \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"command": "git diff --stat"}'
\`\`\`
`,

  // ─── Workspace ──────────────────────────────────────────────────
  "workspace": `# Workspace

The Workspace module provides interactive AI agent threads with isolated Docker environments. Work directly with AI agents like Claude Code or OpenClaw in a browser-based terminal, edit files with a Monaco-powered code editor, and manage your codebase - all from citshe.

## Key Features

<cards>
<card title="Threads" icon="terminal" href="/docs/workspace/sessions">
Launch isolated Docker containers with your repositories and work with AI agents in real-time through a browser terminal.
</card>
<card title="Presets" icon="sliders" href="/docs/workspace/presets">
Define reusable agent configurations with pre-selected repositories, instructions, and CLI arguments.
</card>
<card title="Environments" icon="box" href="/docs/workspace/environments">
Configure container resources, environment variables, and setup scripts for consistent development environments.
</card>
</cards>

## How It Works

1. **Create a Thread** - select repositories, optionally choose a snapshot
2. **Agent Terminal** - a Docker container starts with your repos cloned, and the AI agent launches automatically
3. **Code Editor** - click any file to open it in the built-in Monaco editor with syntax highlighting
4. **File Browser** - navigate your workspace files with git status indicators
5. **Multiple Terminals** - open additional bash terminals alongside the agent

## Supported AI Agents

| Agent | CLI Command | Instructions File | Auth |
|-------|-------------|-------------------|------|
| Claude Code | \`claude\` | \`CLAUDE.md\` | OAuth (configure in terminal) |
| OpenClaw | \`openclaw tui\` | \`SOUL.md\` | \`openclaw onboard\` (configure in terminal) |

Both agents are CLI-based providers that manage their own authentication. Configure them once in a terminal thread - credentials persist across all future threads via shared Docker volumes.
`,

  "workspace/sessions": `# Threads

Threads are interactive workspaces where you work with AI agents in isolated Docker containers.

## Creating a Thread

1. Go to **Workspace > Threads**
2. Click **New Thread**
3. Configure:
   - **Thread Name** - descriptive name for the thread
   - **AI Agent** (optional) - Claude Code, OpenClaw, or none for plain bash
   - **Project** (optional) - associate with a project
   - **Repositories** - select repos to clone into the workspace
   - **Snapshot** (optional) - start from a saved environment
   - **Start Arguments** (optional) - CLI flags for the agent
   - **Instructions** (optional) - system prompt for the agent
4. Click **Start Thread**

## Thread Lifecycle

\`\`\`
Creating -> Running <-> Paused -> Completed
\`\`\`

- **Running** - container is active, agent is available
- **Paused** - container stays alive, agent process continues, you can disconnect and reconnect
- **Completed** - agent process stopped, container stays for resume with \`--continue\`
- **Resume** - restart the agent with conversation history preserved

## Terminal Features

- **Agent Terminal** - launches the AI agent (Claude Code or OpenClaw) with bash fallback after exit
- **Additional Terminals** - open new bash terminals via the + button
- **Keyboard Input** - full terminal emulation with arrow keys, Ctrl+C, function keys
- **Output Buffer** - reconnecting to a thread restores terminal history

## Code Editor

Click any file in the file browser to open it in the Monaco editor:

- **Syntax Highlighting** - 100+ languages supported
- **Auto-save** - changes saved to container after 2s of inactivity
- **Ctrl+S** - manual save
- **Ctrl+F** - find in file
- **Ctrl+H** - find and replace
- **Real-time Updates** - files refresh when agent makes changes

## File Browser

- **Git Status** - modified (M), added (A), deleted (D), untracked (U) indicators
- **Context Menu** (right-click) - New File, New Folder, Copy Path, Rename, Delete
- **Auto-refresh** - file tree updates periodically
`,

  "workspace/presets": `# Presets

Presets are reusable agent configurations that pre-fill thread creation fields. Define once, use many times.

## Creating a Preset

1. Go to **Workspace > Presets**
2. Click **New Preset**
3. Configure:
   - **Name** - e.g., "Code Reviewer", "Bug Fixer"
   - **Description** - what this preset does
   - **AI Provider** - Claude Code, OpenClaw, etc.
   - **Start Arguments** - CLI flags (e.g., \`--dangerously-skip-permissions --model opus\`)
   - **Default Project** - pre-selected project
   - **Default Repositories** - pre-selected repos
   - **Max Duration** - auto-stop after N hours
   - **Instructions** - system prompt for the agent

## Using a Preset

When creating a new thread, select a preset from the dropdown. All fields are pre-filled but remain editable - you can override any setting before starting.

## Example Presets

**Code Reviewer**
- Provider: Claude Code
- Arguments: \`--model opus\`
- Instructions: "Review code for bugs, security issues, and best practices. Suggest improvements."

**Quick Fix Agent**
- Provider: Claude Code
- Arguments: \`--dangerously-skip-permissions\`
- Instructions: "Fix the described issue. Commit changes with a clear message."
`,

  "workspace/environments": `# Environments

Environments define container configurations - resource limits, environment variables, and setup scripts.

## Creating an Environment

1. Go to **Workspace > Environments**
2. Click **New Environment**
3. Configure:
   - **Name** - e.g., "Node + Python", "High Memory"
   - **Description** - what this environment includes
   - **Memory (MB)** - RAM limit (default: 4096)
   - **CPU Cores** - CPU limit (default: 2)
   - **Setup Script** - commands to run on container start
   - **Environment Variables** - key-value pairs, with optional secret flag

## Setup Script

The setup script runs on container start before the thread begins. Use it to install additional tools:

\`\`\`bash
pip install pytest black
npm install -g tsx
apt-get update && apt-get install -y ripgrep
\`\`\`

## Environment Variables

Variables are passed to the container as standard environment variables. Mark sensitive values as "Secret" to mask them in the UI.

## Usage

Select an environment when creating a thread. Resource limits and env vars are applied to the Docker container automatically.
`,

  "integrations/claude-code": `# Claude Code

Claude Code is Anthropic's official CLI for AI-assisted development. In citshe, it runs inside isolated Docker containers as part of Workspace threads.

## Setup

1. Go to **Settings > AI Providers**
2. Click **Add Provider** and select **Claude Code (Local)**
3. No API key needed - Claude Code manages its own authentication

## First Thread

When you create your first thread with Claude Code:
1. The agent terminal opens with \`claude\` command
2. Claude Code will prompt you to log in via OAuth
3. After logging in, your credentials are stored in a shared Docker volume
4. All future threads reuse the credentials automatically

## Configuration

### Start Arguments

Pass CLI flags via the Start Arguments field in thread creation:

- \`--dangerously-skip-permissions\` - skip permission prompts (sandboxed environment)
- \`--model opus\` or \`--model sonnet\` - select model
- \`--permission-mode plan\` - start in plan mode
- \`--verbose\` - verbose output

### Instructions

Instructions are written as \`CLAUDE.md\` in the workspace root. Claude Code reads this file automatically as project context.
`,

  "integrations/openclaw": `# OpenClaw

OpenClaw is an open-source AI agent platform supporting 50+ AI providers. In citshe, it runs inside isolated Docker containers as part of Workspace threads.

## Setup

1. Go to **Settings > AI Providers**
2. Click **Add Provider** and select **OpenClaw**
3. No API key needed - OpenClaw manages its own provider configuration

## First Thread

When you create your first thread with OpenClaw:
1. The agent terminal opens with \`openclaw tui\` command
2. Run \`openclaw onboard\` to configure your preferred AI provider and API keys
3. Configuration is stored in a shared Docker volume (\`~/.openclaw/\`)
4. All future threads reuse the configuration automatically

## Supported Providers

OpenClaw supports 50+ AI providers including:
- Anthropic (Claude)
- OpenAI (GPT-4, etc.)
- Google (Gemini)
- Groq, Mistral, DeepSeek
- Ollama (local models)
- And many more

## Configuration

### Start Arguments

Pass flags via Start Arguments in thread creation. Refer to the [OpenClaw CLI Reference](https://docs.openclaw.ai/start/wizard-cli-reference) for available flags.

### Instructions

Instructions are written as \`SOUL.md\` in the workspace root. OpenClaw reads this file as the agent personality/instructions.
`,
};

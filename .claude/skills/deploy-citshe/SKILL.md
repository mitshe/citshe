---
name: deploy-citshe
description: Deploy citshe (self-hosted AI coding-agent panel) to a fresh Ubuntu/Debian VPS behind a Cloudflare Tunnel. Use when the user wants to stand up citshe on their own server. Provisions Docker + firewall, pulls the public GHCR images, generates secrets, and brings up the docker compose stack with SSH as the only open port.
---

# Deploy citshe to a VPS

You are helping the user deploy **citshe** — a self-hosted panel that runs
Claude Code workers, browser terminals, and a stack overview — to their own VPS.
The production stack is Docker Compose (Postgres + Redis + api + web + executor)
fronted by a **Cloudflare Tunnel**, so the only inbound port is SSH.

Repo: `https://github.com/mitshe/citshe` · Full reference: `docs/DEPLOY.md`.

## Before you start — gather these from the user

1. **SSH access** to a fresh Ubuntu 22.04+/Debian 12+ VPS (root or sudo). ~2
   vCPU / 4 GB RAM / 40 GB disk — the executor image is large.
2. A **domain on Cloudflare** (free plan is fine) and the subdomain they want,
   e.g. `panel.example.com`.
3. Willingness to create a **Cloudflare Tunnel** (they do this in the dashboard;
   you can't, so you'll pause and ask for the token).

If any is missing, ask before proceeding. Never invent a domain or run commands
against a server the user hasn't given you access to.

## Steps

Run these over SSH on the VPS. Show the user each command; don't hide failures.

### 1. Docker + firewall (only SSH open)

```bash
curl -fsSL https://get.docker.com | sh
apt-get update && apt-get install -y ufw fail2ban
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw --force enable
mkdir -p /opt/citshe
```

### 2. Fetch compose + env template

```bash
cd /opt/citshe
curl -fsSLO https://raw.githubusercontent.com/mitshe/citshe/master/docker/prod/docker-compose.yml
curl -fsSL  https://raw.githubusercontent.com/mitshe/citshe/master/docker/prod/.env.example -o .env
chmod 600 .env
```

### 3. Generate secrets and fill `.env`

Generate secrets **on the server** (so they never pass through chat/logs):

```bash
openssl rand -hex 32   # ENCRYPTION_KEY
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 24   # POSTGRES_PASSWORD
```

Write them into `/opt/citshe/.env` along with `PANEL_DOMAIN`. Prefer generating
and writing in one non-echoing step, e.g.:

```bash
cd /opt/citshe
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -hex 32)|" .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
sed -i "s|^PANEL_DOMAIN=.*|PANEL_DOMAIN=panel.example.com|" .env   # <-- their domain
```

`ENCRYPTION_KEY` must stay stable forever — changing it orphans encrypted keys.
Leave `IMAGE_TAG`/`EXECUTOR_TAG` as `latest` unless they want a pinned release.

### 4. Cloudflare Tunnel — PAUSE and ask the user

You cannot do this part. Ask the user to:

1. Open **Cloudflare Zero Trust → Networks → Tunnels → Create a tunnel →
   Cloudflared**, name it, and **copy the token** (the long string after
   `cloudflared service install` — they do NOT run that command).
2. Add a **Public Hostname**: their `PANEL_DOMAIN`, type **HTTP**, URL
   **`web:3000`** (the compose service name, not localhost).

Then have them give you the token, and write it in (via stdin, not as a shell
arg, so it doesn't land in logs):

```bash
printf 'TUNNEL_TOKEN=%s\n' 'PASTE_TOKEN' >> /opt/citshe/.env   # or sed-replace the line
```

Verify: `grep -c '^TUNNEL_TOKEN=..' /opt/citshe/.env` should print `1`.

### 5. Bring it up

```bash
cd /opt/citshe
docker compose pull        # public GHCR images; executor is large (~minutes)
docker compose up -d
sleep 25 && docker compose ps   # all running/healthy
```

The api applies DB migrations on boot. Verify the panel answers through the
tunnel:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://PANEL_DOMAIN   # expect 307 -> /home
```

### 6. Tell the user the two remaining manual steps

1. **Register the admin** at `https://PANEL_DOMAIN` — the first account becomes
   admin, then registration closes.
2. **Lock the panel** (recommended): Cloudflare Zero Trust → Access →
   Applications → add `PANEL_DOMAIN` with a policy (email allow-list / PIN /
   password).
3. **Agent engine auth**: open a terminal in the panel and run `claude /login`
   once — workers run Claude Code on the user's subscription, not an API key.

## Guardrails

- Secrets live only in `/opt/citshe/.env` (chmod 600). Never commit them, never
  print full values back to the user, never put them in the compose file.
- Don't open any inbound port besides SSH — the tunnel dials outbound.
- If `docker compose pull` is denied, the user forked the repo and their GHCR
  packages are private; tell them to make `citshe-api/web/executor` public or
  `docker login ghcr.io`.
- Confirm before destructive actions (`docker compose down -v` deletes data).

## Day-2

Update: `cd /opt/citshe && docker compose pull && docker compose up -d`.
Logs: `docker compose logs -f api|web|cloudflared`.
Backup: `docker compose exec postgres pg_dump -U citshe citshe > backup.sql`.

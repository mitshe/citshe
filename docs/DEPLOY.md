# Deploy citshe on your own VPS

This is the exact setup citshe runs in production: a single VPS with Docker,
its own Postgres and Redis, images pulled from GHCR, and a **Cloudflare Tunnel**
as the only ingress — so the only port you expose to the internet is SSH.

```
                    ┌── Cloudflare ──┐
   you ──HTTPS──▶  │  your domain    │ ──outbound tunnel──▶  cloudflared ─▶ web ─▶ api
                    └─(Access = auth)┘                         (docker compose on the VPS)
                                                               postgres · redis · executor
```

**What you need**

- A VPS (any provider — Hetzner, DigitalOcean, etc.), Ubuntu 22.04+/Debian 12+,
  root or sudo, ~2 vCPU / 4 GB RAM / 40 GB disk (the executor image is large).
- A domain on **Cloudflare** (free plan is fine).
- ~15 minutes.

You never open HTTP/HTTPS ports. The tunnel dials **out** to Cloudflare, so the
firewall can stay closed to everything but SSH.

---

## 1. Prepare the server

SSH in as root (or a sudo user) and install Docker + a firewall.

```bash
# Docker (official convenience script)
curl -fsSL https://get.docker.com | sh

# Firewall: allow only SSH, deny everything else inbound
apt-get update && apt-get install -y ufw fail2ban
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

mkdir -p /opt/citshe
```

`fail2ban` is optional but recommended — it bans brute-force SSH attempts.

## 2. Get the compose file + env template

```bash
cd /opt/citshe
curl -fsSLO https://raw.githubusercontent.com/mitshe/citshe/master/docker/prod/docker-compose.yml
curl -fsSL  https://raw.githubusercontent.com/mitshe/citshe/master/docker/prod/.env.example -o .env
chmod 600 .env
```

(Or `git clone` the repo and copy `docker/prod/*` — same thing.)

## 3. Fill in secrets

Generate the secrets on the server and edit `.env`:

```bash
openssl rand -hex 32   # ENCRYPTION_KEY
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 24   # POSTGRES_PASSWORD
```

Edit `/opt/citshe/.env` and set:

| Variable            | What to put                                                        |
| ------------------- | ------------------------------------------------------------------ |
| `PANEL_DOMAIN`      | the hostname you'll serve the panel at, e.g. `panel.example.com`   |
| `POSTGRES_PASSWORD` | the generated password                                             |
| `ENCRYPTION_KEY`    | generated — **keep it stable**, changing it orphans encrypted keys |
| `JWT_SECRET`        | generated                                                          |
| `TUNNEL_TOKEN`      | from step 4 (fill in after you create the tunnel)                  |

Secrets live only in this file (`chmod 600`), never in the repo.

## 4. Create the Cloudflare Tunnel

1. Go to **[Cloudflare Zero Trust](https://one.dash.cloudflare.com)** →
   **Networks → Tunnels → Create a tunnel** → **Cloudflared**.
2. Name it (e.g. `citshe`) and **copy the token** — it's the long string after
   `cloudflared service install` in the install snippet. Put it in `.env` as
   `TUNNEL_TOKEN` (you don't run that install command — the container does).
3. Add a **Public Hostname**:
   - Subdomain + domain = your `PANEL_DOMAIN` (e.g. `panel` · `example.com`)
   - Type **HTTP**, URL **`web:3000`**  ← the compose service name, not localhost
4. **Save**. Cloudflare creates the DNS record for you.

## 5. Start it

```bash
cd /opt/citshe
docker compose pull      # pulls api / web / executor from GHCR (public images)
docker compose up -d
docker compose ps        # all should be running / healthy within ~30s
```

The api container applies database migrations on boot. Open
`https://PANEL_DOMAIN` — the first account you register becomes the admin
(registration then closes).

## 6. Lock the panel (recommended)

Behind the tunnel the panel is public. Add a login wall in Cloudflare:
**Zero Trust → Access → Applications → Add** a self-hosted app for
`PANEL_DOMAIN`, then a policy (email allow-list, one-time PIN, or a password).
Now nobody reaches the panel without passing Access first.

## 7. Authenticate the agent engine

The worker/terminal containers run the **Claude Code CLI on your Claude
subscription**, not an API key. Open a terminal in the panel once and run:

```
claude /login
```

inside it to authenticate. The login persists per portal.

---

## Day-2 operations

```bash
cd /opt/citshe
docker compose pull && docker compose up -d   # update to the latest images
docker compose logs -f api                    # tail a service
docker compose logs -f cloudflared            # tunnel connection status
docker compose down                           # stop (data persists in volumes)
```

Data lives in the `postgres-data` and `redis-data` Docker volumes. Back up
Postgres with:

```bash
docker compose exec postgres pg_dump -U citshe citshe > citshe-backup.sql
```

### Pinning a version

Images are tagged `latest`. To pin a release, set `IMAGE_TAG` / `EXECUTOR_TAG`
in `.env` to a published tag and re-run `docker compose pull && up -d`.

### Building from source instead of GHCR

The compose file keeps `build:` contexts, so you can build locally instead of
pulling: `docker compose up -d --build` (needs the full repo checked out, not
just `docker/prod/`).

## Troubleshooting

| Symptom                                    | Cause / fix                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **Error 1033** on the domain              | cloudflared isn't running yet, or the tunnel token is wrong. `docker compose logs cloudflared`. |
| Panel loads but login/register 500s        | api not healthy or DB migration failed. `docker compose logs api`.                          |
| `docker compose pull` denied               | the GHCR packages must be **public** (they are for mitshe/citshe). For a fork, make yours public or `docker login ghcr.io`. |
| Terminals show a black screen / task hangs | the executor image isn't pulled. `docker compose pull` and check `EXECUTOR_IMAGE`.          |
| Changed `ENCRYPTION_KEY` and keys broke    | it must stay constant — restore the original value.                                         |

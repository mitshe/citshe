# Connecting GitHub via SSO (GitHub App)

citshe can connect to GitHub in two ways:

1. **Personal Access Token (PAT)** — works out of the box, no setup. Paste a
   fine-grained token in Settings → Integrations. Good enough to get going.
2. **GitHub App (SSO)** — the Vercel/Cloudflare-style flow: click *Continue with
   GitHub*, authorize, done. No tokens to paste. Requires a **one-time**
   registration below (per citshe instance, done by the admin).

This guide covers option 2. Until you complete it, the SSO button falls back to
the token flow — nothing breaks.

## 1. Register the GitHub App

Go to **https://github.com/settings/apps** → **New GitHub App**.

- **GitHub App name**: e.g. `citshe` (the resulting slug becomes `GITHUB_APP_SLUG`).
- **Homepage URL**: `http://localhost:3000` (your `APP_URL`).
- **Callback URL**: `http://localhost:3001/api/v1/integrations/github/app/callback`
  (this is the **API** origin, port 3001, not the web app).
- **Request user authorization (OAuth) during installation**: leave **off**.
- **Setup URL** (optional): `http://localhost:3000/repos`.
- **Webhook**: **uncheck** *Active* (not needed yet).

### Permissions (Repository permissions)

- **Contents**: Read and write  (clone + push branches)
- **Pull requests**: Read and write  (open PRs)
- **Metadata**: Read-only  (mandatory)

### Where can this GitHub App be installed?

- **Only on this account** is fine for personal use.

Click **Create GitHub App**.

## 2. Collect the credentials

On the App's settings page:

- **App ID** → `GITHUB_APP_ID`
- **Client ID** → `GITHUB_APP_CLIENT_ID`
- **Client secret** → *Generate a new client secret* → `GITHUB_APP_CLIENT_SECRET`
- **Private key** → *Generate a private key* (downloads a `.pem`) →
  `GITHUB_APP_PRIVATE_KEY`
- The **slug** is the URL name of the App (`github.com/apps/<slug>`) →
  `GITHUB_APP_SLUG`

## 3. Put them in `apps/api/.env`

```bash
APP_URL=http://localhost:3000
GITHUB_APP_SLUG=citshe
GITHUB_APP_ID=123456
GITHUB_APP_CLIENT_ID=Iv1.abc123
GITHUB_APP_CLIENT_SECRET=xxxxxxxx
# Either paste the PEM with literal \n between lines:
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n"
# ...or base64-encode the whole file and paste that (the app decodes both):
#   base64 -i your-app.private-key.pem | tr -d '\n'
```

Restart the API.

## 4. Use it

Settings → Integrations → **Continue with GitHub**, or the **Connect GitHub**
button on the Repos page. You'll land on GitHub's *Install* screen, pick the repos
to grant access to, and get redirected back to `/repos?connected=github`. Connected
repos then show up in the Connect-repo dialog and get auto-analyzed.

## Deploying to a VPS / real domain

Only the URLs change. In the App settings set the **Callback URL** to
`https://api.your-domain/api/v1/integrations/github/app/callback` and set
`APP_URL=https://your-domain` in the API env. Everything else stays the same.

## How tokens work (FYI)

Nothing long-lived is stored. citshe saves only the **installation id**; every time
it needs to talk to GitHub (list repos, read files, clone in a worker) it mints a
short-lived **installation access token** from the App's private key on the fly and
caches it for ~55 minutes.

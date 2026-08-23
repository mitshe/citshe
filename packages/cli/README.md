# @citshe/cli

Thin local client for the [citshe](../../README.md) panel. It lets you attach
your **local terminal** to Claude Code worker sessions running on your VPS, list
sessions across your portals, and push a local Claude Code history into the
panel — all authenticated with a personal access token you paste from the UI.

All state lives on the VPS; this CLI only talks to the citshe REST API and its
socket.io server.

## Install

```bash
npm i -g @citshe/cli
```

Then get a token: in the citshe panel go to **Settings → API keys → citshe CLI →
New CLI token**, copy it, and:

```bash
citshe login          # paste the ctk_… token when prompted
citshe ls             # list your sessions (grouped by portal)
citshe attach <id>    # attach that session's terminal to THIS terminal
```

One token works across **all your portals**. Detach from an attached session
with **Ctrl-]** (or type **`~.`** at the start of a line).

### Local build (for development)

```bash
pnpm --filter @citshe/cli build
node packages/cli/dist/index.js --help
```

## Commands

```bash
citshe login [token] [--api-base <url>]   # verify + save your ctk_ token
citshe logout                             # remove the local token
citshe ls [--json]                        # sessions grouped by portal
citshe attach <sessionId> [--terminal id] # live-attach the terminal
citshe push [projectPath] [--org <id>]    # import a local session (coming soon)
```

- Config is stored at `~/.citshe/config.json` (chmod 600) and holds
  `{ token, apiBase, wsBase }`.
- Default API base is `https://rangopanel.mitshe.com`.
- In `attach`, detach cleanly with **Ctrl-]** or by typing **`~.`** at the
  start of a line.

## Wire protocol

REST (Bearer `<ctk_ token>`):

| Route | Method | Notes |
|-------|--------|-------|
| `/api/v1/cli/me` | GET | `{ user, organizations }` |
| `/api/v1/cli/sessions` | GET | `{ sessions: [...] }` |
| `/api/v1/cli/sessions/import` | POST | `{ filename, jsonl, projectPath, sessionUuid, organizationId }` |

Socket.io (path `/socket.io`), event names live in `src/constants.ts`:

- emit `authenticate` `{ token }` → wait for `authenticated`
- emit `subscribe:session` `{ sessionId }`
- receive `session:output` `{ terminalId, data }`
- emit `session:input` `{ terminalId, input }`
- emit `session:resize` `{ terminalId, cols, rows }`

Default terminal id per session: `${sessionId}:agent`.

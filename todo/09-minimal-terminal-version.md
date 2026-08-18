# 09 — Minimal terminal version of citshe

## Idea
CLI-only citshe. No web UI, no browser. Pure terminal.
`citshe thread new "Fix auth bug" --repo my-app --snapshot dev-env`

## Why
- Developers live in terminals
- Faster than opening browser
- Works over SSH
- Complements web UI (not replaces)
- Good for CI/CD integration

## Commands
```bash
citshe thread list                    # list all threads
citshe thread new "name" [--repo X]   # create thread
citshe thread open <id>               # attach terminal to thread
citshe thread stop <id>               # stop thread

citshe snapshot list                  # list snapshots
citshe snapshot create <thread-id>    # snapshot from thread

citshe task list                      # imported tasks
citshe task import --jira             # import from Jira
citshe task open <id>                 # create thread from task

citshe workflow run <id>              # trigger workflow
citshe status                         # overview: threads, tasks, workflows
```

## Implementation
- Thin CLI that calls citshe API (same endpoints as web)
- Written in Node.js or Go
- Published as npm package: `npx citshe` or `npm install -g citshe-cli`
- Auth: API key or JWT token from login
- Terminal attachment: WebSocket to session terminal

## Priority
Low — web UI and desktop app first. But keep API design CLI-friendly.

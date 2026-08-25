# New-project flow — system-design analysis ("what doesn't fit")

Written after an overnight hardening pass on the "New project" wizard (portal +
repo + build task, all from a phone). This records what was fixed and the
trade-offs that remain — so the next person doesn't re-discover them.

## The flow, end to end

```
wizard (apps/web/.../new-portal-page.tsx)
  → pre-flight GitHub token  (POST /new-project/validate-github)
  → engine gate              (client + server)
  → POST /new-project        (NewProjectService.create)
       1. gate on Claude engine (server-side)
       2. create GitHub repo with the pasted PAT     ← external, before DB
       3. ONE Prisma txn: org + member + integration + plugins + repo + task
       4. startBuildTask  → BullMQ job → task-queue.processor → executeTask
                            → session container → claude -p → REVIEW
  → /home BuildHero shows Building… → Site is live / Built — not deployed
```

## Fixed in this pass

- **Concurrency was on the wrong path.** The atomic task-claim guard first
  landed in `dispatchTask` (the MCP orchestrator path), but build tasks go
  through `executeTask` (BullMQ). Ported the guard there: skip if a live worker
  exists, atomically claim with a conditional `updateMany`, roll back to QUEUED
  if the container fails to start. Both dispatch paths now share the invariant.
- **Silently-unstarted builds.** A task could sit PENDING/QUEUED forever if the
  kick-off failed (Redis down, process killed). Added `reconcileUnstartedTasks`
  to the watchdog: re-enqueues old PENDING/QUEUED tasks with no BullMQ job and
  no live worker.
- **Server-side engine gate.** The "is Claude logged in?" check was client-only;
  a direct API call could orphan a repo+portal for a build that can't run. The
  gate now also runs in `NewProjectService.create` before the repo is created.
- **Honest failure copy.** The compensating repo-delete needs `delete_repo`
  scope; when it can't clean up, the error now names the repo left on GitHub
  instead of claiming "nothing was saved".
- **Pre-flight token validation (B9).** Catches an expired token / missing
  `repo` scope in the wizard with an exact fix; missing `workflow` is a warning.
- **Portal-deletion guard (#7).** Refuses to delete a portal with a live worker
  (AgentSession cascades on delete → would orphan the container).
- **Humanized errors (E18/#22)** across the flow, both server and client.

## What still doesn't fit (known trade-offs, not yet fixed)

1. **Cross-system atomicity is not truly atomic.** The GitHub repo is created
   *before* the DB transaction, with a best-effort compensating delete. A crash
   between repo-create and the txn (or a token without `delete_repo`) leaves an
   orphan repo. The DB side is genuinely all-or-nothing; the *repo* is not.
   - *Cleaner design:* create DB rows first (repo row `pending`), create the
     GitHub repo after/inside the txn success, roll back cheap local DB on repo
     failure. Deferred — it's a real restructure with its own edge (a committed
     portal whose repo failed) and the current path is acceptable for a single
     operator. Revisit if orphan repos become a real annoyance.

2. **Layering: `NewProjectService` news up `GitHubAdapter` directly** instead of
   going through `GitProviderPort` / the adapter factory (CLAUDE.md §3.1). Low
   stakes here because the token is a per-request pasted PAT (nothing for a
   factory to resolve), but it hard-wires GitHub and blocks unit-testing against
   a mock port. Cleanup, not urgent.

3. **Two storage shapes for portal secrets.** The GitHub PAT is stored as an
   `Integration.config`; Cloudflare/Vercel/Neon as `Plugin.config`. Same class
   of secret, two tables — "rotate all secrets for this portal" touches both.

4. **Token-in-repo risk is guarded only by prompt discipline.** The builder
   prompt forbids committing secrets and a pre-commit hook scans staged token
   shapes, but nothing scans the pushed commit server-side. Highest consequence
   for **public** repos. A mechanical pre-push secret scan would close this.

5. **Timeouts tuned for generic tasks, not build+deploy.** `WORKER_EXEC_TIMEOUT`
   is 20 min; a scaffold + deploy + DB-migrate build can legitimately exceed it.
   `STUCK_TASK_MS` (30 min) is comfortably past it, so the watchdog won't kill a
   long build — but the exec-timeout inside the worker might cut a genuinely
   long run. Watch real build durations before changing.

6. **Success containers stay hot for 30 min.** On success the worker container
   is kept RUNNING for "Continue with Claude", reaped after 30 min idle. It
   holds a repo clone + all provider tokens in env that whole time — fine for a
   single operator, worth noting as blast radius.

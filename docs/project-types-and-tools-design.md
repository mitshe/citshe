# Design doc — Project types + growing the tool stack

Status: **design only.** Written after Jakub: *"czy task oprócz strony może zrobić
Schedule? albo API? albo Workera z akcją? albo Scrapera? … kolejnymi toolami to
powinny być chyba Stripe/Clerk."*

This is the plan to grow citshe from a **website generator** into a **service
generator + manager** — the wedge vs v0/Lovable ("build & run real services from
your phone", not just "generate a page").

## 1. Where we are today (facts)
- A worker is **Claude Code in a container** with the full repo, a terminal, and
  the portal's decrypted stack tokens (CLOUDFLARE_API_TOKEN / VERCEL_TOKEN /
  NEON_* / …). So it CAN already write any code — a scraper, an API, a cron
  worker — it's just normal software.
- But the build prompt (`buildBuilderInstructions`) is written **only** for
  "build a website and deploy it": house design rules, hosting = CF Pages /
  Vercel. There is no notion of "this is an API" or "this is a scraper".
- `BuildSpec.mode` is only `scratch | refresh`. There is no **project type**.
- Schedules exist (cron → creates a task) but the **user** sets them; a worker
  doesn't create a schedule itself (it can add a follow-up task via
  `citshe-task`, not a cron).

So the foundation is there; what's missing is **project types** so a task knows
WHAT it's building and gets the right prompt + stack + deploy + success check.

## 2. Project types (the core addition)
Add `BuildSpec.projectType` (and surface it as the first real choice in the
wizard, replacing/augmenting the thin scratch/refresh step). Each type is a
**recipe**: prompt fragment + suggested stack + deploy target + "done" signal.

| Type | What it is | Default stack | Deploy | "Done" = |
|---|---|---|---|---|
| **`website`** (today) | Marketing/content/landing/blog | Astro / Next | CF Pages / Vercel | live URL |
| **`webapp`** | App with auth, dashboard, dynamic | Next.js (+ Neon, +Clerk, +Stripe) | Vercel / CF | live URL, login works |
| **`api`** | HTTP API / backend service | Hono/Express on CF Workers, or Next route handlers | CF Workers / Vercel | endpoints return 200, documented |
| **`scraper`** | Pulls data on a schedule into a DB | CF Worker + Cron Trigger + Neon | CF Workers (cron) | first run wrote rows; schedule armed |
| **`worker`/`job`** | Recurring action (send emails, sync, cleanup) | CF Worker + Cron, or a citshe Schedule | CF Workers cron / citshe cron | runs on schedule, logs a result |
| **`automation`** | Event/webhook-driven (Stripe webhook → do X) | CF Worker + webhook route | CF Workers | webhook verified + handled |

Implementation shape:
- `BuildSpec`: add `projectType: 'website'|'webapp'|'api'|'scraper'|'worker'|'automation'`
  (default `website` for back-compat). Keep `mode` (scratch/refresh) orthogonal.
- Orchestration: `buildBuilderInstructions` switches on `projectType` to assemble
  the right prompt: **shared** rules (repo, secrets, commit identity, citshe
  skill, deploy-one-shot) + a **per-type** block (goal, stack, deploy command,
  what "done" means, and — importantly — the design rules ONLY for website/
  webapp; a scraper doesn't need a hero section).
- Wizard: a "What are you building?" step with the 6 types as radio-cards
  (icon + one-liner + example), then the describe step is tailored (e.g. a
  scraper asks "what site/data, how often, which fields").
- The worker's success marker generalizes: `SITE_URL:` for site/webapp,
  `ENDPOINT:`/`DEPLOYED:` for api/worker, `SCRAPER_OK: <rows> rows` for scrapers.

This is the foundation everything else stands on — do it first.

## 3. Scraper / recurring worker — the two models (decide in build)
Jakub: *"do przemyślenia w projekcie."* Both are viable; pick per project.

### Model A — CF Worker + Cron Trigger + Neon (recommended default)
- The scraper IS a Cloudflare Worker with a `[triggers] crons = ["0 * * * *"]`
  in `wrangler.toml`; it fetches, parses, and upserts into Neon Postgres.
- Deploy = `wrangler deploy`; the cron runs on Cloudflare's edge, no citshe
  container needed after deploy. Cheap, serverless, and we already have CF+Neon.
- Best for: steady, lightweight periodic pulls (prices, listings, feeds).
- citshe's role after build: show it in the portal (last run, row count via a
  Neon query, next cron) and let you edit it with "Send back to Claude".

### Model B — citshe Schedule runs a task each time
- The scraper is a **task**; a citshe Schedule (cron) re-runs it, spinning a
  worker container each time to do the pull.
- Reuses the Schedules system we already have. Better when each run needs the
  full agent (heavy parsing, AI extraction, decisions) rather than a fixed
  script.
- Cost: a container per run — fine hourly, wasteful every minute.

**Recommendation:** default scrapers/jobs to **Model A** (edge cron, no
container), and use **Model B** only when a run genuinely needs an AI agent.
The wizard/prompt picks A unless the task clearly needs an agent per run.

Either way, expose a **portal view** for a scraper/worker project: last run
time + status, rows written (Neon `SELECT count(*)`), the cron expression, and
a "Run now" — mirroring the plugin status cards.

## 4. New tools in the STACK (Stripe, Clerk, …)
Same pattern as Cloudflare/Vercel/Neon today: a `StackPlugin` (connect a key,
testConnection, getStatus, listResources) + it gets injected into the worker
container as env, and the design/build rules tell the worker how to use it.

### Stripe (payments)
- Plugin: connect the secret key (+ optional webhook secret); testConnection =
  `GET /v1/account`; getStatus = mode (test/live), recent payments count, MRR-
  ish number if available; warnings = "still in test mode", "no webhook".
- Injected env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- Build rules: for a `webapp`/`automation` that needs payments, the worker wires
  Stripe Checkout + a webhook route (verify signature — never trust the client),
  stores nothing sensitive in the repo. A `stripe` design-rule fragment.

### Clerk (auth)
- Plugin: connect publishable + secret key; testConnection against Clerk API;
  getStatus = user count, active sessions.
- Injected env: `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`.
- Build rules: for a `webapp` needing login, wire Clerk's Next.js middleware +
  components; protect routes; no custom password handling.

### The pattern that makes this scale
Every new tool is: **plugin (connect/status) + env injection + a build-rules
fragment**. The worker's env-discovery (`env | grep …`) and the per-type prompt
already compose these. Adding a tool = add a plugin + a prompt fragment + a
catalog entry (icon, "how to get the key", scope hint) — no core changes. This
is the same shape as the connect-blocks + validate-key work just shipped, so
Stripe/Clerk slot straight in.

## 5. Worker → Schedule / API (can a task set these up?)
- **API:** yes, via `projectType: 'api'` — the worker builds and deploys an HTTP
  service (CF Workers / route handlers) with documented endpoints. No new infra,
  just the type + prompt + deploy target.
- **Schedule:** two levels. (a) A worker building a `scraper`/`worker` project
  sets up an **edge cron** (Model A) as part of the deploy — self-contained. (b)
  For citshe-side Schedules (Model B), give the worker a `citshe-schedule` skill
  script (like `citshe-task`) so it can register a cron on the board when the
  task genuinely needs a per-run agent. Guarded + shown to the human.

## 6. Recommended build order
1. **Project types** (§2) — the foundation. Add `projectType`, the wizard step,
   and per-type prompt branches. Ship with `website` unchanged + `api`,
   `scraper`, `worker` added (webapp/automation can follow).
2. **Scraper/worker portal view** (§3) — last run, rows, cron, Run now.
3. **Stripe plugin** (§4) — first "real" SaaS tool; unlocks paid webapps.
4. **Clerk plugin** (§4) — auth; unlocks logged-in webapps.
5. **citshe-schedule skill** (§5b) — worker can arm citshe-side crons.

## 7. Open questions for Jakub
- Wizard: replace the thin "scratch vs refresh" step with the 6 project-type
  cards, or keep both (type first, then scratch/refresh within type)? Recommend:
  type first; refresh becomes "refresh an existing website".
- Which types to ship in round 1 — just `api` + `scraper` + `worker` alongside
  `website`, or also `webapp` (needs Clerk/Stripe first to be meaningful)?
- Stripe/Clerk: connect at the portal level (Stack, like CF) — confirm that's
  where they live (yes, matches the model).
- For scrapers, is Neon always the sink, or also R2 (files) / KV (small state)?

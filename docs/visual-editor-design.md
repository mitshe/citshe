# Design doc — Visual AI Editor ("popraw stronę klikając")

Status: **design only, not built.** Written after Jakub's idea: *"przydałby się
preview i masz całą wyświetloną stronę, możesz tam klikać po stronie, zaznaczać
elementy które chciałbyś poprawić — taki AI wizualny edytor dla ludzi."*

## The idea in one line
You see your deployed site inside citshe, click the thing you don't like, say
what to change in plain words, and citshe turns that into a precise task for a
worker — which edits the real code and redeploys. A no-code, point-and-describe
loop for non-developers.

## Why it fits citshe
- Sites already deploy to a **public URL** (`SITE_URL` / previews) — we have
  something to show.
- The executor already has **Playwright** (`citshe-shot`) — we can render and
  screenshot pages server-side.
- The worker loop (task → build → deploy) already exists — the editor just
  produces very good, targeted tasks and reuses "Send back to Claude".
- This is the "for humans, from your phone" wedge that separates citshe from
  v0/Lovable: not "generate a new page", but "tweak the real live one by
  pointing at it".

## The core UX (target)
1. **Preview panel** on the portal: the deployed site rendered in the panel.
2. **"Edit" mode toggle.** In edit mode, hovering the page highlights the
   element under the cursor (outline + a small label like `Hero heading` /
   `Pricing card`). Clicking selects it.
3. A **comment popover** anchored to the selection: "What should change here?"
   You type ("make this bigger and move it left", "wrong color", "this text is
   boring"). You can select several elements and batch them.
4. **"Apply with AI"** → citshe assembles a task with (a) your instruction,
   (b) a **precise pointer to the element** (see "The hard part" below), (c) a
   screenshot with the selection marked. It runs a worker on the repo. When the
   worker redeploys, the preview refreshes and you see the change.
5. Iterate. Each round is cheap ("Send back to Claude" with the next note).

## The hard part: turning a click into a code target
An AI worker edits **source files**, but the click happens on **rendered HTML**.
The bridge is the problem to solve. Three approaches, cheapest first:

### Option A — Screenshot + description (MVP, ~least work)
- Preview = a **screenshot** of the live URL (Playwright, already have it), shown
  as an image. The user draws a box / drops a pin on it and types the change.
- We send the worker: the instruction + the cropped screenshot region + a rough
  location ("top hero, right side"). The worker finds the matching source itself
  (it knows the repo).
- Pros: trivial infra, no cross-origin issues, works on a static image. Reuses
  `citshe-shot` and the existing task flow almost as-is.
- Cons: the pointer is fuzzy ("that box near the top"), so the worker may edit
  the wrong thing on dense pages. Good enough for "make the hero copy punchier"
  or "this section's colors are off", weak for "this specific button".

### Option B — Live iframe + element selector (the real thing)
- Preview = the live site in an **iframe**; an injected selector script (from
  citshe) tracks hover/click and reports a **stable selector** for the clicked
  node: tag + text snippet + a CSS path + nearest `id`/`data-*` + a cropped
  screenshot.
- The worker gets that selector + instruction, greps the repo for the text/
  selector, edits the right component, redeploys.
- Pros: precise ("the *Order now* button in the hero"), feels like a real visual
  editor.
- Cons: **cross-origin** — the site is on `*.pages.dev`, the panel on our
  domain, so we CANNOT inject a script into a plain iframe of the live URL
  (browser blocks it). Fixes, in order of preference:
  - **Build-time hook:** during a build, citshe injects a tiny, dev-only
    "citshe-editor" script into the site (guarded, only when opened *through*
    citshe via a token/query param) that talks to the parent via `postMessage`.
    Clean, precise, but requires the design-rules/build step to add it and a way
    to strip it in real prod.
  - **Proxy render:** citshe serves the page through its own origin (server-side
    fetch + rewrite) so the selector script is same-origin. More moving parts,
    can break sites with strict CSP / absolute asset URLs.
  - **Server-side DOM:** Playwright loads the page in the executor, the panel
    shows its screenshot, and clicks are mapped to DOM nodes *server-side*
    (Playwright resolves the element at x,y → its selector/text). No injection
    into the real site at all; the "live" feel is a fast screenshot loop. Best
    balance — precise selectors, no cross-origin hacks — at the cost of a
    Playwright session per edit.

### Option C — Full in-panel editor (later, biggest)
Direct manipulation (drag, resize, recolor in the panel) that writes back to
code. This is Webflow/Framer territory — out of scope for now; A→B is the path.

## Recommended path
1. **Phase 1 (small, ship first): PREVIEW only.** Show the deployed site — start
   with a screenshot (Playwright) with a "refresh" and an "open live" link, or a
   plain iframe of the public URL if the site allows framing. No editing yet.
   This alone is a big win: see the result without leaving citshe. (This is what
   Jakub asked to keep small.)
2. **Phase 2: point-and-describe (Option A).** Add box/pin selection on the
   preview + a "describe the change" popover → generates a targeted task with
   the marked screenshot. Reuses the worker + "Send back to Claude" loop.
3. **Phase 3: precise selection (Option B, server-side DOM via Playwright).**
   Upgrade the pointer from "a box on an image" to "this exact element" so edits
   land on the right component every time.

## Concrete pieces (when we build it)
- Backend: a `preview` capability per portal — render/screenshot the live URL
  (Playwright in a throwaway/executor container), cache it, expose
  `GET /portals/:id/preview`. For Phase 3, an endpoint that maps (url, x, y) →
  `{ selector, text, screenshotCrop }`.
- A task template: "Visual edit — <instruction>" carrying the element pointer +
  marked screenshot as an attachment, delivery = PR or direct push, that flows
  through the existing worker + designRules().
- Frontend: a `PreviewPanel` (image or iframe), an edit-mode overlay
  (hover-highlight, click-select, multi-select), a describe popover, and an
  "Apply with AI" that creates the task and then watches for redeploy to refresh
  the preview.
- Design-rules tie-in: the worker already has the house design system, so
  "make this nicer" edits stay on-brand.

## Open questions for Jakub (before building)
- Preview medium for Phase 1: **screenshot** (always works, static) vs **iframe**
  (interactive, but many sites block framing / cross-origin)? Recommend
  screenshot first.
- For precise selection (Phase 3): OK to have citshe inject a tiny editor script
  at build time (guarded), or prefer the no-injection server-side-DOM route?
- Should a visual edit default to **direct push** (instant, one live site) or a
  **PR** (review first)? For a non-dev "tweak my site" flow, direct push is
  probably what they expect.

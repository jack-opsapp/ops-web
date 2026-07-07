# /clients/new create-entry consistency — ROUTE CONSOLIDATION follow-up #2

> **For Claude:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task. Also obey `/Users/jacksonsweet/Projects/OPS/CLAUDE.md` and the ops-web `CLAUDE.md` (perfection standard, commit rules, no AI attribution). Use `superpowers:verification-before-completion` before claiming done.

**Goal:** Repoint the last two in-app client-create entry points (⌘⇧C and the client-list widget's "New Client" + button) straight onto `useWindowStore.openClientWindow`, eliminating the double-hop through the `/clients/new` redirect — with a unit test, docs, and full verification.

**Architecture:** Wiring-only change. The `/clients/new` route and the `?openClient=new` layout handler stay byte-identical (they are the deep-link contract). No store, dispatch, registry, or visual changes. One new unit test file pins the shortcut → window behavior including singleton refocus.

**Tech Stack:** Next.js 14 App Router, Zustand (`window-store`), vitest + @testing-library/react.

**Design System:** N/A — zero visual/copy changes. Do not introduce any.

**Required Skills:** `custom-skills:executing-plans`, `superpowers:verification-before-completion`. (No UI/animation/copy skills apply — nothing user-visible changes except speed.)

---

## Working rules (non-negotiable)

- **Fresh branch off origin/main:** `git fetch origin && git checkout -b chore/clients-create-entry-consistency origin/main`. Do NOT base on, commit to, or modify `feat/projects-new-consolidation` (in QA by a sibling session) or any other branch/worktree.
- **NO push, NO merge, NO PR.** Merging ops-web main auto-deploys prod. Report done with evidence and stop.
- Atomic conventional commits, staged **by name** (never `git add -A`/`.`), **no AI attribution** of any kind.
- Main CI is perpetually red on pre-existing lint (jsx-no-comment-textnodes); judge green by your own gates only.
- Materialize this plan verbatim (from "## Context" down, plus the header) as `docs/plans/2026-07-04-clients-create-entry-consistency.md` in Task 4.

## Context (decisions settled 2026-07-04 — implement, do not re-derive)

This is **follow-up #2** of the route-consolidation thread. Follow-up #1 (`/projects/new`, branch `feat/projects-new-consolidation`, unmerged/in QA) collapsed the legacy project form into the floating create window and repointed ⌘⇧P + the widget "Create Project" action; its DECISION.md entry explicitly filed `/clients/new` (⌘⇧C) as the next consolidation question.

Verified facts on `origin/main` @ `9583c129` (re-verify at execution time — see "Base re-check" below):

- `/clients/new` (`src/app/(dashboard)/clients/new/page.tsx`) is ALREADY a 15-line hand-off: `router.replace("/dashboard?openClient=new")`. **Do not touch it.**
- `dashboard-layout.tsx:139-155` parses `openClient` (`"new"` → `openClientWindow({ clientId: null, mode: "creating" })`, else id + `mode`), then strips the param. **Do not touch it.**
- `window-store.ts:303` `openClientWindow` derives singleton id `client-workspace:new` for creating mode; if the window exists it un-minimizes, raises z, replaces meta — **second open refocuses, never duplicates. Zero store changes needed.**
- Every other in-app client-create caller already goes direct: clients page (`clients/page.tsx:94`), ⌘K palette → `quick-actions/dispatch.ts:47`, Create menu (`create-cluster.tsx`, gated by ITS caller). Exactly **two stragglers** route through `/clients/new`:
  1. `src/components/ops/keyboard-shortcuts.tsx:64` — ⌘⇧C `router.push("/clients/new")` (double-hop: push → null page → replace → param parse).
  2. `src/components/dashboard/widgets/client-list-widget.tsx:288` — header "+" button `navigate("/clients/new")`.
- **No email/notification/drip links to `/clients/new` exist** (`git grep "clients/new" src/lib/email src/lib/api/services/onboarding-drip-service.ts` → empty). The route stays anyway as a cheap permanent compatibility redirect (bookmarks/muscle memory) — unlike `/projects/new` it has no hard external contract, so no email-side comments are needed.

**Settled decisions:**

1. **Idiom reconciliation — the grammar unifies, the mechanisms don't flip.** Routes = permanent thin hand-offs. In-app callers = direct `useWindowStore` calls. Deep-link query params (`openProject=` / `openClient=`) are parsed once, in `dashboard-layout.tsx`. `/clients/new` KEEPS its query-param mechanism (it reuses the layout handler that must exist regardless — agent action-cards build `/dashboard?openClient=<id>` URLs); `/projects/new` keeps its imperative mechanism (it must carry a `?clientId=` seed the layout handler doesn't parse). Neither flips; both are locally optimal.
2. **Setup gate — deliberately NOT applied.** Call `openClientWindow` directly; the catalog/setup gate is a Create-menu caller concern (`quick-actions/dispatch.ts` docstring). Do NOT route through `dispatchQuickAction`, do NOT add a gate.
3. **`/tasks/new` (the widget's task action) stays untouched** — separately filed follow-up, different contract.
4. Scope is exactly the two stragglers + test + docs. No dictionary changes (the `clientList.newClient` key already exists and is unchanged).

## Base re-check (Task 0)

The sibling branch may merge before you run. After branching, run:
`git show origin/main:src/components/ops/keyboard-shortcuts.tsx | grep -c "openProjectWindow"`
- **0 → World A** (feat unmerged, base = `9583c129`-era): apply edits exactly as written below; expect the merge-order conflicts documented in the Appendix.
- **≥1 → World B** (feat merged): same final state, simpler diff — the `useWindowStore` import and the widget's import/selector region already exist (add only the `openClientWindow` selector line), and the docstring C-line to replace reads `* Cmd+Shift+C: New client (/clients/new page)`. No conflicts expected; ignore the Appendix.

---

### Task 1 — Failing unit test: ⌘⇧C dispatches the create window (singleton)

**Files:**
- Create: `tests/unit/components/ops/keyboard-shortcuts.test.tsx`
- Read first (mirror their harness idioms exactly — store reset, RTL setup, router mock): `tests/unit/stores/window-store.test.ts`, `tests/unit/components/ops/create-menu/create-cluster.test.tsx`

**Step 1:** Write the test. Use the REAL zustand store (assert actual windows state — this also pins the no-duplicate contract in a unit test), mock only `next/navigation`'s `useRouter` (spy `push`). Reset store state between tests the same way `window-store.test.ts` does. Cases:

```tsx
// 1. ⌘⇧C on window → exactly one window with id "client-workspace:new",
//    type "client-workspace", meta.initialMode "creating"; router.push
//    NOT called (no "/clients/new" hop).
// 2. Second ⌘⇧C → still exactly ONE such window (singleton refocus, no
//    duplicate), zIndex raised.
// 3. ⌘⇧C while an <input> has focus → zero windows created (editable
//    guard preserved).
```

Render `<KeyboardShortcuts />` and dispatch real `KeyboardEvent`s (`new KeyboardEvent("keydown", { key: "c", metaKey: true, shiftKey: true, bubbles: true })`) on `window` (wrap in `act`). For case 3, render an `<input>`, `.focus()` it, dispatch on it.

**Step 2:** Run: `npx vitest run tests/unit/components/ops/keyboard-shortcuts.test.tsx` → expect FAIL (case 1: store empty, `push` called with "/clients/new").

### Task 2 — Repoint ⌘⇧C (minimal implementation)

**Files:** Modify `src/components/ops/keyboard-shortcuts.tsx` (World A line refs: import block ~L5, docstring ~L13, switch case "c" ~L62-65)

**Step 1:** Add import directly after the route-registry import (byte-identical to the sibling's placement):
```ts
import { useWindowStore } from "@/stores/window-store";
```

**Step 2:** In the file-top docstring, change ONLY the C line (leave the P and Cmd+B lines exactly as found — the sibling branch owns those lines in World A; see Appendix):
```
 * Cmd+Shift+C: New client (opens the workspace create window in place)
```

**Step 3:** Replace the `case "c":` body:
```ts
          case "c":
            e.preventDefault();
            // Straight onto the workspace create window — no route hop
            // (/clients/new is itself just a hand-off to the same window
            // via the /dashboard?openClient=new deep link). getState():
            // this is a bare event handler, not a subscriber.
            useWindowStore
              .getState()
              .openClientWindow({ clientId: null, mode: "creating" });
            return;
```
`useRouter` stays (number-key nav still uses it); the `[router]` effect dep stays.

**Step 4:** Run: `npx vitest run tests/unit/components/ops/keyboard-shortcuts.test.tsx` → expect PASS (all 3).

### Task 3 — Repoint the widget "New Client" button

**Files:** Modify `src/components/dashboard/widgets/client-list-widget.tsx` (World A refs: imports ~L24-27, hooks ~L52-56, button ~L288)

**Step 1:** Add import directly after the `use-widget-entity-open` import (byte-identical to the sibling's line): `import { useWindowStore } from "@/stores/window-store";` (World B: already present.)

**Step 2:** After `const openEntity = useWidgetEntityOpen();` add:
```ts
  // Same idiom as useWidgetEntityOpen's client path — creating mode goes
  // straight onto the workspace window instead of hopping through the
  // /clients/new redirect (create-entry consistency 2026-07-04).
  const openClientWindow = useWindowStore((s) => s.openClientWindow);
```

**Step 3:** The header "+" button: `onClick={() => navigate("/clients/new")}` → `onClick={() => openClientWindow({ clientId: null, mode: "creating" })}`. Everything else about the button (classes, title attr, icon) unchanged. `navigate` stays (other actions use it).

**Step 4:** Targeted suites: `npx vitest run tests/unit/components/ops/keyboard-shortcuts.test.tsx tests/unit/stores/window-store.test.ts tests/unit/lib/quick-actions/dispatch.test.ts tests/unit/components/ops/create-menu/create-cluster.test.tsx` → all green.

**Step 5:** Commit (staged by name):
```bash
git add src/components/ops/keyboard-shortcuts.tsx src/components/dashboard/widgets/client-list-widget.tsx tests/unit/components/ops/keyboard-shortcuts.test.tsx
git commit -m "refactor(dashboard,shortcuts): last client-create entries straight onto the window

Cmd+Shift+C and the client-widget New Client button now open the
workspace create window directly instead of routing through the
/clients/new redirect (double-hop). The route itself stays — it is the
compatibility hand-off onto the /dashboard?openClient=new deep link the
layout already parses for agent action-cards. Store untouched: the
client-workspace:new singleton already refocuses on repeat opens. New
unit test pins shortcut -> window dispatch, singleton refocus, and the
editable-element guard."
```

### Task 4 — Verification gate (evidence, not claims), then docs

1. `npx tsc --noEmit` → exactly the 7 pre-existing errors (xlsx + notification-service), zero new.
2. `npx eslint` on the three touched/created files → 0 errors.
3. Targeted vitest (Task 3 Step 4 set) → green; also `npx vitest run tests/unit/navigation/route-registry.test.ts` (proves you didn't disturb it).
4. Live pass — dev server with dev bypass as owner (`NEXT_PUBLIC_DEV_BYPASS_AUTH=true` flow via `auth-provider`/`dev-bypass-banner`; already wired in `.env.local`), 1600×900:
   a. ⌘⇧C on the dashboard → client create window opens **with no route change/flicker** (URL stays put);
   b. second ⌘⇧C → same window refocuses, no duplicate;
   c. widget "New Client" + → window opens; repeat → refocus;
   d. ⌘⇧C while typing in any input → nothing;
   e. cold-load `/clients/new` → still lands on `/dashboard` with the create window open (regression check on the untouched route);
   f. 0 console errors throughout.
5. Write `docs/plans/2026-07-04-clients-create-entry-consistency.md` (this plan, verbatim). Append to `docs/design/2026-06-29-table-unification/DECISION.md` (at EOF; in World A the ROUTE CONSOLIDATION §§ from follow-up #1 won't exist in your file — append yours standalone at EOF anyway) a section headed:

`## ROUTE CONSOLIDATION — 2026-07-04 (follow-up #2: /clients/new create entries)`

covering, in the file's established voice: the two repoints; route + layout handler untouched (the `?openClient=new` deep link is the contract — agent action-cards already build `/dashboard?openClient=<id>`); no email links exist to `/clients/new` (grep-verified) so the route is a compatibility redirect, kept; the settled idiom grammar (routes = thin hand-offs, in-app = direct store calls, params parsed once in the layout; mechanisms deliberately not flipped); gate NOT applied (dispatch docstring precedent); `/tasks/new` remains the filed follow-up; your actual gate numbers + live evidence + commit hashes (fill with REAL results — no placeholders may survive); "NOT pushed". In World A also note: expected trivial both-add conflict on this file with `feat/projects-new-consolidation` and `claude/wizardly-shannon-dc59fe` — resolve keep-both, plus the keyboard-shortcuts/client-list-widget resolutions per the plan appendix.

6. Commit docs (staged by name):
```bash
git add docs/plans/2026-07-04-clients-create-entry-consistency.md docs/design/2026-06-29-table-unification/DECISION.md
git commit -m "docs(web-overhaul): log the /clients/new create-entry consistency pass"
```
7. STOP. Report outcomes with evidence (gate outputs, live observations). Do not push/merge/PR.

---

## Appendix — merge-order conflict map (World A only)

`feat/projects-new-consolidation` (unmerged, commits `6b0c207c`/`7d84d746`/`c6e20803`/`f8363615`/`ddd88e3a`) touches two of the same files. Whoever merges second resolves; final-truth state:

- **keyboard-shortcuts.tsx docstring:** take the sibling's P line (`New project (opens the workspace create window in place)`), OUR C line (`New client (opens the workspace create window in place)`), the sibling's Cmd+B deletion.
- **keyboard-shortcuts.tsx imports/switch:** both sides add the identical `useWindowStore` import (keep one); `case "p"` body = sibling's (openProjectWindow), `case "c"` body = ours (openClientWindow).
- **client-list-widget.tsx:** keep both selectors (`openProjectWindow` from the sibling, `openClientWindow` from ours) + the single shared import; both comments.
- **DECISION.md:** both-add at EOF — keep both sections, date order (follow-up #1 2026-07-03 before follow-up #2 2026-07-04).

---

## Execution record (2026-07-04)

**Base:** branched `chore/clients-create-entry-consistency` off `origin/main` @ `2468d8b6` (advanced past the plan's `9583c129` reference; re-verified facts held). **Task 0 base re-check → World A** (`openProjectWindow` count in `keyboard-shortcuts.tsx` = 0; sibling `feat/projects-new-consolidation` unmerged). Edits applied exactly as written.

**Commits (this branch, NOT pushed):**
- `0622f3f2` — `refactor(dashboard,shortcuts): last client-create entries straight onto the window` (the two repoints + new unit test)
- docs commit — `docs(web-overhaul): log the /clients/new create-entry consistency pass`

**Gates:**
- `tsc --noEmit` → 7 pre-existing errors only (5 × xlsx module/type-args, 2 × notification-service test), zero in touched files, zero new.
- `eslint` on the 3 touched/created files → **0 errors** (1 pre-existing `useScrollFadeScroll` unused-var warning on `client-list-widget.tsx:16`, identical on `origin/main`, untouched by this change).
- `vitest` → new `keyboard-shortcuts.test.tsx` 3/3; targeted set (keyboard-shortcuts + window-store + quick-actions/dispatch + create-cluster) 36/36; adding `route-registry.test.ts` → 76/76 across 5 suites (proves the registry was not disturbed).

**Live pass** (dev-bypass as PETE via a worktree-local `.env.local` — the plan's "already wired" assumption did not hold: `.env.local` is absent from the worktree and even the main checkout lacked the two bypass flags, so they were added locally for the run and the file + `.claude/launch.json` were removed afterward; opening a create window mutates nothing server-side). 1600×900, Turbopack dev on :3000:
- **(a)** ⌘⇧C on the dashboard → NEW CLIENT create window opens in place (`// CLIENT — ● CREATING`); URL stayed `http://localhost:3000/dashboard` before and after (no route hop). Screenshot captured.
- **(b)** second ⌘⇧C → still exactly one window (one `CREATING` badge in the DOM, same position — singleton refocus, no duplicate).
- **(c)** the client-list widget "New Client" + button → create window opens, URL unchanged; clicking the second widget's + with a window already open → still exactly one window (both entry points target the `client-workspace:new` singleton).
- **(d)** ⌘⇧C dispatched from a focused search `<input>` → zero windows (editable-element guard preserved).
- **(e)** cold-load `/clients/new` → redirected to `/dashboard`, `openClient=new` query param stripped (`location.search === ""`), create window open — the untouched route + layout handler still honor the deep-link contract. Network trace showed `GET /dashboard?openClient=new → 200` then `GET /dashboard → 200`.
- **(f)** zero console **errors** throughout. The "failed" network requests were exclusively external hosts the preview sandbox blocks by policy (Adobe Typekit, Google Analytics/ads, Carto map tiles) plus benign Next.js RSC-prefetch aborts — none application errors, none from this change.

**NOT pushed / merged / PR'd.** Merging ops-web `main` auto-deploys prod.

# Toast Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Read `2026-07-09-web-polish-README.md` in this directory FIRST — workspace, skills, verification, and commit rules live there.

**Goal:** One toast system. Every transient notification in OPS-Web renders through the tokenized Sonner wrapper — same surface, same status rail, same motion — and raw-`sonner` imports become impossible to reintroduce.

**Architecture:** The canonical system already exists: `src/components/ui/toast.tsx` (Sonner wrapper, glass-dense, 3px status rail via `globals.css` `[data-type]` selectors, mounted once in `src/app/layout.tsx`). This plan (a) routes all imports through the wrapper, (b) migrates the four outlier popup systems onto it, (c) fixes dead inbox undo toasts, (d) i18n's hardcoded toast copy in connectivity + schedule surfaces, (e) adds a lint guard + removes unused toast deps.

**Tech Stack:** Next.js 15, sonner, Framer Motion (`EASE_SMOOTH`), vitest.

**Design System:** `.interface-design/system.md` + `ops-design-system/project/DESIGN.md`. Toasts = `.glass-dense`, `rounded-modal`, no shadow; rails: olive success / rose error / tan warning / accent info.

**Required Skills:** `ops-design`, `frontend-design:frontend-design`, `ops-copywriter:ops-copywriter` (copy tasks), `animation-studio:animation-architect` + `web-animations` (undo-toast motion), `custom-skills:audit-design-system`.

**Explicitly out of scope:** `src/app/(dashboard)/schedule/` UI beyond the string-table edits in Task 6 (a sibling session is reworking that area on another branch — keep the diff surface minimal); `catalog-setup/offline-banner.tsx` (it is an inline wizard banner, not a toast — correct as-is).

---

### Task 1: Route every raw `sonner` import through the wrapper

**Files:** ~90 files import `{ toast } from "sonner"` (grep `from "sonner"` under `src/`, excluding `src/components/ui/toast.tsx` itself).

**Step 1:** `grep -rln 'from "sonner"' src --include="*.ts" --include="*.tsx" | grep -v "components/ui/toast.tsx"` — capture the list.

**Step 2:** Mechanical rewrite in each: `import { toast } from "sonner"` → `import { toast } from "@/components/ui/toast"`. Some files import types (`type ExternalToast`) — those stay from `"sonner"`? No: re-export what's needed. If any file imports anything beyond `toast` (e.g. `Toaster`), route it through the wrapper too; extend the wrapper's exports if a needed symbol isn't re-exported yet (e.g. `export type { ExternalToast } from "sonner"`).

**Step 3:** `npx tsc --noEmit` → clean.

**Step 4:** Add the guard — in `eslint.config.mjs` (or `.eslintrc.*`, whichever this repo uses — check root):
```js
"no-restricted-imports": ["error", {
  paths: [{ name: "sonner", message: "Import { toast } from \"@/components/ui/toast\" — the tokenized wrapper — never raw sonner." }],
}]
```
with an override allowing `src/components/ui/toast.tsx`. Verify the rule actually fires: temporarily add a raw import, run eslint on that file, see the error, revert. (CI lint is red for unrelated reasons; this rule is a local guard.)

**Step 5:** Commit: `refactor(toast): route all sonner imports through the tokenized wrapper + lint guard`

### Task 2: Shared undo toast on the canonical system

The two custom undo toasts (`pipeline-undo-toast.tsx`, `projects-undo-toast.tsx` — near-identical `glass-dense absolute bottom-3 left-3` divs) and the unstyled widget helper (`widget-action-toast.tsx` — bare `toast(label,{action})`, no rail) become ONE helper.

**Files:**
- Create: `src/components/ui/toast-undo.tsx`
- Modify: `src/app/(dashboard)/pipeline/_components/table/pipeline-table-shell.tsx:843` area, `src/app/(dashboard)/projects/_components/table-v2/projects-table-shell.tsx:637` area
- Delete: `src/app/(dashboard)/pipeline/_components/table/pipeline-undo-toast.tsx`, `src/app/(dashboard)/projects/_components/table-v2/projects-undo-toast.tsx`
- Modify: `src/components/dashboard/widgets/shared/widget-action-toast.tsx`
- Test: `tests/unit/` — colocate per existing convention (check how `tests/` is organized for components; follow it)

**Step 1:** Read both undo-toast components + their call sites fully. Inventory behavior that must survive: entry describing the mutation, UNDO button, DISMISS, 10s auto-dismiss paused on hover/focus, `role="status"`, bulk-entry copy (projects), keyboard access.

**Step 2 (failing test):** Test that `showUndoToast({ title, description, onUndo, duration })` calls the wrapper's `toast()` with an action labeled UNDO and the given duration (mock `@/components/ui/toast`).

**Step 3:** Implement `showUndoToast` in `toast-undo.tsx` on the canonical `toast()` API:
```tsx
import { toast } from "@/components/ui/toast";

export function showUndoToast({ title, description, onUndo, undoLabel, duration = 10_000 }: {
  title: string; description?: string; onUndo: () => void | Promise<void>;
  undoLabel: string; duration?: number;
}) {
  return toast(title, {
    description,
    duration,
    action: { label: undoLabel, onClick: () => void onUndo() },
  });
}
```
Sonner gives hover-pause, stacking, a11y (`role="status"`), Esc dismissal, and the tokenized surface for free. Check the installed sonner version's `action` API signature in `node_modules/sonner/dist/index.d.ts` before writing.

**Step 4:** Replace the two table call sites with `showUndoToast(...)`, sourcing all strings from the existing dictionary keys those components used (keep the keys; move them if they live in component-local constants). Delete the two component files and their imports/state wiring (the `undoEntry` state stays — it drives the undo mutation — only the presentation moves).

**Step 5:** Rework `widget-action-toast.tsx` to delegate to `showUndoToast` (keeps its 30s default), so widget undos gain the standard styling/rail.

**Step 6:** Run the test + tsc. Preview: `/projects` table → archive a project → toast appears top-right, tokenized, UNDO works and restores the row. Screenshot. Same spot-check on `/pipeline` table mode (bulk stage change) if data allows; else state what couldn't be exercised.

**Step 7:** Commit: `refactor(toast): one undo toast on the canonical system; retire bespoke pipeline/projects undo divs`

### Task 3: Fix the dead inbox undo toasts

`src/components/ops/inbox/undo-toast.tsx` is an event-bus + `<UndoToastHost>` portal that is **never mounted** — every `enqueueUndoToast()` in the inbox renders nothing.

**Files:**
- Modify: `src/components/ops/inbox/inbox-route.tsx:680,689,871,1565`, `src/components/ops/inbox/snooze-picker.tsx:176`, `src/components/ops/inbox/recategorize-menu.tsx:98`
- Delete: `src/components/ops/inbox/undo-toast.tsx` + `src/components/ops/inbox/__tests__/undo-toast.test.tsx`

**Step 1:** Read each call site; map `enqueueUndoToast(...)` args onto `showUndoToast(...)`. Preserve the message + undo callback exactly. The `z`-shortcut behavior dies with the bus — acceptable: it never worked in production (host unmounted), and Sonner's action button is keyboard-reachable. Note this in the commit body.

**Step 2:** Replace call sites, delete the dead module + its test, tsc clean.

**Step 3:** Preview spot-check if the inbox route is reachable in dev (`/inbox` — the UI is shelved; if the route 404s or is flag-gated, verify by unit test + code review and say so).

**Step 4:** Commit: `fix(inbox): undo toasts render again — replace unmounted event-bus host with canonical toast`

### Task 4: Connectivity toast copy → dictionary + OPS voice

**Files:**
- Modify: `src/lib/hooks/use-connectivity.ts:19,24`
- Modify: `src/i18n/dictionaries/en/common.json` + `es/common.json` (verify namespace — pick the one the top-bar already uses; check `useDictionary` usage in `top-bar.tsx`)

**Step 1:** Load `ops-copywriter`. Replace hardcoded strings with dictionary lookups. Copy (EN):
- online: title `BACK ONLINE` (no description)
- offline: title `OFFLINE`, description `Changes sync when connection is restored.`
Note: `use-connectivity.ts` is a hook used by `top-bar.tsx` — confirm it can call `useDictionary` (it's a client hook; if the toast fires outside component context, pass `t` in or read the dictionary module directly per existing non-component i18n patterns — grep for how services do it).

**Step 2:** ES translations in the same keys. tsc + preview (toggle `preview_eval`: `window.dispatchEvent(new Event("offline"))` then `"online"`) → screenshot both toasts.

**Step 3:** Commit: `fix(connectivity): tokenized dictionary copy for online/offline toasts`

### Task 5: Schedule toast copy → dictionary (strings only, minimal diff)

**Files:**
- Modify: `src/app/(dashboard)/schedule/_components/schedule-dnd-shell.tsx` (:215,:226,:308,:335,:446,:508,:526), `src/app/(dashboard)/schedule/_components/use-schedule-resize.ts` (:58,:70), `src/app/(dashboard)/schedule/_components/event-context-menu.tsx` (:145,:151,:167,:171,:199,:203,:219,:223,:245,:249,:261,:265)
- Modify: `src/i18n/dictionaries/{en,es}/calendar.json` (this is the schedule page's namespace — verify via the `useDictionary(...)` call already in those files; `task-detail-panel.tsx` already uses `panel.*` keys there — follow its exact pattern)

**Step 1:** For each hardcoded string, add a key under a `toast.*` group in the dictionary (both languages) and swap the literal for `t("toast.key")`. Keep messages terse/tactical (`Comment posted` → keep sentence case content; errors name the thing: `Failed to move task`). Touch ONLY the toast lines — no refactors in these files (sibling-session conflict risk).

**Step 2:** tsc; preview drag a task on `/schedule` if seed data allows → screenshot a schedule toast proving same visual system as connectivity toast. If no draggable data exists, trigger `toast.error` copy via a forced failure path or verify by code review — state which.

**Step 3:** Commit: `fix(schedule): toast copy through i18n dictionaries`

### Task 6: Remove unused toast dependencies

**Files:** `package.json` (+ lockfile)

**Step 1:** Confirm zero imports: `grep -rn "react-hot-toast\|@radix-ui/react-toast" src/` → empty.
**Step 2:** Remove both deps from `package.json`. Do NOT run `npm install` to regenerate the lockfile if the lockfile is shared via symlinked node_modules — check: node_modules is a symlink to the primary checkout, so **do not mutate it**. Edit `package.json` only and note in the commit that the lockfile refresh happens on next install. Verify the dev server still runs (deps removed were unused).
**Step 3:** Commit: `chore(deps): drop unused react-hot-toast and @radix-ui/react-toast`

### Task 7: Final audit + evidence

Run `custom-skills:audit-design-system` over touched files. Assemble screenshots in `docs/artifacts/web-polish-2026-07-09/toast-unification/`. Final commit if the audit forced fixes.

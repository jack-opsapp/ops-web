# Bug-Report Element Picker — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task. Before any UI task load `ops-design` (read `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md` first), `frontend-design:frontend-design`, `custom-skills:interface-design`; before the overlay/highlight motion load `animation-studio:animation-architect` then `animation-studio:web-animations` (the plan fixes every duration/easing — implement, don't redesign); before writing any string load `ops-copywriter:ops-copywriter`; run `custom-skills:audit-design-system` before declaring Tasks 4–6 and 9 done. Use `superpowers:test-driven-development` throughout.

**Goal:** Let any operator point at the on-screen element a bug is about, so the report carries that element's identity and a cropped screenshot of it, and the admin sees both at a glance.

**Architecture:** A portaled capture overlay above the whole app resolves the hovered element with `document.elementsFromPoint`, highlights it, and on select builds an `ElementReference` (pure helpers) plus a canvas-cropped PNG from a fresh `modern-screenshot` capture. The drawer holds up to three references, sends them in `custom_metadata.elementReferences`, and uploads crops through the existing screenshot route (extended with `kind=element&index=n`) into `additional_attachments`. The admin detail renders a structured ELEMENTS section.

**Tech Stack:** Next.js 15 App Router, React 18, TypeScript, Tailwind (OPS tokens), Framer Motion (existing drawer), `modern-screenshot`, Zustand (existing stores), Vitest + Testing Library (jsdom), S3 via existing `@/lib/s3/client`.

**Design System:** `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md` (law) + project Tailwind tokens. Spec: `docs/superpowers/specs/2026-08-31-bug-report-element-picker-design.md`.

**Required Skills:** `custom-skills:executing-plans`, `superpowers:test-driven-development`, `ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `animation-studio:animation-architect`, `animation-studio:web-animations`, `ops-copywriter:ops-copywriter`, `custom-skills:audit-design-system`.

**Checkout:** `/Users/jacksonsweet/Projects/OPS/ops-web-element-picker`, branch `feat/bug-report-element-picker` (cut from origin/main 7bafb2f9). Own `node_modules` (npm ci done). Single executor, tasks in order. Single-file `npx vitest run <file>` only; no builds, no dev servers (PM runs the build and the live verification).

---

## Ground truth (read these before Task 1 — verified by the planner)

- `src/components/ops/bug-report-drawer.tsx` — the drawer. Form state resets in an effect keyed on `open` (line ~214): picking must NOT close the drawer. Outside-click dismiss (line ~168) and Esc-close (line ~198) both must be suspended while picking. Screenshot capture uses `modern-screenshot` `domToBlob(document.body, { filter })` excluding `data-bug-report-ignore="true"` and `data-edge-tab="bug-report"` nodes (line ~126). Submit (line ~228) calls `BugReportService.createReport({... customMetadata ...})` then best-effort uploads the screenshot to `/api/bug-reports/screenshot` with `FormData{file, reportId, companyId}` + Firebase bearer.
- `src/lib/api/services/bug-report-service.ts` — `createReport` input already accepts `customMetadata` and `additionalAttachments: string[]` (row mapping lines ~168-170).
- `src/app/api/bug-reports/screenshot/route.ts` — auth (Firebase/Supabase token → `users` row → company match → report reporter match), S3 key `bug-reports/{companyId}/{reportId}/screenshot.{ext}`, stores `s3:`-prefixed key into `screenshot_url`. 8MB max, png/jpeg.
- `src/app/admin/feedback/_components/feedback-content.tsx` — `BugReportDetail` (line ~484): two-column grid; right column SCREENSHOT presigns via `GET /api/admin/bug-reports/screenshot?path=<stored value>`; METADATA section dumps `custom_metadata` JSON.
- DB (verified live): `bug_reports.custom_metadata jsonb`, `additional_attachments text[]` (`_text`), `screenshot_url text`. **No migration in this plan.**
- i18n: `src/i18n/dictionaries/{en,es}/common.json` use FLAT dotted keys (`"bugReport.category.bug": "…"`). Add `bugReport.picker.*` the same way.
- `src/components/layouts/dashboard-layout.tsx` mounts `<BugReportDrawer />` and `<CreateCluster />` (the cluster carries `data-bug-report-ignore`). The overlay is portaled from inside the drawer — no layout change.
- Z-index scale (ops-web `CLAUDE.md` § Z-Index Scale; bible `05_DESIGN_SYSTEM.md` § 15): modals 3000, map-controls 5000, emergency 9000. This plan adds **picker 8000**.
- Motion rule: single easing `cubic-bezier(0.22, 1, 0.36, 1)`; honor `prefers-reduced-motion` (`useReducedMotion` already used in the drawer). No backdrop-filter on full-viewport layers (known dashboard flicker).

---

### Task 1: The `ElementReference` type

**Files:**
- Create: `src/lib/types/bug-report-element.ts`

**Step 1: Write the type (no test — pure declaration).**

```ts
/** A user-selected on-screen element attached to a bug report (custom_metadata.elementReferences). */
export interface ElementReference {
  id: string;
  label: string;
  role: string;
  tag: string;
  selector: string;
  classes: string;
  testId: string | null;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  page: { x: number; y: number };
  viewport: { width: number; height: number };
  componentChain: string[];
  capturedAt: string;
  attachmentIndex: number | null;
}

export const MAX_ELEMENT_REFERENCES = 3;
export const ELEMENT_CROP_PADDING_PX = 24;
```

**Step 2: Commit**
```bash
git add src/lib/types/bug-report-element.ts
git commit -m "feat(bug-report): add the element reference contract (1f2bf7e9)"
```

---

### Task 2: Pure helpers — describe, select, pickability (TDD)

**Skills:** `superpowers:test-driven-development`.

**Files:**
- Create: `src/lib/utils/element-reference.ts`
- Test: `src/lib/utils/__tests__/element-reference.test.ts` (jsdom — check the repo's vitest config picks `__tests__` under `src/lib/utils`; `src/lib/utils/__tests__/pipeline-table-adapter.test.ts` proves it does)

**Step 1: Write the failing tests.** Cover, with real DOM fixtures built via `document.body.innerHTML`:
1. `describeElement(el)` label precedence: aria-label → visible text (trimmed, ≤60, whitespace-collapsed) → placeholder → alt → title → tag name; `role` explicit else implicit (`button`, `a[href]→link`, `input[type=text|email|search|url|tel]→textbox`, `input[type=checkbox]→checkbox`, `input[type=radio]→radio`, `select→combobox`, `textarea→textbox`, else `generic`); `text` = innerText ≤120 (jsdom lacks innerText — implement with `textContent` fallback and test that).
2. `buildStableSelector(el)`: prefers `[data-testid="…"]`, then `#id` (only if id has no digits-only/random-looking pattern — keep simple: any id that is not a pure number and ≤ 40 chars), then `[aria-label="…"]`, then `tag:nth-of-type(n)`; climbs to at most 6 levels; stops early at a `data-testid`/`#id` anchor; never emits utility classes. Assert `document.querySelector(selector) === el` for each fixture.
3. `isPickable(el)`: false for `html`, `body`, elements with zero width/height (`getBoundingClientRect` stubbed), elements inside a `[data-bug-report-ignore="true"]` ancestor, the overlay root (`[data-element-picker-root]`); SVG descendants resolve via `resolvePickTarget(el)` to the nearest `HTMLElement` ancestor; an `<iframe>` is pickable as itself.
4. `readComponentChain(el)` returns `[]` when no `__reactFiber$…` key exists (jsdom), and — with a hand-built fake fiber chain `{ type: function Named(){}, return: … }` — returns the nearest ≤3 named function/class component names, skipping host components and anonymous functions.
5. `pickFromPoint(x, y, doc)`: given `doc.elementsFromPoint` stubbed to return `[overlayChild, target, body, html]`, returns `target`; returns `null` when only ignored nodes remain.
6. `computeCropRect(rect, viewport, padding, scale)` — pads by 24 on every side, clamps to the viewport, multiplies by scale, rounds to integers; asserts on a rect touching the top-left corner and one overflowing bottom-right.

**Step 2: Run to confirm failure:** `npx vitest run src/lib/utils/__tests__/element-reference.test.ts` → FAIL (module missing).

**Step 3: Implement** `element-reference.ts` exporting `describeElement`, `buildStableSelector`, `isPickable`, `resolvePickTarget`, `readComponentChain`, `pickFromPoint`, `computeCropRect`, and `buildElementReference(el, { now, id })` composing them (rect via `getBoundingClientRect`, page = rect + `window.scrollX/Y`, viewport = `innerWidth/Height`). No DOM mutation, no side effects.

**Step 4: Run to green.** Same command → PASS.

**Step 5: Commit**
```bash
git add src/lib/utils/element-reference.ts src/lib/utils/__tests__/element-reference.test.ts
git commit -m "feat(bug-report): describe, locate and crop-size a picked element (1f2bf7e9)"
```

---

### Task 3: Crop capture helper (TDD, mocked capture)

**Files:**
- Modify: `src/lib/utils/element-reference.ts` (add `captureElementCrop`)
- Test: extend `src/lib/utils/__tests__/element-reference.test.ts`

**Step 1: Failing test.** `captureElementCrop(el, { capture, scale })` where `capture` is an injected `(root: HTMLElement, opts) => Promise<Blob>` (the drawer passes `modern-screenshot`'s `domToBlob` wrapped with the same ignore filter). Assert: it calls `capture(document.body, …)` once; draws the returned image onto a canvas sized to `computeCropRect(...)` (stub `createImageBitmap`/`Image` + `HTMLCanvasElement.prototype.getContext` — jsdom has no canvas; mock `getContext` returning a `drawImage` spy and `toBlob` invoking its callback with a Blob); resolves with `{ blob, cropRect }`; rejects (does not swallow) when `capture` throws.

**Step 2: Run → FAIL.** **Step 3: Implement.** Use `createImageBitmap(blob)` when available, else an `Image` with an object URL (revoke after). Canvas `drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh)`; export PNG via `canvas.toBlob`. **Step 4: Run → PASS.**

**Step 5: Commit**
```bash
git add src/lib/utils/element-reference.ts src/lib/utils/__tests__/element-reference.test.ts
git commit -m "feat(bug-report): crop a fresh page capture to the picked element (1f2bf7e9)"
```

---

### Task 4: The overlay component (TDD)

**Skills:** `ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `animation-studio:animation-architect` + `animation-studio:web-animations`, `ops-copywriter:ops-copywriter`, `custom-skills:audit-design-system`.

**Files:**
- Create: `src/components/ops/bug-report-element-picker.tsx`
- Test: `src/components/ops/__tests__/bug-report-element-picker.test.tsx`
- Modify: `src/i18n/dictionaries/en/common.json`, `src/i18n/dictionaries/es/common.json` (flat keys: `bugReport.picker.select`, `bugReport.picker.max`, `bugReport.picker.hint`, `bugReport.picker.keys`, `bugReport.picker.cancel`, `bugReport.picker.capturing`, `bugReport.picker.chip`, `bugReport.picker.remove`, `bugReport.picker.dialogLabel`)

**Design tokens:** overlay root `position:fixed; inset:0; z-index: 8000` (use a named constant `Z_PICKER = 8000` exported from the component; the bible/CLAUDE.md row lands in Task 10); wash `rgba(0,0,0,0.35)` painted (NO backdrop-filter); `cursor: crosshair`; highlight box `outline: 1px solid var(--text-2)`, `background: rgba(255,255,255,0.05)`, `border-radius` = chip (4px) — Tailwind `rounded-chip`; label pill and hint pill: `bg-glass-dense`, `border border-line`, `rounded-chip`, `font-mono text-[10px] uppercase tracking-wider text-text-2`, left-aligned; selection flash: `outline-color: var(--ops-accent)` for 150ms. Copy from the spec, through `useDictionary("common")`.

**Motion (fixed — implement exactly):** overlay opacity 0→1 in 150ms `cubic-bezier(0.22,1,0.36,1)` (Framer Motion, matches the drawer's `EASE_SMOOTH`); highlight box driven by `requestAnimationFrame` on pointer/focus moves, CSS `transition: transform 120ms, width 120ms, height 120ms` same curve; flash 150ms; `useReducedMotion()` → all durations 0. GPU-friendly: position the box with `transform: translate3d(x,y,0)` + width/height; `will-change: transform`.

**Step 1: Failing tests** (Testing Library, `document.elementsFromPoint` stubbed per test):
1. Renders into `document.body` via portal with `data-element-picker-root` and `data-bug-report-ignore="true"`, `role="dialog"`, `aria-modal="true"`, `aria-label` = picker dialog label.
2. `pointermove` over a target → highlight box appears with the target's rect and the label pill reads `button · Save`.
3. `click` → `onSelect` called once with `{ element, reference }` where `reference.label === "Save"` and `reference.attachmentIndex === null`; capture uses the injected `captureCrop` prop; while capturing, the hint reads the capturing copy and pointer input is ignored.
4. `Escape` → `onCancel` once, `onSelect` never.
5. Keyboard: `Tab` moves focus natively (jsdom: dispatch `focusin` on a focusable target) → highlight follows `document.activeElement`; `Enter` selects it.
6. Touch: `touchstart` highlights, `touchend` selects.
7. Elements under a `[data-bug-report-ignore]` ancestor are never highlighted or selectable (stub `elementsFromPoint` to return only such nodes → no highlight, click is a no-op).

**Step 2: Run → FAIL.** `npx vitest run src/components/ops/__tests__/bug-report-element-picker.test.tsx`

**Step 3: Implement.** Props: `{ open: boolean; onSelect(result: { element: HTMLElement; reference: ElementReference; crop: Blob | null }): void; onCancel(): void; captureCrop(el: HTMLElement): Promise<Blob | null> }`. Internals: portal (`createPortal` to `document.body`); listeners on the overlay root for `pointermove`/`click`/`touchstart`/`touchend`, and on `document` for `keydown` (Esc/Enter) and `focusin` — all removed on close. Hit-test via `pickFromPoint` (Task 2) — the overlay is `pointer-events: auto` and `elementsFromPoint` sees through it because the helper skips the overlay subtree. Highlight state in a ref + rAF; label pill flips below the rect when it would clip the top edge. On select: freeze highlight, flash, `await captureCrop(el)` (errors → `null`, never throw), build reference, call `onSelect`. Body `overflow` untouched (scrolling while picking is allowed and the highlight re-measures on `scroll`).

**Step 4: Run → PASS.** **Step 5: audit-design-system** on the file → zero hardcoded color/spacing/radius/font values outside the two documented rgba tokens (`rgba(0,0,0,0.35)` wash and `rgba(255,255,255,0.05)` fill — register them as the picker's tokens in a top-of-file comment; if a matching Tailwind token exists — `bg-surface-hover` is `rgba(255,255,255,0.05)` — use it).

**Step 6: Commit**
```bash
git add src/components/ops/bug-report-element-picker.tsx src/components/ops/__tests__/bug-report-element-picker.test.tsx src/i18n/dictionaries/en/common.json src/i18n/dictionaries/es/common.json
git commit -m "feat(bug-report): overlay to pick an on-screen element (1f2bf7e9)"
```

---

### Task 5: Drawer integration — state, action, chips (TDD)

**Skills:** `ops-design`, `frontend-design:frontend-design`, `ops-copywriter:ops-copywriter`, `custom-skills:audit-design-system`.

**Files:**
- Modify: `src/components/ops/bug-report-drawer.tsx`
- Test: `tests/unit/ops/bug-report-drawer-element-picker.test.tsx` (find the drawer's existing test harness — grep `bug-report-drawer` under `tests/` and `src/**/__tests__`; model mocks on it: edge-tab store open, auth store user, dictionary, `modern-screenshot` mocked, `BugReportService.createReport` mocked, `fetch` mocked)

**Design tokens:** the action and chips reuse the drawer's chip language exactly (`px-2 py-1 rounded-chip border font-mono text-[10px] uppercase tracking-wider`, `border-[rgba(255,255,255,0.08)] text-text-mute hover:text-text-2`); chip thumbnail 28×28, `rounded-chip`, `border border-line`, `object-fit: cover`; remove control = the lucide `X` at 12px inside a 20px hit box, `aria-label` from `bugReport.picker.remove`.

**Step 1: Failing tests:**
1. The `[ SELECT ELEMENT ]` action renders for a non-power user AND a power user, in the auto-capture block.
2. Clicking it sets picking mode: the drawer `aside` gets `data-picking="true"` and inline `opacity: 0; pointer-events: none`; the picker overlay is rendered (`[data-element-picker-root]`).
3. While picking, a `mousedown` outside the drawer does NOT close it (edge-tab `close` not called) and `Escape` does NOT close it.
4. `onSelect` from the picker → a chip `ELEMENT :: Save` with thumbnail renders; picking mode exits; focus returns to the action.
5. Three references → action disabled with `[ MAX 3 ELEMENTS ]`; remove control drops one and re-enables.
6. Submit with two references: `createReport` receives `customMetadata.elementReferences` of length 2 with `attachmentIndex` 0 and 1 (in order, only for references that have a crop blob; a reference with a `null` crop gets `attachmentIndex: null` and does not consume an index), plus all existing metadata keys unchanged.
7. After `createReport` resolves, the crops upload in index order to `/api/bug-reports/screenshot` with `FormData` fields `file`, `reportId`, `companyId`, `kind=element`, `index=<n>`; a rejected upload is logged (`console.warn`) and the submission still succeeds.
8. Drawer close resets references (the existing reset effect gains `setElementRefs([])`).

**Step 2: Run → FAIL.** `npx vitest run tests/unit/ops/bug-report-drawer-element-picker.test.tsx`

**Step 3: Implement.** State: `elementRefs: Array<{ reference: ElementReference; crop: Blob | null; thumbUrl: string | null }>` and `picking: boolean`. `captureCrop` = `captureElementCrop(el, { capture: (root) => domToBlob(root, sameOptionsAsCaptureScreenshot) })` (extract the existing `domToBlob` options into a shared `buildCaptureOptions()` inside the file so the two captures cannot drift). Object URLs for thumbnails revoked on remove/close. Suspend the outside-click and Esc effects with `if (picking) return;`. Hide the aside while picking with inline style (do not unmount). Render `<BugReportElementPicker open={picking} … />` after the `motion.aside` inside the fragment. Submission: assign `attachmentIndex` immediately before `createReport`, then upload crops sequentially after the main screenshot.

**Step 4: Run → PASS**, then also run the drawer's existing test file(s) — must stay green.

**Step 5: audit-design-system** on the drawer diff (new code only).

**Step 6: Commit**
```bash
git add src/components/ops/bug-report-drawer.tsx tests/unit/ops/bug-report-drawer-element-picker.test.tsx
git commit -m "feat(bug-report): attach picked elements to the report (1f2bf7e9)"
```

---

### Task 6: Upload route — element crops (TDD)

**Files:**
- Modify: `src/app/api/bug-reports/screenshot/route.ts`
- Test: find the route's existing test (grep `bug-reports/screenshot` under `tests/`); extend it, or create `tests/unit/api/bug-report-screenshot-element.test.ts` modeled on the nearest `tests/unit/api/*.test.ts` route harness (mock `@/lib/firebase/admin-verify`, `@/lib/supabase/server-client`, `@/lib/s3/client`).

**Step 1: Failing tests:**
1. `kind=element&index=1` → S3 key `bug-reports/{companyId}/{reportId}/element-1.png`, and the row update sets `additional_attachments` to the existing array with `s3:<key>` placed at index 1 (pad missing lower slots with `null`? No — `text[]` cannot carry NULL cleanly for this use; instead append in arrival order and RETURN the array position; the drawer uploads sequentially so arrival order == index order. Assert the route reads the current array, appends, writes back, and responds `{ success, path, attachmentIndex }`).
2. `index` missing/non-integer/negative/> 9 → 400. `kind` absent → existing screenshot behavior byte-identical (existing tests stay green).
3. Auth/company/reporter checks apply to element uploads exactly as before (reuse — do not duplicate the checks; factor the guard into a local function if the existing code is inline).
4. Supabase backend branch (`STORAGE_BACKEND=supabase`): path `{companyId}/{reportId}/element-{n}.png`, stored without scheme.

**Step 2: Run → FAIL.** **Step 3: Implement** (all writes destructure `{ error }` and surface it — PGRST204 family rule). **Step 4: Run → PASS** + existing route tests green.

**Step 5: Commit**
```bash
git add src/app/api/bug-reports/screenshot/route.ts tests/unit/api/bug-report-screenshot-element.test.ts
git commit -m "feat(bug-report): store element crops as report attachments (1f2bf7e9)"
```

---

### Task 7: Admin detail — ELEMENTS section (TDD)

**Skills:** `ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:audit-design-system`.

**Files:**
- Modify: `src/app/admin/feedback/_components/feedback-content.tsx` (`BugReportDetail`)
- Test: extend the admin feedback component test if one exists (grep `feedback-content` under `tests/`), else create `tests/unit/admin/bug-report-detail-elements.test.tsx`.

**Design tokens:** match the surrounding admin detail (this file uses literal hexes today — do NOT add more; use the same `DetailSection`/`DetailGrid`/`DetailRow` primitives and the file's existing mono/text classes). Thumbnail 96px wide, `rounded`, hairline border. Selector in `font-mono text-[11px]` with a copy button (`navigator.clipboard.writeText`, guarded) labelled `COPY`.

**Step 1: Failing tests:**
1. A report whose `custom_metadata.elementReferences` has two entries renders `ELEMENTS (2)` under SCREENSHOT with, per entry: `role · label`, selector, classes, text snippet, `rect` as `x,y · w×h`, component chain joined with ` › ` (or `—`), and a thumbnail whose `src` came from `GET /api/admin/bug-reports/screenshot?path=<additional_attachments[attachmentIndex]>` (fetch mocked).
2. `attachmentIndex: null` → no thumbnail, `[NO CROP]` placeholder.
3. No references → section absent; METADATA dump unchanged.

**Step 2: Run → FAIL.** **Step 3: Implement** (presign each crop lazily with the same effect pattern as the screenshot; type-guard the metadata shape — never trust it). **Step 4: Run → PASS.** **Step 5: audit-design-system** (new code adds no new literal colors).

**Step 6: Commit**
```bash
git add src/app/admin/feedback/_components/feedback-content.tsx tests/unit/admin/bug-report-detail-elements.test.tsx
git commit -m "feat(admin): show picked elements on bug report detail (1f2bf7e9)"
```

---

### Task 8: Triage payload carries references (verify, then fix only if needed)

**Files:**
- Read: `src/app/api/cron/bug-triage/bug/route.ts`, `src/app/api/cron/bug-triage/backlog/route.ts`, `src/app/api/cron/bug-triage/_lib/*`
- Modify only if the per-bug payload omits `custom_metadata` or `additional_attachments`.

**Step 1:** Read the routes. If the single-bug endpoint returns the full row (it likely selects `*`), record that in the commit body of Task 10's docs commit and skip. If it projects columns and omits either field, add them (test: extend the route's existing test to assert both fields are present).

**Step 2 (only if changed): Commit**
```bash
git add src/app/api/cron/bug-triage/bug/route.ts <test>
git commit -m "fix(bug-triage): include element references in the triage payload (1f2bf7e9)"
```

---

### Task 9: Z-index layer + docs in the checkout

**Files:**
- Modify: `CLAUDE.md` (this checkout) — Z-Index Scale table: add row `| **picker** | 8000 | Bug-report element picker overlay |` between map-controls and emergency. Do not touch `AGENTS.md`.
- Modify: `src/components/ops/bug-report-element-picker.tsx` — ensure `Z_PICKER = 8000` has a comment pointing at the scale.

**Commit**
```bash
git add CLAUDE.md src/components/ops/bug-report-element-picker.tsx
git commit -m "docs(web): register the picker z-index layer (1f2bf7e9)"
```

---

### Task 10: Bible

**Files (separate repo `/Users/jacksonsweet/Projects/OPS/ops-software-bible`, local main):**
- Modify: `05_DESIGN_SYSTEM.md` § 15 (z-index scale) — add the `picker 8000` row.
- Modify: `07_SPECIALIZED_FEATURES.md` — find the bug-report subsection (grep `bug_reports` / `Bug report drawer` / `bug-report-drawer`); add a dated paragraph: element picker behavior, the `ElementReference` contract (fields), storage (`custom_metadata.elementReferences` + `additional_attachments` element crops at `bug-reports/{co}/{rid}/element-{n}.png`), the upload route's `kind=element&index` extension, admin rendering, and the "no migration" note. Match the surrounding voice.

**Commit (bible repo)**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-software-bible && git add 05_DESIGN_SYSTEM.md 07_SPECIALIZED_FEATURES.md && git commit -m "docs(bug-report): document the element picker and its reference contract"
```

---

## PM verification (after the single build)

1. Build: `NODE_OPTIONS=--max-old-space-size=8192 npm run build` in the checkout.
2. Live (preview server + dev bypass, 1300×900 and mobile 390×844): open the reporter → `SELECT ELEMENT` → hover shows the hairline box + `role · name` pill, hint pill bottom-left, crosshair; click the Settings industries grid → accent flash → drawer returns with chip + thumbnail; Esc path; Tab/Enter path; 3-cap; remove; submit → report row shows `elementReferences` in `custom_metadata` and `additional_attachments` has `s3:` element keys; admin detail shows ELEMENTS with thumbnails. Screenshots to `docs/artifacts/bug-report-element-picker/`.
3. Reduced-motion: emulate → no transitions.
4. Close bug `1f2bf7e9` with the evidence; note the feature in the debrief.

## Risks

- `document.elementsFromPoint` returns the overlay first — the helper must skip the overlay subtree, not toggle `pointer-events` (toggling flickers the cursor).
- Fresh full-body capture on select costs ~300–800ms on big pages — the capturing state exists for this; never capture on hover.
- Utility-class churn makes class strings noisy but greppable; the structural selector is the stable anchor.
- Production React builds minify component names — `componentChain` is documented as best-effort and often empty.

# Pipeline Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Read `2026-07-09-web-polish-README.md` in this directory FIRST.

**Goal:** Denser kanban cards; "Connect email" (not Gmail-only) with standardized toast feedback; a written audit of the lead detail window for Jackson (NO layout rebuild — he wants human review before that changes).

**Context from prior plans (verify via `git log`):** toolbar plan already converged pipeline filters to chips + deleted the orphaned focused toolbar; metrics plan made strip cells flip.

**Tech Stack:** Next 15, TanStack Query, dnd-kit (cards drag — do not break handle semantics), Framer Motion.

**Required Skills:** `ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `ops-copywriter` (banner copy), `custom-skills:audit-design-system`.

---

### Task 1: Kanban card density

**Files:**
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-card-content.tsx` (comfortable branch :191-329, `Metric` helper :794-803)
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-focused-card.tsx` (:88-163 wrapper + handle)

**Current bulk (verified):** 48px (`w-12`) drag-handle rail, three stacked full-width text rows (title / client / address), a 3-column × 2-line metric grid behind a top border, then a full actions row.

**Step 1:** Read both files completely (inline editors, action row, drag wiring, `density` prop consumers — the compact branch and mobile card must keep working).
**Step 2:** Restructure the comfortable branch:
- **Handle rail:** `w-12` → `w-5`; the dot-grid glyph shrinks to a 2×3 dot column, centered; hit target stays the full rail height (cursor-grab region preserved for dnd-kit — keep the same `{...listeners}` element so drag UX is unchanged).
- **Line 1:** title (InlineTitleEditor) + days-in-stage right-aligned as `font-mono text-micro text-text-3` (e.g. `4D`) — the stage name itself is redundant ON the card (the column IS the stage): drop the stage/daysInStage metric block, keep only the day count. If `daysInStage` drives an attention tone (read the code — e.g. stale > X days → tan), keep that tone on the count.
- **Line 2:** client · address merged on one truncating line (`font-mono text-micro text-text-3`; separator `·` in `text-text-mute`). Both inline editors survive — they become spans within the row (verify editors tolerate inline layout; if InlineAddressEditor needs a block, keep two lines but at `text-micro` and no `py` padding).
- **Metrics:** the email + follow-up signals compress into one mono micro line (icons 12px + counts), only rendering the signals that exist: `✉ 3 · 2D AGO · FLW 07/12` style — exact glyph/format per `data-visualization` judgment against the dictionary's existing labels; NO empty placeholders (a card with no email history shows nothing there).
- **Actions row (`PipelineCardActions`):** render on hover/focus-within only (`opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150`), absolute bottom overlay or collapsed-height reveal — pick whichever avoids layout shift; reduced-motion: always visible. Keyboard users: focus-within shows it, actions stay tabbable.
- Main column padding: `px-2.5 py-2.5` → `px-2.5 py-2`, `gap-1.5` → `gap-1`.
**Step 3:** Target: comfortable card ≤~88px when signals exist (vs ~150px+ today), measured via `preview_inspect`. Column shows ≥6 cards at 900px height.
**Step 4:** tsc; preview `/pipeline` focused mode: drag a card between stages (dnd intact), inline title/client/address edit still work, actions appear on hover, nothing overflows at narrow column widths (`preview_resize` 1280×800). Screenshots (rest + hover states) → `docs/artifacts/web-polish-2026-07-09/pipeline-polish/`.
**Step 5:** Commit: `refactor(pipeline): dense kanban cards — narrow handle, merged meta lines, hover actions`

### Task 2: Connect email — provider-accurate copy + standardized toast

**Verified state:** banner at `page.tsx:1161-1213` is Gmail-only (`window.location.href = /api/integrations/gmail?…`), copy `gmail.connectBanner` = "Connect Gmail to auto-import leads", and NO toast fires anywhere in the flow (the OAuth callback redirects to `/reconnect-inbox/success` or settings — never back to `/pipeline`). Outlook/M365 backend EXISTS (`/api/integrations/microsoft365` + callback + webhook); the settings wizard already offers both providers (`connect-step.tsx:18-107`).

**Files:**
- Modify: `src/app/(dashboard)/pipeline/page.tsx:1161-1213`
- Modify: `src/i18n/dictionaries/{en,es}/pipeline.json` (`gmail.*` keys → `email.*`)
- Create: `src/app/(dashboard)/pipeline/_components/connect-email-menu.tsx` (small provider popover)
- Modify: `src/app/api/integrations/gmail/callback/route.ts` + `src/app/api/integrations/microsoft365/callback/route.ts` (return-to support)
- Reference: `src/components/settings/wizard-steps/connect-step.tsx` (provider copy + endpoints), `src/components/settings/integrations-tab.tsx:265` (existing success-toast pattern + its dictionary keys)

**Step 1 (copy, load ops-copywriter):** rename keys `gmail.connectBanner/connectDesc/connect` → `email.connectBanner/connectDesc/connect` with EN copy:
- `email.connectBanner`: `Connect email to auto-import leads`
- `email.connectDesc`: `Incoming client emails become pipeline leads automatically.` (unchanged sentence)
- `email.connect`: `CONNECT`
- provider labels reuse import-wizard strings if importable, else add `email.gmail` = `Gmail / Google Workspace`, `email.outlook` = `Microsoft 365 / Outlook`. ES equivalents for every key. Grep for other `gmail.*` consumers before renaming — mobile or table mode may read them; update all.
**Step 2 (provider choice):** CONNECT button opens a two-option `glass-dense` popover (Radix Popover per app convention — check how other small menus are built, e.g. `PipelineDetailActionMenu`): Gmail → `/api/integrations/gmail?…`, Outlook → `/api/integrations/microsoft365?…` with the same `companyId/userId/type=company` params (verify m365 route's expected params by reading it — do NOT assume parity with gmail's).
**Step 3 (round-trip toast):** add `returnTo` support: pipeline passes `state`-safe `returnTo=/pipeline` (read how each OAuth route packs `state` — extend the state payload, never a bare query param that gets lost through the OAuth dance). Callbacks: on success where `returnTo` is present and app-internal (allowlist: must start with `/`), redirect to `${returnTo}?connected=<provider>`; on failure `?connect_error=1` (same allowlist). Pipeline page: a `useEffect` watching `searchParams` fires `toast.success(t("email.connected"), { description: t("email.connectedDesc") })` (or `toast.error(t("email.connectFailed"))`) ONCE, then `router.replace` to strip the param (copy the exact pattern from any existing param-consume effect, e.g. books `action=new`). New dictionary keys EN+ES. **Security check:** the allowlist on `returnTo` is mandatory (no open redirect); settings-initiated flows (no `returnTo`) keep today's redirect targets exactly.
**Step 4 (tests):** unit-test the callback `returnTo` allowlist logic (reject `https://evil.com`, `//evil.com`; accept `/pipeline`). Integration tests exist for some routes — check `tests/integration/` for gmail callback coverage and extend it.
**Step 5:** tsc + vitest. Preview: banner shows "Connect email", CONNECT opens the two-provider menu (OAuth itself can't complete in dev — verify the redirect URL is correctly formed via `preview_network`/nav interception, and simulate the return leg by navigating to `/pipeline?connected=gmail` → standardized toast fires once and the param strips). Screenshots: banner, menu, toast.
**Step 6:** Commit: `feat(pipeline): connect email — both providers, round-trip success toast`

### Task 3: Lead detail window — AUDIT ONLY (deliverable for Jackson)

**Do NOT restructure the window.** Jackson wants this reviewed with him before changes.

**Files:**
- Create: `docs/design/2026-07-09-lead-detail-window-audit.md`
- Read: `pipeline-focused-detail-window.tsx`, `pipeline-detail-panel.tsx`, `lead-map-band.tsx`, `pipeline-detail-overview-tab.tsx`, remaining tabs

**Step 1:** Audit against the 780×680 default window (verified: fixed 158px map band even with no coordinates + next-steps block + tab bar consume the top; single scroller squeezed below). Document with numbers: px consumed per chrome block at default size, what's cut off on each tab at default size, information-priority mismatches (what a lead-working operator needs FIRST vs what's above the fold). Capture annotated screenshots of every tab at default size from the preview.
**Step 2:** Write 2–3 concrete redesign directions with tradeoffs (e.g. A: collapse map band to a 44px address strip that expands on demand; B: map as a tab; C: taller default + sticky summary…). Each: what moves, what it costs. Recommend ONE.
**Step 3:** Commit the audit doc: `docs(pipeline): lead detail window audit + redesign directions`

### Task 4: Audit + evidence

`custom-skills:audit-design-system` on touched files; evidence folder complete; report includes the lead-window audit's recommendation summary for Jackson.

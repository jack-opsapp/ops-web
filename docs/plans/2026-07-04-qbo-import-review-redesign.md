# QuickBooks Import Review — UX Redesign (Bug Burndown W7)

> **For Claude:** Executed in-session with `custom-skills:executing-plans` discipline. Worktree: `ops-web-bugburn-w7` off `origin/main`. NEVER push/merge. Own the SURFACE only — do not touch the import *engine* (`applyStagedRows`) or QBO mappers.

**Goal:** Bring the QuickBooks import review surface to the OPS command-deck design system and close six bugs: full visual redesign, apply progress feedback, exact-match labels, needs_review highlight, select padding, and the one-active-provider consolidation.

**Design System:** `.interface-design/system.md` + `ops-design-system/project/DESIGN.md`. Every value → token. Icons: `lucide-react`. Numbers: JetBrains Mono tabular. Empties: `—`. Motion: single curve `cubic-bezier(0.22,1,0.36,1)`.

**Required Skills:** interface-design, frontend-design, ui-ux-pro-max, ops-copywriter (copy), audit-design-system (gate).

---

## Reconciliation against live `origin/main` (verified, not assumed)

1. **`fix/qbo-review-customer-mapping` (16028e18) is already superseded by main.** origin/main's `QboCustomerMatch` already carries `displayName`/`companyName`/`contactName` (`qbo-import.ts:166-171`) and the service already has `mapCustomerMatch` snake→camel + display-name join (`quickbooks-import-service.ts:101`). Nothing to fold in — preserve the behavior in the redesign, cite it in fix_notes.
2. **Bug #6 UI is already canonical on both live surfaces.** Books SYNC segment (`books/segments/sync-segment.tsx`) and Settings › Accounting (`settings/accounting-tab.tsx`) were rebuilt in WEB OVERHAUL P3-4/P3-6 to: single entry → provider picker → live badge → manage/disconnect/switch behind the badge. Switch = disconnect-first. **Remaining gap = the server-side one-active-provider invariant** (the bug's "server-side check, not just visually").
3. **Live route** is Books → SYNC segment, `view=import` (`/books?segment=sync&view=import`), NOT `/accounting`. The notification `action_url` must match this.

---

## Task 1 — Redesign `reconciliation-strip.tsx` (bug #1)

**Files:** Modify `src/components/accounting/qbo/reconciliation-strip.tsx`.
**Tokens:** `text-rose` (replace hardcoded `#B58289` at :37,:60), `text-status-success`, `text-text-mute`, `font-mono` tabular, `border-border`.
- Replace `text-[#B58289]` → `text-rose`.
- Give the strip a real header grammar: `// RECONCILIATION` (JetBrains Mono 11px, `//` in text-mute) with QB / OPS AFTER IMPORT / Δ columns.
- Matched rows → olive; breached → rose, with a rose status pip so color isn't the only signal (a11y: color-independence).
- Keep tabular-nums; em-dash for matched delta.

## Task 2 — Redesign `customer-match-table.tsx` (bugs #1, #3, #4, #5)

**Files:** Modify `src/components/accounting/qbo/customer-match-table.tsx`.
**Reuse:** `Select/SelectTrigger/SelectContent/SelectItem` from `@/components/ui/select` (Radix, glass-dense, chevron never cramped → **bug #5 solved by construction**).
- **Bug #3 — exact-match label.** Rewrite `candidateLabel(c)`: if `c.basis` is `email` or `name_exact` → show basis word (`Email · exact` / `Name · exact`) via i18n, NO percentage. Only `name_fuzzy` with a real score in (0,1) shows `· NN%`. Never render `· 0%`.
- **Bug #4 — needs_review highlight.** A row whose *resolved* action is still `needs_review` gets `border border-rose-line bg-rose-soft` (subtle rose) + a rose `Tag`/pip in the action cell. Resolving it (link/create/skip) clears the treatment. Rose treatment traces to `rose-soft`/`rose-line` tokens.
- **Bug #5 — pickers.** Replace both native `<select>` with styled `Select`. Action picker: Link/Create/Skip (+ disabled needs_review current value). Candidate picker: none + candidates. Chevron spacing handled by the component.
- **Bug #1 — tokens.** Replace `text-[#C4A868]`→`text-tan`, `text-[#B58289]`→`text-rose`, `hover:bg-[rgba(255,255,255,0.02)]`→`hover:bg-surface-hover-subtle`, `bg-[rgba(255,255,255,0.04)]`/`h-[36px]` (native selects removed anyway). Confidence chips as `Tag` earth-tones. Column headers `// `-prefixed JetBrains Mono micro.
- Preserve `displayName ?? companyName` render + `data-testid`s (tests depend on them).

## Task 3 — Redesign `quickbooks-import-tab.tsx` shell (bug #1) + apply in-progress UI (bug #2 client)

**Files:** Modify `src/components/accounting/qbo/quickbooks-import-tab.tsx`.
- Convert the flat `Card` stack into a command-deck: a run-header instrument (title in Cake Mono, read-only note, PULL cta, connection pip + last-pulled + write-calls guard as a compact status ribbon), then reconciliation / records / customers / apply as `// `-titled glass panels.
- **RecordStat** → tactical stat cell: JetBrains Mono tabular value, JetBrains Mono micro label, `bg-fill-neutral-dim`/`border-border`, `—` when 0.
- Accent used **once**: the Apply primary CTA.
- Icon sizes via lucide `size=` props (16 inline / 20 hero), not arbitrary `w-[14px]`.
- **Apply in-progress (bug #2):** when run.status === `applying`, render a non-frozen APPLYING panel: entity phase list (clients → sub-clients → invoices → payments → reconcile) with an indeterminate bar on the OPS curve, + "[safe to leave — tracked in notifications]". Poll `useImportReview` while applying. On `applied`, show the imported-counts confirmation.

## Task 4 — Apply as a background job + persistent notification (bug #2 server)

**Files:** Modify `src/app/api/integrations/quickbooks/import/apply/route.ts`; `src/lib/hooks/use-qbo-import.ts`; add helper `src/lib/api/services/qbo-import-notify.ts`.
**Architecture:** Next.js `after()` backgrounds the unchanged engine call; route returns `202 { status:'applying', runId }` immediately. Server owns the persistent notification lifecycle.
- Before returning: set run `status='applying'`; insert **persistent** notification (`persistent:true`, `type:'accounting_import_complete'`, title `// IMPORT APPLYING`, body counts, `action_url:'/books?segment=sync&view=import'`, `action_label:'VIEW IMPORT'`) and capture its id.
- In `after()`: run `service.applyImport(runId, decisions)` (UNCHANGED engine); on success → **update** the same notification row to the completion state (`persistent:false`, `is_read:false`, title `// IMPORT COMPLETE`, body counts) and set run `status='applied'`; on error → update notification to a failure state + run `status='error'`, store `error`.
- Client `useApplyImport`: treat 202 as success; drive polling via run.status; no double-notify (server owns it — remove the old client onSuccess assumption).
- **Do NOT modify** `applyStagedRows`/mappers.

## Task 5 — Server-side one-active-provider invariant (bug #6)

**Files:** add `src/lib/api/services/accounting-connection-guard.ts`; modify `src/app/api/integrations/quickbooks/route.ts` (POST) + `src/app/api/integrations/sage/route.ts` (POST); defense-in-depth in both `callback/route.ts`.
- Helper `assertNoConflictingProvider(supabase, companyId, provider)`: returns the conflicting provider if a row with `is_connected=true AND provider != provider` exists, else null. (Same-provider different-environment reconnect stays allowed.)
- Initiate POST: after permission check, before the placeholder upsert → if conflict, `409 { error, conflictingProvider }`. Surface a clear toast client-side.
- Callback: before flipping `is_connected=true`, re-check; if conflict, abort activation (redirect with an error param) — prevents a raced second connection.

## Task 6 — Copy + i18n (ops-copywriter)

**Files:** `src/i18n/dictionaries/{en,es}/accounting.json`, `.../books.json`, `.../settings.json` as needed.
- New keys: `qbo.basis.exactSuffix` (`exact`), apply-progress phase labels, `qbo.apply.inProgressNote`, notification titles/bodies (server strings live in route — keep terse OPS voice), mutual-exclusivity error. Product register: terse, no exclamation points, `//`/`[brackets]` grammar, em-dash empties.

## Task 7 — Tests + audit + evidence

- Update/extend: `tests/unit/components/qbo-customer-match-table.test.tsx` (exact-match label, needs_review row treatment), `quickbooks-import-service.test.ts` (unchanged behavior still green), new guard unit test, apply-route background test.
- `npm run lint` + `npx tsc --noEmit` (scope to touched files) + `vitest` on the qbo/accounting suites.
- `custom-skills:audit-design-system` on all touched components — zero hardcoded color/spacing/radius/font; lucide-only; i18n only.
- Evidence: before/after screenshots at 1280×900 via the dev server (`DEV_BYPASS_AUTH` + `dev:webpack`), the apply progress flow, and the connect flow walked end-to-end. Artifacts → `docs/artifacts/`.

## Commit plan (atomic, conventional, no AI attribution)
1. `fix(qbo-import): exact-match candidate labels + rose needs_review highlight`
2. `refactor(qbo-import): rebuild reconciliation strip + match table to design system`
3. `refactor(qbo-import): rebuild import tab shell to the command-deck system`
4. `feat(qbo-import): background apply with persistent progress notification`
5. `feat(accounting): enforce one active accounting provider per company`
6. `chore(qbo-import): i18n + design-system audit fixes`

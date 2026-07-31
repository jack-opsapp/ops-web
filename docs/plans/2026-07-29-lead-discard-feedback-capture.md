# Lead Discard Feedback Capture (Phase C, Web) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When an operator discards a lead on the pipeline, capture the structured reason with one optional tap — through the deployed `apply_lead_disposition_feedback` contract — so discards finally feed the Phase C lead classifier.

**Architecture:** The single discard choke point is `requestStageChange` in `use-stage-transition.ts` (board + table both consume it). Discard is intercepted there. Phase C ON: flip the card optimistically, defer the write, and show ONE toast that is simultaneously the undo toast and a one-tap reason rack; a reason tap calls the atomic RPC (which applies the mapped lifecycle + evidence in one transaction), ignoring/dismissing commits today's plain stage move. Phase C OFF: the same RPC is called immediately with `legacy_unspecified` (authoritative audit, never learning evidence), UX byte-identical to today. Undo routes through the guarded `undo_lead_disposition_feedback` RPC (idempotent, conflict-safe).

**Tech Stack:** Next.js 15 / React / TypeScript, TanStack Query v5 (`mutateAsync` flows — no lifecycle-gated callbacks), Sonner (`toast.custom`), Framer Motion (EASE_SMOOTH only), Supabase client RPC (`requireSupabase().rpc(...)`), vitest + RTL.

**Design System:** `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md` (glass-dense toast surface §5, chip spec §9, type scale §4, motion §8, a11y §15). Zero hardcoded values that don't already exist as project Tailwind tokens/classes used by `toast.tsx` / `stage-transition-dialog.tsx`.

**Required Skills:** `ops-design` (read DESIGN.md before UI), `frontend-design:frontend-design`, `custom-skills:audit-design-system` (before done). All copy below is already ops-copywriter-approved — do not reword.

---

## Verified server contract (do NOT re-derive; verified live 2026-07-29)

Deployed on prod (`ijeekuhbatykdomumfjx`), granted to `anon, authenticated`:

- `apply_lead_disposition_feedback(p_opportunity_id uuid, p_reason_code text, p_optional_note text, p_idempotency_key text)` returns ONE row `{feedback_id, outcome, prior_stage, current_stage, current_stage_entered_at, current_stage_manually_set, current_lost_reason, current_lost_notes, current_actual_close_date, lifecycle_changed, idempotent_replay}`.
  - Resolves actor from JWT (`private.get_current_user_id()`), checks edit permission, `FOR UPDATE` lock, idempotent replay on `(company, actor, key)`, key length 8–128.
  - **Refuses** when `stage IN (won,lost,discarded)` or merged → error message `opportunity_terminal_or_merged`.
  - Phase C ON (company has `admin_feature_overrides.feature_key='phase_c'.enabled`): accepts the 9 reason codes, rejects `legacy_unspecified` (`invalid_phase_c_reason`). Phase C OFF: accepts ONLY `legacy_unspecified` (`phase_c_disabled` otherwise).
  - Reason → outcome mapping (server-owned): `spam|job_applicant|vendor_sales|internal|platform_notification|test_traffic|legacy_unspecified` → stage moves to `discarded`; `not_a_fit` → stage moves to `lost` (+ disposition `disqualified`, lost_reason `other`, lost_notes = optional note); `duplicate` → `duplicate_review`, **no lifecycle change**; `other` → `review_deferred`, **no lifecycle change**.
- `undo_lead_disposition_feedback(p_feedback_id uuid, p_idempotency_key text)` — same return shape. Retracts the learning row; restores prior stage/lost fields when a lifecycle was applied; raises `feedback_undo_conflict` (errcode 40001) if the opportunity changed after the apply; retracted rows replay idempotently (safe double-undo).
- Other error messages to map: `opportunity_not_found`, `opportunity_access_denied`, `actor_not_found`, `invalid_idempotency_key`, `feedback_note_too_long`, `feedback_not_found`, `idempotency_key_reused`.
- Supabase PostgREST returns `returns table` functions as an **array of rows** — normalize `data[0]`.
- Client feature gate: `useFeatureFlagsStore` — the `/api/feature-flags` route ALWAYS appends a synthetic `phase_c` row (enabled per company override, fail-closed). Gate = `initialized && canAccessFeature("phase_c")`. Never gate on `canAccessFeature` alone (unknown slug fail-opens pre-init).

## Interaction contract (locked — do not redesign)

- Every discard entry point already funnels to `requestStageChange(id, Discarded)`: card menu (`pipeline-card-actions.tsx`), detail panel, focused detail window, focused drag-to-discard target, and the table shell (shares the hook). Touch ONLY the hook.
- **Phase C ON:** optimistic stage flip → single custom toast (10s, olive rail, UNDO always visible):
  - Tap a reason chip → `apply` RPC replaces the plain move entirely. Toast updates in place to a confirmed state (reason tag + outcome line), fresh 10s window, UNDO now = `undo` RPC.
  - Ignore / Esc / manual dismiss → commit today's plain `moveStage` (no feedback row — skipping means no learning signal). Silent (the toast already lived its life).
  - UNDO before any commit → cancel: nothing was ever written; invalidate to restore server truth; dismiss.
- **Phase C OFF:** immediately `apply` RPC with `legacy_unspecified`; success toast copy identical to today's (`clientName · value` / `from → to`); UNDO = `undo` RPC. On RPC failure that isn't terminal/access: fall back to the legacy `moveStage` block so discard can never break.
- **Terminal source (won/lost) or merged lead:** legacy `moveStage` path exactly as today (contract excludes them).
- **duplicate / other outcomes:** the lead STAYS on the board (server made no lifecycle change) — invalidation brings the card back; the confirmed toast copy says so explicitly.
- Global undo stack (`pushUndo`) entries: plain-move commits push a moveStage-back inverse (today's exact behavior); RPC commits push an inverse that calls the undo RPC. Double-fire (toast UNDO + Cmd+Z) is server-side idempotent — no client dedup needed.
- All commit/undo flows use `mutateAsync` + explicit `queryClient.invalidateQueries({queryKey: queryKeys.opportunities.all})` inside the controller closures (never rely on mutate-callbacks, which are lifecycle-gated).

## Visual spec (locked)

Custom Sonner toast (`toast.custom`), self-rendered shell (custom toasts bypass `toastOptions.classNames`):

- Shell: `glass-dense relative overflow-hidden w-[340px] rounded-modal border border-glass-border`, content padding `px-3.5 py-3`. Left rail: absolutely positioned `w-[3px]` full-height, `bg-olive` (matches today's `toast.success` rail — the discard IS asserted optimistically).
- Title row: title (Mohave `font-mohave uppercase text-text text-[12px] leading-[1.1] tracking-[0.08em] font-medium`, truncate) + UNDO button right-aligned (`font-mohave uppercase text-[11px] tracking-[0.12em] bg-transparent text-ops-accent border border-ops-accent rounded px-2 py-[3px] hover:bg-ops-accent hover:text-black transition-colors duration-150`).
- Line 2 (state line): `font-mono text-text-3 text-[11px] leading-[1.35] tracking-[0.02em] mt-1`.
- Hairline divider: `border-t border-line mt-2.5 pt-2` above the reason zone.
- Reason zone heading: `<span class="text-text-mute">// </span>` + dict text, `font-mono text-[11px] uppercase tracking-[0.12em] text-text-3`.
- Chip rack (`role="group"`, aria-label from dict): `flex flex-wrap gap-1.5 mt-1.5`; each chip a real `<button type="button">`: `font-mono text-[11px] font-medium uppercase tracking-[0.12em] px-1.5 py-[3px] rounded-[4px] bg-white/5 border border-line text-text-2 hover:bg-white/[0.08] hover:border-white/[0.18] hover:text-text focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-ops-accent focus-visible:outline-offset-2 transition-colors duration-150` — §9 toggle/chip spec, NO accent on chips.
- Confirmed state: rack replaced by one olive tag (`font-mono text-[11px] font-medium uppercase tracking-[0.12em] px-1.5 py-[2px] rounded-[4px] text-olive bg-olive-soft border border-olive-line`) showing the chosen reason label; heading line becomes `REASON LOGGED`; state line becomes the outcome copy.
- While the apply RPC is in flight: chips get `disabled` + `opacity-60 pointer-events-none`; no spinner (sub-300ms operation; the swap is the confirmation).
- Motion: pending→confirmed swap via `AnimatePresence mode="wait"` with new `discardReasonSwapVariants` in `src/lib/utils/motion.ts` (opacity + y:-4, 0.2s, EASE_SMOOTH; exit 0.15s) and `discardReasonSwapReducedVariants` (opacity-only, 0.15s). Select by `useReducedMotion()`. No layout spring — wrap swap region in a fixed flow (height change is a hard cut; acceptable, no animation on height).
- Chip order (frequency): SPAM, SALES PITCH, APPLICANT, PLATFORM MAIL, INTERNAL, TEST, DUPLICATE, NOT A FIT, OTHER. All nine visible — no expander.

## Copy (ops-copywriter approved — use verbatim)

`src/i18n/dictionaries/en/pipeline.json` (FLAT dot-keys — nested objects silently break `t()`):

```json
"discardFeedback.reasonHeading": "Reason — trains the filter",
"discardFeedback.reasonGroupAria": "Discard reason",
"discardFeedback.logged": "Reason logged",
"discardFeedback.undo": "Undo",
"discardFeedback.reason.spam": "Spam",
"discardFeedback.reason.vendorSales": "Sales pitch",
"discardFeedback.reason.jobApplicant": "Applicant",
"discardFeedback.reason.platformNotification": "Platform mail",
"discardFeedback.reason.internal": "Internal",
"discardFeedback.reason.testTraffic": "Test",
"discardFeedback.reason.duplicate": "Duplicate",
"discardFeedback.reason.notAFit": "Not a fit",
"discardFeedback.reason.other": "Other",
"discardFeedback.outcome.lost": "Marked lost — disqualified",
"discardFeedback.outcome.duplicate": "Duplicate review — stays on board",
"discardFeedback.outcome.review": "Sent to review — stays on board",
"discardFeedback.error.notSavedTitle": "Reason not saved",
"discardFeedback.error.notSavedBody": "Lead discarded — the reason did not record",
"discardFeedback.error.undoBlockedTitle": "Undo blocked",
"discardFeedback.error.undoBlockedBody": "This lead changed after the discard"
```

`src/i18n/dictionaries/es/pipeline.json` (same keys): "Motivo — entrena el filtro", "Motivo de descarte", "Motivo registrado", "Deshacer", "Spam", "Oferta comercial", "Postulante", "Aviso de plataforma", "Interno", "Prueba", "Duplicado", "No encaja", "Otro", "Marcado perdido — descalificado", "Revisión de duplicado — sigue en el tablero", "Enviado a revisión — sigue en el tablero", "Motivo no guardado", "Lead descartado — el motivo no se registró", "Deshacer bloqueado", "Este lead cambió después del descarte".

For discard-outcome confirmed states the state line stays the existing stage line (`FROM → DISCARDED` via `getStageDisplayName`); `not_a_fit`/`duplicate`/`other` use the outcome keys above.

---

### Task 1: Service — `lead-disposition-feedback-service.ts`

**Files:**
- Create: `src/lib/api/services/lead-disposition-feedback-service.ts`
- Test: `tests/unit/services/lead-disposition-feedback-service.test.ts`

Service shape (mirror `ProjectViewsService`'s typed-RPC pattern — `requireSupabase() as unknown as <RpcClient interface>`; do NOT depend on `database.types.ts` having these functions):

```ts
export type LeadDiscardReasonCode =
  | "spam" | "job_applicant" | "vendor_sales" | "internal"
  | "platform_notification" | "test_traffic" | "duplicate"
  | "not_a_fit" | "other";

export type LeadDispositionOutcome =
  | "discarded" | "lost" | "duplicate_review" | "review_deferred";

export interface LeadDispositionFeedbackResult {
  feedbackId: string;
  outcome: LeadDispositionOutcome;
  priorStage: string;
  currentStage: string;
  lifecycleChanged: boolean;
  idempotentReplay: boolean;
}

export type LeadDispositionFeedbackErrorCode =
  | "terminal_or_merged" | "phase_c_disabled" | "invalid_reason"
  | "access_denied" | "not_found" | "undo_conflict" | "unknown";

export class LeadDispositionFeedbackError extends Error {
  constructor(public code: LeadDispositionFeedbackErrorCode, message: string) { super(message); }
}
```

- `applyLeadDispositionFeedback({opportunityId, reasonCode, optionalNote, idempotencyKey})` → `rpc("apply_lead_disposition_feedback", {p_opportunity_id, p_reason_code, p_optional_note: optionalNote ?? null, p_idempotency_key})`; `reasonCode: LeadDiscardReasonCode | "legacy_unspecified"`.
- `undoLeadDispositionFeedback({feedbackId, idempotencyKey})` → `rpc("undo_lead_disposition_feedback", {...})`.
- Both: `if (error) throw normalize(error)`; `const row = Array.isArray(data) ? data[0] : data;` → map snake_case → result; missing row → `unknown` error.
- `normalize`: match `error.message` **substrings**: `opportunity_terminal_or_merged`→`terminal_or_merged`; `phase_c_disabled`→`phase_c_disabled`; `invalid_phase_c_reason`|`invalid_idempotency_key`|`feedback_note_too_long`|`idempotency_key_reused`→`invalid_reason`; `opportunity_access_denied`|`actor_not_found`→`access_denied`; `opportunity_not_found`|`feedback_not_found`→`not_found`; `feedback_undo_conflict`→`undo_conflict`; else `unknown`.

**Steps (TDD):** write failing tests (mock `@/lib/supabase/helpers` `requireSupabase` with `vi.mock`, capture rpc args; cases: correct arg mapping incl. null note; row-array normalization; each error-message → code; missing-row → unknown) → `npx vitest run tests/unit/services/lead-disposition-feedback-service.test.ts` FAIL → implement → PASS → commit `feat(pipeline): add lead disposition feedback service`.

### Task 2: Hooks

**Files:**
- Create: `src/lib/hooks/use-lead-disposition-feedback.ts` (thin: `useApplyLeadDispositionFeedback` / `useUndoLeadDispositionFeedback`, `useMutation({mutationFn})` only — invalidation is the controller's job)
- Modify: `src/lib/hooks/index.ts` (re-export)

No dedicated tests (no logic); covered by Task 4 controller tests. Commit with Task 3's commit.

### Task 3: Toast component + motion + i18n

**Files:**
- Create: `src/app/(dashboard)/pipeline/_components/discard-feedback-toast.tsx`
- Modify: `src/lib/utils/motion.ts` (add `discardReasonSwapVariants`, `discardReasonSwapReducedVariants`)
- Modify: `src/i18n/dictionaries/en/pipeline.json`, `src/i18n/dictionaries/es/pipeline.json` (keys above; keep file's existing key-block ordering conventions — append near the other `toast.`/`undo.` keys)
- Test: `tests/unit/pipeline/discard-feedback-toast.test.tsx`

Component exports:

```ts
export interface DiscardFeedbackToastHandle { toastId: string | number; }
export function showDiscardFeedbackToast(opts: {
  title: string;            // `${clientName}` or `${clientName} · ${value}`
  stageLine: string;        // `FROM → TO` (pre-formatted by caller)
  t: (key: string, fallback?: string) => string;
  onReason: (code: LeadDiscardReasonCode) => void;
  onUndo: () => void;
  onClosedWithoutReason: () => void;  // auto-close AND manual dismiss, once
  durationMs?: number;      // default 10_000
}): DiscardFeedbackToastHandle;
export function confirmDiscardFeedbackToast(handle, opts: {
  title: string; stateLine: string; reasonLabel: string;
  t: ...; onUndo: () => void; durationMs?: number;
}): void;  // re-renders same toast id, fresh duration
```

Implementation notes:
- `toast.custom((id) => <DiscardFeedbackToastBody .../>, { id?, duration, onDismiss, onAutoClose })` from `@/components/ui/toast`. Guard `onClosedWithoutReason` with a `let settled = false` closure so dismiss+autoClose can't double-fire, and so `confirmDiscardFeedbackToast`/undo/cancel mark it settled first (a confirmed toast's later close must NOT trigger the skip-commit).
- `DiscardFeedbackToastBody` is a pure presentational component (exported for tests) with `state: {kind:"pending"} | {kind:"confirmed"; reasonLabel; stateLine}` and `applying: boolean` props driven by the imperative wrappers via re-render (call `toast.custom` again with the same id to swap state — Sonner updates in place).
- Reason chips: the 9 codes with dict keys per the Copy section, rendered in the locked order. Layout/classes per Visual spec. Reduced motion via `useReducedMotion()`.
- The internal reason→dict-key map lives here and is exported (`DISCARD_REASON_DICT_KEYS`) for tests + controller confirmed-state labels.

**Steps:** failing RTL tests (pending renders all 9 chips with dict labels + UNDO + heading; chip click fires `onReason("vendor_sales")` once; `applying` disables chips; confirmed renders olive tag + `REASON LOGGED` + outcome line, no chips; buttons have accessible names) → implement → PASS → commit `feat(pipeline): add discard feedback capture toast`.

### Task 4: Controller — route discard through the contract

**Files:**
- Modify: `src/app/(dashboard)/pipeline/_components/use-stage-transition.ts`
- Test: `tests/unit/pipeline/use-stage-transition-discard.test.tsx` (new; mirror the closest existing hook/component test harness in `tests/unit/pipeline/`)

In `requestStageChange`, replace the fall-through for Discarded:

```ts
if (newStage === OpportunityStage.Discarded) {
  beginDiscardCapture(opp);
  return;
}
```

`beginDiscardCapture(opp)` (new `useCallback` in the hook; all server steps via `mutateAsync` + captured `queryClient`; every idempotency key = `crypto.randomUUID()`):

1. Compute `previousStage`, `clientName` (existing clientNameMap logic), `value`, `fromStage`/`toStage` labels — reuse the existing block's code.
2. `const phaseCOn = useFeatureFlagsStore.getState().initialized && useFeatureFlagsStore.getState().canAccessFeature("phase_c");` (module import, read at call time — no subscription).
3. **Legacy guard:** if `previousStage` is `Won`/`Lost` → run the existing plain-move block verbatim (moveStage + success toast + pushUndo) and return. (Same-stage no-op already handled above; merged leads aren't exposed on the board type — the RPC error path covers any residue.)
4. **Phase C OFF:** optimistic flip (exact `setQueriesData` shape from `useMoveOpportunityStage.onMutate`, lists+detail); `applyFeedback.mutateAsync({opportunityId, reasonCode: "legacy_unspecified", idempotencyKey})`:
   - success → invalidate `opportunities.all`; `toast.success(title, {description: stageLine})` (byte-identical copy to today); `pushUndo({label, inverseFn: () => undoFeedback.mutateAsync({feedbackId, idempotencyKey: uuid()}).then(invalidate).catch(swallow-conflict→invalidate+error-toast)})`.
   - error `terminal_or_merged`/`access_denied` → invalidate + `toast.error(t("toast.failedMove"), {description: message})`.
   - any other error → **fallback:** run the legacy plain-move block (moveStage owns its own optimistic/rollback; it will reconcile the flip) — discard must never break on RPC unavailability.
5. **Phase C ON:** optimistic flip; `const pending = { key: crypto.randomUUID(), settled: false }`; show `showDiscardFeedbackToast` with:
   - `onClosedWithoutReason`: if settled return; settled=true; `moveStage.mutate({id, stage: Discarded, userId})` (its optimistic re-flip is a no-op) and on its success `pushUndo` with the existing moveStage-back inverse (today's exact label/inverse); on error its existing onError rollback + `toast.error(t("toast.failedMove"))` — reuse the existing block, extracted as a local `commitPlainDiscard()`.
   - `onUndo` (pending phase): if settled return; settled=true; dismiss toast; `queryClient.invalidateQueries(opportunities.all)` (nothing was written); no pushUndo.
   - `onReason(code)`: if settled return; settled=true (chips also flip `applying` first via re-render); `applyFeedback.mutateAsync({opportunityId, reasonCode: code, idempotencyKey: pending.key})`:
     - success → `confirmDiscardFeedbackToast(handle, { stateLine: outcome-specific (see Copy), reasonLabel, onUndo: undoAfterApply(feedbackId) })`; invalidate; `pushUndo({label, inverseFn: undoAfterApply(feedbackId)})`.
     - `terminal_or_merged` | `access_denied` → dismiss toast; invalidate; `toast.error(t("toast.failedMove"), {description})`.
     - `phase_c_disabled` (flag flipped mid-session) → dismiss toast; `commitPlainDiscard()` silently.
     - other → dismiss toast; `commitPlainDiscard()`; `toast.error(t("discardFeedback.error.notSavedTitle"), {description: t("discardFeedback.error.notSavedBody")})`.
   - `undoAfterApply(feedbackId)` = async: `undoFeedback.mutateAsync({feedbackId, idempotencyKey: uuid()})` → dismiss toast → invalidate; on `undo_conflict` → invalidate + `toast.error(t("discardFeedback.error.undoBlockedTitle"), {description: t("discardFeedback.error.undoBlockedBody")})`; other errors → invalidate + generic `toast.error(t("toast.failedUpdate"))`.
6. Add `useFeatureFlagsStore` import; add the two feedback mutations; extend the hook deps arrays correctly (lint rule enforces exhaustive-deps).

**Behavior matrix the test file MUST cover** (mock service module + feature-flags store state + moveStage service; use fake timers only if the harness needs auto-close — otherwise invoke the captured toast callbacks directly by mocking `discard-feedback-toast` module):
1. ON + reason tap → apply RPC called with reason + pending key; NO moveStage call; invalidation fired.
2. ON + closed without reason → moveStage called once; NO apply call; pushUndo entry pushed.
3. ON + UNDO while pending → no writes at all; invalidation fired.
4. ON + apply throws unknown → moveStage fallback + error toast.
5. OFF → apply called immediately with `legacy_unspecified`; no capture toast (`showDiscardFeedbackToast` not called); success toast shown.
6. OFF + apply throws unknown → moveStage fallback.
7. Source stage Won/Lost → moveStage direct; apply never called.
8. Undo-after-apply conflict → error toast with `undoBlocked` copy + invalidation.

**Steps:** failing tests → implement → `npx vitest run tests/unit/pipeline/use-stage-transition-discard.test.tsx` PASS → full pipeline suite `npx vitest run tests/unit/pipeline` green → commit `feat(pipeline): route lead discard through phase C feedback capture`.

### Task 5: Type-check + full test sweep

`npx tsc --noEmit` clean (pre-existing errors, if any, must be diffed against `origin/main` — only OUR files must be clean). `npx vitest run tests/unit` — no new failures vs main. Fix anything ours. Amend/commit as needed.

### Task 6: Self-audit against the design system

Run the `custom-skills:audit-design-system` checklist over the new toast component: every color/radius/font traces to existing tokens/classes (`glass-dense`, `rounded-modal`, `border-glass-border`, `border-line`, `text-text/-2/-3/-mute`, `text-ops-accent`, `text-olive`/`bg-olive-soft`/`border-olive-line`, `font-mono`/`font-mohave`, EASE_SMOOTH). No new hex values, no `shadow-*`, no accent on chips, 11px floor respected, reduced-motion handled. Fix violations before finishing.

---

## Out of scope for the executor (owner handles)

Live verification (dev server + MAVERICK tenant + DB assertions + screenshots), bible update, bug-report row update, archive-path capture (separate contract, separate bug), and anything requiring pushes.

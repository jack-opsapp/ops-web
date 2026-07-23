# AI-Provider Failure Isolation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** An OpenAI-provider outage in email-sync Steps 5/6 must defer AI enrichment durably and let the cycle stamp its Gmail cursor, instead of aborting and freezing the cursor.

**Architecture:** Add an unwrap-aware `isAIProviderUnavailableError` predicate; convert the coarse Step 5/6 `try/catch` into per-AI-call isolation while every deterministic path keeps its fail-closed (cursor-holding) semantics; defer unmatched-lead classification durably via a new `email_threads.lead_scan_pending_at` marker drained by a bounded `retryPendingLeadScans` sweep in the email-sync cron; classify provider-unavailability in the lead-summary refresh; fire the operator-rail alert deterministically from the sync path and make the P1-1-4 misconfiguration observable.

**Tech Stack:** TypeScript, Next.js 15 App Router, Supabase (service-role), OpenAI SDK. Tests via the existing sync-engine/vitest harness.

**Design System:** N/A (backend only — no UI surface).

**Spec:** `docs/superpowers/specs/2026-07-22-ai-provider-failure-isolation-design.md` (authoritative; read first).

**Required Skills:** `superpowers:test-driven-development`, `superpowers:verification-before-completion`. No design/animation skills (no UI).

**House rules:** Commit atomically as work lands (no push). No AI attribution in commits. Stage by name — the worktree has sibling-session WIP; never `git add -A`. Do not disturb other `M` files. Read actual code before editing (never guess a seam).

---

## Phase 0 — Verify the seams (no code changes)

### Task 0: Confirm exact integration points

**Files (read-only):**
- `src/lib/api/services/sync-engine.ts` — locate: the `LifecyclePersistenceError` class definition; the `SyncCycleResult` type (field names); the `interface UnmatchedInboundContext` (2176); the three `refreshLeadSummariesForOpportunities` call sites (3554, 3721, 4620); the Step 5/6 block (4102–4638).
- `src/lib/email/email-sync-cron-result.ts` — `buildEmailSyncCronResult` shape.
- `src/lib/api/services/openai-monitoring.ts` — `isOpenAIInsufficientQuotaError`, `isOpenAIRetryableRateLimitError`.
- `tests/` — find the existing sync-engine test file(s) and the mock-Supabase / mock-provider helpers they use.

**Step 1:** Record the exact `SyncCycleResult` field list and where it is initialized (so new fields `aiProviderDeferred`, `leadScansDeferred` are added in one place with defaults).
**Step 2:** Record whether OpenAI SDK error objects expose `status` / `code` at top level or under `.error` / `.cause` (check how `isOpenAIInsufficientQuotaError` already reads them, and the OpenAI SDK `APIError` shape in `node_modules/openai`).
**Step 3:** No commit (investigation only). Proceed only once every seam above is confirmed by reading the actual code.

---

## Phase 1 — The error predicate (TDD)

### Task 1: `isAIProviderUnavailableError`

**Files:**
- Modify: `src/lib/api/services/openai-monitoring.ts`
- Test: `src/lib/api/services/__tests__/openai-monitoring.test.ts` (create if absent; else co-located existing test)

**Step 1 — failing tests.** Cover:
- raw `{ code: "insufficient_quota" }` → true
- `{ status: 429 }`, `{ status: 503 }`, `{ status: 401 }`, `{ status: 403 }` → true
- OpenAI transport by name: `{ name: "APIConnectionError" }`, `{ name: "APIConnectionTimeoutError" }` → true
- wrapped: `new Error("prefix", { cause: { code: "insufficient_quota" } })` → true (unwrap `.cause`)
- deep chain `a.cause.cause = { status: 500 }` → true (bounded depth ≥ 3)
- `LifecyclePersistenceError`-like `{ name: "LifecyclePersistenceError" }` → **false**
- `{ name: "StageEvaluationModelContractError" }`, `{ name: "LeadSummaryModelContractError" }`, model refusal → **false**
- plain `new Error("boom")`, `{ status: 400 }`, `null`, `undefined` → **false**

**Step 2:** Run the test file — expect FAIL (function undefined).

**Step 3 — implement.** Export `isAIProviderUnavailableError(error: unknown): boolean`. Walk the error and up to 3 `.cause` links; at each level return true when `isOpenAIInsufficientQuotaError(node)` OR a numeric `status` ∈ {429} ∪ [500,599] ∪ {401,403} OR `name` ∈ {`APIConnectionError`,`APIConnectionTimeoutError`}. Never treat a `name` ending in `ContractError`/`RefusalError` or equal to `LifecyclePersistenceError` as unavailable (short-circuit false at that node, but still allow a genuine provider error deeper in `.cause` — walk-then-decide). Reuse `isRecord`.

**Step 4:** Run — expect PASS. Run the full `openai-monitoring` test file green.

**Step 5 — commit.**
```bash
git add src/lib/api/services/openai-monitoring.ts src/lib/api/services/__tests__/openai-monitoring.test.ts
git commit -m "feat(email): detect AI-provider-unavailability errors for sync isolation"
```

---

## Phase 2 — Durable marker migration

### Task 2: `email_threads.lead_scan_pending_at`

**Files:**
- Create: `supabase/migrations/20260722<HHMMSS>_email_threads_lead_scan_pending.sql`

**Step 1 — write the migration** (additive, nullable — respects iOS additive-only sync constraint):
```sql
begin;
alter table public.email_threads
  add column if not exists lead_scan_pending_at timestamptz;

create index if not exists email_threads_lead_scan_pending_idx
  on public.email_threads (company_id, lead_scan_pending_at)
  where lead_scan_pending_at is not null and opportunity_id is null;
commit;
```
**Step 2 — regenerate types.** Update `src/lib/types/database.types.ts` for `email_threads` (add `lead_scan_pending_at: string | null` to Row/Insert/Update). Use the Supabase type generator if wired; otherwise hand-edit the three shapes to match exactly.
**Step 3 — do NOT apply to prod here.** Applying the DDL to prod is a gated, Jackson-coordinated step tied to deploy (branch is held/unpushed). Note this in the commit body. Local tests mock Supabase, so no local DB apply is required.
**Step 4 — commit.**
```bash
git add supabase/migrations/20260722*_email_threads_lead_scan_pending.sql src/lib/types/database.types.ts
git commit -m "feat(db): add email_threads.lead_scan_pending_at deferral marker (apply gated to deploy)"
```

---

## Phase 3 — Lead-summary provider-unavailability bucket (TDD)

### Task 3: `deferred` bucket in `refreshLeadSummariesForOpportunities`

**Files:**
- Modify: `src/lib/api/services/lead-summary-service.ts` (result type ~242/1904; per-opp catch ~2001)
- Test: existing lead-summary-service test file

**Step 1 — failing tests:** a quota error thrown by `generateLeadSummary` lands in `deferred` (not `failed`); a DB write error from `commitLeadSummarySnapshot` lands in `failed`; a mix routes each correctly; `written` still counts successes.

**Step 2:** Run — expect FAIL (no `deferred` field).

**Step 3 — implement:** add `deferred: Array<{ opportunityId: string; error: string }>` to the result type and initializer; in the per-opp `catch`, route `isAIProviderUnavailableError(error)` → `deferred`, else → `failed`.

**Step 4:** Run — expect PASS.

**Step 5 — commit.**
```bash
git add src/lib/api/services/lead-summary-service.ts <its test file>
git commit -m "feat(email): classify provider-unavailability in lead-summary refresh"
```

---

## Phase 4 — Extract the Step-5 promotion helper (behavior-preserving refactor)

### Task 4: Extract `promoteClassifiedUnmatchedLead` (or a batch helper) with NO behavior change

**Files:**
- Modify: `src/lib/api/services/sync-engine.ts` (Step-5 loop 4138–4369)
- Test: sync-engine test file

**Step 1 — characterization test first.** Before moving any code, add/confirm a test that drives the current Step-5 path end-to-end for one classified lead (create-opportunity branch AND relationship-link branch), asserting: opportunity/activity created, `linkThread` called, `updateCorrespondenceCounts` called, `applyLabel` called, `result.activitiesCreated`/`result.newLeads` incremented, and that a persistence failure still throws `LifecyclePersistenceError`. Run green against current code.

**Step 2 — extract.** Move the body of `for (const classified of aiResult.classifiedLeads) { … }` into an internal async helper (module-scoped, same file) taking exactly the values it closes over today (`classified`, `connection`, `profile`, `result`, `unmatchedContextByIdentity`, `supabase`, `followUpDaysCache`, `renewSyncLeaseIfNeeded`, company context). The live loop calls the helper per classified lead. **Zero logic change** — identical control flow, identical error wrapping.

**Step 3 — run the characterization test + full sync-engine suite** — expect all still PASS (proves behavior preserved).

**Step 4 — commit.**
```bash
git add src/lib/api/services/sync-engine.ts <sync-engine test file>
git commit -m "refactor(email): extract unmatched-lead promotion into a reusable helper"
```

---

## Phase 5 — Core isolation in the sync cycle (TDD)

### Task 5: Per-AI-call isolation + durable defer + one-shot alert

**Files:**
- Modify: `src/lib/api/services/sync-engine.ts` (Step 5/6 block 4102–4638; `SyncCycleResult` init; add `markUnmatchedThreadsPendingLeadScan`, `reportAIProviderOutageOnce`)
- Test: sync-engine test file

**Step 1 — failing integration tests** (mock reviewer/provider + mock Supabase per existing harness):
1. `reviewUnmatchedEmails` throws `insufficient_quota` → `persistSyncCheckpoint` **is** called (cursor advances); each `mayInheritProviderThread` unmatched thread gets `lead_scan_pending_at` set (assert the update call/filter incl. `opportunity_id IS NULL`); `result.aiProviderDeferred === true`; `result.leadScansDeferred === N`; alert reporter called exactly once.
2. Step-5 succeeds but `evaluateStagesWithSummary` throws 503 → Step-5 opportunities persisted; checkpoint called; `aiProviderDeferred === true`; stage/summary skipped.
3. Step-5 + stage-eval succeed but `refreshLeadSummariesForOpportunities` returns `deferred.length>0, failed.length===0` (quota) → checkpoint called; `aiProviderDeferred === true`.
4. **Regression:** a Step-5 persistence write throws `LifecyclePersistenceError` → checkpoint **NOT** called (cursor holds); no marker set.
5. **Regression:** `maybeAutoAdvanceOnAccept` throws → checkpoint **NOT** called; and it still runs even when an earlier Step-5 provider outage occurred (assert it executed).
6. Contact-form (`!mayInheritProviderThread`) unmatched context under outage → no `email_threads` update attempted; logged as non-thread deferral.

**Step 2:** Run — expect FAIL.

**Step 3 — implement** per spec §4:
- Add `aiProviderDeferred: boolean` (default false) and `leadScansDeferred: number` (default 0) to `SyncCycleResult` init.
- Guard `reviewUnmatchedEmails`, `evaluateStagesWithSummary` in their own `try/catch`, routing `isAIProviderUnavailableError` → `aiProviderOutage ??= err`, else `throw err`.
- On Step-5 outage: call `markUnmatchedThreadsPendingLeadScan(unmatchedContexts, connection)` (update `email_threads set lead_scan_pending_at = now()` where `connection_id`+`provider_thread_id` and `opportunity_id is null`, only for `mayInheritProviderThread` contexts; others → `console.warn` non-thread deferral) and bump `leadScansDeferred`.
- Keep deterministic middle (`reconcileUnlinkedOutboundEmail`, `maybeAutoAdvanceOnAccept`) unconditional and fail-closed.
- After stage persistence: `summaryRefresh.failed.length>0` → `LifecyclePersistenceError` (unchanged); else `summaryRefresh.deferred.length>0` → `aiProviderOutage ??= …`.
- Retain outer `catch` as safety net: `LifecyclePersistenceError`→rethrow; `isAIProviderUnavailableError`→set outage; else wrap+throw.
- After the block: `if (aiProviderOutage) { await reportAIProviderOutageOnce(aiProviderOutage); result.aiProviderDeferred = true; }` then fall through to `persistSyncCheckpoint()`.
- `reportAIProviderOutageOnce` → `reportOpenAIQuotaExhausted({ keySource: "OPENAI_API_KEY_SYNC", workload: "email_sync", errorMetadata })`, wrapped best-effort (never throws into the cycle).

**Step 4:** Run — expect all PASS. Run the full sync-engine suite green.

**Step 5 — commit.**
```bash
git add src/lib/api/services/sync-engine.ts <sync-engine test file>
git commit -m "fix(email): isolate AI-provider outages so the sync cursor still advances"
```

---

## Phase 6 — The drain sweep (TDD)

### Task 6: `retryPendingLeadScans` + wire into email-sync cron

**Files:**
- Modify: `src/lib/api/services/sync-engine.ts` (add `SyncEngine.retryPendingLeadScans`)
- Modify: `src/app/api/cron/email-sync/route.ts` (call beside `retryDirtyClassifications`; add to JSON result)
- Test: sync-engine test file + email-sync cron test if present

**Step 1 — failing tests:** given a pending thread (`lead_scan_pending_at` set, `opportunity_id NULL`) for an active company and a healthy reviewer, the sweep re-drives it, promotes it to an opportunity, and clears `lead_scan_pending_at`; a thread already promoted by another path is cleared without re-promoting; when the reviewer is down the marker is left in place; the batch is bounded (`limit`/`concurrency`) and returns `{ scanned, promoted, cleared, errors }`.

**Step 2:** Run — expect FAIL.

**Step 3 — implement** per spec §5a: select bounded pending threads for active companies; group by connection; per thread fetch from provider (mirror `evaluateStagesWithSummary`'s `provider.fetchThread`) and feed the latest inbound message through `processInboundEmail`; if it returns an unmatched context, run the Phase-4 promotion helper; clear the marker when the thread has an opportunity or is classified non-lead; on a sweep-level provider outage leave markers untouched. Wire into the cron with its own try/catch (like the other sweeps) and surface `pendingLeadScanSweep` in the response JSON + failed-count tally.

**Step 4:** Run — expect PASS.

**Step 5 — commit.**
```bash
git add src/lib/api/services/sync-engine.ts src/app/api/cron/email-sync/route.ts <tests>
git commit -m "feat(email): drain deferred lead-classification scans when AI recovers"
```

---

## Phase 7 — Make the P1-1-4 misconfiguration observable (TDD)

### Task 7: Distinct diagnostic for unconfigured/ineligible alert identity

**Files:**
- Modify: `src/lib/notifications/openai-quota-alert-service.ts`
- Test: `tests/unit/notifications/openai-quota-alert-service.test.ts`

**Step 1 — failing tests:** when `configuredIdentity` throws (env unset / non-UUID) the service emits a distinct operational event (e.g. `openai_quota_alert_unconfigured` with reason `identity_not_configured`); when `resolveConfiguredRecipient` throws "not a company administrator" it emits reason `recipient_not_admin`; a genuine DB persistence failure still emits the existing `openai_quota_notification_failed`. No throw escapes (still best-effort). No hardcoded fallback recipient is introduced.

**Step 2:** Run — expect FAIL.

**Step 3 — implement:** in `reportOpenAIQuotaExhausted` (and the capture path), catch configuration-class failures and route them to the distinct `emitOperationalLog` event with a specific `reason`, separate from delivery failures. Keep everything else identical.

**Step 4:** Run — expect PASS.

**Step 5 — commit.**
```bash
git add src/lib/notifications/openai-quota-alert-service.ts tests/unit/notifications/openai-quota-alert-service.test.ts
git commit -m "fix(notifications): surface unconfigured OpenAI-quota alert identity distinctly"
```

---

## Phase 8 — Full verification + docs

### Task 8: Whole-suite green, typecheck/lint, bible update

**Step 1 — run the impacted suites and the type/lint gates:**
```bash
npx vitest run src/lib/api/services/__tests__/openai-monitoring.test.ts <sync-engine test> <lead-summary test> tests/unit/notifications/openai-quota-alert-service.test.ts
npx tsc --noEmit
npx eslint src/lib/api/services/sync-engine.ts src/lib/api/services/openai-monitoring.ts src/lib/api/services/lead-summary-service.ts src/app/api/cron/email-sync/route.ts src/lib/notifications/openai-quota-alert-service.ts
```
Expected: all PASS. (OPS CI gates tests behind lint — keep lint clean. Verify locally per `project_ops_web_ci_red_lint_gates_tests`.)

**Step 2 — bible.** Update `ops-software-bible/07_SPECIALIZED_FEATURES.md` (email-sync / failure-isolation) with: the provider-outage isolation contract, the `lead_scan_pending_at` marker + `retryPendingLeadScans` sweep, the lead-summary `deferred` bucket, the deterministic sync-path alert, and the P1-1-4 config requirement. Commit separately:
```bash
git add ops-software-bible/07_SPECIALIZED_FEATURES.md
git commit -m "docs(bible): document email-sync AI-provider failure isolation"
```

**Step 3 — evidence.** Capture the passing test output (vitest summary for the isolation + regression cases) as the proof artifact for the report. Do NOT push.

---

## Out of scope (do not build)
Per-item model-contract quarantine; setting P1-1-4 env vars / choosing the operator identity (Jackson decision); flipping `LEAD_SUMMARY_REFRESH_ENABLED`; a stage-eval durable marker. See spec §8.

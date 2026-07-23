# AI-Provider Failure Isolation in the Email Sync Cycle

**Date:** 2026-07-22
**Branch:** `release/lead-refinements-20260719` (ops-web-held-merge)
**Chips:** `OUTAGE REMEDIATION - P1-1-3` (this work) · diagnoses `P1-1-4` (quota alert never fires)
**Related:** commit `f7c05ad5` (thread-parent conflict quarantine), migration `20260721050404` (quota notification contract), memory `project_outage_2026_07_22_projection_guard`

---

## 1. Problem

The 2026-07-22 outage had two independent faults. The first (duplicate-lead thread conflict) is fixed (`f7c05ad5` + merge repair). This spec addresses the **second, independent fault**.

The hourly email sync cycle (`SyncEngine.runSync` in `src/lib/api/services/sync-engine.ts`) runs, in order:

- **Steps 2–4** — deterministic ingestion of every delivered message. Durable: matched mail becomes activities + correspondence events; **unmatched Gmail-thread mail is durably written to `email_threads`** via `EmailThreadService.upsertFromEmail` (sync-engine.ts:2716).
- **Step 5** — AI classification of *unmatched* mail (`AISyncReviewer.reviewUnmatchedEmails` → OpenAI) to promote leads into pipeline opportunities.
- **Step 6** — deterministic accept-to-project conversion (`maybeAutoAdvanceOnAccept`, AI-free), then AI stage evaluation (`evaluateStagesWithSummary` → OpenAI) and AI lead-summary refresh (`refreshLeadSummariesForOpportunities` → OpenAI).
- **`persistSyncCheckpoint()`** — stamps `last_synced_at` / `history_id` (the Gmail cursor).

Steps 5 and 6 are wrapped in one `try { … } catch (aiErr) { … throw new LifecyclePersistenceError(…) }` (sync-engine.ts:4102–4638). The catch re-throws **every** failure — including an OpenAI outage — as a `LifecyclePersistenceError`, which aborts the cycle **before** `persistSyncCheckpoint()`.

On 2026-07-22 the platform sync key (`OPENAI_API_KEY_SYNC`) hit `insufficient_quota`. Messages kept ingesting (Steps 2–4 are durable and run before the abort), but **every hourly cycle died at Step 5**, so the Gmail cursor froze at `history_id 3217019`. Frozen >~7 days → Gmail history expiry → forced full-recovery resync.

This is wrong. An AI-provider outage is not a transient persistence failure; replaying hourly cannot fix it (billing must be topped up) — it only re-freezes the cursor.

### 1a. Sibling finding — P1-1-4 (quota alert never fires)

The `ai_provider_quota` notification contract (migration `20260721050404`) is fully applied in prod (functions + partial unique index + `incident_version` column all verified present), yet **zero `ai_provider_quota` rows have ever been created** — despite a real multi-hour outage that provably reached the monitoring code.

**Root cause (verified):** the alert recipient is resolved from `OPS_PLATFORM_ALERT_USER_ID` / `OPS_PLATFORM_ALERT_COMPANY_ID` (`openai-quota-alert-service.ts:129`). `.env.example` marks both `[_]` = "NOT in Vercel — must be added if needed"; they are unset in prod. `configuredIdentity()` therefore throws `"OPS platform alert identity is not configured"`, which both the report path (`reportOpenAIQuotaExhausted`) and the recovery-probe path (`captureOpenAIQuotaIncident`) swallow best-effort. **The alert has never had a recipient, so it has always silently no-op'd.**

**Secondary trap (verified):** `resolveConfiguredRecipient` additionally requires the recipient be an *active company admin*. The obvious operator identity `j4ckson.sweet@gmail.com` (user `1746a0c1-be43-45d6-ab4d-584e82594b1b`, company `a612edc0-…` "Canpro Deck and Rail") is **not** account-holder, **not** `is_company_admin`, and **not** in `admin_ids` — so even after the env vars are set to that pair, the alert would still throw and swallow. The real OPS operator identity is `jack@opsapp.co` (present in the `admins` table). Picking an eligible admin pair is a config decision owned by chip P1-1-4.

Because both failure modes are *silently swallowed*, this misconfiguration is invisible — nobody can tell the alert channel is dead. Making that observable is in scope here (§7), because the whole point of this work is to make the outage *surface*.

---

## 2. Design principles

1. **Mirror `f7c05ad5`:** quarantine the affected item, alert the operator, never block ingestion.
2. **Deterministic work is never blocked by an AI outage.** Message ingestion, accept-to-project conversion, and every database write keep their current fail-closed semantics (a genuine persistence failure still holds the cursor for idempotent replay).
3. **AI enrichment is deferrable.** Lead promotion, stage evaluation, and summaries are enrichment layered on already-durable messages. When the provider is down, defer them durably and advance the cursor.
4. **Defer durably, sweep later** — mirror the existing dirty-classification retry queue (`EmailThreadService.retryDirtyClassifications`, keyed on `email_threads.category_classified_at IS NULL`).
5. **Surface once, observably** — one operator-rail alert per incident (existing dedupe), plus a machine-observable deferral signal in the cron result that survives even a misconfigured rail.

---

## 3. Error taxonomy — what isolates vs. what holds the cursor

A new predicate **`isAIProviderUnavailableError(err)`** (added to `src/lib/api/services/openai-monitoring.ts`, co-located with `isOpenAIInsufficientQuotaError`) returns true for **provider-unavailability** — i.e. "the model call did not complete for reasons outside our data":

- `insufficient_quota` (via existing `isOpenAIInsufficientQuotaError`);
- OpenAI HTTP `status` 429 (rate limit past SDK retries), 500–599 (provider outage), 401/403 (missing/rejected key — same "AI calls stopped" family);
- OpenAI SDK transport errors: `APIConnectionError` / `APIConnectionTimeoutError` (name-based, since instanceof across the SDK boundary is unreliable).

It **must unwrap `.cause` chains**: `evaluateSingleBatch` wraps provider errors as a generic `Error` with `{ cause: originalError }` (ai-sync-reviewer.ts:706) and prefixed message; `reviewUnmatchedEmails` propagates raw. Walk `err`, `err.cause`, `err.cause.cause` (bounded depth).

It returns **false** for — and these keep the current cursor-holding behavior:

- `LifecyclePersistenceError` (our DB writes) — always re-thrown, always holds cursor.
- `StageEvaluationModelContractError` / `StageEvaluationModelRefusalError` / `LeadSummaryModelContractError` — the model *answered* but the answer was unusable for a specific thread. Not a provider outage; rare; per-thread; handled by the reviewer's internal retry + idempotent replay. Out of scope (§8).
- Any other error — wrapped as `LifecyclePersistenceError` (unchanged), holds cursor.

---

## 4. Sync-engine changes — finer-grained isolation

Replace the single coarse `try/catch` (sync-engine.ts:4102–4638) with per-AI-call isolation. The three AI calls each become individually guarded; **every deterministic path between them keeps running and keeps its fail-closed semantics.**

Track one cycle-scoped `let aiProviderOutage: unknown | null = null`.

### Step 5 — `reviewUnmatchedEmails`
```
if (unmatchedContexts.length > 0) {
  let aiResult = null;
  try {
    aiResult = await AISyncReviewer.reviewUnmatchedEmails(...);
  } catch (err) {
    if (!isAIProviderUnavailableError(err)) throw err;   // real failures still abort
    aiProviderOutage ??= err;
  }
  if (aiResult) {
    for (const classified of aiResult.classifiedLeads) { …existing persistence… }  // unchanged; still throws LifecyclePersistenceError on write failure
    result.newLeads += aiResult.newLeadsClassified;
  } else {
    await markUnmatchedThreadsPendingLeadScan(unmatchedContexts, connection);       // durable defer (§5)
    result.leadScansDeferred += unmatchedContexts.length;
  }
}
```
`reviewUnmatchedEmails` makes its OpenAI call up front before any Step-5 persistence, so an outage there means **no partial writes** — clean skip.

### Deterministic middle — always runs
`reconcileUnlinkedOutboundEmail` loop and the `maybeAutoAdvanceOnAccept` accept-conversion loop are AI-free and unchanged. They still aggregate/throw `LifecyclePersistenceError` (hold cursor). An earlier `aiProviderOutage` does **not** skip them.

### Step 6 — `evaluateStagesWithSummary` + `refreshLeadSummariesForOpportunities`
```
if (activeLeadTargets.size > 0) {
  …maybeAutoAdvanceOnAccept loop (deterministic, unchanged)…

  let stageResults = null;
  if (!aiProviderOutage) {                    // provider already known-down ⇒ skip the doomed call
    try {
      stageResults = await AISyncReviewer.evaluateStagesWithSummary(...);
    } catch (err) {
      if (!isAIProviderUnavailableError(err)) throw err;
      aiProviderOutage ??= err;
    }
  }
  if (stageResults) {
    for (const sr of stageResults) { …existing stage persistence… }   // unchanged
    const summaryRefresh = await refreshLeadSummariesForOpportunities(...);
    if (summaryRefresh.failed.length > 0) {
      throw new LifecyclePersistenceError(...);                        // genuine failures unchanged
    }
    if (summaryRefresh.deferred.length > 0) {                          // NEW bucket (§6)
      aiProviderOutage ??= summaryRefresh.deferred[0].error;
    }
  }
  // stage eval + summary deferred: opportunities re-evaluate naturally on their next
  // inbound message (advisory only; deterministic accept-conversion already handled
  // won/lost; summaries stay dirty and recover via the existing refresh path).
}
```

### After the block
```
} catch (aiErr) {
  if (aiErr instanceof LifecyclePersistenceError) throw aiErr;
  if (isAIProviderUnavailableError(aiErr)) { aiProviderOutage ??= aiErr; }   // safety net
  else throw new LifecyclePersistenceError(`[sync-engine] AI review failed before cursor advancement: …`);
}

if (aiProviderOutage) {
  await reportAIProviderOutageOnce(aiProviderOutage);   // operator rail, once per incident (§7)
  result.aiProviderDeferred = true;                     // observable in cron result even if rail misconfigured
}
```
The outer `catch` is retained only as a safety net for provider errors that escape an unguarded spot; genuine persistence failures still abort → cursor holds → replay. **The cycle then falls through to `persistSyncCheckpoint()` and advances the cursor.**

---

## 5. Durable defer — the lead-scan retry queue

### Marker
New nullable column `email_threads.lead_scan_pending_at timestamptz` (default NULL). It is a **positive deferral flag**, set only when an unmatched thread's Step-5 classification was skipped due to a provider outage. It is **never** inferred from `opportunity_id IS NULL` — prod has 3,614 unmatched threads, the vast majority already classified-and-correctly-rejected as non-leads. Inferring pending-state from a null opportunity would re-scan all of them.

**Migration** (additive, nullable — respects the iOS sync additive-only constraint; iOS ignores the column):
```sql
alter table public.email_threads
  add column if not exists lead_scan_pending_at timestamptz;

create index if not exists email_threads_lead_scan_pending_idx
  on public.email_threads (company_id, lead_scan_pending_at)
  where lead_scan_pending_at is not null and opportunity_id is null;
```
Partial index keeps the sweep scan cheap (the pending set is near-empty outside an outage window).

### `markUnmatchedThreadsPendingLeadScan(contexts, connection)`
For each unmatched context whose routing `mayInheritProviderThread` (i.e. the durable `email_threads` row exists), set `lead_scan_pending_at = now()` where `connection_id` + `provider_thread_id` match **and `opportunity_id IS NULL`** (never overwrite a promoted thread). Contact-form / `suppressThreadState` contexts have no durable thread row (sync-engine.ts:2694–2714); they are logged as non-thread deferrals and left to the next inbound message (documented limitation — these paths overwhelmingly re-arrive or are handled by the deterministic contact-form pipeline).

### Recovery is self-healing on new mail
When a customer replies to a deferred thread, `processInboundEmail`'s thread-inheritance check still finds no opportunity, falls back through the unmatched branch, and Step 5 re-runs (AI now healthy) → promotes → clears the marker. The sweep (§5a) is the belt-and-suspenders for threads that go silent after a single inbound during the outage window.

### 5a. Sweep — `retryPendingLeadScans`
Add to the `email-sync` cron (`src/app/api/cron/email-sync/route.ts`) beside the existing `retryDirtyClassifications` call, with the same independent try/catch and bounded shape (`limit`, `concurrency`; report `{ scanned, promoted, cleared, errors }` in the cron JSON).

For active companies, select `email_threads WHERE lead_scan_pending_at IS NOT NULL AND opportunity_id IS NULL` (bounded batch). Group by connection; for each thread, re-drive it through the **existing** classification+promotion path — the cleanest reuse is to fetch the thread from the provider (as `evaluateStagesWithSummary` already does via `provider.fetchThread`) and feed its latest inbound message through `processInboundEmail` → if it returns an unmatched context, run the extracted Step-5 promotion on it. Clear `lead_scan_pending_at` when the thread gains an opportunity (by any path) or is classified non-lead. If the sweep itself hits a provider outage, leave markers in place (no clear) — it retries next cycle.

**Extraction:** pull the Step-5 `for (const classified of aiResult.classifiedLeads) { … }` promotion body into an internal `SyncEngine` helper callable by both the live cycle and the sweep, so there is exactly one promotion implementation. This is the one non-trivial refactor; it must be behavior-preserving for the live path (covered by existing + new tests).

---

## 6. Lead-summary service — classify provider-unavailability

`refreshLeadSummariesForOpportunities` currently collects **all** per-opportunity errors into `failed[]` (lead-summary-service.ts:2001–2006), including quota errors, and the caller throws `LifecyclePersistenceError` when `failed` is non-empty. Add a `deferred: Array<{ opportunityId, error }>` bucket: in the per-opp catch, route `isAIProviderUnavailableError(error)` into `deferred`, everything else into `failed`. Callers that want the old strict behavior still act on `failed`; the sync cycle treats a non-empty `deferred` (with empty `failed`) as an outage to defer, not a cursor-holding failure. Deferred summaries stay dirty (`ai_summary` unchanged) and recover via the next inbound message or the `lead-summary-refresh` cron. Update the other two callers (sync-engine.ts:3554, 3721) to treat `deferred` the same way (defer, don't hold cursor).

---

## 7. Operator-rail alert + observability

### Deterministic alert from the sync path
`reportAIProviderOutageOnce` calls the existing `reportOpenAIQuotaExhausted({ keySource: "OPENAI_API_KEY_SYNC", workload: "email_sync", errorMetadata })` (openai-quota-alert-service.ts). This does **not** depend on the monitored-fetch side channel firing — the sync engine fires it directly when it isolates an outage. Existing dedupe (`platform-provider:openai:insufficient-quota:OPENAI_API_KEY_SYNC`, partial unique index) guarantees one open ledger row per incident regardless of how many connections/cycles hit it. Best-effort: never let alert failure affect the cycle.

### Make the misconfiguration observable (fixes the P1-1-4 silent-swallow trap)
In `openai-quota-alert-service.ts`, distinguish **configuration** failures from **delivery** failures in the operational log: when `configuredIdentity()` throws (identity unset) or `resolveConfiguredRecipient` throws "not a company administrator", emit a distinct, greppable event (e.g. `openai_quota_alert_unconfigured` with the specific reason) instead of folding it into the generic `openai_quota_notification_failed`. This does not reach the rail (there is no recipient) but makes "the alert channel is misconfigured" instantly diagnosable in logs. **No hardcoded fallback recipient** — that would violate the identity discipline of the 2026-07-20 design.

### Machine-observable deferral signal
`result.aiProviderDeferred: boolean` (+ `result.leadScansDeferred: number`) on `SyncCycleResult`, surfaced through `buildEmailSyncCronResult` into the `/api/cron/email-sync` JSON. This is the backstop that shows an outage was isolated **even when the rail is misconfigured** — visible to cron monitoring and manual inspection.

---

## 8. Explicitly out of scope (documented, not built)

- **Per-item model-contract-error quarantine** — a different failure class (the model answered unusably for one thread). Rare, per-thread, handled by internal retry + idempotent replay. Isolating it would weaken correctness guarantees for genuine data-processing failures.
- **Setting the P1-1-4 env vars / choosing the operator identity** — a config action owned by chip P1-1-4 and requiring a Jackson decision (§10).
- **Flipping `LEAD_SUMMARY_REFRESH_ENABLED`** — a cost-gate decision (Jackson's call). Deferred summaries recover on next inbound mail regardless.
- **A durable stage-eval marker** — stage evaluation is advisory; deterministic accept-conversion already handles won/lost; opportunities re-evaluate on their next inbound message. No data loss, so no marker needed.

---

## 9. Testing

Unit:
- `isAIProviderUnavailableError` — true for insufficient_quota (raw, and wrapped as `.cause`), 429/500/401/403 status shapes, APIConnection/timeout names; false for `LifecyclePersistenceError`, model-contract/refusal errors, plain `Error`, and deep-but-unrelated `.cause` chains.
- `markUnmatchedThreadsPendingLeadScan` — sets marker only for `mayInheritProviderThread` contexts and only where `opportunity_id IS NULL`; no-ops for contact-form contexts.
- `refreshLeadSummariesForOpportunities` — quota error → `deferred`, DB write error → `failed`.
- quota-alert service — unconfigured identity emits the distinct diagnostic event.

Integration (sync cycle):
- **Cursor advances** when `reviewUnmatchedEmails` throws insufficient_quota; unmatched threads marked pending; `persistSyncCheckpoint` called; `aiProviderDeferred = true`; alert fired once.
- **Cursor advances** when `evaluateStagesWithSummary` / summary refresh hit quota after Step-5 success; Step-5 opportunities persisted; stage/summary deferred.
- **Cursor holds** (regression guard) when a Step-5 persistence write fails (`LifecyclePersistenceError`) and when `maybeAutoAdvanceOnAccept` fails — unchanged behavior.
- **Deterministic paths still run** under a Step-5 provider outage (accept-conversion executes).
- Sweep `retryPendingLeadScans` promotes a deferred thread when AI is healthy and clears the marker; leaves it on repeat outage.

Follow the existing sync-engine test harness and `email-sync-cron-result` fixtures.

---

## 10. P1-1-4 hand-off — config action (Jackson-only)

To make the `ai_provider_quota` alert actually deliver, the P1-1-4 owner must, in **prod Vercel**, set `OPS_PLATFORM_ALERT_USER_ID` + `OPS_PLATFORM_ALERT_COMPANY_ID` to a user/company pair where the user is an **active company admin**. `j4ckson.sweet@gmail.com` (`1746a0c1…` / Canpro `a612edc0…`) does **not** qualify. The OPS operator identity `jack@opsapp.co` (in the `admins` table) is the likely correct recipient — resolve its `users.id` + `company_id` and confirm admin eligibility before setting. The code hardening in §7 will make any remaining misconfiguration loud instead of silent.

---

## 11. Rollout

Additive migration (safe on the low-tenant prod DB; iOS ignores the new column). **Do not push** — the branch carries other unpushed outage-remediation commits; integration and deploy are Jackson's call. Update `ops-software-bible/07_SPECIALIZED_FEATURES.md` (email sync / failure-isolation section) in the same session. Atomic commits; no AI attribution.

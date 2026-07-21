# Lead AI Summary Coverage Extension — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Every open lead with real context gets — and keeps — a fresh `opportunities.ai_summary`, regardless of whether its activity arrives by email, phone, site visit, note, or stage move.

**Architecture:** One new service (`LeadSummaryService`) builds a DB-only context bundle per lead (lead fields + activities + stage transitions + site visits + thread summaries as read-only input) and generates a summary with the shipped engine's exact model/client/contract discipline (gpt-4o-mini via `getSyncOpenAI()`, singleton alias key, strict JSON schema, temp 0.1, retry-once-on-contract-error), then writes through the shipped write path (`ai_summary` + `ai_summary_updated_at`, nothing else). One new route exposes it twice: `GET /api/cron/lead-summary-refresh` (recurring, env-gated by `LEAD_SUMMARY_REFRESH_ENABLED`) and `POST` on the same path (one-time backfill, explicit `{"mode":"backfill"}`, no env gate). No provider mailbox fetches, no locks, no migrations, no stage writes, no notifications.

**Tech Stack:** Next.js route handlers, Supabase service-role client, OpenAI SDK (`getSyncOpenAI`), Vitest (chain-level Supabase mock, mirroring `tests/integration/lead-lifecycle-cron.test.ts`).

**Design System:** N/A (backend only — no UI, no copy, no animation).

**Required Skills:** `superpowers:test-driven-development`, `superpowers:verification-before-completion`. UI/animation/copy skills N/A.

**Branch:** `claude/fervent-saha-3dc996` (== `release/lead-refinements-20260719` tip). Do NOT touch the held-merge checkout; commits here merge cleanly into the release branch after the canary.

---

## Verified facts this plan is built on (prod `ijeekuhbatykdomumfjx`, 2026-07-21)

- Canpro: 41 open-stage leads → 12 with summary, 29 missing: 21 email-linked, 8 no-email. Matches the brief.
- 20/21 email-linked leads have **fully bodied email activities in DB** (1.3k–110k chars; `activities.type='email'`, `body_text`); 19 also have `email_threads.ai_summary` populated. The one empty lead (`jillkski`, created 07-17) has zero synced content anywhere — the live engine will cover it on next thread activity; until then it is legitimately `insufficient_context` for the DB path.
- Of the 8 no-email leads: 2 have `call` activities, 1 has real stage moves, **5 are bare manual creates (no description, no activities, no site visits, no stage moves)** → nothing honest to summarize; skip until activity lands.
- `opportunities.last_activity_at` has **no maintaining trigger** — do not trust it. Compute freshness from source tables.
- `opportunity_email_threads.thread_id` and `opportunities.source_thread_key` hold **provider** thread ids; `email_threads` rows hold synced state incl. its own `ai_summary` (different feature — read-only input here, never written).
- Activity vocabulary in prod: `email`, `call`, `note`, `meeting`, `site_visit`. Non-email rows carry `content` (+ sometimes `outcome`, `duration_minutes`); email rows carry `body_text`/`content` + `subject` + `direction`.
- Engine gate: `AdminFeatureOverrideService.isAIFeatureEnabled(companyId, "phase_c")` — reads `admin_feature_overrides` (`feature_key='phase_c' AND enabled`). Discovery for sweeps: query that table for enabled company ids, then re-check per company via the service.
- Engine stage transitions land seconds AFTER the summary stamp in the same sync pass (`apply_email_opportunity_stage_transition` runs after the update payload) → a staleness epsilon is required or every engine stage change echoes one wasted regeneration.
- gpt-4o-mini pricing (verified 2026-07-21): $0.15/1M input, $0.60/1M output.

## Design decisions (locked)

1. **DB-context only.** Both backfill and refresh read context from our own tables. No `provider.fetchThread` — avoids mailbox-lock contention with the live canary sync, contact-form platform-thread cross-contamination, and OAuth cost. Prod data proves DB context is rich enough.
2. **Summary-only writes.** `ai_summary` + `ai_summary_updated_at`, `WHERE id AND company_id`. No `ai_stage_signals`, no stage transitions, no terminal flags, no auto-conversion, no notifications. Lifecycle stays owned by the shipped engine.
3. **Staleness rule (refresh mode):** `latestContextAt > (ai_summary_updated_at + 5 min)` where `latestContextAt = max(activities.created_at, stage_transitions.transitioned_at, site_visits.{updated,completed,created}_at, stage_entered_at)`; leads with `ai_summary IS NULL` are stale iff they have substantive context. `opportunities.updated_at` is deliberately excluded (our own write bumps it → self-trigger loop).
4. **Substantive context =** ≥1 activity row, OR ≥1 non-deleted site visit, OR ≥1 stage transition with `from_stage IS NOT NULL`, OR non-empty `description`. Bare name-only leads are skipped with `insufficient_context` — never fabricate.
5. **Backfill mode =** same pipeline, candidates restricted to `ai_summary IS NULL`, env gate bypassed (explicit manual POST), `dryRun` supported.
6. **Cadence:** hourly at :40 during the email-sync operating window — `40 13-23,0-4 * * *` (16 runs/day). Ships **disabled** (`LEAD_SUMMARY_REFRESH_ENABLED` unset) pending Jackson's cost-gate approval.
7. **Ordering & caps:** stalest first (`ai_summary_updated_at` NULLs first, then oldest), `maxLeadsPerRun` default 40 — structural cost cap; remainder caught next run.
8. **Per-lead failure isolation:** one lead's model-contract failure (after 1 retry) records into `failed[]` and the run continues.

## Cost model (for the gate report — do not enable the cron before Jackson sees this)

- Per summary: ≤2.6k input + ≤120 output tokens ≈ **$0.0005 ceiling**.
- One-time backfill: 24 eligible leads ≈ **$0.01**.
- Recurring at Canpro volume (observed: <1 non-email activity/day + a few manual stage drags/week): **~$0.05–0.60/month expected**.
- Structural worst case (40 leads × 16 runs/day, unreachable in practice): $9.60/month.
- Vercel: +~480 invocations/month, sub-second no-ops while idle or gate off.

---

### Task 1: `LeadSummaryService` + unit-level tests

**Files:**
- Create: `src/lib/api/services/lead-summary-service.ts`
- Test: `tests/integration/lead-summary-refresh-cron.test.ts` (service sections)

Service exports:

```ts
export interface LeadSummaryRunResult {
  companiesConsidered: number;
  companiesEnabled: number;
  leadsScanned: number;
  candidates: number;
  summariesWritten: number;
  skippedInsufficientContext: number;
  failed: Array<{ opportunityId: string; error: string }>;
  written: Array<{ opportunityId: string; title: string }>; // capped at 50
  dryRun: boolean;
}

export async function runLeadSummaryRefresh(input: {
  supabase: SupabaseLike;         // injectable, mirrors lead-lifecycle-cron-service
  mode: "refresh" | "backfill";
  companyId?: string;
  dryRun?: boolean;
  maxLeadsPerRun?: number;        // default 40
  now?: Date;
}): Promise<LeadSummaryRunResult>
```

Internal steps per company (discovery: `admin_feature_overrides` where `feature_key='phase_c' AND enabled=true`, optional `companyId` scope, re-verified via `AdminFeatureOverrideService.isAIFeatureEnabled`):
1. Fetch open opps (6 active stages, not deleted/archived/merged) with the context fields.
2. Fetch context tuples for those opp ids from `activities`, `stage_transitions`, `site_visits` (DESC, LIMIT 10_000/2_000/1_000 with overflow log).
3. Compute staleness per decision 3/4/5; order stalest-first; cap at `maxLeadsPerRun`.
4. For each candidate: assemble context bundle (caps: description 600, prior summary 600, last 5 real stage moves, last 3 site visits w/ notes 400 + internal 400 + measurements 300, last 15 non-email activities w/ content 400, last 10 email activities chronological w/ body 500 — shipped cap, up to 3 `email_threads.ai_summary` 300 each), generate via `generateLeadSummaryFromContext` (exported for tests: singleton alias `k0`, strict json_schema `{results:[{tid,summary}]}`, gpt-4o-mini, temp 0.1, max_tokens 300, refusal/finish_reason/shape checks, retry once on contract error), write both fields unless `dryRun`.

System prompt reuses the shipped summary spec **verbatim** ("1-2 sentence summary … Be specific — mention addresses, materials, dollar amounts if known.") reframed for a mixed activity record, plus continuity instruction ("If a previous summary is provided, update it with new information rather than contradicting it") and the same "Return exactly one result / RESPOND WITH JSON" contract lines.

Tests (chain-level Supabase mock + `vi.mock` of `./openai-clients` and `admin-feature-override-service`): staleness epsilon (2 s echo → not stale; 10 min note → stale), NULL-summary + bare lead → skipped insufficient, NULL-summary + context → generated, backfill ignores stale-with-summary leads, dryRun writes nothing, contract failure retries once then isolates into `failed[]`, write payload is exactly `{ai_summary, ai_summary_updated_at}`.

Run: `npx vitest run tests/integration/lead-summary-refresh-cron.test.ts` → all pass.

Commit: `feat(email): add lead summary refresh service`

### Task 2: Route (GET cron + POST backfill) + `vercel.json` + route tests

**Files:**
- Create: `src/app/api/cron/lead-summary-refresh/route.ts`
- Modify: `vercel.json` (add cron entry `40 13-23,0-4 * * *`)
- Test: same test file (route sections)

GET: CRON_SECRET bearer → env gate (`LEAD_SUMMARY_REFRESH_ENABLED !== "true"` → `{ok:true,skipped:true,reason:"lead_summary_refresh_disabled"}`) → `runLeadSummaryRefresh({mode:"refresh"})` → structured log + JSON. `maxDuration=300`, `runtime="nodejs"`, `dynamic="force-dynamic"`.
POST: CRON_SECRET bearer → body must be `{"mode":"backfill", companyId?, dryRun?}` (400 otherwise) → runs regardless of env flag.

Tests: 401s (both verbs), GET skips when flag unset (no supabase touch), GET runs when flag true, POST rejects bad body, POST backfill runs with flag unset, POST dryRun returns would-write counts with zero update calls.

Commit: `feat(email): add lead summary refresh cron and backfill entry`

### Task 3: Repo docs + bible

**Files:**
- Modify: `CLAUDE.md` (worktree root — Product Environment Variables table: add `LEAD_SUMMARY_REFRESH_ENABLED`)
- Modify: `../ops-software-bible/03_DATA_ARCHITECTURE.md` (ai_summary column notes → full trigger design)
- Modify: `../ops-software-bible/04_API_AND_INTEGRATION.md` (cron inventory section, if present — verify)

Bible content: the three writers (import seed → sync engine per-thread-activity → activity-driven refresh cron/backfill), staleness rule + epsilon, eligibility rule, phase_c + env gating, cadence, cost model, thread-vs-lead field distinction.

Commits: `docs(env): document LEAD_SUMMARY_REFRESH_ENABLED` (ops-web), bible commit in its own repo: `docs(pipeline): lead ai_summary trigger design`

### Task 4: Verification + cost-gate report

- `npx vitest run tests/integration/lead-summary-refresh-cron.test.ts` green; `npx tsc --noEmit` clean on new files (repo lint is known-red on pre-existing issues — judge by own signals).
- `npx eslint` the new files only.
- Final report to Jackson: what shipped, the backfill run instruction (one `curl -X POST` after deploy), cost table, and the explicit "cron is OFF until you approve" gate.

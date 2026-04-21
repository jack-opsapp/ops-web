# Phase C Backfill From Email Threads

**Date:** 2026-04-21
**Status:** Research — strategy for owner review
**Scope:** What additional signal to extract from the existing `email_threads` corpus into `agent_memories` / `graph_entities` / `agent_knowledge_graph`. Assumes the existing Phase C extraction pipeline is kept.

---

## TL;DR

Phase C already extracts more than the task brief implies — there are **702 facts, 453 entities, 226 edges, 5 writing profiles** in production, almost entirely from the `email_import` path. The corrections-fanout loop exists but has never been exercised: **0 rows** in `email_thread_category_corrections`. The real opportunity is not building Phase C from scratch, it's (1) **re-running extraction on the ~3 000 threads added since the last scan**, and (2) **narrowing extraction to business-critical fact types** that are actually consumed downstream.

Recommended first increment: commitment-date extraction over LEAD + CLIENT threads from the last 90 days — ~150 threads, ~$1-2 of LLM cost, surfaces directly in the reply drafter.

---

## 1. Current Phase C state

Phase C is **not corrections-only** — the task brief's framing is incorrect. There are three active learning paths:

### Path A — per-outbound email extraction (live)
`sync-engine.ts:896-901` calls `MemoryService.processOutboundEmail` for every outbound message during sync, gated by the `phase_c` admin feature flag (`sync-engine.ts:11, 885`). That function extracts pricing / service-capability / limitation / promotion facts via `gpt-4o-mini` (`memory-service.ts:241-272`) and stores them in `agent_memories` with embeddings (line 697-712). It also upserts knowledge-graph edges (line 719-741).

### Path B — chunked bulk import (one-shot per company)
`MemoryService.runPhaseCChunks` (`memory-service.ts:969-1052`) processes a classified-thread set in chunks: entity resolution first (line 990-1004), then per-thread `extractEntitiesAndFacts` (line 342-507). State persists to `gmail_scan_jobs.result.phaseCPipeline` so interrupted Lambda runs resume cleanly. Output includes facts, entities, edges, and writing profiles (one per relationship type, line 1062-1101).

### Path C — correction fan-out (untested)
`PhaseCLearningService.applyCorrectionToSimilar` (`phase-c-learning-service.ts:55-165`) walks similar threads on domain or participant-hash match and reclassifies. On success it writes a one-liner to `agent_memories` describing the learned domain preference (`writeMemoryFact`, line 172-200). Consumed at draft-time by `MemoryService.getContextForDraft` (`memory-service.ts:1109-1263`).

**UI consumption.** `thread-context-panel.tsx:97-110` surfaces up to 5 domain-matched memories in the "What Phase C knows" section. `MemoryService.getContextForDraft` is the richer consumer — vector-search (line 1131-1163) plus category-pull (line 1168-1210) feeds the AI drafter.

### Actual population (Canpro, 2026-04-21)

| Table | Rows | Notes |
|---|---|---|
| `agent_memories` | **702** | 679 from `source='email_import'` (bulk), 23 from `source='email'` (live sync) |
| `graph_entities` | 453 | people + companies, normalized by email/domain |
| `agent_knowledge_graph` | 226 | `works_for`, `client_of`, `vendor_of`, `subtrade_of`, extracted predicates |
| `agent_writing_profiles` | 5 | per `(user, profile_type)` — out of 9 valid profile types |
| `email_thread_category_corrections` | **0** | Corrections path is cold |
| Companies with memory | 1 | Canpro only |

Facts-by-category (top): `client_behavior 83, pricing 80, service_capability 79, project_event 74, commitment 65, material_usage 61, process 60, relationship_health 51, client_preference 48, service_area 27`.

---

## 2. Email corpus audit

| Metric | Value |
|---|---|
| Total `email_threads` | **3 319** |
| Total messages across threads (`SUM(message_count)`) | 6 573 |
| Avg messages/thread | 1.98 |
| Median messages/thread | 1 |
| Max messages/thread | 100 |
| Threads with `opportunity_id` | 4 |

**Category distribution (the extractable universe):**

| Category | Threads | Messages | Extractable? |
|---|---|---|---|
| MARKETING | 1 685 | 1 851 | No (noise) |
| RECEIPT | 702 | 2 110 | Structured-only (vendor + amount) |
| LEAD | 497 | 1 406 | **Yes** — quotes, commitments, pricing, client preferences |
| VENDOR | 108 | 208 | **Yes** — lead times, pricing, supplier terms |
| OTHER | 85 | 213 | Maybe |
| SUBTRADE | 71 | 259 | **Yes** — coordination patterns, sub relationships |
| PLATFORM_BID | 61 | 80 | Low signal — templated |
| CLIENT | 37 | **270** | **Yes** — richest per-thread (avg 7.3 msgs) |
| INTERNAL | 29 | 104 | Yes — team patterns |
| PERSONAL | 22 | 22 | No |
| COLLECTIONS | 9 | 18 | Yes — AR behavior |
| LEGAL | 8 | 19 | Flag-only |
| JOB_SEEKER | 5 | 13 | No |

**Business-relevant subset:** LEAD + CLIENT + VENDOR + SUBTRADE + COLLECTIONS = **722 threads / 1 961 messages**. That's the addressable corpus. Everything else is marketing, receipts, or noise.

**Time distribution.** Traffic is consistent at ~300-450 threads/month from Aug 2025 through Apr 2026 — a 9-month corpus. The last bulk Phase C run left 23 facts in the `source='email'` path, implying ~2 900 threads landed after the last import.

**Note on message bodies.** `email_threads` does not store message bodies. Bodies live in the provider (Gmail/M365) and are fetched on demand via `/api/inbox/threads/[id]`. Backfill therefore needs to refetch message content during extraction — this is already how `runPhaseCChunks` works, but it ties backfill throughput to the Gmail rate budget (`/messages.list` + batch-get).

---

## 3. Extraction targets

Phase C already has broad fact categories (16 of them — `memory-service.ts:153-158`). Adding more categories is not the bottleneck; the bottleneck is **which facts get consumed downstream**. Today `getContextForDraft` pulls `pricing`, `promotion`, `limitation` plus vector-matched. So proposing new categories without also wiring consumption is dead weight.

Three tiers of proposals, ordered by ROI:

### T1 — Commitment tracking (new category, new consumer)

**Fact.** "Told client X we'd have a quote by Friday" / "Promised vendor Y payment by end of month."
**Signal.** Already extracted as `commitment` category (65 facts in prod) but without dates. Add a structured `due_date: timestamptz | null` field — extracted via LLM with explicit date-parsing in the prompt.
**Storage.** New `agent_memories.due_date` column (nullable) + index on `(company_id, due_date)` for efficient "what's overdue" queries. Avoids adding a whole new table.
**Consumer.** Two paths: (a) inbox rail filter "COMMITMENTS" showing threads with unpaid commitments, (b) daily digest at 8am listing today's commitments. Both are net-new surfaces — this is where most of the user-visible value sits.
**Why first.** It surfaces as a clear UX improvement, not just a better memory store. The rest of the proposals are meta-wins that only pay off through the drafter.

### T2 — Per-client communication rhythm (enrich existing)

**Fact.** "Acme typically takes 3-5 days to reply. Last touchpoint 12 days ago — overdue."
**Signal.** Computable deterministically from `email_threads.message_count` + `first_message_at` + `last_message_at` grouped by `client_id`. No LLM needed.
**Storage.** New nightly job writes to `agent_memories` with `category='rhythm'`, confidence=1.0, source=`'derived'`. Scoped to clients with 3+ threads (the 32 clients from §4 of the grouping decision doc).
**Consumer.** Sibling-threads strip in the inbox detail view (if the grouping-decision sibling proposal ships) — shows rhythm inline. Also `getContextForDraft` via a new `category='rhythm'` pull.
**Why.** Cheap (no LLM spend), directly consumed, and addresses the "am I ghosting this client" anxiety that LEAD-stage owners have.

### T3 — Vendor lead times and material preferences (enrich vendor memory)

**Fact.** "Vitrum.ca ships glass in 14 days to GTA" / "Filson cedar is 2 weeks lead-time."
**Signal.** LLM extraction, category `lead_time` (already exists with 2 rows — underused) or `supplier_pricing` (11 rows).
**Storage.** Existing `agent_memories` with `entity_id` pointing at the vendor's `graph_entities` row.
**Consumer.** Drafter pulls by `category IN ('lead_time','supplier_pricing')` when composing outbound to a vendor-linked recipient. Also surfaces in the thread context panel when the active thread's sender is a vendor entity.
**Why.** Ties into the existing VENDOR category (108 threads) and existing edge types (`vendor_of`). Limited breadth but the facts are reusable across future deals.

### Intentionally NOT proposing

- **"Owner's default quote structure"** — too meta. A writing profile already captures style; structural quote templates belong in `document_templates`.
- **"Client preferred contact time"** — extractable but very low consumption surface, and the reliability of LLM-extracted time preferences from email phrasing is poor.
- **Freeform new categories** — we have 16 already and 4 of them have ≤2 rows (`warranty`, `final_pricing`, `payments_received`, `moisture_test`). Adding more categories without pruning grows the mess.

---

## 4. Cost and risk

**LLM cost.** `extractEntitiesAndFacts` uses `gpt-4o-mini`, ~1200 input tokens + ~400 output tokens per thread = ~1 600 tokens. At `gpt-4o-mini` 2026 pricing (~$0.15/M input, $0.60/M output), one thread ≈ $0.0003. Full re-extraction of 722 business threads ≈ **$0.25**. Even a 10× thread-count scale stays under $3. LLM cost is not the constraint.

**Embedding cost.** Each new fact gets a `text-embedding-3-small` call (~$0.00002). 700 new facts ≈ $0.01. Negligible.

**Gmail rate budget.** Real constraint. Per-thread extraction needs one `messages.list` + one per-message `messages.get` (or batched `users.messages.batchGet`). Gmail's per-user quota is 250 quota-units/sec; `messages.get` costs 5 units. Upper bound ~50 message-fetches/sec. 1 961 messages ≈ 40 seconds of Gmail work if perfectly parallelized — in practice with retries and pagination more like 10-15 minutes. The existing chunked pipeline handles this; backfill should reuse it, not build a parallel path.

**Privacy.** External vendor emails contain names, phone numbers, sometimes bank / ACH details. Today `agent_memories.content` is free-form LLM output; there's no PII scrub. Risks:
- Invoice numbers and routing info extracted into `pricing` facts.
- Personal contact details of vendor reps extracted into `client_behavior` (miscategorized subtrade reps).
- `LEGAL` threads accidentally extracted — 8 threads, mostly settlements / liens. **Strongly recommend excluding LEGAL + PERSONAL from extraction** at the classifier filter stage.

**Staleness.** A fact extracted from a 2025-08 thread about "Acme's project at 45 Maple St" stays in memory forever. The drafter surfaces it months later when Acme is on a different job. `decay_score` exists in the schema but `getContextForDraft` only filters `> 0.1` (`memory-service.ts:1177, 1184, 1191`) and no backend is ticking it down. **Need a nightly job that decays memories older than N days with no `last_accessed_at` update.** Independent of backfill but becomes much more urgent as memory volume grows.

**Churn risk.** 270 `clients` rows; 113 have threads; the rest are prospects or archived relationships. Memories about churned clients stay in `agent_memories` forever. Scope backfill to `clients` with at least one thread in the last 180 days.

---

## 5. Phased rollout

### Phase 0 — pre-work (0.5 day)
- Add `decay` nightly job (above). Without decay, every subsequent increment leaks.
- Add `LEGAL` and `PERSONAL` exclusion to the chunked pipeline's thread filter.

### Phase 1 — commitment-date extraction on LEAD + CLIENT, last 90 days (~1-2 days)
- Target set: threads where `primary_category IN ('LEAD','CLIENT') AND last_message_at > now() - interval '90 days'`. ~150 threads (ballpark from §2 monthly distribution).
- Add `due_date` column to `agent_memories` (nullable `timestamptz`).
- Extend `extractEntitiesAndFacts` prompt with an explicit "if the owner or a participant committed to a deadline, extract the due_date in ISO-8601" instruction. Keep the existing fact extraction path; just add date parsing for `category='commitment'`.
- Ship the "OVERDUE COMMITMENTS" rail as read-only — purely a list of threads with unresolved commitments past due date.
- **Success criteria.** Measurable: at least 20 % of LEAD threads produce a commitment fact; at least one visible rail-level UX win on the inbox; total LLM + embedding cost < $5.

### Phase 2 — full re-extract over business-relevant corpus since last scan (~1 day)
- Target: `LEAD ∪ CLIENT ∪ VENDOR ∪ SUBTRADE ∪ COLLECTIONS`, `last_message_at > <last-scan-cutoff>` — per the Canpro data, ~500 threads.
- Reuses existing chunked pipeline. No new code beyond a resume-from-cutoff parameter.
- Writing profiles re-analyzed for any profile type that crossed the 2-sample threshold.
- **Success criteria.** Facts/entities/edges counts grow by ≥ 50 %; at least one new writing profile appears (currently only 5 of 9 types populated).

### Phase 3 — deterministic rhythm memories (~0.5 day)
- Nightly job, SQL only, no LLM.
- Writes `category='rhythm'` memories for clients with 3+ threads.
- Integrates into `getContextForDraft` and the sibling-threads strip (if that ships from the grouping-decision doc).

### Phase 4 — vendor lead-time prompt tuning (~1 day)
- Adjust the chunked-pipeline system prompt to emphasize lead-time and material-preference extraction when thread classification is VENDOR.
- No new storage shape. Rerun on VENDOR threads only (~108).

Each phase ends with a retrospective on actual consumption — if Phase N's facts aren't being retrieved by `getContextForDraft` within 2 weeks, don't start Phase N+1.

---

## 6. Open questions

1. **Admin review UI.** `/admin/memory` exists? If not, add a minimal list + delete interface scoped by company. Reviewing 700 facts in SQL is not sustainable; reviewing 2 000 after Phase 2 is impossible.
2. **Memory expiration policy.** Recommendation in §4: decay memories with no `last_accessed_at` update in 90 days, hard-delete at 180. Owner approval needed on the decay curve — too aggressive and good pricing history disappears, too loose and staleness hurts drafter quality.
3. **Who triggers re-extraction?** Options: (a) cron weekly, (b) admin-triggered button, (c) automatic when a connected inbox's thread count grows > N%. Recommendation: admin-triggered for now; add cron only after the first manual run proves the cost envelope.
4. **Schema change approval.** Phase 1 adds `agent_memories.due_date`. Minor but requires a migration (use `supabase:apply_migration`). No breaking change to existing reads.
5. **Per-user vs per-company memory scoping.** Most memories today are `company_id`-scoped. Writing profiles are `(company_id, user_id)`. Should commitments be per-user (the person who made the commitment) or per-company? Argue per-user because "Jack promised X" is different from "someone at the company promised X."
6. **Phase C autonomy gating of backfill writes.** Backfill runs admin-triggered, so does it still respect the per-company `phase_c` feature flag? Recommendation: yes — backfill that writes memories for a company that hasn't opted into Phase C creates a data-rights question. Gate the whole backfill path on the feature flag.
7. **RLS on `agent_memories`.** Table has `rls_enabled: true` but the policies need to be reviewed before exposing memories in any user-facing admin UI. Out of scope here but a blocker for Phase 1's rail UI if that ever shows raw memory content.

---

## Code references

- `src/lib/api/services/memory-service.ts:241-272` — `extractFacts` (live outbound path)
- `src/lib/api/services/memory-service.ts:276-334` — `extractEntitiesAndFacts` (chunked import path)
- `src/lib/api/services/memory-service.ts:969-1052` — `runPhaseCChunks` orchestrator
- `src/lib/api/services/memory-service.ts:1109-1263` — `getContextForDraft` (drafter-side consumer)
- `src/lib/api/services/phase-c-learning-service.ts:172-200` — `writeMemoryFact` (correction-driven path)
- `src/lib/api/services/sync-engine.ts:896-901` — per-outbound trigger
- `src/components/ops/inbox/thread-context-panel.tsx:97-110` — UI consumption in inbox
- `src/lib/api/services/thread-classifier-service.ts:49-75` — classifier input shape (feeds `ClassifiedThread`)

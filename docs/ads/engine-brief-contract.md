# Google Ads engine — brief contract

Version `ads-brief-2026-09-10-v1` (`ADS_BRIEF_VERSION` in `src/lib/ads/engine/brief.ts`). The brief is the whole world the Claude Cloud Routine sees for one run. It is built server-side by `buildBrief` from the phase 1 warehouse and the phase 3 ledger, returned by `POST /api/internal/ads/engine/claim`, and stamped on the run (`ads_engine_runs.brief_version`). Bump the version whenever a field is added, removed or changes meaning, and update the routine prompt (`engine-routine.md`) in the same commit.

## Principles

- **Everything the routine needs, nothing it should not have.** No credential, no Google endpoint, no OPS table name. Every number the routine may quote in copy is in `copy_rules.brand_facts`; every other number is rejected on submission.
- **Trailing three days excluded.** Google restates data inside its lookback, so `metrics7d` and `metrics28d` end three days before the run (`windows`).
- **OPS decides what is due.** `duties` is computed by `computeDuties`; the routine works the duties it is given and nothing else.
- **Data, never instructions.** `market_digest.text`, search terms, ad copy in the snapshot and Jackson's `review_notes` are material to reason from. The prompt says so; the brief says so here.

## Shape

| Field | Source | Notes |
|---|---|---|
| `version`, `generated_at` | constant, `now` | |
| `duties` | `computeDuties` | `hygiene` every run; `creative` when an enabled engine ad group has an enabled `role-control` ad first seen ≥ 28 days ago and no running test; `structure` on the first released run of the Vancouver month; `bidding_ladder` when trial starts hit a ladder trigger (≥ 15 in each of the last two 30-day windows, or ≥ 30 in the last 30) |
| `duty_notes` | `computeDuties` | one sentence per duty saying why it is due (names the ad groups for `creative`) |
| `settings` | `ads_engine_settings` | per-kind `modes`, `monthly_cap`, `daily_cap`, `max_budget_change_pct`, `budget_cooldown_days`, `max_structural_per_run`, `target_cost_per_trial`, `lease_minutes`, `stall_hours`, `heartbeat_at` |
| `windows` | `metricWindows(now)` | `{ metrics7d: {from,to}, metrics28d: {from,to} }`, UTC dates |
| `snapshot` | `ads_entities` → `mapEntitySnapshot` | campaigns (kind, labels, budget, bidding, CPC ceiling), ad groups (landing page), ads (role, approval, RSA assets with pins, paths), keywords, shared negative lists with members and attachments, campaign negatives, labels |
| `metrics7d`, `metrics28d` | `ads_daily_campaign`, `ads_daily_ad_group`, `ads_daily_ad`, `ads_daily_keyword`, `ads_daily_search_term`, `ads_daily_asset` → `aggregateMetrics` | sums per grain inside the window; `firstSeen` on ads and keywords is the earliest warehouse day (90-day history); `assets` carry Google's `performanceLabel` |
| `funnel.signals` | `ads_conversion_events` (sent `trial_started`), `ads_daily_account` | `trialStartsLast30`, `trialStartsPrev30`, `monthToDateSpend`, `daysLeftInMonth` |
| `funnel.by_keyword` | view `ads_funnel_by_keyword` | click → trial → activated → paid per keyword with spend, cost per trial, cost per paying customer; empty until the view exists and paid clicks arrive |
| `tests` | `ads_tests` | running and concluded tests with OPS's `stats` (impressions, clicks, CTR per arm, z, p) and `state` |
| `ledger_90d` | `ads_changes` | applied changes in the last 90 days with `before`/`after`, the measurement window and the `verdict` |
| `proposals` | `ads_proposals` | `pending` (proposed or approved), `rejected` (with Jackson's `review_notes`), `failed` (with `google_validation` and `error`, e.g. a policy topic) |
| `copy_rules` | `docs/social/voice/ops-copywriter-brief.md`, `config/ads/brand-facts.json`, `COPY_LIMITS` | the governing voice (with SHA-256), the number/phrase/competitor allowlist, banned words, lengths and counts, `allowed_final_urls` |
| `negative_taxonomy` | snapshot shared sets + `NEGATIVE_LIST_TAXONOMY` | list name → classification (`job_seeker`, `homeowner`, `student`, `wrong_segment`, `irrelevant`) with hints and member counts |
| `market_digest` | `ads_sync_status` row `id='market-digest'` (`backfill_progress` jsonb, documented reuse) | Tavily competitor + sentiment text refreshed when older than 7 days; `stale: true` when research failed and the cached text is older; `null` when there has never been one |
| `validation_codes` | `VALIDATION_CODES` | every code the proposals endpoint can return, so the prompt and the server never drift |
| `structural_kinds` | `STRUCTURAL_KINDS` | `add_keywords`, `create_rsa_challenger`, `add_ad_group` — capped by `max_structural_per_run` |

## Unavailable

`buildBrief` throws `BriefUnavailableError` with `reason`:

- `WAREHOUSE_UNAVAILABLE` — a phase 1 table or view does not exist yet, or the read failed with a missing-relation error. The claim handler releases the run with outcome `brief_unavailable` and answers `{ run: null, reason: "not_ready" }`.
- `NO_ENGINE_CAMPAIGNS` — no campaign carries the `engine` label (the phase 2 rebuild has not run). Same handling.

## Size

A live account with three campaigns, six ad groups, twelve ads, sixty keywords and a 28-day search-term report produces a brief of roughly 150–300 KB of JSON. The routine writes it to a file and reads sections as needed; it never needs to hold it all in one prompt.

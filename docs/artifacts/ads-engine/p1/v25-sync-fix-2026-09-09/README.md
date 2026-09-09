# Google Ads engine · phase 1 sync repair (2026-09-09)

The two phase 1 defects the phase 3 rehearsal found on 2026-09-08
(`docs/artifacts/ads-engine/p3/local-e2e-2026-09-08/README.md`, section "What
it found for phase 1"), fixed and proved on `feat/ads-engine-p1`.

Nothing reached production. Every Google call in this record is a
`searchStream` read; no `mutate` was sent. The worktree's `.env.local` was
swapped to the local stack for the run and restored afterwards.

| Defect | Fix | Commit |
|---|---|---|
| `/api/cron/ads-sync` died on v25 `UNRECOGNIZED_FIELD: campaign.start_date, campaign.end_date` (Google request `CnGpVfygOu0M3ED2DpjO3w`) | select `campaign.start_date_time` / `campaign.end_date_time` | `e9e704da8` |
| The entity snapshot never fetched `campaign_shared_set`, so the engine could not see which negative list guards which campaign | tenth `searchStream` call + a follow-up migration widening the `entity_type` check | `930182d28` |

## The field names are not a guess

`campaign.start_date` and `campaign.end_date` do not exist in v25. The
replacements come from the v25 `Campaign` resource definition
(`google/ads/googleads/v25/resources/campaign.proto`, fields 104 and 105):

```
// The date and time when campaign started in serving...
optional string start_date_time = 104;
// The last day and time of the campaign in serving customer's timezone...
optional string end_date_time = 105;
```

`campaign_shared_set` likewise carries exactly the four fields the snapshot now
selects, and its resource name pattern is
`customers/{customer_id}/campaignSharedSets/{campaign_id}~{shared_set_id}` —
the collection `snapshot.ts` keys on.

## What is in here

| Path | What it is |
|---|---|
| `stack/stack.mjs`, `stack/shim.mjs` | The disposable stack: PostgreSQL 17 database `ops_ads_p1_sync` on the shared local cluster behind PostgREST (:3033) and the storage shim (:3032). `node stack.mjs up <worktree>` / `node stack.mjs down`. Same recipe as the phase 3 rehearsal stack, with two deliberate differences: it applies the **real** phase 1 migrations instead of that rehearsal's hand-written `warehouse-fixture.sql`, and it uses its own database name and ports so a sibling session running the phase 3 stack is undisturbed. |
| `ads-sync-response.json`, `ads-sync-response-rerun.json` | The two live `GET /api/cron/ads-sync` runs. |
| `gaql-probe.mjs`, `gaql-probe.txt` | Read-only probe of the live account: the fixed campaign query, the removed names, `shared_set`, and `campaign_shared_set` with and without the status filter. |
| `write-path-check.mjs`, `write-path-check.txt` | A `campaign_shared_set` row pushed through the same PostgREST lane supabase-js uses. |
| `mapper-check.mjs`, `mapper-check.txt` | Phase 3's `mapEntitySnapshot`, transpiled standalone out of the p3 worktree and fed rows in the shape phase 1 now writes. Nothing in that worktree was modified. |
| `database-state.txt` | The disposable database after both runs. |

## How it ran

1. `node stack.mjs up <worktree>` built `ops_ads_p1_sync` and applied five real
   migrations in dependency order: `cron_workload_controls`,
   `ads_daily_search_terms`, `ads_conversion_outbox`, `ads_warehouse_grain`,
   `ads_entities_campaign_shared_set`. The pre-existing objects those build on
   (`companies`, `projects`, `billing_events`, `trial_attributions`,
   `touchpoints`, `users`, `notifications`, `ads_daily_account`,
   `ads_daily_campaign`, `ads_sync_status`, the old `ads_daily_keyword`) are
   stubbed in the shapes production actually has, read off the live database
   on 2026-09-09.
2. `.env.local` was backed up and rewritten to point at the local stack — the
   production Supabase URL, keys and database password removed entirely
   (`grep -c supabase.co` = 0), the real Google Ads and Firebase credentials
   kept so the sync made real reads. Restored afterwards.
3. `npm run dev -- -p 3245`, then `GET /api/cron/ads-sync` with the stack's
   own `CRON_SECRET`.

## What was proven, live

- **The daily sync runs.** `HTTP 200 · {"status":"synced","date":"2026-09-08"}`
  in 11.2s, `entityRows: 1678` off the real account — the call that previously
  took the whole route down. A second run returned byte-identical numbers, so
  the snapshot upsert is idempotent and the workload lease releases.
- **The v25 fields are right and the old ones are still wrong.** The fixed
  campaign query answered `HTTP 200` with real values
  (`"startDateTime": "2025-02-21 10:28:17"`); the removed names answered
  `HTTP 400 · UNRECOGNIZED_FIELD` with the same message the rehearsal
  recorded. `database-state.txt` shows the value stored in the payload.
- **`campaign_shared_set` is a valid v25 read.** `HTTP 200`. A wrong resource
  or field name returns 400, as the probe's second case demonstrates.
- **The warehouse accepts the new row type.** A `campaign_shared_set` row
  upserted through PostgREST returned `HTTP 201`; an unknown `entity_type`
  returned `HTTP 400 · 23514`, so the widened check is still a check.
  `tests/sql/ads-warehouse-grain-runtime.mjs` proves the same constraint from
  both sides — refused before the follow-up migration, accepted after — and
  that re-running the migration is a no-op.
- **Phase 3 reads what phase 1 writes.** Fed rows in the exact shape the sync
  now stores, `mapEntitySnapshot` resolved the attachment:
  `Competitors (jobber) → ["customers/4454506598/campaigns/22263645060"]`.

## What could not be proven live, and why

**No `campaign_shared_set` row came from Google, because the account has
none.** The probe asked twice — with the `status != 'REMOVED'` filter the sync
applies and with no filter at all — and both answered `HTTP 200` with zero
rows. The account holds exactly one shared set (`Competitors`, type `BRANDS`,
four members, `ENABLED`) and it is attached to no campaign. So the query is
proven correct and empty, not proven to carry a row end to end from Google.

The two links that a live attachment would have exercised are closed
separately and deliberately: the write path by `write-path-check.mjs` and the
mapper by `mapper-check.mjs`, both using the real account's ids. The single
`campaign_shared_set` row in `database-state.txt` is that synthetic row, not
one Google returned.

The first real attachment arrives when phase 2 builds the campaigns and binds
the negative lists to them. That run is the remaining evidence.

**The grain counts are all zero** (`adGroups`, `ads`, `assets`, `keywords`,
`clicks`). Every campaign on the account is `PAUSED`, so the trailing
three-day window has no metrics to report. Those four range reports and the
three `click_view` queries did execute — `apiCalls: 7` — and none of them
failed, which is the first time that code path has run at all: the v25 error
used to abort the route before it was reached.

## Verification

| Check | Result |
|---|---|
| `npx vitest run tests/unit/analytics tests/unit/admin` | 16 files, 142 tests passed |
| `npx tsc --noEmit` | exit 0 |
| `node tests/sql/ads-warehouse-grain-runtime.mjs` | PASS |
| `GET /api/cron/ads-sync` (live account, disposable database) | HTTP 200, 1678 entity rows, twice |

## Still owed

The follow-up migration `20260909180000_ads_entities_campaign_shared_set.sql`
is **not applied to production**. It is a one-statement constraint widening on
a table holding 0 rows, and it must land before the daily sync writes an
attachment. Jackson's call, with the push.

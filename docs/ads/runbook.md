# Google Ads engine — runbook

Operational reference for the measurement layer (Phase 1) of the Google Ads
engine. Design: `ops-software-bible/specs/2026-09-08-google-ads-engine-design.md`.
Plan: `ops-software-bible/docs/plans/2026-09-08-google-ads-engine-p1-measurement.md`.

Accounts: manager `5448339076` (OPS LTD, holds the developer token) →
serving client `4454506598` (OPS, CAD, America/Vancouver). Service account
`firebase-adminsdk-fbsvc@ops-ios-app.iam.gserviceaccount.com` on Cloud project
`ops-ios-app` (`992104001932`). Google Ads API **v25**; conversions go through
the **Data Manager API** (`events:ingest`), never the Ads API upload service.

## Readiness probe

`node scripts/ads/validate-probe.mjs` (run from a worktree with a real
`.env.local`). Read-only: the mutate uses `validateOnly: true`, and the Data
Manager call uses `validateOnly: true`. Exit `0` when the gate is green, `2`
when any account action is still missing, `1` on a script failure. Every run
writes `docs/artifacts/ads-engine/p1/probe-<timestamp>.json`.

The same checks run server-side in `src/lib/ads/readiness-probe.ts`: daily
from the `ads-sync` cron, and on demand through
`POST /api/internal/ads/setup/probe` (CRON_SECRET bearer). The result is
stored on `ads_sync_status` row `engine-readiness` (jsonb `backfill_progress`,
reused rather than adding schema) and read by
`GET /api/admin/google-ads/readiness`, which the admin ledger renders while the
account is dark.

The gate is green only when all four are true:

| Check | Meaning | Who flips it |
|---|---|---|
| `mutateValidateOnly.status === 200` | The service account may write (role Standard on the manager) | Jackson — Google Ads → manager 5448339076 → Admin → Access and security |
| `acceptedCustomerDataTerms` | Customer data terms accepted on the serving account | Jackson — Google Ads → client 4454506598 → Goals → Conversions → Settings |
| `enhancedConversionsForLeadsEnabled` | Enhanced conversions for leads on | Jackson — same settings page |
| `dataManagerReachable` | Data Manager API enabled on Cloud project `ops-ios-app` | Jackson — https://console.developers.google.com/apis/api/datamanager.googleapis.com/overview?project=992104001932 |

### Results

| Probed at (UTC) | Write access | Data terms | EC for leads | Data Manager API | Service-account role | Artifact |
|---|---|---|---|---|---|---|
| 2026-09-08 22:00 | 403 `authorizationError.ACTION_NOT_PERMITTED` | false | false | not probed | READ_ONLY on manager, absent on client | (planning session) |
| 2026-09-09 01:19 | 403 `authorizationError.ACTION_NOT_PERMITTED` | false | false | 403 `PERMISSION_DENIED` / `SERVICE_DISABLED` | READ_ONLY on manager, absent on client | `probe-2026-09-09T01-19-21-347Z.json` |
| 2026-09-09 02:29 | 200 (request `QCYqbPFiwG1aTXuks8zlYQ`) | true | true | 200 (request `v-560ef1a6-7d56-4d57-826b-b65798607b51`) | STANDARD on manager, absent on client | `probe-2026-09-09T02-29-40-415Z.json` |
| 2026-09-09 04:21 | 200 | true | true | 200 | STANDARD | `readiness-probe.json` (server-side probe, stored) |

**Status: GREEN as of 2026-09-09 02:29 UTC.** All four account actions have
landed; the conversion actions are applied and the Data Manager rehearsal
delivered a real event (see "What each artifact proves").

## Conversion actions (setup route)

`POST /api/internal/ads/setup/conversion-actions[?validateOnly=1]` with
`Authorization: Bearer $CRON_SECRET`. Plans the account against the target
state in `src/lib/ads/conversion-actions.ts` and applies it through
ConversionActionService **one phase at a time** (creates, then updates, then
removes). Idempotent: a second run plans zero operations. Never scheduled —
run it from a local dev server:

```bash
npm run dev -- -p 3210
curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3210/api/internal/ads/setup/conversion-actions?validateOnly=1"
curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3210/api/internal/ads/setup/conversion-actions"
```

Applied 2026-09-09 02:55 UTC (request `KP6FSRbsIh-hO1DWjwx-nQ`):

| kind | Google id | name | role |
|---|---|---|---|
| `trial_started` | `7754797893` | OPS · Trial started | primary (SIGNUP, 30-day lookback) |
| `trial_activated` | `7754797896` | OPS · Trial activated | secondary (QUALIFIED_LEAD, 30-day) |
| `paid` | `7754797899` | OPS · Paid subscription | secondary, valued (SUBSCRIBE_PAID, 90-day) |

Also applied: the three Firebase iOS actions (`OPS APP First open`, `sign_up`,
`login`) demoted to secondary; the three Bubble-era page actions (`Join Ops
SIgnup`, `Homepage Signup`, `Quiz Signup v2`) removed.

Two Google rules learned on the way, both encoded in the code:

- `include_in_conversions_metric` is read-only (IMMUTABLE_FIELD, request
  `GhT3wJ45mMH3_pUEC-vqOw`). It follows `primary_for_goal`; the planner never
  sends it.
- A mixed create/update/remove batch answers INTERNAL_ERROR on every operation
  while validating cleanly (requests `5AluX7K36qmzSSUNYDWf3Q`,
  `QP1iZPcJnISXeYM0YLDw-g`, `hfFhllc6wBjKNxz0TJBlmg`, `vnhDaBi0pJ1LjKMrq-YQvw`;
  the diagnostic `docs/artifacts/ads-engine/p1/mutate-transport-diag.mjs`
  proved a lone update succeeds). Hence the phased apply.

## Conversion outbox

Table `ads_conversion_events` (service-role only). Triggers enqueue one row per
company and kind, `transaction_id = kind:company_id` so a re-send never double
counts:

| kind | written by | when |
|---|---|---|
| `trial_started` | `seed_trial_attribution_for_company` (companies AFTER INSERT) | company created, any platform |
| `trial_activated` | `ads_enqueue_trial_activation` (projects AFTER INSERT) | first non-deleted project ≥ 2 minutes after the company's birth (earlier ones are bulk imports) |
| `paid` | `pmf_update_first_paid_at` (billing_events AFTER INSERT) | first `invoice.paid`; value = `ads_plan_annual_value(plan, amount_cents)` (starter 1080 / team 1680 / business 2280 CAD, else amount × 12) |

Sender: `GET /api/cron/ads-conversions` hourly at `:41` (workload key
`ads-conversions`, 120 s lease). Picks `queued` rows whose `next_attempt_at`
has passed and that are ≥ 10 minutes old (so the owner's `users` row exists),
resolves each company's `gclid` / `gbraid` / `wbraid` from `trial_attributions`
and the owner's SHA-256 email (admins first, oldest first), and posts one
Data Manager request per kind (≤ 2,000 events).

| state | meaning |
|---|---|
| `queued` | waiting for the next run (`attempts`, `next_attempt_at` say when) |
| `sent` | accepted by Google; `google_request_id` is Google's receipt |
| `skipped` | never sendable: `no_identifier` (no click id, no email), `no_conversion_action` (setup not run), `invalid_identifier` (Google rejected the click id and no email remained), or `rehearsal` |
| `failed` | five attempts (15 min · 2^n backoff) exhausted; `last_error` holds Google's answer; the persistent `ADS CONVERSIONS FAILING` notification is raised once |

A rejected click id does not poison its batch: Google names the offending
events, the rest are re-sent untouched, and the rejected ones are re-sent once
with the click id dropped (hashed email only).

Requeue (never delete — the ledger is the audit trail):

```sql
update public.ads_conversion_events
   set state = 'queued', next_attempt_at = now(), attempts = 0
 where id = '<id>';
```

`?validateOnly=1` on the cron route asks Google to validate and persists
nothing — the rehearsal path.

## Warehouse

Daily `ads-sync` (08:04 UTC) now also writes, after the account / campaign /
search-term day sync: the entity snapshot (`ads_entities`, nine searchStream
calls) and the trailing **3 days** (30 on Mondays, because Google restates
inside its lookback window) of `ads_daily_ad_group`, `ads_daily_ad`,
`ads_daily_asset`, `ads_daily_keyword` (four range calls) plus
`ads_click_map` (one `click_view` call per day). Budget: ~16 searchStream
calls per weekday, ~43 on Mondays — far inside Basic access.
`ads_funnel_by_keyword` joins the click map to `trial_attributions` and the
outbox: clicks → trials → activated → paid per keyword, with cost per trial
and cost per paying customer.

## Cron schedule

| Path | Schedule (UTC) | Lease | Purpose |
|---|---|---|---|
| `/api/cron/ads-sync` | `4 8 * * *` | `ads-history-sync` 120 s | day sync + entity snapshot + trailing grains + readiness probe refresh |
| `/api/cron/ads-conversions` | `41 * * * *` | `ads-conversions` 120 s | drain the outbox to the Data Manager API |

`:41` shares its minute with `unsnooze` (business hours) and the
`spec_board_snapshot_refresh` database lane — exactly at the three-lane
budget enforced by `tests/unit/api/heavy-cron-schedule-isolation.test.ts`.

## What each artifact proves (`docs/artifacts/ads-engine/p1/`)

| Artifact | Proves |
|---|---|
| `baseline.txt` | pristine `origin/main` carried 3 `tsc` errors (agent-control-plane test files) and 299 green unit tests before this work |
| `probe-2026-09-09T01-19-21-347Z.json` | the account was still read-only / unaccepted / disabled at 01:19 UTC |
| `probe-2026-09-09T02-29-40-415Z.json` | all four account actions landed by 02:29 UTC |
| `migration-verify.txt` | outbox migration live in prod, verified by object (ledger `20260909023503`, md5 byte-exact with the file) |
| `migration-verify-grain.txt` | warehouse migration live in prod, verified by object (ledger `20260909041702`, md5 byte-exact) |
| `conversion-actions-validate.json` | the plan validates cleanly against Google (8 operations, 0 failures) |
| `conversion-actions-apply.json` | the plan applied for real: 3 created, 2 demoted, 3 removed, ledger recorded |
| `conversion-actions-rerun.json` | the second run plans nothing (idempotent) |
| `mutate-transport-diag.mjs` | the diagnostic that isolated the batch-shape INTERNAL_ERROR |
| `readiness-probe.json` | the server-side probe stored six READY checks, one PENDING |
| `data-manager-validate.json` | Google validated a rehearsal event end to end (request `v-7291313a-0955-4637-a7c2-f1b89fe92d1c`) after rejecting a fabricated gclid and accepting the email-only re-send |
| `data-manager-live.json` | one real event delivered (request `3ac0bc8f-4d84-4bf2-98f2-1ebe4a3817e3`); the fixture row is marked `skipped` / `rehearsal` and the fake gclid cleared |
| `design-audit.txt` | the readiness ledger uses tokens only |
| `readiness-ledger.png` | the ledger at 1440×900 with the real stored probe payload (`readiness-probe.json`) — rendered by `capture-readiness-ledger.mjs` on a throwaway dev route with the admin page chrome, because the admin layout admits only the `admins` table (Jackson's two accounts) and the dev auth bypass has no admin identity; the real `/admin/google-ads` shows the same panel under its header |

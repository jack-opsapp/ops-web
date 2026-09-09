# Google Ads engine · phase 3 local rehearsal (2026-09-08)

The whole loop, on this Mac, against a disposable database and the worktree dev server: the routine prompt claims a brief, files typed proposals, fixes what the server rejects and releases; the worker tick raises the notification and scores the running test; Jackson's console lists the proposals; an approval runs `validateOnly` against the real Google Ads account and stops there (`ADS_ENGINE_REHEARSAL=1`). Nothing reached production. No real mutate was sent. The routine `OPS Google Ads engine` (`trig_01LroGoQJLg9GCPEAK3SD4dg`) was created **disabled** afterwards and was never enabled or run.

## What is in here

| Path | What it is |
|---|---|
| `stack/stack.mjs`, `stack/shim.mjs` | PostgreSQL 17 database `ops_ads_e2e` on the shared local cluster, the real migrations (`cron_workload_controls`, `ads_daily_search_terms`, `ads_engine`) behind PostgREST on :3013 and the storage shim on :3012. `node stack.mjs up <worktree>` / `node stack.mjs down`. |
| `stack/warehouse-fixture.sql` | Phase 1's warehouse contract as plain tables plus a seeded live account: three engine campaigns, five ad groups, a running control/challenger test, 38 days of daily grains, seven search terms (five of them waste), one paying customer through `jobber alternative`. The resource ids are fixture ids (`campaigns/11`, `adGroups/22`, `sharedSets/501` …), not the real account's. |
| `routine-run-1-v1/` | First routine run with prompt v1. Every request, response, candidate and editor verdict. |
| `routine-run-2-v2/` | Second routine run with prompt v2 (the version now installed in the routine). Includes the deliberate `COPY_REJECTED` fix loop. |
| `worker-tick/` | Two worker ticks (`/api/cron/ads-engine`) and the phase 1 daily sync attempt. |
| `screenshots/` | The console at 1440×900, dark: proposals waiting, an observation noted, a challenger and three negative lists approved (Google's `validateOnly` answer on the card), the funnel, the running test, engine health and modes, the change ledger. |
| `capture.mjs` | The headless Playwright script that signed in through the dev bypass as `pete`, drove the approvals and took the screenshots (the Browser pane was wedged). |

## How it ran

1. `stack.mjs up` built the database and printed `.state/env.local`; the worktree's `.env.local` was rewritten to point at the local stack (Supabase URL, keys, `CRON_SECRET`, `ADS_ENGINE_TOKEN`, `ADS_ENGINE_REHEARSAL=1`, dev bypass on) while keeping the real Google Ads and Firebase credentials so the apply layer could reach Google for `validateOnly`. The original file was kept as `.env.prod-backup.local` and restored afterwards.
2. `npm run dev -- -p 3225` from the worktree. A smoke `claim` proved the brief; its run row was deleted so the routine's run was the first of the month.
3. The routine prompt was handed, verbatim except for the base URL and the working directory, to a local Claude session (Opus) with the same tools the routine has. The bearer token was read inline from `.env.local` on every curl and never printed or written.
4. The console was driven headlessly; every approval went through `POST /api/admin/google-ads/engine/proposals/<id>` → `applyProposal` → phase 1's `mutateGoogleAds` with `validateOnly: true` on the real serving customer.

For the approve step the worktree was temporarily checked out on a scratch merge of `feat/ads-engine-p1` into `feat/ads-engine-p3` (detached, never pushed, four files resolved by keeping both sides: `google-ads-client.ts`, `page.tsx`, `vercel.json`, the cron isolation test). That merge is the preview of the real rebase.

## What was proven

- **Claim → proposals → release**, twice, with the exact prompt. Run 1 (`10e4cf67`) filed 4 negative lists and 2 observations; run 2 (`53dea8bd`) filed 3 challenger ads and 1 observation, and honoured the structural cap of 3 (the fourth due ad group was left for the next run) and the pending list (nothing re-proposed).
- **Server-side rejection and fix**: run 2's first submission carried one 34-character headline on purpose; the server answered `COPY_REJECTED · HEADLINE_TOO_LONG · headlines[9] · "34 characters; the limit is 30."`; the routine restored the editor-approved copy, ran the editor again and refiled that index only; accepted. `submission_counts` shows `{"1": 2}`.
- **The pause rule held**: two keywords clear 30 clicks with zero Google conversions, but the warehouse funnel shows a trial on each and the only paying customer on one; the routine did not pause either and said why.
- **Worker tick**: `ADS PROPOSALS READY · 6` and `· 4` notifications, the running test scored at day 12 of 14 (`p 0.048`, no verdict yet, as designed), no stall, campaigns live, rehearsal flagged.
- **Console**: proposals with the engine's rationale, the RSA preview with pins, the evidence table, the batch `APPROVE n` for negatives, NOTED for observations, the running test with both arms, the funnel by keyword, engine health with modes and caps, the empty change ledger.
- **Approve → Google `validateOnly` on the real account**: every approval reached Google and came back `400 INVALID_ARGUMENT · RESOURCE_NOT_FOUND` on the fixture resource (ad group 23, ad group 31, shared sets 502/503/504/501), with a Google request id each time. The label operation that precedes the RSA create (`mutate_operations[0]`) passed validation; the failure sits on `mutate_operations[1].ad_group_ad_operation.create.ad_group`. OPS recorded each as `failed` with the raw Google answer in `google_validation` and a one-line reason on the card. **The happy path (Google accepting the operations) cannot be shown until phase 2 builds the real campaigns**: the account today has only legacy campaigns with no `engine` label, and the phase 1 entity sync that would have loaded real ids failed on a v25 field (see below).

## What the rehearsal found and fixed

1. **Routine prompt (v1 → v2)**. The editor subagent judged copy against the voice brief alone and rejected `$90 / $140 / $190` and `no credit card`, both of which are brand facts; all three challengers were dropped in run 1. v2 hands the editor `brand-facts.json`, states the near-duplicate standard in the server's terms, and allows a bounded third round when the second verdict raises a new reason. Run 2 with v2 filed all three challengers. Commit `726a43d8d`.
2. **Console auth (`use-ads-engine.ts`)**. The panels fetched with a naked `fetch` and got 401 from the admin verifier; the page's other admin call happened to be unauthenticated. The hooks now use `authedFetch` (live Firebase token, one retry on 401), and the review mutation no longer waits on the refetches it triggers. Commit `28793d834`.
3. **Vanishing verdicts (`proposal-panel.tsx`)**. The refetch after a review drops reviewed rows, so a Google rejection disappeared a second after it appeared. Decided cards now stay in place with their outcome until the page is reloaded; test added. Commit `fe75f221b`.
4. **Readable refusals (`apply.ts`)**. A refused `validateOnly` surfaced as the raw GoogleAdsFailure JSON. It is now one line: status, error code, Google's message, the field, the request id; the raw text stays in the validation record. Commit `3a93c57ac`.

## What it found for phase 1 (not fixed here)

- `/api/cron/ads-sync` on `feat/ads-engine-p1` fails against Google Ads API v25 with `UNRECOGNIZED_FIELD: campaign.start_date, campaign.end_date` (request `CnGpVfygOu0M3ED2DpjO3w`, see `worker-tick/ads-sync-response.json`). Until that query is fixed, the daily sync and the entity snapshot do not run.
- Phase 1's `ads_entities` snapshot has no `campaignSharedSet` rows, so the engine's snapshot cannot see which negative lists are attached to which campaign; the rebase should add that resource to the entity query.
- Phase 1's `entity_type` vocabulary (`ad`, `keyword`, `negative_keyword`) differs from the fixture's, which does not matter to the engine: `snapshot.ts` keys on the resource-name collection, not on the column.

## Local-only quirks, not defects

- `POST /api/auth/sync-user` returns 500 locally because the baseline `users` table has no `auth_id` column; the admin gate still passed because `admins` carries `pete`'s email.
- `ad_briefings` had to be created by hand (its DDL is not in the repo) and PostgREST needed a schema reload (`NOTIFY pgrst, 'reload schema'`) to see it.
- Operator-approved failures do not raise `ADS CHANGE FAILED`; that alert is for unattended (auto) applies, where nobody is watching the card.

## Integration (2026-09-09)

`feat/ads-engine-p1` was merged into `feat/ads-engine-p3` for real (`fa553337b`), and current `origin/main` on top of that (`aae19f810`). The four overlapping files were resolved by keeping both sides, exactly as the scratch preview above predicted: the ads client carries phase 1's warehouse reports plus the engine's budget-pacing query, the admin page shows the readiness ledger while the account is dark and the engine console always, and the cron manifest and its isolation test list both new lanes. The branch is 46 commits ahead of `origin/main`, 0 behind.

Proved on the merged branch: 433 tests across the ads, analytics, cron, console and attribution suites, and the engine SQL harness. Not proved, and not this work's: `src/lib/agent-control-plane` is red on `origin/main` itself. A clean detached checkout of `origin/main` (`0d4d84fba`), with no ads code in it, fails the same 7 tests and reports the same 3 type errors, in `catalog-candidate-protocol.test.ts` and `domain-dispatch.test.ts`. The branch's error set is byte-identical to main's: the merge adds nothing and hides nothing. Neither ads branch touches that directory (0 files changed on either side). Filed as its own task.

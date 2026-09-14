# Every live ad pair is judged — GOOGLE ADS ENGINE - P2-1-1-1 (2026-09-14)

Branch `feat/ads-engine-p2`, commits `4082cbe46` (blueprint) and `0dc872321` (engine). Not pushed, not deployed. Nothing in the ad account or the production database was written.

## What was wrong

The phase 2 blueprint put an enabled control and an enabled challenger in **all twelve** engine ad groups (the brief said eleven; `BRAND · NA › Brand` runs its 2026-09-09 pair too), and `public.ads_tests` held zero rows, because only an applied `create_rsa_challenger` ever opened a test. Consequences, read from the code and then shown on production rows (`dry-run-before-2026-09-14.json`, the code at `1ad1fc685`):

1. `concludeTests` never judged any of the twelve pairs.
2. With the campaigns live and the controls 28+ days old, `computeDuties` named **all twelve** groups for a new challenger, and `validateProposal` accepted the group's own approved copy as a third ad in **5** of them (Brand, Cleaning, Landscaping, Roofing, Category). The other 7 were refused only by an unrelated copy-rule mismatch (see "Found, not fixed").
3. `applyProposal` would have written that third ad and opened a test that ignored the phase 2 challenger.

The same hole existed for an engine-built ad group (`add_ad_group` creates two ads and opens no test) and for any hand edit.

## The decision

The invariant is spec §5.4's definition — a test is one group, one control, one challenger, both enabled — kept by **one mechanism for every source of pairs**, not a patch per creator:

- **The worker tick tracks pairs** (`trackPairs`, rules in `src/lib/ads/engine/pairs.ts`), before the verdicts:
  - A live pair (exactly one enabled `role-control` and one enabled `role-challenger` in a non-legacy engine campaign, neither held paused by the guardrail) with no running test and no verdict gets a test, **started at Vancouver midnight of the first account day both ads recorded impressions** (`ads_daily_ad`). Its verdict window opens the next day, exactly like an engine-applied challenger's.
  - A pair with a verdict (`control_won`, `challenger_won`, `no_verdict`) is never judged again — its fate is a proposal. A `cancelled` pair is judged again, counting from the day after the cancellation.
  - A running test is cancelled (`stats.reason`, arm stats kept) when an ad is gone, or paused by anything but the guardrail (the blueprint retiring it, a hand edit), or when it is the challenger and the guardrail holds it for its copy. A landing-page hold, or a held control, keeps the test: the guardrail switches those back on.
- **Why no one-time backfill row now:** none of the 24 ads has ever served (`served_rows = 0` for every engine group, 2026-09-14). A row opened today would count paused days toward the 56-day limit and could force `no_verdict` before a single impression. The tick opens all twelve tests on its own, on the first tick after the launch day's warehouse sync, each started on the day both ads first served — that is the backfill, with the correct `started_at`.
- **One challenger at a time**, one predicate (`challengerInPlace` in `disapprovals.ts`: an enabled `role-challenger`, or one the guardrail holds for a landing page; a copy-verdict hold is not in place): the creative duty skips such a group; the validator refuses a second challenger with `TEST_NOT_CONCLUDED` ("… already runs challenger ad N. A group tests one challenger at a time." — the routine prompt's instruction for that code is already "drop", so no prompt or brief version change); `replacementDue` never promises a replacement beside one.
- **Last gate before Google:** `applyProposal` refuses an approved challenger whose group took a challenger or a new control since approval, before any mutate ("Cleaning already runs a challenger. Nothing changed in Google.").
- **The guardrail ends the test it breaks:** pausing a running test's challenger for its copy cancels that test in the same step, so the "replacement on its next run" promise is one the validator accepts.
- **The blueprint cannot recreate the problem:** a group may list at most one control and one challenger (`DUPLICATE_AD_ROLE`), and the planner refuses to create an ad beside a live one in the same role unless `retire.adIds` retires it in the same apply (`ROLE_ALREADY_LIVE`).

No schema change: `ads_tests` already allows `proposal_id` null, `state = 'cancelled'`, and one running test per group (`ads_tests_one_running_per_ad_group`, which makes a lost race a quiet `null`).

## Proof

| Check | Result |
|---|---|
| Test-first | Every new rule's tests were run red before the code existed (import failure for `pairs.ts`; assertion failures for the duty, validator, replacement, worker, guardrail, apply and blueprint rules). Two older tests encoded the bug and were corrected: the brief test expected a challenger in a group that already runs one, and the trademark test cleared the tests to squeeze a second challenger into a live pair. |
| Mutation check | Ten deliberate breakages (validator rule, duty skip, verdict pairs re-judged, `trackPairs` removed, guardrail cancel removed, apply check removed, replacement rule removed, stale-arm cancel removed, Vancouver start offset removed, blueprint guard removed) — **each caught** by a failing test, sources restored byte-identical. |
| Ads unit suite | `npx vitest run tests/unit/ads` — 26 files, **457 passed** (411 before). |
| Wider suite | `npx vitest run ads google-ads pmf analytics heavy-cron-schedule-isolation` — **112 files, 1325 passed**. |
| Types | `tsc --noEmit` — the same 6 errors as before this work (3 inherited from main, 3 branch errors owned by P2-1-1-2-1), none from it. |
| Repository against a real database | `node --conditions=react-server --import tsx tests/sql/ads-engine-pair-tests-runtime.mts` — the real `createEngineRepository` through supabase-js and PostgREST on a disposable PostgreSQL 17 cluster with the real `ads_engine` migration and the real `ads_daily_ad` DDL: **PASS** (open, the 23505 race as `null`, history shape, state-guarded cancel keeping arm stats, a cancel freeing the group, first shared day with zero-impression rows ignored, `since`, a control serving alone, and a shared day past the first 1000-row page). The cluster is created and deleted by the script. |
| Production, read-only | `dry-run.mts` → `dry-run-2026-09-14.json`, through a fetch that refuses anything but GET/HEAD (zero refused): **12 live pairs, 0 tests, 0 guardrail episodes, 0 tests to cancel, 0 to open** (nothing has served); with every campaign treated as live and every control 60 days old, the brief's duties are `hygiene` only; the validator refuses a third ad in **all 12** groups; the committed blueprint `2026-09-11-v1` plans **0** structural operations against the live account and trips no new guard. `dry-run-before.mts` → `dry-run-before-2026-09-14.json` asks the same questions of the code before the fix. |

## What happens next, and when

Nothing changes in production until Jackson merges and deploys `feat/ads-engine-p2` (the deployed worker is still the 2026-09-10 build). After that, and after launch: the launch day's sync writes `ads_daily_ad` rows, the next 14:59 UTC tick opens twelve tests dated to that day, and the creative duty stays quiet for each group until its test concludes and its pair is settled.

## Found, not fixed (spawned separately)

The engine classifies a campaign's copy rules by name prefix (`campaignKindOf`: `BRAND`, `CORE`, `COMPETITOR`), which predates the phase 2 names: `PRICING · US` and `SWITCH · US` (competitor intent) and `TRADE · US` read as `other`, and the blueprint's per-group `copyKind` (`CORE · CA › Pricing` / `Switching`) is invisible to it. On the live account the validator rejects competitor-name copy in the 7 groups built for competitor searches (`TRADEMARK_CAMPAIGN`). Spawned as GOOGLE ADS ENGINE - P2-1-1-1-1. **Fixed 2026-09-14** — the engine now reads campaign kinds and each ad group's copy rules from the blueprint; `dry-run.mts` gained `snapshotKinds` and `copyRulesAskedOnTheirOwn`; record and before/after evidence in `../copy-kinds/README.md`.

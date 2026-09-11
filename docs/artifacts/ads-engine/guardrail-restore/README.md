# Disapproved-ad guardrail: restore path and truthful alerts (2026-09-11)

GOOGLE ADS ENGINE - P2-1-1. Branch `feat/ads-engine-p2` (worktree `ops-web-ads-engine-p2`), commits
`ce58cf7c5` (live reads), `62ac27e31` (migration), `258159da2` (guardrail + brief). Not pushed.

## What went wrong

On 2026-09-10 14:59Z the worker's `pauseDisapproved` paused all 22 non-brand engine ads on Google's
stale `DESTINATION_NOT_WORKING` verdict (the try-ops pages had not existed when Google crawled). Google
cleared the verdict 2026-09-11 08:29Z. The guardrail had no record of why it paused anything and no
restore path, so approved ads would have stayed paused forever. Its 22 persistent `AD DISAPPROVED`
alerts promised "the next run writes a replacement". That was false twice: the routine is disabled,
and even a running routine would not have written one, because the brief's creative duty only named
groups by the 28-day cadence.

## What the guardrail does now (`src/lib/ads/engine/worker.ts`, rules in `disapprovals.ts`)

- **Decides on Google's live verdict**, never the warehouse snapshot (a copy up to a day old). The
  snapshot only nominates suspects; `queryAdPolicyStates` reads status, review status, approval and
  `policy_topic_entries` for exactly those ads and the ads it already tracks.
- **Records every episode** in `ads_guardrail_pauses` with the policy topics and the window its pause
  was committed in (`pause_requested_at` … `paused_at`).
- **Holds a landing-page verdict for one daily check.** `DESTINATION_NOT_WORKING` alone waits 20 hours
  from first sighting, so the next daily check is the one that acts. Why: a disapproved ad serves
  nothing, so waiting costs no money and no reach, and this verdict is often a crawl that failed once.
  Any other topic, a landing-page verdict with a second topic, or a verdict with no topic is paused
  at once, as spec §5.6 says. Replayed against 2026-09-10, the new guardrail would have held all 22,
  paused none, alerted nothing, and let them go the next morning.
- **Switches an ad it paused back on** once Google's review is finished and lets it serve (`APPROVED`,
  `APPROVED_LIMITED`, `AREA_OF_INTEREST_ONLY` with `REVIEWED`). It uses validateOnly first, then the real
  write, with partial failure off. It only does so when all of these hold:
  1. the ad id is not in the blueprint's `retire.adIds`. If the blueprint cannot be read, nothing is
     restored. (The 11 challengers retired 2026-09-11 are there.)
  2. no engine proposal claims the ad. A pending pause, promotion or challenger for the group makes it
     wait; one applied after the episode began lets it go.
  3. Google's `change_event` history shows the guardrail's own pause as the last change to the ad.
     Every OPS actor shares one service account, so identity cannot separate them. Time can: the
     guardrail's commit is the status change to PAUSED inside its recorded window (±60 s), and anything
     later was someone else's decision. If its own commit is missing, the history was cut short, or the
     read failed, it waits. A pause older than Google's 30-day history is let go (`unverifiable`).
- **Lets go without acting** when the ad is removed or gone, switched back on or changed by someone
  else, retired, claimed by an engine decision, or when the verdict cleared during the hold.
- **Alerts only what is true** (copy through the ops-copywriter skill). `AD DISAPPROVED` names Google's
  reason in plain words and says OPS turns the ad back on once Google approves it. It promises a
  replacement only when the routine is running (heartbeat inside `stall_hours`, challengers not `off`)
  and `replacementDue` holds. `replacementDue` requires a serving engine campaign and group, an enabled
  control other than the paused ad, no running test, and a copy verdict rather than a landing-page one.
  The brief's creative duty uses the same predicate, so the promise and the duty cannot disagree.
  - A failed pause raises `AD DISAPPROVED` "could not pause … tries again tomorrow".
  - A failed restore raises `AD STILL PAUSED`.
  - A restore reports once as a standard `AD BACK ON` / `ADS BACK ON`.
  - Closing an episode resolves every alert it raised, on the rail too.
- **In rehearsal** (`ADS_ENGINE_REHEARSAL=1`) it validates with Google and writes nothing.

## Proof

| Check | Result |
|---|---|
| Live GAQL probe (`gaql-probe-2026-09-11.mjs` → `.json`, read-only) | `policy_topic_entries` selectable (22 rows). `change_event` returned 68 AD_GROUP_AD events, including the guardrail's 22 ENABLED→PAUSED commits at 14:59:29Z and the manual restore's 11 PAUSED→ENABLED. Google refused `change_resource_name` in WHERE, a start older than 30 days, and an open-ended range. Account time zone America/Vancouver; the event resource name carries UTC epoch micros. |
| Unit tests, guardrail + rules + brief + worker + client | 83 new/updated engine tests, plus 4 client tests, all green |
| Full ads suite (37 files: ads, analytics, ads-sync grain, cron, console) | 508 / 509. The one failure, `tests/unit/api/ads-sync-cron.test.ts` "records provider health as healthy on a successful sync" (500 ≠ 200), reproduces identically on a clean export of HEAD `d359806c3`: it predates this work |
| `tsc --noEmit` | the same 6 errors as a clean export of HEAD `d359806c3`, all in files this work does not touch; zero new |
| SQL harness `tests/sql/ads-guardrail-pauses-runtime.mjs` (PG17) | PASS. It caught one real constraint bug before prod (a released episode could lose its `closed_at`). `tests/sql/ads-engine-runtime.mjs` still PASS on the replaced `notify_ads_engine` |
| Prod migration | applied 2026-09-11, ledger `20260911172121 ads_guardrail_pauses`, `md5(statements[1])` = `458e71c776b406db96d4de224737403e` = the committed file. Verified by object: table with RLS and the one-open-per-ad index, both functions security invoker with `search_path=""` and service-role only, kind check admits `ad_restored` |
| Prod backfill | all 22 `ad_disapproved` alerts resolved (the dry run beforehand selected exactly 22, all `APPROVED` in the 09:30Z snapshot); the 20 rail rows resolved; the 2 never delivered will never be delivered; 0 open |

## Still true after this

- The fix is **not live** until `feat/ads-engine-p2` is merged and deployed (Jackson). Until then the
  deployed worker still runs the old guardrail against the new schema. The two are compatible; the old
  code simply cannot restore.
- Nothing was enabled or paused in Google by this work. Every engine campaign stays PAUSED and the
  routine stays disabled.

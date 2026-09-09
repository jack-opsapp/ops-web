# First automatic Instagram publication — 2026-09-08

Read-only production readouts taken 15:07–15:15 Vancouver (Etc/GMT+7) on 2026-09-08 through the pooler psql channel, plus the routine run log `cse_01GQqRtzC5jqtGJxEKxi4Hq5`.

## Routine run (scheduled fire, 21:05 UTC = 14:05 Vancouver)

- Claimed `blog:171b2086-6154-49ba-ab12-328e70175ce0` (Kauaʻi hurricane warning article), wrote the draft, one editor pass approved, `POST …/draft` → `200 {"state":"drafted"}` at 21:10 UTC.
- Claimed `protocol:2026-09-08` (word-of-mouth referral article), first editor pass rejected `weak_copy` (passive voice in hook and cover body), revised once, second pass approved, drafted at 21:16 UTC.
- Third claim → `IDLE idle`. Result: `success`, 28 turns, 662 s.
- The claim payload carried no `voice` field (the server release with the voice bundle was not yet deployed); the routine wrote `voice.md` from the prompt's own rules and continued. Prompt version `routine-prompt-2026-09-08-v2`.

## Ledger after the 14:23/14:24 tick

| identity | mode | state | attempts | post |
|---|---|---|---|---|
| blog:e0d5ff01… (Fable) | prepare | prepared (held, old voice) | 1 | — |
| blog:85c62b33… (Cape Breton) | prepare | prepared (held, old voice) | 1 | — |
| blog:171b2086… (Kauaʻi) | publish | submitted | 1 | 740192c5… |
| protocol:2026-09-08 | publish | submitted | 1 | da6035f8… |

Settings: `mode=publish`, `delivery_gap_minutes=1200`, heartbeat 14:16.

## Posts

| post | status | publish_after (Vancouver) | published | media id | permalink | assets |
|---|---|---|---|---|---|---|
| 740192c5-8c30-468c-bbd8-0d4324662ca4 | published | 09-08 14:34 | 09-08 14:43 | 17899797792664494 | https://www.instagram.com/p/DdCrehGoC-n/ | 7 (carousel, editorial_cover) |
| da6035f8-16e7-4b7f-b2ba-1debb51a2715 | review | 09-09 10:34 | — | — | — | 5 (carousel, signal_grid) |

Audit trail of the published post: submitted → rendered (7 assets) → claimed by the publisher 21:43:22 UTC → container `18110353451161184` ready → publish requested → `publish_succeeded` 21:43:41 UTC with media `17899797792664494`. One claim, one attempt, exactly one post per identity (`cloud-editorial-v2:<identity>` keys).

Instagram (logged-out view of the permalink at 15:08): `opsapp.co · 1 like · "The prep window on Kauaʻi is closed.…" · 25 minutes ago`, carousel dots visible.

Caption ends with `Full article: https://opsapp.co/journal/kauai-hurricane-lowell-jobsite-prep-september-7-2026`.

## Defects found by this readout

1. No `INSTAGRAM POST QUEUED` and no `INSTAGRAM POST LIVE` rail item exists. `notifications` holds only the two 09-06 `DRAFT READY` items (read) and the 09-08 01:38 `AUTHORING STALLED` item (unread, persistent). Cause: `src/lib/social/notification-service.ts` read `PMF_OPERATOR_*` untrimmed; the production values carry trailing whitespace (the reason for `532e8e9c2`), the company id failed `notifications_company_id_canonical`, and the insert error was caught and logged only. Fixed in `2e3cfcb77` (every rail item now resolves its recipient through `getEditorialOperator`).
2. The `AUTHORING STALLED` alarm is persistent and nothing resolved it once the writer checked in. Fixed in `197f87d5c` (the tick resolves open stall alarms whenever the heartbeat is fresh).

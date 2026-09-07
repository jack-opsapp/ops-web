# First native cloud authoring run — production, 2026-09-07

Verified live, not rehearsed. Routine `OPS Instagram authoring` (`trig_011aQJD1UqqmG2DVkzHAQTS1`, `claude-opus-5`) was started by Jackson with **Run now** at 06:12:00 UTC and finished `ROUTINE_RUN_STATUS_SUCCEEDED` at 06:22:20 UTC (session `cse_01J9N2Nra5QmrLVtDMZ1UCxb`). No Mac was involved in the writing; this folder was assembled afterwards from production readbacks.

| Check | Observed |
|---|---|
| Credential handling | The sandbox reported `SOCIAL_AUTHORING_TOKEN` UNSET and sent no header; `POST /api/internal/social/editorial/claim` answered 200 through the environment API credential. The token never entered the session. |
| Claim | `blog:e0d5ff01…` (Fable) claimed 06:12:15, `mode=prepare`, lease 40 min, `brief_version ops-editorial-2026-09-07-v3`, `guide_sha256 33eb69c7…` (matches the bundled guide); `authoring_heartbeat_at` advanced on every claim (last 06:21:53). |
| Editor loop | Fable: first editor pass **rejected** (`unsupported_claim`: the draft said the context window grew; the article says it did not), writer revised, second pass approved. Cape Breton: approved first pass, with one non-blocking note. |
| Handoff | Fable `drafted` 06:18:19; Cape Breton claimed 06:18:22, `drafted` 06:21:49; third claim returned idle. Two HTTP submissions total, no 422s. |
| Promotion | Production cron tick 06:23 UTC (`8-59/15` schedule, leased) rendered both: `prepared` at 06:24:01 and 06:24:11, 7 slides each, stored through `SOCIAL_STORAGE_BACKEND=supabase` in the `social-media` bucket. |
| Public readback | All 14 JPEG URLs returned HTTP 200, 1080 × 1350; copies here under `fable/` and `cape-breton/`. |
| Notifications | Two `INSTAGRAM DRAFT READY` rows at 06:24:11 with dedupe keys `editorial:blog:<id>`; no duplicates on the following ticks. |
| Publication | `social_posts` = 0. Nothing entered the queue; nothing reached Instagram. |
| Model API calls from OPS | none; the OpenAI generator no longer exists in the deployed code. |

Fable draft: *What a stronger model changes for your job file, and what it does not* — hook *The expensive mistakes start when two ordinary facts never meet.*, five takeaways, closing slide `opsapp.co/journal/claude-fable-5-1-first-test-gpt-5-7-astra`.
Cape Breton draft: *Hold the dispatch until the route is proven* — hook *The road can look wet from the cab. The pavement may be gone underneath it.*, five steps, closing slide with the article URL.

Not yet proven: a **scheduled** (not manual) run — the routine was still paused at 06:30 UTC; first scheduled fire is 15:08 UTC once enabled — and any Instagram publication.

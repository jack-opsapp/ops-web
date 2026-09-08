# Cloud Instagram editorial operations

Status (2026-09-07 06:30 UTC): **deployed and live.** Migration `20260907055055` applied; `app.opsapp.co` serves the release; `SOCIAL_AUTHORING_TOKEN` and `SOCIAL_STORAGE_BACKEND=supabase` are set; the cloud environment credential works. The first native cloud run (manual **Run now**, 06:12–06:22 UTC) drafted the Fable and Cape Breton articles on Jackson's subscription with the independent editor loop; the 06:23 tick rendered both as held previews and delivered two `INSTAGRAM DRAFT READY` notifications; `social_posts` = 0. Evidence: `../artifacts/social-editorial/cloud-run-2026-09-07/`. Still open: the routine is **paused** (a scheduled fire has not been observed), first publication and the recurring `publish` policy await Jackson's approval, and the legacy edge function `social-publish-instagram` still exists. Every proof boundary below says which of prepared / tested / deployed / verified-live it has reached.

## What runs where

| Piece | Runs on | State |
|---|---|---|
| Discovery, leases, promotion, pacing, notifications, stall alarm | Vercel cron `GET /api/cron/social-editorial` every 15 minutes at :08 :23 :38 :53 under the durable `social-editorial` workload lease | built + tested locally; deploy pending |
| Writing and editing | Claude Cloud Routine `OPS Instagram authoring` on Jackson's subscription (`0 15,21 * * *` UTC = 08:00 and 14:00 Vancouver, daily), model `claude-opus-5`, no repositories, no connectors, tools Bash/Read/Write/Edit/Agent | created, disabled; enable after deploy + credential |
| Handoff API | `POST /api/internal/social/editorial/claim`, `…/assignments/{id}/draft`, `…/assignments/{id}/release`, bearer `SOCIAL_AUTHORING_TOKEN` | built + tested locally |
| Rendering, storage, veto queue, Meta publishing | existing OPS renderer, `social-media` storage, `submitSocialPost`, `social-publish` cron | unchanged; social artwork can be pinned with `SOCIAL_STORAGE_BACKEND` |
| Legacy | `social_editorial_runs`, OpenAI generator, `scripts/social-generators/`, edge function `social-publish-instagram` | generator removed from source in this release; data table kept for audit; edge function deletion needs approval |

Nothing depends on a running Mac.

## Assignments

`social_editorial_assignments` holds one row per unit of work, keyed by a durable `identity`:

- `blog:<blog_id>` — one per newly published article. Discovery scans live `blog_posts` published after `settings.discovery_since` (set to the migration time, so the 78 existing articles are not backfilled) and within the last 30 days; duplicates are impossible (`identity` is unique, inserts are `on conflict do nothing`). Discovery runs every tick in every mode, including `off`.
- `protocol:<date>` (Tuesday), `product:<date>` (Wednesday), `rotation:<date>` (Friday) — created on the first tick of that Vancouver date. Monday/Thursday blog sampling is retired: blog publication drives blog posts.

States: `queued` → `authoring` (claimed by the routine, 40-minute lease) → `drafted` (held draft saved; nothing rendered) → `prepared` (preview rendered, held) or `submitted` (in the publishing queue with a paced `publish_at`) → `blocked` (terminal, with `last_code`). Attempts are capped at 3; a rejected or failed attempt retries after 2 hours (editor rejection: 6 hours); an expired lease requeues with the attempt spent. Codes: `NO_FRESH_SOURCE`, `SOURCE_WITHDRAWN`, `SOURCE_CHANGED`, `EDITOR_REJECTED`, `SUBMISSIONS_EXHAUSTED`, `ATTEMPTS_EXHAUSTED`, `UNSUPPORTED_FORMAT`, `AUTHORING_ERROR`, `LEASE_EXPIRED`, `PACKAGE_MISSING`, `RENDER_FAILED`, `DELIVERY_NEEDS_REVIEW`.

`mode` is stamped on the assignment at claim time from `settings.mode`. Promotion uses the stricter of the two: if either the account or the assignment says `prepare`, the draft is rendered as a held preview. Flipping the account to `publish` therefore never releases drafts written under a preview promise; only new claims publish.

## The routine

Defined in `cloud-authoring-routine.md` (prompt version `routine-prompt-2026-09-08-v2`). Each run claims up to four assignments. For each: writes the draft from the claim response (source text, brief, limits, recent hooks, the **OPS copywriter brief** `docs/social/voice/ops-copywriter-brief.md` as the governing founder voice, and the complete Sam Parr guide as the pacing layer, both with their SHA-256 recorded on the package), runs an **independent editor subagent** that only sees the voice brief, guide, brief, source and draft and must also enforce the voice brief's filter, revises once on rejection, then posts the draft. OPS validates deterministically (`prepareSubmission`: exact evidence quotes, numbers present in the source, no links, voice rules, blog slide count 4–6), returns `422` with a code the routine can fix (max three submissions per claim), records rejections, and stores the accepted package as `drafted`. The draft endpoint has no path into rendering, notifications or the queue; that is proven by a test that injects spies.

Authentication: the routine sends no token itself. The cloud environment carries an **API credential** (host `app.opsapp.co`, `Authorization: Bearer <SOCIAL_AUTHORING_TOKEN>`) that Anthropic's agent proxy injects after the request leaves the sandbox; the same credential is what makes the host reachable at all under the Trusted network policy. Instagram credentials never leave OPS.

Usage: runs draw the subscription and count against the account's daily routine allowance. When a run is refused, nothing happens on the OPS side except that `authoring_heartbeat_at` stops advancing; queued work waits. No paid API fallback exists in the code.

## Blog carousel contract

Cover: article image, hook headline, the article title as the subtitle, the article date. Slides 2–5: `TAKEAWAY 01…` eyebrow, takeaway headline, body with context. Closing slide (server-owned): `FULL ARTICLE` / `KEEP READING` / `opsapp.co/journal/<slug>`. Caption ends with `Full article: https://opsapp.co/journal/<slug>`. Footer shows only `OPS` and the page counter. Render proof: `../artifacts/social-editorial/render-proof-2026-09-07/`.

## Pacing and publication

In `publish` mode the worker submits a drafted assignment to the existing queue with `publish_at = clamp(max(now + 11 min, last scheduled agent post + delivery_gap_minutes))`, clamped into 10:00–20:00 Vancouver (`Etc/GMT+7`), FIFO by draft time. `delivery_gap_minutes` defaults to 1200 (20 hours): several blogs published on one day publish on consecutive days. The existing review notification names the launch time (`Publishes Sep 08 · 10:00 unless stopped`), and the existing EDIT / STOP / PUBLISH NOW actions apply until then. Publication itself is unchanged: atomic claims, bounded retries, Meta reconciliation, published notification.

## Notifications

- `INSTAGRAM DRAFT READY` (standard) — a held preview exists (`prepared`).
- `INSTAGRAM POST QUEUED · <ID>` (persistent, existing) — a paced post entered the queue.
- `INSTAGRAM POST BLOCKED` (persistent) — an assignment stopped; the reason is on `/admin/social#cloud-production`.
- `INSTAGRAM AUTHORING STALLED` (persistent, at most once per Vancouver day) — work has been queued for 26 hours and the routine has not contacted OPS in 26 hours. This is the quota-exhausted / routine-disabled / credential-broken alarm.

Recipients: `SOCIAL_OPERATOR_*`, falling back to `PMF_OPERATOR_*`.

## Inspection

`/admin/social` → cloud production lists every assignment by article title (or `PROTOCOL · TUE SEP 08`), state, block reason, preview slides, caption, source link and queued-post status/permalink. The legacy 2026-09-05 draft is listed under its own label. The read route stays admin-only and exposes no credentials.

## Environment contract (production)

| Variable | Purpose | State |
|---|---|---|
| `SOCIAL_AUTHORING_TOKEN` | ≥32 chars; bearer for the three handoff routes | **new, Jackson adds** |
| `SOCIAL_STORAGE_BACKEND` | `supabase` pins social artwork to the proven `social-media` bucket; unset = global backend (S3) | **new, recommended `supabase`** |
| `CRON_SECRET` | existing | unchanged |
| `SOCIAL_AUTOMATION_SECRET` | existing `/api/internal/social/posts` | unchanged |
| `OPENAI_API_KEY*` | other OPS features | unchanged; the social workload no longer uses it |
| `PMF_OPERATOR_*` | notification recipient | unchanged |

## Release procedure (no step grants approval)

1. Jackson approves the code release and the additive migration `20260907004500_create_social_editorial_assignments.sql`. Integrate onto current `main`; rerun focused tests, both SQL harnesses, `tsc`, production build.
2. Apply the migration with settings still `prepare`. Verify the new table, RLS, grants, function execution restrictions and that `discovery_since` equals the apply time.
3. Deploy. Verify the customer domain targets the release; verify `SOCIAL_AUTHORING_TOKEN` and `SOCIAL_STORAGE_BACKEND` are set; call the claim route without a token (401, no-store).
4. Jackson adds the API credential to the cloud environment and reads the daily routine allowance from claude.ai/code/routines.
5. Enable the routine and **Run now** once. Verify in OPS: an assignment moved `queued → authoring → drafted`, its `guide_sha256` equals the bundled guide, the next cron tick rendered a held preview, the JPEGs return 200, `INSTAGRAM DRAFT READY` arrived, `social_posts` is still empty. Verify on claude.ai that the run consumed subscription usage and made no model API call from OPS.
6. Let one scheduled run fire (08:00 or 14:00 Vancouver) without the Mac; verify the heartbeat advanced and no duplicate assignment, draft, preview or notification exists.
7. Jackson reviews the finished draft and approves (a) its publication and (b) the recurring policy. Set `settings.mode = 'publish'`. New claims publish through the queue with the paced launch time; STOP remains available until then. Verify the Instagram media ID, permalink, account, caption, complete carousel and exactly one `published` row.
8. Retire the legacy path: the OpenAI generator is already gone from source; delete the deployed edge function `social-publish-instagram` and the repo's `scripts/social-generators/` and `supabase/functions/social-publish-instagram/` with approval. Blog writing and newsletter workflows are untouched.

Rollback: `settings.mode = 'off'` stops claims and promotions; STOP any post already in review; disable the routine at claude.ai/code/routines. Never delete ledger rows to retry; requeue by resetting `state`, `attempts` and `next_attempt_at` on the exact row and record why in `attempt_log`.

## Local verification

- `tests/unit/social/editorial/handoff.test.ts`, `worker.test.ts`, `policy.test.ts`, `carousel-render.test.tsx`, `cloud-production.test.tsx`, `tests/unit/social/render-social-post.test.tsx`, `tests/integration/social-editorial-cron.test.ts`.
- `node tests/sql/social-editorial-assignments-runtime.mjs` and `node tests/sql/social-editorial-runtime.mjs` against the disposable PostgreSQL 17 harness (`/private/tmp/ops-editorial-pg`, start with `LC_ALL=C`).
- Rehearsal stack: a disposable database with the real migrations behind PostgREST and a storage shim, the worktree dev server on port 3120, and the exact routine prompt driven by a local session. Results: `../artifacts/social-editorial/local-e2e-2026-09-07/`.

## Release candidate 2026-09-07

- Code: branch `feat/instagram-cloud-editorial`, commit `30e49f0c1` (36 commits ahead of `origin/main` `4907dc649`; includes the sibling leased-cron branch and the three earlier reliability fixes). Verification at that commit: 322 focused tests, `tests/sql/social-editorial-assignments-runtime.mjs` and `tests/sql/social-editorial-runtime.mjs` PASS, `tsc --noEmit` clean, `next build` clean with all six social routes.
- Migration: `supabase/migrations/20260907004500_create_social_editorial_assignments.sql` (additive; two `create or replace` supersets). Apply with settings still `prepare`.
- Vercel (Production): add `SOCIAL_AUTHORING_TOKEN` (≥32 chars); add `SOCIAL_STORAGE_BACKEND=supabase` (social artwork only).
- Claude cloud environment `Default`: API credential, allowed website `app.opsapp.co`, header `Authorization`, prefix `Bearer`, value = the same token.
- Routine `trig_011aQJD1UqqmG2DVkzHAQTS1` stays disabled until the deploy and the credential are verified; then **Run now** once, then let the 08:00 / 14:00 Vancouver schedule prove itself.
- Legacy: the deployed Supabase edge function `social-publish-instagram` (v3, no callers) is deleted only with approval.
- Rollback: `settings.mode='off'`, STOP any reviewable post, disable the routine.

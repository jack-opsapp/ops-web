# Instagram Subscription-Funded Authoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task. Load `supabase:supabase` for every migration/RPC task, `ops-design` + `frontend-design:frontend-design` + `custom-skills:audit-design-system` for every renderer/UI task, and `ops-copywriter:ops-copywriter` for every user-facing string (notification titles/bodies, admin labels, slide eyebrows, closing-slide copy).

**Goal:** Every newly published OPS blog gets exactly one durable Instagram takeaway assignment, recurring Tue/Wed/Fri formats get their own assignments, a native Claude Cloud Routine (Jackson's subscription) writes and edits each assignment through a narrowly scoped OPS handoff API, and OPS owns discovery, validation, rendering, storage, pacing, the ten-minute veto queue, publication, notifications and monitoring.

**Architecture:** Replace the date-keyed `social_editorial_runs` slot model and the OpenAI generator with an assignment ledger (`social_editorial_assignments`, one row per blog or per recurring day). The Vercel cron worker (already leased, every 15 minutes) discovers work, expires leases, promotes drafts (preview render in prepare mode, paced queue submission in publish mode), notifies, and watches for authoring stalls. A cloud routine claims one assignment at a time over HTTPS with a bearer token injected by the Anthropic agent proxy, writes the draft with an independent editor subagent, and returns it to a held-draft endpoint that never renders or publishes. Publication still flows through `submitSocialPost` → existing 10-minute veto → existing Meta publisher.

**Tech Stack:** Next.js 15 route handlers, Supabase (Postgres RPCs, RLS, service-role only), Vercel cron with durable workload leases, `next/og` ImageResponse + sharp renderer, Claude Cloud Routines (`/schedule` API), vitest, local PostgreSQL 17 harness at `/private/tmp/ops-editorial-pg` (start with `LC_ALL=C pg_ctl … -o "-p 55439 -k /private/tmp/ops-editorial-pg/socket -c listen_addresses=''"`).

**Design System:** `.interface-design/system.md` (admin UI), `ops-design-system/project/DESIGN.md` (voice, type). Raster social artwork uses `src/lib/social/render/theme.ts` tokens (`SOCIAL_THEME`, `SOCIAL_FONTS`) because ImageResponse cannot resolve CSS variables — add new spacing/type tokens there, never literals in treatments.

**Required Skills:** `custom-skills:executing-plans`, `supabase:supabase`, `ops-copywriter:ops-copywriter`, `ops-design`, `frontend-design:frontend-design`, `custom-skills:audit-design-system`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`.

**Worktree:** `/private/tmp/ops-instagram-diagnostics-release-20260904`, branch `feat/instagram-cloud-editorial`, base `0d66a5816` (origin/main `4907dc649` + sibling leased-cron branch merged; 258 focused social tests green). Always `cd` explicitly. Commit atomically with conventional messages, no AI attribution.

---

## Verified facts this plan relies on (2026-09-07 00:40 UTC)

- Cloud Routines work on this account: probe routine `trig_01Wx7D8aNETqPUkw8XzsRmKm` ran in the cloud in 30 s (session `cse_01XghgNdmDBW43XnoyMQgR9h`), Node 22, curl, `Agent` tool available. Under the Default environment's Trusted network, CONNECT to `app.opsapp.co`, `opsapp.co` and `*.supabase.co` is refused (403); `*.amazonaws.com` and npm are allowed. Per official docs, an environment **API credential** for host `app.opsapp.co` (Bearer, `Authorization` header) both opens that host and injects the token; the token never enters the sandbox. Routine minimum interval is 1 hour; runs draw subscription usage; a daily run cap exists and is only visible at claude.ai/code/routines (unverified number).
- Production: `social_editorial_settings` = `{mode: prepare, monthly_budget_usd: 20}`; one `social_editorial_runs` row (2026-09-05 Fable draft, prepared, held); `social_posts` = 0; 78 live blogs; Instagram connected as `opsapp.co` (token valid to 2026-11-04); 120 objects in the `social-media` bucket; legacy edge function `social-publish-instagram` still deployed; no desktop scheduled tasks, no pg_cron social jobs, no launchd social jobs.
- Blog publishing writes come from `ops-web` admin routes (`src/app/api/admin/blog/posts`) with RLS policy `blog_posts_ops_admin_all` (authenticated). Discovery must read shared DB state, not the editor.
- `@opsapp.co` bio link is `opsapp.co/join_ops` (+4 more). The exact article URL must be printed on the closing slide and in the caption; recommend adding `opsapp.co/journal` to the profile links (Jackson action).
- Renderer defect confirmed: `editorial-cover.tsx` reads `content.subtitle` and ignores `slide.body`, so slides 2–5 of the Fable draft repeat the cover with no explanation. Footer prints the internal treatment label (`EDITORIAL COVER · 01/05`).

## Product contract (unchanged from the 2026-09-06 plan, restated)

1. One independently tracked Instagram adaptation per newly published blog. Repeated discovery, edits, retries and restarts never create duplicates.
2. A blog carousel identifies the article (cover shows hook + article title), explains 3–5 key takeaways with context, and ends with a reading action that prints the exact URL.
3. Cover reuses the article image when the title and imagery identify the same article; later slides are readable text slides.
4. Tue = practical protocol, Wed = supported OPS product behavior (or protocol), Fri = supported roast/dispatch/proof/release (or protocol). Blog publication drives blog posts. Monday/Thursday sampling is retired.
5. Writer and editor both receive the complete versioned Sam Parr guide; its SHA-256 is recorded on every package.
6. Every assignment is `queued`, `authoring`, `drafted`, `prepared`, `submitted` or `blocked` with a code. Failure, rejection and quota exhaustion never look like coverage.
7. Publication is paced: one post per `delivery_gap_minutes` (default 20 h), inside 10:00–20:00 Vancouver (`Etc/GMT+7`), FIFO by draft time, via `publish_at` on the existing queue.
8. Approved recurring policy: preview + edit/stop window, then automatic publication. Flipping to `publish` never releases previously held drafts.
9. No paid API fallback. Quota exhaustion = queued work waits + operator notified of the stall.

---

## API contract (shared by Tasks 2–6; do not deviate)

All routes: Node runtime, `cache-control: no-store`, JSON only, POST only (405 otherwise), bearer `SOCIAL_AUTHORING_TOKEN` (≥32 chars, `secureTokenEquals`), 503 `SOCIAL_AUTHORING_NOT_CONFIGURED` when unset, 401 `SOCIAL_AUTHORING_INVALID`. Body limit 200 KB (413). Never echo secrets.

### `POST /api/internal/social/editorial/claim`
Request `{ "worker": string(1..120) }`.
Response 200:
```json
{ "assignment": null, "reason": "idle" | "authoring_off" }
```
or
```json
{ "assignment": {
    "id": "uuid", "identity": "blog:<uuid>" | "protocol:2026-09-08", "kind": "blog|protocol|product|rotation",
    "mode": "prepare|publish", "attempt": 1, "attempts_remaining": 2,
    "claim_token": "uuid", "lease_until": "iso",
    "brief_version": "ops-editorial-2026-09-07-v3",
    "current_time": "iso",
    "source": { "id","title","slug","url","published_at","text","thumbnail_url" },
    "recent_hooks": ["..."],
    "format": { "story_types": ["blog_signal"], "slides": {"min":4,"max":6}, "closing_slide": "server" },
    "limits": { "title":100,"hook":90,"angle":220,"caption":1800,"cta":120,"alt_text":500,"slide_headline":100,"slide_body":350,"evidence_quote":[20,700],"evidence":[1,12] },
    "guide": { "path": "docs/social/voice/sam-parr-field-guide.md", "sha256": "…", "content": "…" }
} }
```
Rules: locks settings; `mode='off'` → `authoring_off`; expires stale `authoring` leases first; picks oldest `queued` with `attempts<3` and `next_attempt_at<=now`; stamps `mode`, `attempts+1`, `claim_token`, `lease_until = now + authoring_lease_minutes`, `claimed_by=worker`; refreshes `source_snapshot` from live `blog_posts` (blog kind: its blog; recurring kinds: `chooseSource` over fresh live blogs excluding sources used in the last 60 days by assignments, legacy runs and posts). Blog not live → `blocked/SOURCE_WITHDRAWN` and try the next row (max 3 iterations). No fresh source for a recurring kind → `blocked/NO_FRESH_SOURCE`. Always sets `settings.authoring_heartbeat_at = now()` (even on idle).

### `POST /api/internal/social/editorial/assignments/{id}/draft`
Request:
```json
{ "claim_token": "uuid",
  "candidate": { …candidateSchema (title, hook, angle, caption, cta, alt_text, story_type, slides[], evidence[]) },
  "editor": { "approved": bool, "grounded": bool, "current": bool, "distinct": bool, "useful": bool, "format_supported": bool, "identifies_subject": bool, "clear_without_caption": bool, "reason": "approved|unsupported_claim|stale|repetitive|weak_copy|unsupported_format|unclear|off_subject", "notes": string(0..1200) },
  "usage": [ { "stage": "writer|editor", "model": string, "input": int?, "output": int? } ] }
```
Responses: 404 `ASSIGNMENT_NOT_FOUND`; 409 `CLAIM_NOT_OWNED` (wrong token, lease expired, or state not `authoring`); 422 `DRAFT_REJECTED` with `{ code: "EVIDENCE_INVALID|IMAGE_REQUIRED|DUPLICATE_HOOK|MODEL_LINK_REJECTED|UNSUPPORTED_NUMBER|VOICE_REJECTED|SCHEMA_INVALID|SLIDE_COUNT", issues: [...] }` — the claim stays live so the routine can fix and resubmit; at most 3 submissions per claim (4th → 429 `SUBMISSIONS_EXHAUSTED`, claim released, `next_attempt_at = now + 6h`); 200 `{ "state": "rejected", "attempts_remaining": n }` when `editor.approved=false` (attempt consumed, `next_attempt_at = now + 6h`, third → `blocked/EDITOR_REJECTED`); 200 `{ "state": "drafted", "identity", "title" }` on success (replay with the same token after success returns the same). Success stores `package = { submission, evidence, review: editor, usage, references: [{path, sha256}], brief_version }`, `drafted_at`, releases the lease. The endpoint **never** renders, notifies or submits.

### `POST /api/internal/social/editorial/assignments/{id}/release`
Request `{ "claim_token": "uuid", "outcome": "error" | "unsupported", "detail": string(0..2000) }`. `error` → `queued`, `next_attempt_at = now + 2h` (attempt already consumed; third → `blocked/ATTEMPTS_EXHAUSTED`). `unsupported` → `blocked/UNSUPPORTED_FORMAT`. 409 on ownership failure. Response `{ "state": "queued"|"blocked", "code" }`.

---

## Ledger contract (Task 1)

Migration file: `supabase/migrations/20260907004500_create_social_editorial_assignments.sql` (additive; only `create or replace` of `guard_cloud_editorial_handoff` and `notify_social_editorial`). Mirror it under `../ops-software-bible/migrations/` at release time, not now.

```sql
alter table public.social_editorial_settings
  add column discovery_since timestamptz not null default now(),
  add column delivery_gap_minutes integer not null default 1200 check (delivery_gap_minutes between 60 and 10080),
  add column authoring_lease_minutes integer not null default 40 check (authoring_lease_minutes between 10 and 120),
  add column authoring_heartbeat_at timestamptz,
  add column authoring_stall_notified_on date;

create table public.social_editorial_assignments (
  id uuid primary key default gen_random_uuid(),
  identity text not null unique check (identity ~ '^(blog:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(protocol|product|rotation):[0-9]{4}-[0-9]{2}-[0-9]{2})$'),
  kind text not null check (kind in ('blog','protocol','product','rotation')),
  blog_id uuid,
  slot_date date,
  mode text check (mode in ('prepare','publish')),
  state text not null default 'queued' check (state in ('queued','authoring','drafted','prepared','submitted','blocked')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  submissions integer not null default 0 check (submissions between 0 and 3),
  claim_token uuid, lease_until timestamptz, next_attempt_at timestamptz, claimed_by text,
  source_id uuid, source_snapshot jsonb,
  brief_version text, guide_sha256 text,
  package jsonb, preview jsonb,
  attempt_log jsonb not null default '[]'::jsonb,
  post_id uuid references public.social_posts(id),
  last_code text check (last_code ~ '^[A-Z_]{1,80}$'),
  drafted_at timestamptz, prepared_at timestamptz, submitted_at timestamptz, blocked_at timestamptz, notified_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check ((kind='blog') = (blog_id is not null)), check ((kind<>'blog') = (slot_date is not null))
);
create index on public.social_editorial_assignments (state, next_attempt_at, created_at);
create index on public.social_editorial_assignments (blog_id) where blog_id is not null;
```
RLS enabled, revoke all from public/anon/authenticated, grant CRUD to service_role. All functions `security invoker`, `set search_path=''`, execution revoked from public/anon/authenticated and granted to service_role:

| Function | Contract |
|---|---|
| `discover_social_editorial_assignments(p_local_date date, p_weekday text)` | Locks settings. Inserts `blog:<id>` for live blogs with `published_at > discovery_since`, `published_at <= now()`, `published_at >= now() - interval '30 days'`, not already assigned (`on conflict (identity) do nothing`, limit 50, ordered by `published_at`). Inserts `<kind>:<date>` for `p_weekday` in (Tue→protocol, Wed→product, Fri→rotation). Returns `jsonb {blogs:int, recurring:int}`. Mode `off` still discovers (durable tracking), it just never claims. |
| `claim_social_editorial_assignment(p_token uuid, p_worker text)` | See API rules; returns `setof social_editorial_assignments` (0 or 1). Requeues expired `authoring` leases before choosing (attempt stays consumed). Updates heartbeat. |
| `checkpoint_social_editorial_assignment(p_id uuid, p_token uuid, p_source jsonb, p_brief_version text, p_guide_sha256 text)` | Owner-scoped snapshot write; boolean. |
| `record_social_editorial_assignment_attempt(p_id uuid, p_token uuid, p_detail jsonb)` | Owner-scoped, appends to `attempt_log` (cap 9 entries, 100 KB detail limit), increments `submissions` when `p_detail->>'event'='submission'`; boolean. |
| `finish_social_editorial_assignment(p_id uuid, p_token uuid, p_state text, p_code text, p_package jsonb)` | Owner-scoped transition from `authoring` to `drafted` (requires package), `queued` (retry: sets `next_attempt_at` per code: `EDITOR_REJECTED`/`SUBMISSIONS_EXHAUSTED` +6h, else +2h; third attempt → `blocked`), or `blocked`. Releases token/lease. Returns final state text or null. Replay: same token + `drafted` already → returns `'drafted'`. |
| `recover_social_editorial_assignments()` | Requeues expired `authoring` leases (or blocks at 3 attempts with `ATTEMPTS_EXHAUSTED`); returns count. Idempotent. |
| `promote_social_editorial_assignment(p_id uuid, p_state text, p_code text, p_preview jsonb, p_post_id uuid, p_source jsonb)` | Worker-only transition from `drafted` to `prepared` (needs preview), `submitted` (needs post_id), `queued` (source changed: clears package, keeps attempts) or `blocked`. Optional refreshed `p_source`. Returns final state or null. |
| `notify_social_editorial(p_user_id text, p_company_id text)` | **Replaced (superset):** keeps legacy-run behaviour, then handles assignments: `prepared` → standard `INSTAGRAM DRAFT READY`; `blocked` → persistent `INSTAGRAM POST BLOCKED`; both link `/admin/social#cloud-production`, dedupe `editorial:<identity>`; acknowledges `notified_at` in the same transaction; ≤10 per call. |
| `check_social_editorial_authoring(p_user_id text, p_company_id text, p_stale_hours int)` | If any `queued` row is older than `p_stale_hours` and `authoring_heartbeat_at` is null or older than `p_stale_hours`, insert one persistent notification per Vancouver day (`authoring_stall_notified_on`), dedupe `editorial:authoring-stalled:<date>`, title `INSTAGRAM AUTHORING STALLED`, body written with ops-copywriter. Returns boolean inserted. |
| `guard_cloud_editorial_handoff()` | **Replaced:** `cloud-editorial-v1:%` keys → always raise (retired path). `cloud-editorial-v2:%` keys with `updated_by='agent:social'` entering `rendering`/`review` → require settings `publish`, matching assignment (`identity = substring(key from 20)`) in state `drafted` with `mode='publish'` and non-null package, and for blog kind a live `blog_posts` row equal to `assignment.blog_id` and `new.source_id`. |

Downstream idempotency key: `cloud-editorial-v2:<identity>`. Preview post ID: `editorialPreviewId(identity)` (existing function, new input).

---

## Worker contract (Task 3)

`runCloudEditorial()` (called by the leased cron handler; keep the `{state, copywriting_reference}` result shape, add `{discovered, promoted, notified}` counts):
1. `recover_social_editorial_assignments()`.
2. `discover_social_editorial_assignments(localDate, weekday)` using `Etc/GMT+7`.
3. Promote up to 3 `drafted` rows (oldest first):
   a. Read settings mode. `off` → leave drafted.
   b. Source check via `sourceStillCurrent`: withdrawn → `blocked/SOURCE_WITHDRAWN`. Changed → if every evidence quote still appears in the current normalized text and slug unchanged → refresh snapshot/title/subtitle and continue; else `queued` with `SOURCE_CHANGED` in `attempt_log` (attempts unchanged, `next_attempt_at=now`), or `blocked/SOURCE_CHANGED` at 3 attempts.
   c. Effective mode = `prepare` if either settings or assignment mode is `prepare`; else `publish`.
   d. `prepare` → render preview (`renderSocialPost` with `editorialPreviewId(identity)`, selection from `selectSocialTemplate` with key `cloud-editorial-v2:<identity>`) → `promote(... 'prepared', preview)`.
   e. `publish` → if `findPost(key)` exists: status in review/publishing/published → `submitted` with that id; rendering → wait; failed/cancelled → `blocked/DELIVERY_NEEDS_REVIEW`. Else compute `publish_at = clampToWindow(max(now+11min, lastScheduled + gap))` where `lastScheduled = max(publish_after)` of `social_posts` with `created_by='agent:social'` and status in review/publishing/published; call `submitSocialPost({ idempotencyKey, submission: {...package.submission, publish_at} })`; status review/publishing/published → `submitted`; else `blocked/DELIVERY_NEEDS_REVIEW`.
4. `notify_social_editorial(operator)` then `check_social_editorial_authoring(operator, 26)`.
5. Any thrown error inside one assignment's promotion is caught, recorded in `attempt_log` (`{event:'promotion_failed', code}`) and does not stop the other rows.

`clampToWindow`: Vancouver local; before 10:00 → 10:00 same day; ≥ 20:00 → 10:00 next day; blog kind allowed every day; recurring kinds are already dated.

---

## Task 1: Ledger migration + SQL harness

**Skills:** `supabase:supabase`, `superpowers:test-driven-development`.

**Files:**
- Create: `supabase/migrations/20260907004500_create_social_editorial_assignments.sql`
- Create: `tests/sql/social-editorial-assignments-runtime.mjs` (same harness style as `tests/sql/social-editorial-runtime.mjs`; applies `_create_social_editorial.sql` then the new migration on a disposable DB)
- Modify: `tests/unit/social/social-migration-contract.test.ts` (add the new file to the contract list if it enumerates migrations)

**Steps:**
1. Write the harness first with assertions for: default `discovery_since` is set; two blogs published after the boundary on one date → two distinct `blog:` rows; re-running discovery → zero new rows; a blog published before the boundary is ignored; a blog with `published_at` in the future is ignored; Tuesday creates `protocol:<date>` once; concurrent `claim_social_editorial_assignment` from two psql processes → exactly one row claimed; claim with `mode='off'` returns nothing but still bumps heartbeat; lease expiry requeues and keeps the attempt; third expiry blocks with `ATTEMPTS_EXHAUSTED`; `finish … 'drafted'` needs a package; replay returns `drafted`; stale owner cannot finish; `promote` to `submitted` needs `post_id`; `guard` raises for a v1 key, raises for a v2 key when settings are `prepare`, raises when the blog is not live, allows when everything matches; `notify` inserts one row per prepared/blocked assignment and zero on replay; `check_social_editorial_authoring` inserts once per day only when queued work is stale and the heartbeat is stale; grants: anon/authenticated have no privileges on the table or functions.
2. Run: `cd /private/tmp/ops-instagram-diagnostics-release-20260904 && node tests/sql/social-editorial-assignments-runtime.mjs` → expect failure (migration missing).
3. Write the migration per the ledger contract.
4. Run the harness → `PASS`. Also re-run `node tests/sql/social-editorial-runtime.mjs` to prove the legacy harness still passes with the replaced functions (adjust its guard expectations only where the v1 path is now always rejected; document why).
5. Commit: `feat(social): add durable per-blog editorial assignment ledger`.

## Task 2: Handoff endpoints (claim / draft / release)

**Skills:** `superpowers:test-driven-development`, `ops-copywriter:ops-copywriter` (error messages are operator-facing only; keep codes, no prose).

**Files:**
- Create: `src/lib/social/editorial/handoff.ts` (pure handler factory `createEditorialHandoffHandlers(deps)` with `claim`, `draft`, `release`; deps: repository, now, brief loader, guide loader)
- Create: `src/lib/social/editorial/brief.ts` (`EDITORIAL_BRIEF_VERSION = "ops-editorial-2026-09-07-v3"`, per-kind `format` and `limits` objects, `recentHooks` cap 30)
- Create: `src/app/api/internal/social/editorial/claim/route.ts`, `src/app/api/internal/social/editorial/assignments/[id]/draft/route.ts`, `…/[id]/release/route.ts` (Node runtime, `maxDuration = 60`, POST only)
- Modify: `src/lib/social/editorial/repository.ts` (add assignment methods: `claimAssignment`, `checkpointAssignment`, `recordAssignmentAttempt`, `finishAssignment`, `findAssignmentForOwner`, `assignmentContext(kind)`, keep `sourceStillCurrent`, `findPost`)
- Modify: `src/lib/social/editorial/policy.ts` (`prepareSubmission(raw, source, recentHooks, kind)` — see Task 4 for the blog-specific behaviour; export `editorReviewSchema` moved from generator)
- Delete: `src/lib/social/editorial/generator.ts`, `tests/unit/social/editorial/generator.test.ts` (OpenAI authoring path retired; `OPENAI_API_KEY` and `openai-clients.ts` stay for unrelated workloads — remove only the `social_editorial` workload entry if one exists in `src/lib/api/services/openai-clients.ts`)
- Test: `tests/unit/social/editorial/handoff.test.ts`, `tests/unit/social/route-export-contract.test.ts` (add the three routes)

**Steps:**
1. Tests first: 503 without token; 401 wrong token; 405 GET; claim idle/off/assignment shapes (guide sha equals file sha; `source.url` is `https://opsapp.co/journal/<slug>`; no `OPENAI`/model call anywhere); draft 409 on wrong token; 422 with `EVIDENCE_INVALID` when a quote is not in the snapshot; 422 `MODEL_LINK_REJECTED`; editor rejection → `rejected` + attempt consumed; third rejection → blocked; success → `drafted`, package contains `references[0].sha256` and `brief_version`, and **no** render/submit/notify dependency was invoked; replay after success → `drafted`; 4th submission → 429 and release; release `error` → queued with `next_attempt_at ≈ +2h`; 413 on oversize body.
2. Run → fail. 3. Implement. 4. Run → pass. 5. `npx tsc --noEmit -p tsconfig.json` (targeted: ensure no other file imported `generateEditorial`).
6. Commit: `feat(social): add subscription-authoring handoff endpoints`, then `refactor(social): retire the OpenAI editorial generator`.

## Task 3: Worker rewrite (discovery, promotion, pacing, monitoring)

**Skills:** `superpowers:test-driven-development`.

**Files:**
- Rewrite: `src/lib/social/editorial/worker.ts` (`runEditorialTick(deps)`; export `computePublishAt(now, lastScheduled, gapMinutes)` and `clampToVancouverWindow`)
- Modify: `src/lib/social/editorial/runtime.ts` (`runCloudEditorial()` → tick; `readCloudEditorial()` → `{ settings, assignments (≤30, with joined post status/permalink/publish_after via a second query on `social_posts` by `post_id`), legacy_runs (≤5) }`)
- Modify: `src/lib/social/editorial/repository.ts` (worker methods: `discover`, `recover`, `listDrafted(limit)`, `promote`, `lastScheduledPublishAt`, `notify`, `checkAuthoringStall`)
- Modify: `src/app/api/cron/social-editorial/handler.ts` only if the result type changes.
- Tests: rewrite `tests/unit/social/editorial/worker.test.ts` (in-memory repository rig): prepare mode renders preview and never submits; publish mode with assignment mode `prepare` stays held; both publish → submit with `publish_at` = paced slot (assert exact ISO for a fixture: now 2026-09-08T16:30Z, last 2026-09-08T17:00Z, gap 1200 → 2026-09-09T17:00Z; last null → now+11min clamped to 17:00Z); withdrawn source blocks; changed-but-quotes-intact source refreshes and proceeds; changed source with missing quote requeues; existing post reconciles without resubmitting; failed existing post blocks with `DELIVERY_NEEDS_REVIEW`; one row's thrown error does not stop the others; `off` leaves drafted untouched; notify and stall check are always called.
- Keep `tests/integration/social-editorial-cron.test.ts` green (result shape).

Commit: `feat(social): promote drafted assignments through paced delivery`.

## Task 4: Copy policy + renderer + notifications + admin read model

**Skills:** `ops-copywriter:ops-copywriter` (invoke before writing any string), `ops-design`, `frontend-design:frontend-design`, `custom-skills:audit-design-system`.

**Design tokens:** `SOCIAL_THEME.canvas/text/textSecondary/textTertiary/textMute/line`, `SOCIAL_FONTS.display/body/mono`; add to `theme.ts`: `SOCIAL_TYPE = { coverHeadline: 76, coverHeadlineLong: 62, slideHeadline: 64, slideHeadlineLong: 52, body: 34, bodyLong: 30, eyebrow: 22, counter: 22, url: 30 }` and `SOCIAL_SPACE = { frameX: 62, frameTop: 58, frameBottom: 48, eyebrowGap: 28, headlineGap: 34, ruleGap: 40 }` (numbers only live in theme.ts).

**Files:**
- Modify: `src/lib/social/editorial/policy.ts` — for `kind==='blog'`: require 4–6 candidate slides (cover + ≥3 takeaways); set `content.subtitle = source.title` (trim to 160, uppercase preserved); set `content.date` = `MMM DD · YYYY` of `published_at` (mono-friendly); append a server-owned closing slide `{ eyebrow: "FULL ARTICLE", headline: "READ THE FULL ARTICLE", body: "opsapp.co/journal/<slug>" }` (copywriter may improve eyebrow/headline; body must be exactly the URL without scheme); caption ends with `Full article: https://opsapp.co/journal/<slug>`; slides other than the cover carry `eyebrow` `TAKEAWAY 01…` when the writer omitted one. Non-blog kinds unchanged except `prepareSubmission` signature.
- Modify: `src/lib/social/render/frame.tsx` — footer right becomes the page counter only (`01 / 05`, JetBrains Mono), no treatment label; header right shows `content.date ?? "OPS // SOCIAL"`; export `SlideBody` that always renders `slide.body`.
- Modify: `src/lib/social/render/treatments/editorial-cover.tsx` — slide 0: image + fade + eyebrow + headline + subtitle (article title, `SOCIAL_TYPE.body`); slides ≥ 1: canvas, eyebrow, headline (size steps by length), rule, body; closing slide (eyebrow `FULL ARTICLE` or `slide === last && body matches /^opsapp\.co\//`): headline + URL line in `SOCIAL_FONTS.mono` at `SOCIAL_TYPE.url`.
- Modify: `split-signal.tsx`, `operator-brief.tsx`, `signal-grid.tsx`, `proof-board.tsx`, `roast-file.tsx`, `field-frame.tsx` — remove the treatment-label footer dependency (already handled by frame), apply headline size stepping, keep body.
- Modify: `src/lib/social/notification-service.ts` — `createSocialReviewNotification(post)` body becomes time-aware: `Publishes <Sep 08 · 10:00> unless stopped. Edit or stop from Social.` (Vancouver, `Etc/GMT+7`); title `INSTAGRAM POST QUEUED · <ID8>`.
- Modify: `src/app/admin/social/_components/cloud-production.tsx` — list assignments (identity label: blog title or `PROTOCOL · TUE SEP 08`), state, block reason, preview grid, caption, source link, queued-post link (post status + permalink when published); legacy runs listed under a `HELD LEGACY DRAFT` label; copy via i18n keys in `src/i18n/dictionaries/en/admin-social.json` and `es/admin-social.json` (new keys: `cloud.schedule` rewritten: "Blogs are adapted as they publish. Tuesday protocol, Wednesday product, Friday rotation. Posts are paced one per day inside 10:00–20:00."; `cloud.state.queued|authoring|drafted|prepared|submitted|blocked`; `cloud.code.SOURCE_WITHDRAWN|SOURCE_CHANGED|UNSUPPORTED_FORMAT|SUBMISSIONS_EXHAUSTED|RENDER_FAILED|AUTHORING_STALLED`).
- Tests: `tests/unit/social/editorial/policy.test.ts` (blog closing slide, subtitle, slide-count floor, caption URL), `tests/unit/social/render-social-post.test.tsx` (every treatment renders `slide.body` text into the static markup for index ≥ 1 — assert via `renderToStaticMarkup` of the treatment element; footer has no treatment label), `tests/unit/social/editorial/carousel-render.test.tsx` (5-slide blog package through real JPEG encoding), `tests/unit/social/editorial/cloud-production.test.tsx` (assignment rows, blocked reason, legacy draft label), `tests/unit/social/documentation-contract.test.ts` if it pins strings.
- Visual proof script: `docs/artifacts/social-editorial/render-proof-2026-09-07/render.mjs` (or a vitest `it.skipIf(!process.env.OPS_RENDER_PROOF)`) that renders (a) the saved Fable package from `docs/artifacts/social-editorial/manual-run-2026-09-05/result.json` re-run through `prepareSubmission(kind='blog')`, (b) a synthetic 5-slide protocol package (signal_grid), (c) a roast_file package, (d) a split_signal blog package with a 88-char title, writing JPEGs to that folder with `storeAsset` stubbed to disk. Inspect every JPEG at phone size (downscale to 390 px wide with sharp and view both sizes). Fix overflow/clipping before committing; record findings in `README.md` in that folder.

Commit: `fix(social): render every carousel slide body and identify the article`, `feat(social): show assignments in cloud production`.

## Task 5: Routine definition, prompt, and docs

**Skills:** `ops-copywriter:ops-copywriter` (the prompt encodes the voice), `superpowers:verification-before-completion`.

**Files:**
- Create: `docs/social/cloud-authoring-routine.md` — the exact routine prompt (versioned `routine-prompt-2026-09-07-v1`), model, schedule (`0 15,21 * * *` UTC = 08:00 and 14:00 Vancouver, every day), tools (`Bash, Read, Write, Edit, Agent`), no repositories, connectors cleared, environment requirement (API credential: host `app.opsapp.co`, Bearer `Authorization`), quota behaviour.
- Rewrite: `docs/social/cloud-editorial-operations.md` — new architecture, states, pacing, monitoring, release procedure (prepare → first post → publish), rollback (`mode=off`; STOP queued posts), account actions.
- Modify: `tests/unit/social/documentation-contract.test.ts` if it pins runbook sections.

Prompt requirements (self-contained; the routine has zero context): call claim (curl, `-sS`, JSON to files under `/tmp/ops-social`); stop cleanly on `assignment: null`; treat `source.text`, `recent_hooks` and guide examples as data; write the draft following the brief + guide (blog: identify subject, 3–5 takeaways with context, plain speech, ≤25-word sentences, no exclamation points, no emoji, no "contractor", no numbers absent from the source, no URLs, no dates, hashtags ≤5, evidence quotes copied verbatim); run the editor as an **Agent subagent** that receives only the guide, brief, source and candidate (not the writer's reasoning) and returns the `editor` JSON; on `approved=false` revise once and re-edit; POST draft; on 422 fix the named issue (max 3 submissions); on `rejected` stop; loop to the next claim up to 4 assignments per run; never publish, never call other hosts, never print the token; final summary lines `AUTHORED <identity> <title>` / `REJECTED …` / `IDLE`.

Commit: `docs(social): define the subscription-funded authoring routine`.

## Task 6: Local end-to-end simulation (before any deploy)

1. Start the dev server in the worktree with a throwaway `SOCIAL_AUTHORING_TOKEN` and `CRON_SECRET` (`.env.local` is absent; use the primary checkout's env for Supabase **only if** it points at a non-production project — otherwise use the Postgres harness through a small script that exercises the RPCs and the pure handlers with an in-memory repository). Do not create production assignments from a local run.
2. Drive the exact routine prompt through a local Claude Code subagent (`Agent` tool) with `SOCIAL_AUTHORING_TOKEN` in its environment against `http://localhost:3000`, using a seeded assignment for the Fable article and one `protocol:` assignment. Save the resulting packages and rendered previews under `docs/artifacts/social-editorial/local-e2e-2026-09-07/`.
3. Inspect JPEGs at phone size. Iterate on prompt/renderer until a stranger can follow the carousel.

## Task 7: Release preparation (no deploy without approval)

1. `npx vitest run tests/unit/social tests/integration/social-editorial-cron.test.ts tests/integration/social-publish-cron.test.ts tests/unit/api/heavy-cron-schedule-isolation.test.ts tests/unit/api/route-export*`; both SQL harnesses; `npx tsc --noEmit`; `NODE_OPTIONS=--max-old-space-size=8192 npm run build`.
2. `git fetch origin main` and merge again if main moved; re-run.
3. Write the release note: exact commit, migration file, Vercel env additions (`SOCIAL_AUTHORING_TOKEN`), routine JSON, account actions, rollback.
4. Update the Software Bible (`03_DATA_ARCHITECTURE.md`, `04_API_AND_INTEGRATION.md`, `07_SPECIALIZED_FEATURES.md`) with the new ledger, endpoints, routine, and honest proof boundaries; commit in the bible repo without touching unrelated dirty files (stage by name).

## Account actions for Jackson (collected)

1. Generate a token (`openssl rand -hex 32`), add it as `SOCIAL_AUTHORING_TOKEN` in Vercel (ops-web, Production) — or approve me running `vercel env add`.
2. claude.ai/code → environment **Default** (or a new environment named `OPS Social Authoring`) → **API credentials** → Add credential: name `OPS social authoring`, allowed website `app.opsapp.co`, header `Authorization` / prefix `Bearer` / value = the same token → Connect.
3. Read the daily routine run allowance shown at claude.ai/code/routines and tell me the number.
4. Add `opsapp.co/journal` to the Instagram profile links (optional but recommended for "link in bio").
5. Approve: production deploy + migration; first publication; recurring `publish` mode; deletion of the deployed legacy edge function `social-publish-instagram`.

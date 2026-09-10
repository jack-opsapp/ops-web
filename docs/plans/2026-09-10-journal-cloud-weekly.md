# Journal weekly post on the cloud routine — implementation plan

> **For Claude:** REQUIRED SUB-SKILL: use `custom-skills:executing-plans` to implement this plan task by task.

**Goal:** the weekly evergreen OPS journal post is researched, written and edited by a native Claude Cloud Routine on Jackson's subscription with the Mac off, and OPS alone validates, stores, previews, holds for veto, publishes and announces it.

**Architecture:** a durable weekly assignment ledger in Supabase (`journal_editorial_*`), three narrow bearer-authenticated handoff operations for the routine plus an OPS-owned source fetch (claim, fetch a source, return a draft, release), an hourly Vercel cron that promotes drafts into scheduled previews, publishes them into `blog_posts` exactly once at Monday 06:00 Vancouver, and raises rail notifications and a stall alarm. The routine never reaches Supabase, S3 or `blog_posts`; every fact it cites must be verbatim in a page OPS fetched and snapshotted itself.

**Tech stack:** Next.js 15 route handlers (Node runtime), Supabase Postgres (security-invoker RPCs, service-role only), zod, jsdom + pdfjs-dist (source text), sanitize-html (article HTML), `next/og` + sharp (hero), S3 through `src/lib/s3/client.ts`, vitest, the disposable PostgreSQL 17 harness at `/private/tmp/ops-editorial-pg`.

**Design system:** `ops-design-system/project/` (`DESIGN.md`, `colors_and_type.css`, `uploads/system.md`). No `.interface-design/system.md` exists in this repo.

**Required skills:** `ops-copywriter` (every string, the voice documents, the routine prompt), `ops-design` + `custom-skills:interface-design` + `frontend-design:frontend-design` (admin preview panel, hero plate), `custom-skills:audit-design-system` (before UI is called done), `superpowers:test-driven-development`, `superpowers:verification-before-completion`, `schedule` (routine create/update).

---

## Decisions (2026-09-10)

| Decision | Owner | Value |
|---|---|---|
| Weekly cadence | Jackson | One evergreen post a week, live **Monday 06:00 Vancouver**; written Sunday, preview in the rail all Sunday |
| Breaking news | Jackson | **Stays on the Codex radar** (`~/.codex/automations/ops-emergency-trades-radar`). The cloud build covers the weekly post only. The breaking lane is documented in the Bible as it is; nothing here touches it |
| Newsletter | Jackson | **Off.** The lane is built behind `app_settings.blog_newsletter_enabled` (already `false`); Jackson reviews a test send before it is ever turned on |
| Byline | Jackson | `OPS Team` |
| Everything else | agent | Below |

## Discovery facts this plan rests on (verified 2026-09-10)

- `blog_posts` has no audit trail and no `updated_at` trigger; `source` is `weekly | breaking` (check constraint); RLS allows only `private.is_ops_admin()`; ops-site reads it with the service role, `is_live = true`, ordered by `published_at`, ISR 300 s, and does **not** filter future `published_at`. Publication must therefore happen by inserting a live row at the moment of publication, never by pre-dating.
- The Instagram editorial cron discovers every live post with `published_at > social_editorial_settings.discovery_since` (2026-09-01) and creates `blog:<id>`; its pacing (`delivery_gap_minutes` 1200, 10:00–20:00 window) spreads carousels. A Monday 06:00 publication is adapted by the 08:00 Instagram routine run.
- Weekly posts today come from Cowork tasks on the Mac (unreadable from here); breaking posts come from the Codex radar, which writes production through the Supabase connector and has been refused by Codex's approval guard since 2026-09-09.
- Cloud routines: minimum interval one hour; daily run cap per account, value only visible at claude.ai/code/routines; routines draw subscription usage; with usage credits **off**, runs over the limit are rejected, never billed (code.claude.com/docs/en/routines). API credentials inject a header after the request leaves the sandbox and open that host even under Trusted network access (code.claude.com/docs/en/cloud-environments). Whether WebSearch/WebFetch work inside a routine is **undocumented**; probe routine `trig_01PToy1tVo4Etv9LXkdxKqhf` (paused) answers it when Jackson clicks Run now. The design does not depend on WebFetch: OPS fetches every source itself.
- `notifications` has no check on `type`; `action_url` must be an internal path; `company_id` must be canonical (always resolve through `getEditorialOperator`, values carry trailing whitespace in production).
- Every runtime `readFileSync` of a repo file needs `outputFileTracingIncludes` for **every** route that reads it (2026-09-08 incident).
- `sendBlogNewsletter` links to `${NEXT_PUBLIC_APP_URL}/blog/<slug>`, not the canonical `https://opsapp.co/journal/<slug>`. It has never sent (`email_log` has zero `blog_newsletter` rows). Fixed in Task 9.
- `linkedin_article` has no reader anywhere; the new pipeline does not write it.

## Lifecycle

```
                discover (≤72 h before slot)
                        │
  queued ──claim──▶ authoring ──draft ok──▶ drafted ──tick: render hero──▶ scheduled ──tick at publish_at──▶ published
    ▲                  │  │                                                   │   │
    └── retry (2 h / 6 h editor reject) ┘  └─ release unsupported ─▶ blocked  │   └─ STOP ─▶ cancelled
                                                                              └─ PUBLISH NOW (admin) ─▶ published
  lease expiry → queued (attempt spent) · attempts > 3 → blocked · slot + 72 h undrafted → blocked SLOT_MISSED
```

- **Identity** `weekly:<YYYY-MM-DD>` = the Monday slot date in Vancouver (`Etc/GMT+7`, permanent UTC−7). Unique. Discovery creates the next slot when `now ≥ slot − draft_open_hours` (default 72 h → Friday 06:00).
- **publish_at** = the slot (Monday 06:00) unless the draft arrives late; then `max(slot, drafted_at + min_veto_minutes)` clamped into 06:00–20:00 Vancouver. `min_veto_minutes` default 360.
- **Modes** (`journal_editorial_settings.mode`, stamped on the assignment at claim; the stricter wins): `off` (no claims), `prepare` (preview only; publishes only by admin PUBLISH NOW), `publish` (auto at `publish_at` unless stopped). Initial production mode: `prepare`.
- **Guards at publication** (all inside one RPC, row-locked): state `scheduled`; not cancelled; slug still free in `blog_posts`; no other `source = 'weekly'` post published in the last 5 days (a still-running Cowork task can never double the week); draft younger than 8 days (`STALE_DRAFT`). A manual PUBLISH NOW skips only the time and mode gates, never the others.

## Contracts

### Handoff (bearer `JOURNAL_AUTHORING_TOKEN`, ≥32 chars, `POST` only, `cache-control: no-store`, 200 KB request limit)

| Route | Body | Result |
|---|---|---|
| `/api/internal/journal/editorial/claim` | `{worker}` | `{assignment: null, reason}` or the assignment (id, identity, claim_token, lease_until, attempt, slot, publish_at, current_time, brief_version, format, limits, categories, recent_posts[40], backlog_topics, voice, guide, product_facts) |
| `/api/internal/journal/editorial/assignments/[id]/sources` | `{claim_token, url}` | OPS fetches the public HTTPS page (SSRF-guarded, pinned DNS, ≤3 redirects, ≤8 MB, 15 s, HTML/text/PDF), snapshots it, returns `{source_id, url, final_url, title, site_name, published_hint, fetched_at, text, truncated}`; ≤24 sources per claim; the same URL returns the stored snapshot |
| `/api/internal/journal/editorial/assignments/[id]/draft` | `{claim_token, candidate, editor, usage}` | `200 {state:"drafted"}` · `200 {state:"rejected"}` (editor said no; retried in 6 h) · `422 {code, issues}` (fixable) · `409 CLAIM_NOT_OWNED` · `429 SUBMISSIONS_EXHAUSTED`. Stores the validated package only. No path into rendering, `blog_posts`, notifications or publication (proved by a spy test) |
| `/api/internal/journal/editorial/assignments/[id]/release` | `{claim_token, outcome: error|unsupported, detail}` | requeue (error) or block (unsupported) |

### Candidate (what the routine writes)

```jsonc
{
  "title": "ALL CAPS, 5–10 words, ≤ 80 chars",
  "subtitle": "≤ 160 chars, sentence case",
  "slug": "^[a-z0-9]+(-[a-z0-9]+)*$, ≤ 80 chars",
  "meta_title": "≤ 70 chars",
  "summary": "≤ 300 chars (meta description)",
  "teaser": "≤ 200 chars",
  "category": "growth | industry-intel | leadership-and-crew | money-and-margins | operations | technology",
  "topic": { "backlog_topic_id": "uuid | null", "angle": "≤ 300 chars" },
  "hero_line": "≤ 60 chars — the sharpest line of the piece, shown on the hero plate (three rows inside the band every crop keeps)",
  "body": [ { "type": "p" | "h2" | "h3" | "blockquote", "text": "…" } | { "type": "ul" | "ol", "items": ["…"] } ],
  "faqs": [ { "question": "≤ 160", "answer": "60–120 words" } ],   // 6–8 (format playbook)
  "email_content": "≤ 1,600 chars plain text, 120–250 words",
  "citations": [ { "source_id": "uuid", "role": "primary" | "supporting" } ],   // ≥ 2, all fetched through OPS for this assignment
  "evidence": [ { "claim": "≤ 400", "source_id": "uuid", "quote": "20–700 chars, verbatim from that snapshot" } ],  // 1–30
  "worked_examples": [ "exact sentence from the body containing a hypothetical number" ]  // ≤ 4
}
```

Inline markup inside `text` / `items` / `answer`: `**bold**`, `*italic*`, `[label](url)`. OPS renders the HTML itself and appends a server-owned `Sources` section from `citations` (title · site · link). Allowed link targets: a cited source's `url`/`final_url`, or `/journal/<slug>` of a live post.

### Deterministic checks (422 codes the routine can fix)

`SCHEMA_INVALID`, `TITLE_FORMAT` (not uppercase / word count), `SLUG_TAKEN`, `CATEGORY_INVALID`, `WORD_COUNT` (rendered body words outside 1,000–1,400), `FAQ_COUNT`, `CITATION_INVALID` (unknown or foreign source id, fewer than two), `EVIDENCE_INVALID` (quote not verbatim in its snapshot after whitespace/quote normalisation), `UNSUPPORTED_NUMBER` (a number not present in any cited snapshot and not inside a declared worked example), `WORKED_EXAMPLE_INVALID` (sentence absent or without an illustration cue), `LINK_REJECTED` (link to anything else), `VOICE_REJECTED` (banned word, exclamation point, emoji, "contractor", "could potentially", "we believe", title or first sentence leading with "AI"), `STALE_FRAMING` (this week, last week, next week, today, yesterday, tomorrow, this morning, tonight, breaking, just announced, just released), `DUPLICATE_TOPIC` (title word overlap ≥ 0.8 with a live post from the last 365 days).

Editor verdict (independent subagent): `{approved, grounded, current, original, useful, on_voice, structured, reason: approved|unsupported_claim|stale|duplicate|weak_copy|off_voice|structure, notes}`; all booleans true and `reason = approved` to accept.

### Settings singleton `journal_editorial_settings`

`mode` (`off|prepare|publish`, default `off`; set `prepare` at release), `publish_weekday` 1, `publish_hour` 6, `draft_open_hours` 72, `min_veto_minutes` 360, `slot_grace_hours` 72, `authoring_lease_minutes` 60, `max_sources` 24, `byline` `OPS Team`, `authoring_heartbeat_at`, `authoring_stall_notified_on`.

### Notifications (type `journal_editorial`, recipient `getEditorialOperator(process.env)`, dedupe key `journal:<identity>:<event>`)

| Title | Kind | When | Resolved |
|---|---|---|---|
| `JOURNAL POST READY` | persistent | `scheduled` — body names the launch (`Goes live Mon Sep 14 · 06:00 unless you stop it.`; prepare mode: `Held for your go.`) | on publish or stop |
| `JOURNAL POST LIVE` | standard | `published` | — |
| `JOURNAL POST BLOCKED` | persistent | `blocked` (reason copy per code) | next assignment scheduled |
| `JOURNAL WRITER STALLED` | persistent, once per Vancouver day | a queued assignment is < 18 h from its slot with no draft, or the heartbeat is > 26 h old while work waits | the tick, once a draft exists or the heartbeat is fresh |

All copy goes through `ops-copywriter` before commit.

### Cron

`GET /api/cron/journal-editorial`, `9 * * * *` (hourly; `:09` carries one full-day lane, so this is two of three), `CRON_SECRET`, durable lease `journal-editorial` (360 s), `maxDuration` 300. Tick order: recover → discover (+ expire missed slots) → promote ≤2 drafted (hero render + upload → `scheduled`) → publish due → newsletter (no-op while disabled) → notify outbox → stall check/clear.

---

## Tasks

### Task 1: Ledger migration and SQL harness

**Skills:** `supabase:supabase-postgres-best-practices`, `superpowers:test-driven-development`

**Files:**
- Create: `supabase/migrations/20260910170000_create_journal_editorial.sql`
- Create: `tests/sql/journal-editorial-runtime.mjs`

Tables `journal_editorial_settings` (singleton `id boolean primary key default true check (id)`), `journal_editorial_assignments`, `journal_editorial_sources`; RLS on, `revoke all … from public, anon, authenticated`, `grant … to service_role`; partial unique index on `slug` for states `drafted|scheduled|published`; RPCs (security invoker, `set search_path = ''`, execute revoked from app roles, granted to `service_role`): `discover_journal_editorial_assignment`, `recover_journal_editorial_assignments`, `claim_journal_editorial_assignment`, `record_journal_editorial_attempt`, `store_journal_editorial_source`, `finish_journal_editorial_assignment`, `schedule_journal_editorial_assignment`, `publish_journal_editorial_assignment`, `cancel_journal_editorial_assignment`, `notify_journal_editorial`, `check_journal_editorial_authoring`, `resolve_journal_editorial_stall`, `claim_journal_editorial_newsletter` / `finish_journal_editorial_newsletter`.

Harness (disposable DB on `/private/tmp/ops-editorial-pg`, `LC_ALL=C`): stub `blog_posts` (with the production `source` check and unique slug), `notifications` (with production dedupe indexes), `app_settings`; then prove: slot discovery timing (Thu 23:00 → none, Fri 06:00 → `weekly:<Mon>`, repeat → none); concurrent claims disjoint; mode off → no claim; lease expiry spends the attempt, fourth → blocked; source cap and per-URL dedupe; draft needs a live lease and reserves the slug; slug collision rejected; publish exactly once under concurrent callers; publish refuses before `publish_at`, in `prepare`, after STOP, on taken slug, within 5 days of another weekly post, on an 8-day-old draft; manual publish skips only time/mode; published row has `is_live`, `published_at = now()`, `source = 'weekly'`, byline; notify outbox is replay-safe (zero duplicate rows); stall alarm fires once per day and resolves; grants: `anon`/`authenticated` cannot read tables or execute RPCs.

Run: `LC_ALL=C node tests/sql/journal-editorial-runtime.mjs` → `PASS`.
Commit: `feat(journal): durable weekly assignment ledger`.

### Task 2: OPS source custody (guarded fetch + text extraction)

**Files:**
- Modify: `src/lib/social/public-media.ts` — export the pinned, redirect-revalidated fetch as `fetchPublicResource(url, {accept, maxBytes, timeoutMs, allowedTypes})`; `downloadPublicImage` becomes a caller (behaviour unchanged; existing tests stay green).
- Create: `src/lib/journal/editorial/sources.ts` — `fetchJournalSource(url)` → `{url, final_url, http_status, content_type, bytes, sha256, title, site_name, published_hint, text}`. HTML through jsdom (drop script/style/noscript/svg/nav/header/footer/aside/form; title from `og:title` → `<title>`; site from `og:site_name` → host; date from `article:published_time`, `article:modified_time`, JSON-LD `datePublished`/`dateModified`, first `<time datetime>`), PDF through `pdfjs-dist` legacy build (≤ 60 pages), plain text as is; text capped at 150,000 characters with `truncated`.
- Test: `tests/unit/journal/editorial/sources.test.ts` (fixtures: HTML with entities and JSON-LD, PDF generated by `pdf-lib`, private address, redirect to private address, oversize, wrong content type).

Commit: `feat(journal): OPS-owned source fetch and snapshot text`.

### Task 3: Voice documents and bundling

**Skills:** `ops-copywriter`

**Files:**
- Create: `docs/journal/voice/ops-journal-brief.md` (governing voice for `/journal/`: identity, brand facts, always/never, banned words, "contractor" ban, AI rule, PAS-D and Story-Drop, the four signature moves, structure: ALL CAPS title 5–10 words, sentence-case h2s, 1,000–1,400 words, closing one-line blockquote, grounding and citation rules, evergreen currency rules, the filter)
- Create: `docs/journal/voice/blog-voice-sam-parr.md` (verbatim `ops-copywriter` 1.0.0 `references/blog-voice-sam-parr.md`, with a provenance header)
- Create: `docs/journal/voice/ops-product-facts.md` (shipped OPS behaviours a post may mention, each cited to the Bible chapter it comes from; nothing else about OPS may be claimed)
- Create: `src/lib/journal/editorial/voice.ts` (literal-path readers returning `{path, sha256, content}`)
- Modify: `next.config.ts` (`./docs/journal/voice/*.md` for every reader route)
- Test: `tests/unit/journal/editorial/voice-bundle.test.ts` (every route importing a reader names the folder; documents non-empty)

Commit: `feat(journal): journal voice documents travel with every claim`.

### Task 4: Draft policy and article rendering

**Files:**
- Create: `src/lib/journal/editorial/brief.ts` (version `ops-journal-2026-09-10-v1`, limits, format, editor schema, `isJournalApproved`)
- Create: `src/lib/journal/editorial/policy.ts` (`candidateSchema`, `prepareJournalDraft(raw, {sources, livePosts, categories, now})` → `{article, html, wordCount}` or throws a named code; number, evidence, link, voice, stale-framing, duplicate checks)
- Create: `src/lib/journal/editorial/article-html.ts` (blocks + inline markup → sanitized HTML; Sources section; sanitize with the same allowlist ops-site's `PostContent` uses)
- Test: `tests/unit/journal/editorial/policy.test.ts`, `article-html.test.ts` (one test per code, plus an end-to-end valid fixture of ~1,100 words)

Commit: `feat(journal): deterministic draft validation and article rendering`.

### Task 5: Handoff handlers, repository and routes

**Files:**
- Create: `src/lib/journal/editorial/handoff.ts` (pure handlers over an injected repository — claim, sources, draft, release), `repository.ts` (service-role RPC calls), `handoff-runtime.ts` (composition root)
- Create: `src/app/api/internal/journal/editorial/claim/route.ts`, `…/assignments/[id]/sources/route.ts`, `…/assignments/[id]/draft/route.ts`, `…/assignments/[id]/release/route.ts`
- Test: `tests/unit/journal/editorial/handoff.test.ts` (auth 503/401/405, body limit, claim payload shape incl. voice sha256, lease ownership, sources cap/dedupe, 422 per code, editor rejection path, idempotent re-post of an accepted draft, spy proof that draft/release never touch publication, notifications or storage)

Commit: `feat(journal): bearer handoff for the cloud writer`.

### Task 6: Hero plate

**Skills:** `ops-design`, `frontend-design:frontend-design`, `custom-skills:audit-design-system`

**Files:**
- Create: `src/lib/journal/editorial/hero.tsx` (`renderJournalHero({title, hero_line, category, date})` → 1200 × 630 JPEG via `next/og` + sharp, fonts from `src/lib/social/render/fonts.ts`; composition survives ops-site's full-bleed 50 vh crop and white fade; tokens from `ops-design-system/project/colors_and_type.css`)
- Create: `src/lib/journal/editorial/hero-store.ts` (S3 `blog/journal/<identity>-<sha8>.jpg` through `getS3Client`/`buildPublicS3Url`, or the `images` bucket when `getStorageBackend()` is `supabase`, mirroring `/api/admin/blog/upload`; no backend change)
- Evidence: `docs/artifacts/journal-editorial/hero-proof-2026-09-10/` (plate at 1200 × 630, at the journal card size and cropped the way ops-site crops it)
- Verify: Instagram's blog cover draws the article image full-bleed under its own text. If the plate carries type, `src/lib/social/editorial/policy.ts` treats `blog/journal/` thumbnails as imageless so the carousel cover never stacks text on text (test in `tests/unit/social/editorial/policy.test.ts`).

Commit: `feat(journal): OPS-rendered hero plate`.

### Task 7: Worker tick, cron route and schedule

**Files:**
- Create: `src/lib/journal/editorial/worker.ts` (`runJournalTick(deps)`), `runtime.ts`
- Create: `src/app/api/cron/journal-editorial/route.ts`, `handler.ts`
- Modify: `vercel.json` (`9 * * * *`), `tests/unit/api/heavy-cron-schedule-isolation.test.ts` (manifest entry with its lane note)
- Test: `tests/unit/journal/editorial/worker.test.ts`, `tests/integration/journal-editorial-cron.test.ts`

Commit: `feat(journal): hourly promotion, publication and alarms`.

### Task 8: Admin read/actions and the Blog hub panel

**Skills:** `ops-design`, `custom-skills:interface-design`, `ops-copywriter`, `custom-skills:audit-design-system`

**Files:**
- Create: `src/app/api/admin/journal/editorial/route.ts` (GET, admin-only, no-store), `src/app/api/admin/journal/editorial/[id]/route.ts` (POST `stop | publish_now | send_test`)
- Create: `src/app/admin/blog/_components/weekly-post-panel.tsx` — state-aware: one status line (`NEXT POST · MON SEP 14 · 06:00 · WRITING` / `READY — GOES LIVE IN 19 H` / `LIVE`), opening a preview (hero, title, subtitle, body, FAQs, sources, validation facts) with STOP and PUBLISH NOW; `?journal=<id>` opens it from the rail
- Modify: `src/app/admin/blog/_components/blog-hub-content.tsx`, `src/i18n/dictionaries/{en,es}/admin-blog.json`
- Test: `tests/unit/journal/editorial/admin-routes.test.ts`, `tests/unit/journal/editorial/weekly-post-panel.test.tsx`

Commit: `feat(journal): weekly post preview and veto in the Blog hub`.

### Task 9: Newsletter lane (built, off)

**Files:**
- Modify: `src/lib/email/sendgrid.tsx` (post URL = `https://opsapp.co/journal/<slug>`)
- Modify: worker (Tuesday 10:00 Vancouver after publication, only when `blog_newsletter_enabled = true`, exactly once through the claim RPC, `email_log` rows)
- Test: `tests/unit/journal/editorial/newsletter.test.ts`

Commit: `fix(newsletter): link the canonical journal article` and `feat(journal): gated weekly newsletter lane`.

### Task 10: Routine prompt and runbook

**Skills:** `ops-copywriter`, `schedule`

**Files:**
- Create: `docs/journal/cloud-authoring-routine.md` (version `journal-routine-prompt-2026-09-10-v1`; configuration table; verbatim prompt: claim → read voice/guide/facts → choose topic → research (WebSearch when present) → fetch every source through OPS → write → independent editor subagent → revise once → draft; 422 loop ≤3; release on failure; never publish, never touch another host)
- Create: `docs/journal/cloud-editorial-operations.md` (what runs where, lifecycle, environment contract, notifications, release procedure, rollback, incidents)

Commit: `docs(journal): routine prompt and operations runbook`.

### Task 11: Local rehearsal on a disposable stack

Reuse `docs/artifacts/social-editorial/local-e2e-2026-09-07/stack/` (PostgREST + storage shim) extended with the journal migration; dev server from this worktree; the exact routine prompt driven by a local Claude subagent against `http://localhost:<port>`; evidence in `docs/artifacts/journal-editorial/local-e2e-2026-09-10/`: claim payload, fetched sources, candidate, editor verdicts, 422 fix loop, drafted → scheduled preview with hero, READY notification, publish (prepare → manual, publish → timed) into the disposable `blog_posts`, Instagram discovery creating `blog:<id>` on the same database, LIVE notification, stall alarm fire/clear.

Commit: `docs(journal): local rehearsal evidence`.

### Task 12: Verification gate

`npx vitest run tests/unit/journal tests/unit/social tests/unit/api/heavy-cron-schedule-isolation.test.ts tests/integration/journal-editorial-cron.test.ts tests/integration/social-editorial-cron.test.ts`; both SQL harnesses; `npm run type-check > tsc.log 2>&1; echo $?` (main carries 3 pre-existing errors in MCP catalog tests; nothing new); `NODE_OPTIONS=--max-old-space-size=8192 npm run build`, then confirm `docs/journal/voice/*.md` in every reader route's `.next/server/app/**/route.js.nft.json`.

### Task 13: Bible and memory

`ops-software-bible/07_SPECIALIZED_FEATURES.md` §21 rewritten (three producers as they are: weekly cloud routine, breaking Codex radar, Cowork retired after proof; social rows moved to §22 as superseded), `03_DATA_ARCHITECTURE.md` (three tables), `04_API_AND_INTEGRATION.md` (routes), §14 (notification type), `scheduled-agents/ops-journal-authoring.md`, `migrations/` archive after apply; memory file for the initiative.

### Task 14: Release (every step needs Jackson's GO)

1. GO for the code release and the additive migration. Integrate onto current `main`; rerun Task 12.
2. Jackson runs the migration SQL (psql writes are classifier-blocked for the agent); verify tables, RLS, grants, settings `off`.
3. Push `main` (auto-deploys); verify the deployment on `app.opsapp.co`; unauthenticated claim → 401 no-store; cron tick 200.
4. Jackson: `openssl rand -hex 32` → Vercel Production `JOURNAL_AUTHORING_TOKEN`; new cloud environment `OPS Journal` (Trusted network) with API credential host `app.opsapp.co`, header `Authorization`, prefix `Bearer`, same token; confirm usage credits are **off** at claude.ai/settings/usage; read the daily routine cap.
5. Agent creates routine `OPS Journal authoring` (cron `0 13,21 * * 0` = Sunday 06:00 and 14:00 Vancouver, `claude-opus-5`, no repositories, connectors cleared), disabled. Settings → `prepare`.
6. Jackson clicks Run now with the Mac off (or leaves the Sunday fire). Verify: claim, OPS-fetched sources, drafted, preview + hero, READY in the rail.
7. Jackson reviews the preview; approves first publication (PUBLISH NOW or `publish` mode for Monday 06:00). Verify: one live `blog_posts` row, public URL 200 on opsapp.co/journal, LIVE alert, Instagram `blog:<id>` assignment, carousel drafted and paced.
8. With Jackson, pause the Cowork blog tasks; routine enabled; runbook, Bible, memory updated with the proof.

Rollback: settings `off`; STOP the scheduled draft; disable the routine. Never delete ledger rows; requeue by resetting `state`, `attempts`, `next_attempt_at` on the exact row with an `attempt_log` entry.

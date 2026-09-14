# Journal weekly post — operations

Status (2026-09-10): **built and tested locally; not deployed.** Branch `feat/journal-cloud-editorial`. Plan: `../plans/2026-09-10-journal-cloud-weekly.md`. Routine definition: `cloud-authoring-routine.md`. Every proof boundary below says which of prepared / tested / deployed / verified-live it has reached.

## What runs where

| Piece | Runs on | Notes |
|---|---|---|
| Slot creation, promotion, publication, rail items, stall alarm, newsletter | Vercel cron `GET /api/cron/journal-editorial` at `:09` every hour, `CRON_SECRET`, durable lease `journal-editorial` (360 s) | Nothing depends on a running Mac |
| Topic choice, research, writing, independent editing | Claude Cloud Routine `OPS Journal authoring` on Jackson's subscription, Sunday 06:00 + 14:00 Vancouver | No repositories, no connectors, tools Bash/Read/Write/Edit/Agent/WebSearch |
| Source custody | `POST /api/internal/journal/editorial/assignments/{id}/sources` — OPS fetches the page (public HTTPS only, DNS-pinned, ≤3 redirects, ≤8 MB, 15 s, HTML/text/PDF) and keeps the text | Evidence quotes are verified against these snapshots only |
| Handoff | `…/claim`, `…/sources`, `…/draft`, `…/release`, bearer `JOURNAL_AUTHORING_TOKEN`, `POST` only, `no-store`, 200 KB body limit | The draft route stores a validated package; it has no path to publication, storage or the rail |
| Header image | `renderJournalHero` (`next/og` + sharp, 1200 × 630 JPEG) stored at `blog/journal/<slot>-<sha16>.jpg` on the product's blog image path (S3 by default, the Supabase `images` bucket if `STORAGE_BACKEND=supabase`); a public HEAD must answer 200 before the preview is promised | Instagram treats these plates as imageless so its cover never stacks text on text |
| Publication | `publish_journal_editorial_assignment` — the only writer of `blog_posts` in this pipeline | Row-locked, exactly once, `source='weekly'`, byline from settings |
| Preview and veto | `/admin/blog` → WEEKLY POST strip (`?journal=<id>` opens it) | PUBLISH NOW, STOP, WRITE ANOTHER, SEND TEST TO ME |
| Breaking news | Codex automation `OPS Emergency Trades Radar` on the Mac (unchanged, Jackson's decision 2026-09-10) | Not part of this pipeline |

## Lifecycle

`queued` (created Friday 06:00 for the Monday 06:00 slot) → `authoring` (claimed; 60-minute lease) → `drafted` (validated package stored) → `scheduled` (plate public, `publish_at` set, preview in the rail) → `published`. Alternates: `blocked` (terminal, with `last_code`), `cancelled` (STOP). Attempts ≤ 3; an expired lease requeues with the attempt spent; an editor rejection retries after 6 hours, an error after 2. A slot undrafted 72 hours after its launch time blocks as `SLOT_MISSED`; nothing ever publishes days late.

Modes (`journal_editorial_settings.mode`, stamped on the slot at claim, the stricter wins): `off` (no slots, no claims), `prepare` (preview only; publishes only by PUBLISH NOW), `publish` (goes live at `publish_at` unless stopped).

`publish_at` = the slot, unless the draft is late: then `drafted_at + min_veto_minutes` (360), and never outside 06:00–20:00 Vancouver.

Publication guards (one transaction): slot state `scheduled`; slug still free in `blog_posts`; no other `source='weekly'` post live in the last 5 days (`WEEKLY_ALREADY_LIVE`, which PUBLISH NOW may override); draft younger than 8 days (`STALE_DRAFT`, never overridable). A published backlog topic is marked used.

## What OPS checks before a draft is accepted

Codes the routine can fix: `SCHEMA_INVALID`, `MARKUP_INVALID`, `TITLE_FORMAT`, `META_TITLE_LENGTH`, `CATEGORY_INVALID`, `TOPIC_INVALID`, `STRUCTURE`, `WORD_COUNT` (1,000–1,400), `FAQ_COUNT` (6–8), `FAQ_LENGTH` (60–120 words), `EMAIL_LENGTH` (120–250 words), `VOICE_REJECTED` (banned words, "contractor", exclamation points, emoji, hashtags, hedges, an AI lead), `STALE_FRAMING` (relative time words), `SLUG_TAKEN`, `DUPLICATE_TOPIC`, `CITATION_INVALID`, `EVIDENCE_INVALID` (quote not verbatim in the page OPS fetched), `LINK_REJECTED` (anything but live posts, industry pages or cited sources), `INTERNAL_LINKS` (8–12), `WORKED_EXAMPLE_INVALID`, `UNSUPPORTED_NUMBER` (a number in no cited page, not in the product facts, not in a declared worked example). OPS renders the HTML itself and appends the Sources list.

## Rail items (type `journal_editorial`)

| Title | Kind | When | Cleared by |
|---|---|---|---|
| `JOURNAL POST READY` | persistent | `scheduled`; body names the launch, or "waits for your go" when held | publication, block, STOP |
| `JOURNAL POST LIVE` | standard | `published` | — |
| `JOURNAL POST BLOCKED` | persistent | `blocked`, with the reason | a new ready item, STOP |
| `JOURNAL WRITER STALLED` | persistent, once per Vancouver day | a queued slot is within 12 hours of launch with no draft | the tick, once nothing is at risk |

Recipient: `SOCIAL_OPERATOR_*`, falling back to `PMF_OPERATOR_*`, always through `getEditorialOperator` (trimmed). Delivery is one transaction per item (`deliver_journal_editorial_notification`): resolve, insert (replays collide with the open dedupe index), mark delivered.

## Newsletter

Built and **off** (`app_settings.blog_newsletter_enabled = false`). When on, each published weekly post mails once, the Tuesday 10:00 Vancouver after it goes live, to active `newsletter_subscribers`, logged to `email_log`. While off, the Tuesday check records `skipped`, so turning it on later never mails an old post. A send that fails midway stays `sending` for a person to look at; it is never retried automatically. Before switching it on, Jackson reviews the email with SEND TEST TO ME in the Blog hub. The newsletter links the canonical `https://opsapp.co/journal/<slug>`.

## Environment contract (production)

| Variable | Purpose | State |
|---|---|---|
| `JOURNAL_AUTHORING_TOKEN` | ≥32 chars; bearer for the four handoff routes | **new, Jackson adds (Vercel Production)** |
| `CRON_SECRET` | cron auth | existing |
| `SOCIAL_OPERATOR_*` / `PMF_OPERATOR_*` | rail recipient | existing |
| `AWS_*`, `STORAGE_BACKEND` | blog image storage | existing, unchanged |
| `SENDGRID_*` | newsletter + test send | existing |

Claude side: cloud environment `OPS Journal` (Trusted network) with an API credential for host `app.opsapp.co` (header `Authorization`, prefix `Bearer`, value = the same token). Usage credits **off** at claude.ai/settings/usage.

## Release procedure (no step grants approval)

1. Jackson approves the code release and the additive migration `supabase/migrations/20260910170000_create_journal_editorial.sql`. Integrate onto current `main`; rerun the focused tests, the SQL harness, `npm run type-check`, and a production build; confirm `docs/journal/voice/*.md` and the three fonts appear in the traces of the routes that read them.
2. Jackson runs the migration SQL (agent psql writes are blocked). Verify the three tables, RLS, grants, `mode = 'off'`.
3. Push `main` (auto-deploys). Verify the deployment on `app.opsapp.co`; unauthenticated claim → 401 no-store; cron tick → 200 `idle`.
4. Jackson: `openssl rand -hex 32` → Vercel Production `JOURNAL_AUTHORING_TOKEN`; creates environment `OPS Journal` with the API credential; confirms usage credits are off; reads the daily routine cap.
5. Agent creates the routine (disabled), clears connectors, sets the environment. Settings → `prepare`.
6. Jackson clicks **Run now** with the Mac off. Verify: claim, OPS-fetched sources, `drafted`, plate public, `scheduled`, `JOURNAL POST READY` in the rail, no `blog_posts` row.
7. Jackson reviews the preview and approves: PUBLISH NOW (or `publish` mode for Monday 06:00). Verify: one live `blog_posts` row (`source='weekly'`, `author='OPS Team'`), `https://opsapp.co/journal/<slug>` 200, `JOURNAL POST LIVE`, Instagram `blog:<id>` assignment created and adapted.
8. With Jackson: pause the Cowork blog tasks; enable the routine; set `publish` if approved. Update this runbook, the Bible and memory.

Rollback: `mode = 'off'`; STOP the scheduled draft; disable the routine. Never delete ledger rows; requeue a slot with WRITE ANOTHER (or reset `state`, `attempts`, `next_attempt_at` on the exact row with an `attempt_log` entry).

## Local verification

- `npx vitest run tests/unit/journal tests/integration/journal-editorial-cron.test.ts tests/unit/api/heavy-cron-schedule-isolation.test.ts tests/unit/social/editorial`
- `LC_ALL=C node tests/sql/journal-editorial-runtime.mjs` against the disposable PostgreSQL 17 cluster at `/private/tmp/ops-editorial-pg` (start: `LC_ALL=C /opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /private/tmp/ops-editorial-pg/data -l /private/tmp/ops-editorial-pg/server.log -o "-p 55439 -k /private/tmp/ops-editorial-pg/socket -c listen_addresses=''" start`).
- Hero proofs: `JOURNAL_HERO_PROOF_DIR=$PWD/docs/artifacts/journal-editorial/hero-proof-2026-09-10 npx vitest run tests/unit/journal/editorial/hero.test.tsx`.

## Lessons carried from the Instagram release

- Any file read from disk at runtime is named in `outputFileTracingIncludes` for every route that reads it (guard test `tests/unit/journal/editorial/voice-bundle.test.ts`).
- Operator ids carry trailing whitespace in production; always `getEditorialOperator`.
- Every persistent alarm has a clearing path (`resolve_journal_editorial_stall`, ready items resolved on publish/block/stop).

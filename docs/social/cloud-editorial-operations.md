# Cloud Instagram editorial operations

Status: production migration, deployment and preparation-only activation approved on 2026-09-05; release verification in progress. First publication is separately unauthorized.

## Purpose and schedule

Vercel starts `GET /api/cron/social-editorial` every 15 minutes. The server selects one weekday slot beginning at 10:00 Vancouver time, with recovery until 20:00. There is no dependency on Claude Desktop, Codex Desktop, a browser session, or a running Mac. Unfinished previous dates become failed; they do not accumulate into a publishing burst.

| Day | Editorial preference |
| --- | --- |
| Monday, Thursday | Adapt one idea from a recent live OPS blog |
| Tuesday | A practical operator protocol |
| Wednesday | A supported OPS product behavior, otherwise a practical protocol |
| Friday | Supported roast, dispatch, proof, or release; otherwise a practical protocol |

This is five opportunities per week, not a promise to fill every slot. An unavailable source or rejected draft is skipped. The starting cadence follows the [Buffer posting-frequency study](https://buffer.com/resources/how-often-to-post-on-instagram/); it is a starting hypothesis, not a growth guarantee. Assess saves, shares, profile visits and follows against the actual account's baseline after a meaningful sample.

Vancouver is pinned to `Etc/GMT+7`: BC adopted permanent UTC−7 in March 2026. This avoids the obsolete November fallback in older runtime timezone data. [BC announcement](https://news.gov.bc.ca/releases/2026AG0013-000209).

## Source and creative controls

The worker reads only published `public.blog_posts` fields: `id`, `title`, `slug`, `content`, `published_at`, `is_live`, and `thumbnail_url`. It removes scripts/styles/HTML and clips text to 12,000 characters. Blog slots use sources at most 30 days old; other slots allow 180 days. Future, unpublished, malformed, empty, or recently used sources are excluded. A saved source snapshot is revalidated before generation and after generation. A retry reuses that exact snapshot and any completed package.

Other formats use a distinct practical angle supported by those public sources. The worker does not inspect private customer records, infer shipped features from code, or invent testimonials and results. Product/proof/release/dispatch formats require source support; dispatch also needs an authentic image. Both prompts treat source text and previous hooks as untrusted data. Neither model can invoke tools or publish.

Both writer and editor receive the complete versioned `docs/social/voice/sam-parr-field-guide.md` as a creative reference. Its SHA-256 is recorded on approved packages and rejected editor audits. OPS evidence and voice rules override its website-specific advice; its example claims are never evidence about OPS. The file is explicitly included in the cloud function bundle.

The writer returns a strict structured package. Deterministic checks enforce OPS voice, field lengths, exact evidence excerpts, numeric support, URL ownership, compatible imagery, and near-duplicate hooks. An independent editor checks every claim, freshness, usefulness, repetition, and format support. Model review is fallible; it supplements these constraints and the operator's inspection, rather than proving every semantic claim.

OPS owns the source URL, source identity, visual treatment, images, and publication lifecycle. Approved packages reuse the existing seven-template renderer. Prepare mode also renders real 1080 × 1350 JPEGs into the existing asset store.

## Durable state and release controls

Migration: `supabase/migrations/20260905185527_create_social_editorial.sql`.

`social_editorial_settings` is a service-only singleton. Its mode defaults to `off`:

- `off`: no new editorial claims or automatic queue handoffs.
- `prepare`: generate, review, render and save a held preview. No `social_posts` row is submitted.
- `publish`: eligible new runs may enter the existing renderer and ten-minute veto queue. Publication requires separate explicit approval before selecting this mode.

Each `social_editorial_runs.slot_date` is unique. The row records originating mode, source snapshot, attempts, reserved allowance, lease, package, review, usage, optional rejection audit, preview assets and linked social post. A terminal prepared row stays held when mode changes; old previews never become automatic publications.

Claims lock the settings row and run, use a six-minute lease, and allow at most three attempts. Retries wait 15 minutes. Every date uses `cloud-editorial-v1:YYYY-MM-DD` for the downstream idempotency key. If the downstream row already exists, the worker reconciles it rather than creating another. Rendering waits for recovery; failed/cancelled or uncertain downstream delivery requires inspection. The existing publisher retains ownership of Meta uncertainty and reconciliation.

The database handoff trigger serializes new automatic rendering/review transitions with the mode control. Turning off during rendering prevents promotion into automatic review. **Turning off does not cancel a post that already entered the review queue.** Use the existing STOP action for those rows.

Tables have RLS, no browser grants or policies, and explicit service-role privileges. New RPCs use `SECURITY INVOKER`, a fixed empty search path and revoked public execution. The authenticated admin read route exposes the last 20 runs; it does not expose credentials or provide an activation button.

## Cost limits

Two `gpt-5.6-sol` calls are allowed per attempt: writer and editor. Each has a 65-second timeout, no SDK retries, a 64KB serialized input limit including schema, and at most 4,000 completion tokens. No tools or external research calls are available to the models.

Each claim reserves US$0.75 against a configurable monthly allowance capped at US$20. Reservations are retained after crashes and retries, so the ledger intentionally overestimates usage. At the reviewed [OpenAI standard prices](https://developers.openai.com/api/docs/pricing), input is US$4/M tokens and output US$20/M. Recheck prices before changing the model or bounds. This is an application estimate allowance, not a provider-enforced billing limit.

The full-guide local canary used 17,257 input and 1,296 output tokens across both stages: estimated **US$0.094948**, producing five slides. The earlier condensed-guide canary cost US$0.052068 and is preserved under `prior-condensed-guide/`. One preceding attempt failed with incomplete usage, so neither number is the total testing bill. Vercel function execution and asset storage are additional usage. [Vercel cron pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) states that cron is included but function usage is billed normally; this schedule requires a plan supporting subdaily cron.

## Notifications and inspection

Prepared and failed rows form a durable notification outbox through `notified_at`. `notify_social_editorial` inserts the notification and acknowledges the row in one transaction; a replay inserts zero duplicates. Notification type is `social_editorial`; prepared notifications are standard and failed notifications persistent. Both link to `/admin/social#cloud-production`.

Recipients use `SOCIAL_OPERATOR_USER_ID` and `SOCIAL_OPERATOR_COMPANY_ID`, with corresponding `PMF_OPERATOR_*` fallbacks. Verify the exact recipient before activation. Missing configuration leaves the outbox unacknowledged. Notification failure does not discard a completed draft.

Open `/admin/social`, expand cloud production, and inspect the rendered slides, full caption, source link and status. The admin API also retains source snapshots, review results, usage and rejected editor output for investigation. Skipped unsupported ideas remain visible in history without a failure alert.

## Approved release procedure

No step in this section grants approval by itself.

1. Obtain explicit approval for this production code release, new migration and paid preparation-only activation. Integrate onto current production source while preserving concurrent work, and rerun focused verification.
2. Verify current production schemas and migration history; apply the exact additive migration with settings still `off`. Independently verify the default, RLS, grants and RPC execution restrictions.
3. Deploy the code. Verify `OPENAI_API_KEY`, `CRON_SECRET` of at least 32 characters, existing storage settings and the exact operator recipient. Do not print secrets. Confirm the cron schedule and expected authentication failures.
4. Set only the exact singleton to `prepare`, preserving the US$20 allowance or an explicitly approved lower limit. Read it back independently. During a weekday 10:00–20:00 window, allow or invoke one authenticated cron run. Outside that window, wait for the next scheduled opportunity rather than bypassing the schedule in production.
5. Verify one durable date row, source snapshot, approved package, actual JPEG URLs and held-preview UI. Verify no new `social_posts` row for that date's key and no Instagram publication. Repeat the cron invocation and confirm no extra generation or duplicate notification.
6. Leave preparation active only within the approved scope. Obtain separate explicit permission before enabling `publish` or manually submitting a held draft. A first real post requires exact queue and Meta permalink readback after the veto window.

Rollback control is the singleton's `off` mode. Independently inspect and STOP any already-reviewable posts that must not publish. Do not delete ledger rows to retry a terminal date; preserving the audit and date identity is the duplicate-prevention boundary.

## Local verification

Behavioral tests live under `tests/unit/social/editorial/`. They cover schedule boundaries, source freshness, voice/evidence, retry snapshots and packages, prepare/off controls, downstream reconciliation, auth, safe errors, shared thumbnail rendering and the inspection UI.

`tests/sql/social-editorial-runtime.mjs` applies the exact migration to a disposable local PostgreSQL database. It proves concurrent claims, stale owners, attempt exhaustion, monthly reservations, mode changes during rendering, source withdrawal, terminal preview behavior, recovery, RLS/grants and notification replay. Its fixed local socket intentionally cannot target a production database.

`tests/integration/social-editorial-canary.test.ts` is skipped unless `OPS_RUN_EDITORIAL_CANARY=1`. It runs real bounded model calls and the production renderer, but injects local asset writes and bypasses application notifications and all database writes. `docs/artifacts/social-editorial/` contains the approved canary, five actual JPEGs and a browser-inspected static rendering of the real admin component. This proves the local generation/render path; production scheduling, storage, recipient delivery and first publication still need their separate live checks.

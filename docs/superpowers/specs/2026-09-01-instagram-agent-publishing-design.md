# Instagram Agent Publishing — Design Specification

**Date:** 2026-09-01  
**Status:** Approved for implementation  
**Surface:** OPS Web admin, scheduled content agents, Instagram professional account

## Outcome

A scheduled agent can turn a newly published OPS article or an original social idea into a complete Instagram package, submit it to OPS Web, and rely on OPS Web to render, hold, publish, retry, and audit it. The agent owns creative judgment. OPS Web owns deterministic production and publishing safety.

The default path is deliberately quiet:

1. The agent reads the source article and the versioned OPS + Sam Parr voice references.
2. It submits structured copy, source context, media, and optional format preferences to a secret internal endpoint.
3. OPS Web validates the payload, selects the best compatible treatment from the programmed feed cycle, renders Instagram-ready JPEGs, and opens a 10-minute veto window.
4. The Social command deck shows the exact post, countdown, copy, source, and publishing state.
5. If an operator does nothing, the post publishes automatically. If stopped or edited, publishing is cancelled or the review clock restarts.

Instagram credentials remain server-only in Vercel and are never given to the agent.

## Product principles

- **Agent as creative engine.** Hooks, angles, captions, narrative sequence, and proposed format come from the scheduled writer, not a brittle template filler.
- **System as producer.** Layout fit, asset generation, feed cadence, duplicate protection, veto timing, retries, quota checks, and Meta API calls are deterministic.
- **Preview is the real artifact.** The operator reviews the exact JPEGs and caption that will publish, not a loose text draft.
- **Silence means publish.** The review window is an intervention mechanism, not an approval queue.
- **No secret leakage.** A narrow submission secret authenticates the agent. Instagram tokens and account IDs never cross that boundary.
- **Fail closed.** Missing secrets, invalid public media, expired claims, exhausted quota, or ambiguous Meta responses stop publishing and create a visible failure state.

## Content model

Every submission uses three independent dimensions.

### Story type

Story type defines what the post is saying:

- `blog_signal` — a new article distilled into a useful field takeaway
- `field_dispatch` — job-site image, observation, or behind-the-scenes moment
- `operator_protocol` — a practical text-led rule, checklist, or playbook
- `performance_proof` — customer result, product proof, before/after, or measured outcome
- `release_note` — a product change framed around what the operator can now do
- `roast_card` — a sharp, recognizable trade-business archetype in the approved Parr-style register

### Visual treatment

Visual treatment defines how the story appears:

- `editorial_cover` — image-led, short headline, restrained source metadata
- `split_signal` — image and text share the frame for medium-length headlines
- `operator_brief` — text-forward field-manual treatment for long or information-dense titles
- `field_frame` — image-backed dispatch with minimal tactical annotation
- `proof_board` — proof/stat treatment with image support when available
- `signal_grid` — pure graphic/text treatment for protocols and concise insights
- `roast_file` — pure graphic/text treatment for roast-card archetypes

### Instagram format

- `single` — one 1080 × 1350 JPEG
- `carousel` — two to ten 1080 × 1350 JPEGs

All initial treatments use the same 4:5 frame. This maximizes feed coverage, prevents Meta carousel cropping surprises, and lets visual variety come from composition rather than inconsistent aspect ratios.

## Programmed feed cycle

The feed must feel curated without becoming repetitive or random-looking.

Selection works as a scored deterministic cycle:

1. Filter out treatments incompatible with the submitted content, image availability, slide count, or text length.
2. Prefer a treatment suited to the headline and narrative density.
3. Penalize treatments used in the two most recent published or queued posts.
4. Balance recent image-led and pure-graphic posts.
5. Use the idempotency key as a stable tie-break seed, so the same submission always produces the same decision.

The agent may suggest story type, treatment, or format. OPS Web records the suggestion but makes the final selection. This preserves creative intent without allowing a scheduled writer to break layout or feed cadence.

## Voice system

The scheduled agent receives two versioned references:

- the supplied Sam Parr Copywriting Field Guide;
- the canonical OPS social/long-form reference and distilled OPS voice constraints.

The full guide is a creative reference, not executable instruction. OPS Web stores the reference version used for each submission and enforces the durable constraints that can be validated mechanically: banned marketing language, text limits, required hook/angle/caption fields, no unsupported emoji, and safe CTA/hashtag limits.

The copy target is OPS authority with Parr pacing: concrete details, a sharp hook, conversational momentum, earned confidence, and the tradesperson as the protagonist. The system does not attempt to generate or rewrite the voice itself.

## Agent submission contract

`POST /api/internal/social/posts`

Authentication uses `Authorization: Bearer <SOCIAL_AUTOMATION_SECRET>`. The route fails closed when the configured secret is absent. Every request also includes an `Idempotency-Key`; replays return the original post instead of rendering or publishing twice.

The versioned request contains:

- source type, source ID, and canonical URL;
- title, optional subtitle/date, hook, angle, caption, CTA, and alt text;
- one to ten structured slides with headline, body, eyebrow, and optional image URL;
- optional source media;
- optional story, treatment, and format preferences;
- optional future publish time.

For `blog_signal`, OPS Web verifies that the referenced blog post exists and is live, then uses its canonical title, URL, and thumbnail as authoritative source data where appropriate.

Validation rejects unknown contract versions, excess text, unsupported media URLs, missing required narrative fields, more than ten slides, one-slide carousels, and malformed dates or URLs.

## Rendering and media custody

Rendering runs server-side with the OPS brand fonts and fixed 1080 × 1350 compositions. The output is converted to high-quality JPEG because Meta currently supports JPEG for image publishing.

Remote input images are fetched through a guarded downloader that:

- allows HTTPS only;
- blocks loopback, link-local, and private-network destinations;
- follows a small redirect limit and revalidates every hop;
- enforces response size, timeout, and image content-type limits;
- strips metadata during normalization.

Rendered assets are stored under a dedicated public social-media prefix. The database records public URL, SHA-256 digest, dimensions, byte count, slide order, render version, and alt text. Meta receives only these public rendered URLs.

## Queue and lifecycle

Each post is a durable row with one of these states:

`rendering → review → publishing → published`

Alternate terminal or recovery states are `cancelled` and `failed`.

- A successfully rendered post enters `review` with `publish_after = rendered_at + 10 minutes`, unless a later requested publish time was supplied.
- Editing structured copy re-renders the assets and restarts the full 10-minute review window.
- `STOP POST` moves a reviewable post to `cancelled` permanently.
- `PUBLISH NOW` uses the same atomic claim and publisher as the cron worker; it does not bypass quota, idempotency, or readiness checks.
- Retryable failures use bounded backoff and remain visible. Terminal failures require an operator retry after the underlying cause is corrected.

The worker uses an atomic database claim with `FOR UPDATE SKIP LOCKED`, a claim token, and an expiry. This makes duplicate Vercel cron delivery safe and prevents two workers from publishing the same row.

## Instagram publishing

The Meta client uses an environment-configurable Graph API origin and version, with Vercel-held `INSTAGRAM_ACCESS_TOKEN` and `INSTAGRAM_USER_ID`.

Before publishing, the worker:

1. verifies the post still owns its database claim;
2. queries the account's content publishing limit;
3. creates single-image or carousel child containers from public JPEG URLs;
4. polls container status until ready or terminal;
5. publishes the final container once;
6. records the Instagram media ID and permalink.

HTTP 429/5xx responses and Meta errors explicitly marked transient are retryable. Other Graph errors are terminal until an operator retries. Access tokens are never placed in logs or stored with the post.

## Social command deck

`/admin/social` is an operator control surface, not a marketing content calendar.

The screen has three coordinated zones:

- **Launch rail:** chronological queue with state, story type, treatment, source, and veto clock.
- **Artifact preview:** the actual 4:5 post or carousel at meaningful size, with slide navigation.
- **Control file:** caption, hook, angle, template decision, render details, audit trail, and the actions appropriate to the current state.

The next post due is selected by default. Review-state actions are `EDIT COPY`, `STOP POST`, and one primary `PUBLISH NOW`. Published rows link to Instagram. Failed rows name the failure and expose `RETRY NOW` only when an operator can act.

Editing is structured: title, subtitle, hook, angle, caption, CTA, alt text, and slide text can change. Re-rendering is mandatory before the post returns to review.

The interface follows the OPS command-deck design system: black canvas, glass and hairlines, Cake Mono authority labels, Mohave sentence-case copy, JetBrains Mono timestamps/numbers, semantic earth tones, and steel blue reserved for the single primary action.

## Notifications and audit

When a post enters review, OPS creates a persistent in-app notification that links to the exact post. Publishing or cancellation resolves it. A successful publication creates a standard informational notification. Exhausted retries create a persistent failure notification with the error and recovery route.

Every material transition records timestamp, actor (`agent`, `system`, or admin identity), prior state, next state, and structured metadata. The post row preserves the original payload, final selected treatment, render version, voice reference version, attempt count, last error, Instagram IDs, and publication timestamps.

## Security and database exposure

The queue lives in `public.social_posts` for Supabase API compatibility, but Row Level Security is enabled with no browser policies and privileges are revoked from `anon` and `authenticated`. Only server-side service-role code can read or mutate it.

The atomic claim function is `SECURITY DEFINER`, fixes its `search_path`, fully qualifies referenced objects, and grants execution only to `service_role`.

Admin routes retain the existing Firebase admin-email gate. Agent routes use the dedicated automation secret. Cron routes use Vercel's `CRON_SECRET`.

## Scheduling and cost

Vercel calls the publishing worker every two minutes. The function normally performs one indexed claim query and exits; rendering occurs at submission/edit time, not on every tick.

This cadence produces at most about 21,600 cron invocations in a 30-day month, plus submission and operator requests. It requires a Vercel plan that supports sub-daily cron schedules and consumes normal function invocation, CPU, and memory allowance. No new paid rendering service is introduced.

## Operational boundaries

This build creates code, tests, a local migration, reference files, and the Vercel environment contract. It does not:

- apply the database migration to production;
- create or rotate Meta credentials;
- add Vercel production environment values;
- deploy OPS Web;
- publish a real Instagram post.

Those are explicit production gates after local verification.

## Acceptance criteria

- Replaying an identical agent request cannot create or publish a duplicate.
- A live blog source can become a fully rendered review item without Instagram credentials present.
- Incompatible agent format preferences are safely overridden and explained in stored selection metadata.
- The exact final JPEGs and caption are visible during a 10-minute veto window.
- Editing re-renders and restarts the clock; stopping prevents future claims.
- Duplicate cron delivery cannot double-publish.
- Single-image and carousel Meta flows enforce quota and readiness before publishing.
- Retryable failures back off; terminal failures become persistent operator actions.
- All new user-facing copy is dictionary-backed and all new interface styling uses OPS tokens.
- The full feature is documented in the OPS Software Bible and has a current scheduled-agent contract.

# Instagram Agent Publishing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use custom-skills:executing-plans to implement this plan task-by-task.

**Goal:** Build a secure OPS Web production system that accepts structured social packages from a scheduled agent, renders a curated Instagram post, provides a 10-minute operator veto window, and publishes idempotently through Meta.

**Architecture:** A versioned, secret-authenticated agent route writes durable `social_posts` rows and rendered public JPEG metadata. A deterministic selector combines story fit with recent-feed cadence. A server-only worker atomically claims due rows, enforces Meta quota and container readiness, then publishes once. `/admin/social` exposes the exact artifact, countdown, edit/re-render, stop, publish-now, retry, and audit state.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase Postgres/RLS/RPC, S3 or Supabase Storage, `next/og`, `sharp`, Zod, TanStack Query, Vercel Cron, Meta Instagram Graph API, Vitest, Testing Library.

**Required skills:** `custom-skills:executing-plans`, `superpowers:test-driven-development`, `supabase:supabase`, `ops-copywriter:ops-copywriter`, `custom-skills:ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:ui-ux-pro-max`, `custom-skills:audit-design-system`, `vercel:env-vars`, `vercel:nextjs`, `superpowers:verification-before-completion`, `superpowers:requesting-code-review`, `superpowers:finishing-a-development-branch`.

**Approved design:** `docs/superpowers/specs/2026-09-01-instagram-agent-publishing-design.md`

---

### Task 1: Install the durable queue schema

**Files:**

- Create with Supabase CLI: `supabase/migrations/<generated>_create_social_publishing.sql`
- Modify if generated types are committed by this repo: `src/lib/database.types.ts`
- Test: `tests/unit/social/social-migration-contract.test.ts`

**Step 1: Write the failing migration contract test**

Assert the migration includes:

- `public.social_posts` with lifecycle, source, structured content, selection, asset, Meta, claim, retry, audit, and timestamp columns;
- checks for status, story type, visual treatment, format, attempts, and JSON array asset shape;
- unique `idempotency_key`;
- due-row and history indexes;
- RLS enabled with browser privileges revoked;
- `public.claim_due_social_posts` as fixed-search-path `SECURITY DEFINER`, using `FOR UPDATE SKIP LOCKED`, claim expiry, and `service_role`-only execution;
- an `updated_at` trigger using the repository's existing trigger convention.

Run:

```bash
npm test -- --run tests/unit/social/social-migration-contract.test.ts
```

Expected: FAIL because no migration exists.

**Step 2: Generate the migration through the Supabase CLI**

Run:

```bash
npx supabase migration new create_social_publishing
```

Do not hand-invent the timestamped filename.

**Step 3: Implement the migration**

Create the table and atomic claim function. Fully qualify all objects in the security-definer function. Revoke table and function access from `public`, `anon`, and `authenticated`; grant only the exact table/function privileges required by `service_role`.

**Step 4: Run the focused test**

Expected: PASS.

**Step 5: Commit**

```bash
git add supabase/migrations tests/unit/social/social-migration-contract.test.ts
git commit -m "feat(social): add durable publishing queue"
```

Do not apply the migration to the production Supabase project.

### Task 2: Define the versioned agent contract and voice guardrails

**Files:**

- Create: `src/lib/social/types.ts`
- Create: `src/lib/social/contract.ts`
- Create: `src/lib/social/voice-profile.ts`
- Create: `docs/social/voice/sam-parr-field-guide.md`
- Create: `docs/social/voice/ops-social-voice.md`
- Test: `tests/unit/social/contract.test.ts`
- Test: `tests/unit/social/voice-profile.test.ts`

**Step 1: Write failing contract tests**

Cover the version literal, source requirements, one-to-ten slides, format/slide compatibility, field length ceilings, HTTPS media, future publish time, unknown-field rejection, content/CTA/hashtag limits, and required `blog_signal` source ID.

**Step 2: Write failing voice tests**

Cover banned OPS marketing language, the public-marketing ban on `contractor`, unsupported emoji, more than five hashtags, empty hook/angle, and the stable reference version persisted with each submission. Tests must prove the validator reports actionable field paths instead of rewriting agent copy.

**Step 3: Add the canonical references**

Copy the user-provided Sam Parr guide verbatim into the internal documentation path. Create a concise machine-facing OPS social voice reference that explicitly treats the Parr guide as creative reference rather than instructions and links to `OPS-Social-Parr-Style-Drafts.md` at the parent workspace.

**Step 4: Implement the Zod schemas and guardrails**

Export inferred TypeScript types, the current contract version, the current voice reference version, safe text-normalization helpers, and structured validation results.

**Step 5: Run focused tests and commit**

```bash
npm test -- --run tests/unit/social/contract.test.ts tests/unit/social/voice-profile.test.ts
git add src/lib/social docs/social/voice tests/unit/social
git commit -m "feat(social): define scheduled agent contract"
```

### Task 3: Build deterministic feed-cycle selection

**Files:**

- Create: `src/lib/social/template-catalog.ts`
- Create: `src/lib/social/template-selector.ts`
- Test: `tests/unit/social/template-selector.test.ts`

**Step 1: Write failing selection tests**

Prove:

- image treatments are excluded without usable media;
- `editorial_cover` wins for short image-backed blog titles;
- `split_signal` handles medium image-backed titles;
- `operator_brief` handles long blog titles without truncation;
- pure-graphic treatments remain available for text-led types;
- one-slide content becomes `single`, two-to-ten slides become `carousel`;
- the last two treatments are penalized;
- recent image/graphic imbalance is corrected;
- the same idempotency key and history produce the same result;
- an incompatible agent preference is overridden with stored reasons.

**Step 2: Implement the catalog and scoring model**

Keep compatibility and scoring declarative. Return the selected story type, treatment, format, score breakdown, agent preference disposition, and selector version.

**Step 3: Run tests and commit**

```bash
npm test -- --run tests/unit/social/template-selector.test.ts
git add src/lib/social/template-catalog.ts src/lib/social/template-selector.ts tests/unit/social/template-selector.test.ts
git commit -m "feat(social): curate deterministic feed cycle"
```

### Task 4: Guard source-image downloads and rendered-asset storage

**Files:**

- Create: `src/lib/social/public-media.ts`
- Create: `src/lib/social/asset-store.ts`
- Test: `tests/unit/social/public-media.test.ts`
- Test: `tests/unit/social/asset-store.test.ts`

**Step 1: Write failing SSRF and storage tests**

Cover HTTPS-only input, credentials/ports rejection, localhost/private/link-local/metadata IP rejection for IPv4 and IPv6, DNS resolution checks, redirect revalidation, timeout, size limit, image MIME requirement, normalized JPEG output, deterministic storage keys, S3 public URL generation, Supabase storage fallback, and no secret-bearing log output.

**Step 2: Implement guarded download and normalization**

Use explicit fetch timeouts, redirect handling, DNS checks, `sharp` metadata/normalization, pixel limits, and metadata stripping.

**Step 3: Implement the storage adapter**

Store under `social-media/{postId}/{renderVersion}/slide-{nn}.jpg`. Return URL, SHA-256 digest, width, height, byte count, and content type.

**Step 4: Run tests and commit**

```bash
npm test -- --run tests/unit/social/public-media.test.ts tests/unit/social/asset-store.test.ts
git add src/lib/social/public-media.ts src/lib/social/asset-store.ts tests/unit/social
git commit -m "feat(social): secure rendered media custody"
```

### Task 5: Render the seven OPS visual treatments

**Files:**

- Add asset: `public/fonts/CakeMono-Light.woff2`
- Create: `src/lib/social/render/fonts.ts`
- Create: `src/lib/social/render/theme.ts`
- Create: `src/lib/social/render/frame.tsx`
- Create: `src/lib/social/render/treatments/editorial-cover.tsx`
- Create: `src/lib/social/render/treatments/split-signal.tsx`
- Create: `src/lib/social/render/treatments/operator-brief.tsx`
- Create: `src/lib/social/render/treatments/field-frame.tsx`
- Create: `src/lib/social/render/treatments/proof-board.tsx`
- Create: `src/lib/social/render/treatments/signal-grid.tsx`
- Create: `src/lib/social/render/treatments/roast-file.tsx`
- Create: `src/lib/social/render/render-social-post.tsx`
- Test: `tests/unit/social/render-social-post.test.tsx`

**Step 1: Write failing renderer tests**

For every treatment, assert 1080 × 1350 JPEG output, slide order, JPEG content type, accessible alt text metadata, deterministic digest for fixed input, no clipped sentinel text at maximum allowed lengths, and correct single/carousel asset count.

**Step 2: Add the approved brand font asset**

Reuse Cake Mono Light from the OPS design-system font directory. Load Mohave from the existing public assets. Use Cake Mono only for uppercase display voice and Mohave for sentence-case content; use the available mono face or a token-compliant fallback for tactical metadata.

**Step 3: Implement the shared frame and treatments**

Use a tokenized server-render theme matching OPS brand values. Keep every frame left-aligned, high contrast, free of decorative icons, and legible in the Instagram grid crop. Image treatments use normalized image data. Graphic treatments use composition, hierarchy, hairlines, source markers, and whitespace rather than gradients or ornaments.

**Step 4: Convert to final JPEG and persist metadata**

Render with `ImageResponse`, convert through `sharp`, and store through the adapter from Task 4.

**Step 5: Run tests and commit**

```bash
npm test -- --run tests/unit/social/render-social-post.test.tsx
git add public/fonts/CakeMono-Light.woff2 src/lib/social/render tests/unit/social/render-social-post.test.tsx
git commit -m "feat(social): render curated instagram treatments"
```

### Task 6: Accept idempotent scheduled-agent submissions

**Files:**

- Create: `src/lib/social/auth.ts`
- Create: `src/lib/social/repository.ts`
- Create: `src/lib/social/submission-service.ts`
- Create: `src/app/api/internal/social/posts/route.ts`
- Test: `tests/integration/social-agent-submission.test.ts`

**Step 1: Write failing integration tests**

Cover fail-closed missing secret, constant-time bearer validation, required idempotency key, malformed body errors, live-blog source verification, non-live source rejection, canonical blog field enrichment, recent-history selection, rendering, review deadline, source/selection/reference metadata persistence, replay returning the original row, and partial-render cleanup/failure state.

**Step 2: Implement server-only auth and repository**

Never expose secrets or use a browser Supabase client. Keep the table behind the service-role client. Query recent relevant history with an indexed bounded query.

**Step 3: Implement submission orchestration**

Reserve the idempotency key before expensive rendering, handle concurrent unique-key races, persist `rendering`, select, render, move to `review`, and create the persistent review notification. A requested future publish time wins only when later than the ten-minute minimum.

**Step 4: Implement the route and response contract**

Return `201` for a new post and `200` for an idempotent replay. Return the post ID, state, selected treatment, format, asset URLs, publish deadline, and admin review URL. Never return Instagram credentials or service details.

**Step 5: Run tests and commit**

```bash
npm test -- --run tests/integration/social-agent-submission.test.ts
git add src/lib/social src/app/api/internal/social/posts/route.ts tests/integration/social-agent-submission.test.ts
git commit -m "feat(social): accept agent publishing packages"
```

### Task 7: Implement the Meta Instagram client

**Files:**

- Create: `src/lib/social/instagram-client.ts`
- Create: `src/lib/social/instagram-errors.ts`
- Test: `tests/unit/social/instagram-client.test.ts`

**Step 1: Write failing Meta-client tests**

Mock fetch and prove:

- missing account ID/token/version fails before a request;
- API origin and version are configurable;
- publishing-limit lookup is mandatory;
- single-image container creation, readiness polling, publish, and permalink lookup use the correct sequence;
- carousel child containers are created, polled, attached, then the parent is polled and published;
- only two-to-ten carousel children are allowed;
- JPEG public URLs and caption/alt fields are passed without logging tokens;
- HTTP 429/5xx and `is_transient: true` classify as retryable;
- other Graph errors classify terminal with operator-safe messages;
- readiness timeout never calls publish.

**Step 2: Implement the typed Graph client**

Use `INSTAGRAM_API_ORIGIN` (default `https://graph.facebook.com`), `INSTAGRAM_API_VERSION`, `INSTAGRAM_ACCESS_TOKEN`, and `INSTAGRAM_USER_ID`. Keep request building internal so access tokens cannot appear in thrown URLs or logs.

**Step 3: Run tests and commit**

```bash
npm test -- --run tests/unit/social/instagram-client.test.ts
git add src/lib/social/instagram-client.ts src/lib/social/instagram-errors.ts tests/unit/social/instagram-client.test.ts
git commit -m "feat(social): publish through instagram graph api"
```

### Task 8: Build the atomic publisher, retries, cron, and notifications

**Files:**

- Create: `src/lib/social/notification-service.ts`
- Create: `src/lib/social/publisher.ts`
- Create: `src/app/api/cron/social-publish/route.ts`
- Modify: `vercel.json`
- Test: `tests/integration/social-publisher.test.ts`
- Test: `tests/integration/social-publish-cron.test.ts`

**Step 1: Write failing worker tests**

Cover atomic claims, expired-claim recovery, claim-token ownership on every update, publish success, permalink persistence, review-notification resolution, publication notification, retry backoff at 5/15/60 minutes, bounded attempts, terminal failure notification, cancellation exclusion, duplicate worker delivery, and absence of credentials in errors.

**Step 2: Write failing cron tests**

Cover fail-closed `CRON_SECRET`, Vercel bearer auth, no-due-work success, bounded batch size, per-row isolation, and a stable summary response.

**Step 3: Implement the publisher**

Claim through the RPC, process posts sequentially, verify claim ownership before and after external calls, call the Meta client, update terminal state, and resolve/create notifications through the service-role lane.

**Step 4: Register the two-minute Vercel cron**

Add `/api/cron/social-publish` with `*/2 * * * *`, preserving every existing cron entry.

**Step 5: Run tests and commit**

```bash
npm test -- --run tests/integration/social-publisher.test.ts tests/integration/social-publish-cron.test.ts
git add src/lib/social src/app/api/cron/social-publish/route.ts vercel.json tests/integration/social-publisher.test.ts tests/integration/social-publish-cron.test.ts
git commit -m "feat(social): publish due posts with safe retries"
```

### Task 9: Add admin list, edit, stop, publish-now, and retry APIs

**Files:**

- Create: `src/app/api/admin/social/posts/route.ts`
- Create: `src/app/api/admin/social/posts/[id]/route.ts`
- Create: `src/lib/social/admin-service.ts`
- Test: `tests/integration/social-admin-routes.test.ts`

**Step 1: Write failing admin-route tests**

Cover admin auth, bounded status-filtered listing, exact ID lookup, edit eligibility, structured validation, re-render and clock restart, old-asset preservation in audit metadata, stop eligibility, immediate atomic publish, retry eligibility, claim conflicts, published immutability, and actionable error responses.

**Step 2: Implement admin orchestration**

All mutations run server-side and record actor identity plus before/after audit events. `PUBLISH NOW` must use the shared atomic publisher. `STOP POST` resolves the review notification. `EDIT COPY` renders before swapping asset metadata and then starts a fresh 10-minute veto window.

**Step 3: Run tests and commit**

```bash
npm test -- --run tests/integration/social-admin-routes.test.ts
git add src/app/api/admin/social src/lib/social/admin-service.ts tests/integration/social-admin-routes.test.ts
git commit -m "feat(social): add operator publishing controls"
```

### Task 10: Build the Social command deck

**Files:**

- Create: `src/i18n/dictionaries/en/admin-social.json`
- Create: `src/i18n/dictionaries/es/admin-social.json`
- Modify: `src/i18n/config.ts` or current dictionary registry if required
- Create: `src/lib/hooks/use-social-posts.ts`
- Create: `src/app/admin/social/page.tsx`
- Create: `src/app/admin/social/_components/social-command-deck.tsx`
- Create: `src/app/admin/social/_components/launch-rail.tsx`
- Create: `src/app/admin/social/_components/post-preview.tsx`
- Create: `src/app/admin/social/_components/post-control-file.tsx`
- Create: `src/app/admin/social/_components/post-copy-editor.tsx`
- Create: `src/app/admin/social/_components/social-status-badge.tsx`
- Modify: `src/app/admin/_components/sidebar.tsx`
- Test: `tests/unit/admin/social-command-deck.test.tsx`

**Step 1: Write failing interface tests**

Cover dictionary-backed copy, due-post default selection, review countdown, carousel navigation, exact asset rendering, state labels independent of color, disabled/visible actions by state, edit form population and validation, stop confirmation, publish loading/result state, failure recovery, keyboard/focus behavior, and no empty-state crash.

**Step 2: Implement the data hook**

Use centralized TanStack Query keys, authenticated admin fetches, controlled polling only while rows are in active states, and mutation invalidation.

**Step 3: Implement the three-zone command deck**

- Launch rail: chronological state and veto clock, no calendar or Kanban UI.
- Artifact preview: full 4:5 JPEG, slide position, and accessible controls.
- Control file: source, rationale, copy, audit, and current actions.

Use `Surface`, existing button/input/status primitives where applicable, token classes only, Cake Mono authority labels, Mohave content, mono numbers/timestamps, one steel-blue primary action, and semantic earth tones with text labels. Add no bespoke animation; use existing transition tokens and respect reduced motion.

**Step 4: Implement structured edit and confirmation flows**

The editor exposes only fields the agent contract owns. Confirm stopping because it is terminal. Keep primary action hierarchy state-aware.

**Step 5: Add the CONTENT sidebar destination**

Add `SOCIAL` immediately after `BLOG`.

**Step 6: Run tests and commit**

```bash
npm test -- --run tests/unit/admin/social-command-deck.test.tsx
git add src/i18n src/lib/hooks/use-social-posts.ts src/app/admin/social src/app/admin/_components/sidebar.tsx tests/unit/admin/social-command-deck.test.tsx
git commit -m "feat(social): add instagram command deck"
```

### Task 11: Document the scheduled-agent handoff and environment contract

**Files:**

- Create: `docs/social/scheduled-agent-contract.md`
- Create: `docs/social/instagram-operations.md`
- Modify: `.env.example`
- Modify: `README.md` if it maintains environment/setup references
- Modify: `ops-software-bible/07_SPECIALIZED_FEATURES.md` in the parent workspace or its current canonical social section
- Test: `tests/unit/social/documentation-contract.test.ts`

**Step 1: Write the failing documentation contract test**

Assert the docs and environment example cover:

- agent and cron authentication;
- Meta origin/version/account/token variables;
- operator notification IDs;
- S3/Supabase asset storage behavior;
- idempotency and request/response examples;
- story/treatment/format values;
- review/edit/stop/publish lifecycle;
- token rotation, quota, failure, and safe retry operations;
- explicit no-production-deploy/migration assumptions.

**Step 2: Write the agent handoff**

Include a JSON example and a curl example that references environment variables without embedding secrets. Direct the scheduled writer to the versioned voice references and make the structured schema authoritative.

**Step 3: Write the operator runbook and env contract**

Document `SOCIAL_AUTOMATION_SECRET`, `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID`, `INSTAGRAM_API_VERSION`, optional `INSTAGRAM_API_ORIGIN`, notification recipient variables/fallbacks, `CRON_SECRET`, and existing storage variables. Include Meta professional-account prerequisites and public-media requirements.

**Step 4: Replace the bible's old social-pipeline gaps with the new architecture**

Preserve historical context but mark the queue, preview, retry, notification, secret, and token-operations gaps as locally implemented and awaiting migration/deployment. Document exact file and route pointers.

**Step 5: Run tests and commit**

```bash
npm test -- --run tests/unit/social/documentation-contract.test.ts
git add docs/social .env.example README.md tests/unit/social/documentation-contract.test.ts
git commit -m "docs(social): publish agent and instagram runbooks"
```

Commit the software-bible change separately in its own repository if that directory is independently versioned. Never sweep unrelated parent-workspace changes into either commit.

### Task 12: Verify behavior, visual quality, and branch readiness

**Files:**

- Create transient proof only under: `docs/artifacts/social-publishing/`
- Modify only if audit finds defects: files from Tasks 1–11

**Step 1: Run the focused feature suite**

```bash
npm test -- --run tests/unit/social tests/integration/social-agent-submission.test.ts tests/integration/social-publisher.test.ts tests/integration/social-publish-cron.test.ts tests/integration/social-admin-routes.test.ts tests/unit/admin/social-command-deck.test.tsx
```

Expected: PASS.

**Step 2: Run type and production-build gates**

```bash
npm run type-check
npm run build
```

Expected: PASS, or report only independently verified pre-existing failures without claiming feature completion.

**Step 3: Run a local route/render smoke test**

Use a local test payload and mocked Instagram boundary. Verify:

- the agent endpoint creates one row on replay;
- generated files are valid 1080 × 1350 JPEGs;
- the admin screen shows the exact assets and countdown;
- edit restarts the clock;
- stop excludes the row from claims;
- publish success/failure transitions and notifications read back correctly.

Store screenshots/logs under `docs/artifacts/social-publishing/` only, then remove disposable artifacts after review.

**Step 4: Run the mandatory design-system audit**

Search every new UI file for hardcoded colors, spacing, radii, font sizes/families, non-token shadows, centered body text, unsupported icons, hardcoded copy, sub-11px text, and incorrect accent use. Correct every finding.

**Step 5: Request code review and address findings**

Use `superpowers:requesting-code-review`. Re-run affected focused tests after every correction.

**Step 6: Run final verification immediately before claiming completion**

Use `superpowers:verification-before-completion` and capture current command outputs. Use `superpowers:finishing-a-development-branch` to summarize branch options without pushing, deploying, or applying the production migration.

**Step 7: Commit any verification-driven corrections**

```bash
git add <only feature files changed by verification>
git commit -m "fix(social): close publishing verification gaps"
```

The final handoff must distinguish local code, local migration, live database, Vercel environment, deployment, and real Instagram publication. Only the first two are in scope without new approval.

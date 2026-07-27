# External Lead Intake and Analytics API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a company-scoped `/v1` API that accepts one original website inquiry with private photos/files, creates the correct customer/contact and a fresh OPS lead exactly once, and exposes a company-wide pseudonymous lead feed plus versioned analytics metrics for server-rendered website dashboards.

**Architecture:** Public `/v1` route handlers ignore browser cookies and terminate at a dedicated external-API boundary. They authenticate reveal-once credentials, apply a durable fail-closed limiter, validate strict Zod contracts, and call fixed service-role database commands that revalidate company, principal epoch, scope, and source inside each transaction. Original files upload directly to a versioned private S3 quarantine bucket through create-only conditional capabilities, pass structural and malware inspection, and are delivered only through short-lived CloudFront URLs from a cookieless origin. Intake creates the customer/contact, fresh lead, immutable submission, upload claims, public lead handle, source projection, assignment event, and post-commit outbox atomically. Analytics reads an append-only privacy-safe projection and versioned metric functions; it never serializes raw opportunity, customer, message, or file rows.

**Tech Stack:** Next.js 15 App Router, TypeScript 5.9, React 19, Zod, Supabase/PostgreSQL guarded RPCs and RLS/grant hardening, AWS S3 + GuardDuty Malware Protection for S3 + SQS/EventBridge + CloudFront, Upstash Redis REST for strict distributed limiting/private cache, Sharp, Vitest, Playwright, generated OpenAPI JSON.

**Design System:** OPS `DESIGN.md` and existing Settings/Pipeline workspace primitives. Add one state-aware `COMMS › WEBSITE` settings section; accepted images join the existing lead photo surface and non-image intake documents appear only when present. Reuse existing transitions. Add no new animation.

**Required Skills:** `custom-skills:executing-plans` as the OPS execution wrapper; `superpowers:test-driven-development`; `supabase:supabase`; `supabase:supabase-postgres-best-practices`; `ops-copywriter:ops-copywriter`; `custom-skills:ops-design`; `frontend-design:frontend-design`; `custom-skills:interface-design`; `custom-skills:ui-ux-pro-max`; `custom-skills:audit-design-system`; `superpowers:verification-before-completion`.

---

## Source of truth and hard boundaries

- Approved design: `docs/superpowers/specs/2026-07-23-lead-intake-and-analytics-api-design.md`.
- Public routes are exactly:
  - `GET /v1/intake/config`
  - `POST /v1/intake/uploads`
  - `POST /v1/intake/submissions`
  - `GET /v1/intake/submissions/{publicSubmissionId}`
  - `GET /v1/analytics/leads`
  - `GET /v1/analytics/metrics`
- Do not put these handlers under `src/app/api/v1`; that would expose the wrong `/api/v1` contract.
- V1 is server-to-server. A reusable intake or analytics secret never enters browser JavaScript.
- The API owns only the original submission. Do not add endpoints for later replies, notes, or files.
- Every genuine inquiry creates a new lead. Idempotency suppresses retries, not human intent.
- Analytics is company-wide and pseudonymous. Do not expose contact data, addresses, content, answers, attachment metadata, assignees, mailboxes, or internal IDs.
- Do not build an OPS analytics dashboard in this initiative. The read API powers a dashboard on the connecting website.
- No outbound webhook is part of v1.
- Do not reuse `src/app/api/uploads/presign/route.ts` or `src/lib/utils/ratelimit.ts` as-is.
- Do not push, deploy, apply production migrations, provision paid infrastructure, or enable a pilot company without Jackson's separate approval.

## Current baseline and reconciliation rule

- Planning branch: `feat/lead-intake-api`.
- Planning worktree: `/Users/jacksonsweet/Projects/OPS/ops-web/.worktrees/lead-intake-api`.
- Design commit: `92775580`.
- At planning time the branch is one commit ahead and four commits behind `origin/main`.
- The four upstream commits change commercial lifecycle classification, the sync engine, and lead summaries. Task 0 must merge current `origin/main` and remap those paths before implementation.
- Migration filenames below reserve `20260724030000` through `20260724037000` in dependency order. If Task 0 finds an upstream timestamp collision, advance the whole reserved sequence and update this plan before writing SQL.
- The pre-plan full Vitest baseline is 951 files passed, one skipped, four failed; 8,680 tests passed, five skipped, 12 failed. This is historical evidence only; it is not the implementation comparison baseline.
- Pre-plan known-red files:
  - `tests/integration/uploads-presign.test.ts`
  - `tests/unit/email/email-opportunity-title-live-pattern.test.ts`
- `tests/unit/email/sync-engine-ai-provider-isolation.test.ts`
- `tests/unit/i18n/inbox-parity.test.ts`
- Task 0 must rerun and record the complete suite after merging current `origin/main`. Every later full-suite comparison uses that post-merge commit-specific baseline, never the four-file historical list above.
- Live Supabase project `ijeekuhbatykdomumfjx` was reachable during planning, but broad catalog reads timed out. Every migration task therefore begins with a fresh live schema/RLS/grant readback; generated types and checked-in migrations are not enough.

## Recommended infrastructure and cost gate

Use the existing AWS account and region family, but create a dedicated private intake bucket and delivery boundary:

- versioned S3 quarantine/original/derivative prefixes with Block Public Access, create-only conditional uploads, short capability expiry, and lifecycle cleanup;
- GuardDuty Malware Protection limited to the intake bucket/prefix;
- S3/ObjectCreated and GuardDuty results delivered durably through SQS/EventBridge;
- CloudFront with origin access control, signed URLs, a response-header policy (`nosniff`, restrictive CSP/CORP), and no OPS cookies;
- a dedicated strict Upstash Redis namespace/database for pre-auth, principal, and company rate limits plus short private analytics caching.

Why this is the recommended path:

- Vercel Functions cap request and response bodies at 4.5 MB, below the approved 25 MiB file limit, so bytes must bypass the Next.js function body: <https://vercel.com/docs/functions/limitations>.
- S3 conditional `PutObject` supports `If-None-Match: *`; sign that header, exact key, content type, content length, and checksum so the first write wins and replacement fails: <https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html>.
- GuardDuty can scan newly uploaded S3 objects and emit EventBridge results; the application must handle at-least-once delivery idempotently: <https://docs.aws.amazon.com/guardduty/latest/ug/how-malware-protection-for-s3-gdu-works.html>.

Before any task provisions or changes a paid tier, Task 0 must write the account-specific monthly estimate and receive approval. Current public list prices are only planning inputs:

- GuardDuty's published US East example is `$0.09/GB + $0.215/1,000 objects` after its monthly allowance; verify `us-west-2` and the actual account eligibility: <https://aws.amazon.com/guardduty/pricing/>.
- Upstash pay-as-you-go lists `$0.20/100,000 commands`; production SLA/multi-zone features are a separate paid add-on, so inventory the current OPS contract before selecting a tier: <https://upstash.com/pricing/redis>.
- CloudFront currently lists a `$0/month` plan with included request/transfer allowances, but verify that the OPS account and required private-S3 configuration qualify: <https://aws.amazon.com/cloudfront/pricing/>.
- S3 bills storage, requests, retrieval, and transfer separately: <https://aws.amazon.com/s3/pricing/>.

The application code and infrastructure template may be prepared before approval. Actual cloud resource creation and any tier change remain blocked at the cost gate.

## Planned commit sequence

Each task ends in one atomic commit. If a task grows into independently reversible schema and application changes, split it into the named subcommits rather than sweeping unrelated work into one commit.

1. `chore(api): reconcile external api branch baseline`
2. `feat(api): define external v1 contracts`
3. `feat(api): add external authorization and projection foundation`
4. `feat(api): secure the external request boundary`
5. `feat(settings): manage website api access`
6. `feat(settings): add website integration controls`
7. `feat(storage): define private intake file infrastructure`
8. `feat(api): add replay-safe upload intents`
9. `feat(api): inspect and retain private intake files`
10. `feat(api): canonicalize external intake submissions`
11. `feat(api): create leads atomically from external intake`
12. `feat(api): expose intake configuration and submissions`
13. `feat(pipeline): surface accepted intake files`
14. `fix(pipeline): make external lifecycle evidence atomic`
15. `feat(analytics): add external lead projections`
16. `feat(api): expose checkpointed lead analytics`
17. `feat(api): add versioned lead metrics`
18. `feat(api): add external api operations and retention`
19. `docs(api): publish external api contract`
20. `test(api): prove external api launch contract`

---

### Task 0: Reconcile the branch, live schema, and service costs

**Files:**

- Modify only if reconciliation requires it: `docs/superpowers/specs/2026-07-23-lead-intake-and-analytics-api-design.md`
- Create: `docs/runbooks/external-api-cost-and-service-gate.md`
- Create: `docs/runbooks/external-api-test-baseline.md`
- Do not modify feature code in this task.

**Skills:** `custom-skills:executing-plans`, `supabase:supabase`.

**Step 1: Prove the workspace boundary**

Run:

```bash
git status --short --branch
git worktree list --porcelain
git log --oneline HEAD..origin/main
```

Expected: this isolated worktree contains only the committed design/plan work. Stop if unrelated uncommitted files appear.

**Step 2: Refresh and merge the latest base**

Run:

```bash
git fetch origin
git merge --no-edit origin/main
```

Expected: the documentation commits remain present. Resolve only genuine overlaps; never discard newer email lifecycle behavior.

**Step 3: Re-run and record the complete post-merge baseline**

Run:

```bash
npm test -- --run
```

Write `docs/runbooks/external-api-test-baseline.md` with the exact merged commit, command, file/test pass-skip-fail counts, and every failing test name/error. This becomes the only accepted comparison baseline for Task 19. If the merge changes the known-red set, investigate and record why before feature work.

**Step 4: Re-run the affected mapping**

Read end-to-end before touching them:

- `src/lib/api/services/sync-engine.ts`
- `src/lib/api/services/lead-summary-service.ts`
- `src/lib/email/opportunity-correspondence-classifier.ts`
- `src/lib/email/opportunity-relationship-matching.ts`
- newest `supabase/migrations/*correspondence*`, `*lifecycle*`, and `*intake_owner*`

Record path or contract changes in the plan if current main has moved a seam.

**Step 5: Verify live database truth**

Using the Supabase connector against `ops-app` (`ijeekuhbatykdomumfjx`), read:

- `clients`, `sub_clients`, `opportunities`, lifecycle, invoice/payment, notification, and assignment schemas;
- relevant indexes, constraints, RLS, grants, and function definitions;
- currently applied migration versions.

Expected: a written delta between live state and checked-in migrations. Do not apply DDL.

**Step 6: Write the cost gate**

In `docs/runbooks/external-api-cost-and-service-gate.md`, record:

- existing AWS/CloudFront/GuardDuty/Upstash/Vercel contracted capacity without printing credentials;
- low, expected, and approved-high volume assumptions for leads, files, GiB, scan objects, API requests, and cache/limiter commands;
- monthly storage, scanning, request, bandwidth, CloudFront invalidation, queue, function, and Redis estimates;
- the exact resources that are free/included versus variable;
- approval status and the “do not provision” boundary.

**Step 7: Commit**

```bash
git add docs/runbooks/external-api-cost-and-service-gate.md docs/runbooks/external-api-test-baseline.md docs/superpowers/specs/2026-07-23-lead-intake-and-analytics-api-design.md
git commit -m "chore(api): reconcile external api branch baseline"
```

---

### Task 1: Define the executable v1 contract before implementation

**Files:**

- Create: `src/lib/external-api/contracts/common.ts`
- Create: `src/lib/external-api/contracts/errors.ts`
- Create: `src/lib/external-api/contracts/intake.ts`
- Create: `src/lib/external-api/contracts/lead-feed.ts`
- Create: `src/lib/external-api/contracts/metrics.ts`
- Create: `src/lib/external-api/contracts/index.ts`
- Create: `src/lib/external-api/http/request-body.ts`
- Create: `src/lib/external-api/http/responses.ts`
- Create: `src/lib/external-api/http/request-id.ts`
- Modify: `src/middleware.ts`
- Test: `tests/unit/external-api/contracts.test.ts`
- Test: `tests/unit/external-api/http-boundary.test.ts`
- Test: `tests/unit/middleware/external-api-boundary.test.ts`

**Skills:** `superpowers:test-driven-development`.

**Step 1: Write failing contract tests**

Cover:

- strict unknown-field rejection;
- the 256 KiB JSON ceiling before parsing;
- `Idempotency-Key` syntax and namespace rules;
- all opaque ID, timestamp, source, form, answer, attribution, upload, cursor, metric, response, and error shapes from the approved design;
- ten files, 25 MiB each, and 50 MiB batch limits;
- default 100/max 250 lead-feed page sizes;
- exact safe error codes and response metadata;
- explicit `upload_batch_expired`, `external_submission_conflict`, `sync_checkpoint_expired`, `date_alignment_required`, and `definition_version_unsupported` status/code mappings;
- serialization allowlists that cannot accept a raw database row;
- `/v1` bypassing dashboard cookie redirects while still passing through its own route auth.

Run:

```bash
npx vitest run tests/unit/external-api/contracts.test.ts tests/unit/external-api/http-boundary.test.ts tests/unit/middleware/external-api-boundary.test.ts
```

Expected: failures because the contract modules and explicit middleware exclusion do not exist.

**Step 2: Implement the smallest complete contract layer**

- Use strict Zod objects.
- Make request-size enforcement consume a bounded stream before `JSON.parse`.
- Emit one success/error envelope with request ID, API version, server timestamp, result/code, and safe details.
- Add `Cache-Control: no-store` for intake/status and private cache directives for analytics.
- Explicitly exclude `/v1` from the middleware matcher; route handlers own bearer auth and must not inspect OPS session cookies.
- Export DTOs from schemas rather than defining duplicate interfaces.

**Step 3: Make the tests green**

Run the command from Step 1. Expected: all pass.

**Step 4: Commit**

```bash
git add src/lib/external-api src/middleware.ts tests/unit/external-api tests/unit/middleware/external-api-boundary.test.ts
git commit -m "feat(api): define external v1 contracts"
```

---

### Task 2: Add durable authorization plus the minimal lead-projection foundation

**Files:**

- Create: `supabase/migrations/20260727102500_external_api_authorization_foundation.sql`
- Create: `scripts/run-external-api-sql-contracts.mjs`
- Modify: `package.json`
- Modify: `src/lib/types/database.types.ts` (generated after the migration is verified)
- Test: `tests/unit/supabase/external-api-authorization-migration.test.ts`
- Test: `tests/sql/external-api-authorization-contract.sql`

**Skills:** `supabase:supabase`, `supabase:supabase-postgres-best-practices`, `superpowers:test-driven-development`.

**Step 1: Write failing migration contract tests**

Assert the migration defines:

- `private.external_api_principals`;
- `private.external_api_credentials`;
- `private.lead_intake_sources`;
- `private.lead_intake_forms`, including a stable `default` form;
- `private.external_api_request_audit`;
- a separately purgeable 30-day network-fingerprint relation;
- append-only security/credential audit events;
- one request-ID identity that supports a transactionally inserted authenticated base audit row plus a later redacted timing/cache/response finalization;
- principal class/scope constraints, including financial requiring lead-read;
- one company per principal and one principal per credential family;
- durable `server_key` and future `oauth_installation` principal types sharing the same scope/source/epoch model, without implementing OAuth routes in v1;
- source allowlists for intake principals;
- credential digest/prefix, expiry, rotation overlap, revocation, last-use, rejection, and epoch evidence;
- source canonical host, default phone region, forms, allowed origins, default coarse source, and optional default owner;
- minimal private projection dependencies needed by the later atomic intake command: stable public lead handles, source/attribution dictionaries, company-monotonic sequence/high-water state, immutable projection versions, and current baseline rows;
- one private append helper that can create the handle, normalized source projection, and initial projection version inside another guarded transaction;
- source-attribution dictionary rows that keep a random stable public handle separate from versioned keyed lookup digests;
- private tables with RLS enabled and table access revoked from `PUBLIC`, `anon`, and `authenticated`;
- fixed `search_path`, fully qualified references, no dynamic SQL, and explicit function grants.

Run:

```bash
npx vitest run tests/unit/supabase/external-api-authorization-migration.test.ts
```

Expected: fail because the migration is absent.

**Step 2: Implement the private schema and fixed wrappers**

Add public service-role-only wrappers with exact typed inputs:

- `authenticate_external_api_credential_as_system`;
- `list_external_api_settings_as_system`;
- `create_lead_intake_source_as_system`;
- `update_lead_intake_source_as_system`;
- `create_external_api_credential_as_system`;
- `update_external_api_credential_as_system`;
- `rotate_external_api_credential_as_system`;
- `revoke_external_api_credential_as_system`;
- `record_external_api_request_audit_as_system`;
- `purge_external_api_network_fingerprints_as_system`.

Management wrappers must re-resolve an active actor, company, `settings.integrations:all`, and current feature flag inside the transaction. They must never trust a payload company ID.

Credential wrappers store only a versioned HMAC-SHA-256 digest and visible prefix supplied by the trusted server. The raw 256-bit secret exists only in server memory and the one creation/rotation response. Rotation stays under the same principal and supports at most 24 hours of overlap.

This migration intentionally creates only the storage/helper foundation required for Task 10 to commit a public lead handle and first source projection atomically with a new lead. Task 14 installs the complete dependency triggers, historical backfill orchestration, and retention behavior; it must not recreate these foundation tables.

**Step 3: Add executable SQL security tests**

`tests/sql/external-api-authorization-contract.sql` must prove:

- cross-company actor and source denial;
- scope/class combination denial;
- revoked/expired/old-epoch denial;
- rotation preserves principal identity;
- caller-selected company/source escalation fails;
- direct table and private-function access fails for app roles;
- public wrappers accept only service-role execution;
- audit records cannot carry authorization headers, raw secrets, bodies, or signed URLs.
- authenticated command/read functions cannot return a result without their base audit row; finalization failure cannot erase that evidence or roll back an already accepted lead.

Create `scripts/run-external-api-sql-contracts.mjs` and `npm run test:external-api:sql`. The runner must:

- discover every `tests/sql/external-*.sql` file in deterministic filename order;
- run each contract with stop-on-first-error semantics against the local Supabase database;
- support explicit multi-session race fixtures without asking an operator to copy SQL between terminals;
- refuse a non-loopback database unless an explicit disposable-branch flag and expected project reference are supplied;
- hard-deny the OPS production project reference and reject libpq multi-host targets;
- require `verify-full` TLS with an explicit readable Supabase CA certificate for every disposable-branch run;
- print one pass/fail result per contract and return nonzero on any assertion, timeout, leaked session, or skipped file.

Run:

```bash
npm run test:external-api:sql -- --match authorization
```

Expected: all assertions pass against the disposable local database.

**Step 4: Apply only to local Supabase, lint, and regenerate**

Run:

```bash
npx supabase db reset
npx supabase db lint
npm run test:external-api:sql -- --match authorization
npx vitest run tests/unit/supabase/external-api-authorization-migration.test.ts
```

Then regenerate `src/lib/types/database.types.ts` using the project's standard Supabase command. Do not apply the migration to production.

**Step 5: Commit**

```bash
git add supabase/migrations/20260727102500_external_api_authorization_foundation.sql scripts/run-external-api-sql-contracts.mjs package.json src/lib/types/database.types.ts tests/unit/supabase/external-api-authorization-migration.test.ts tests/sql/external-api-authorization-contract.sql
git commit -m "feat(api): add external authorization and projection foundation"
```

---

### Task 3: Build the bearer-auth, strict-limiter, and redacted-audit boundary

**Files:**

- Create: `src/lib/external-api/auth/credential-secret.ts`
- Create: `src/lib/external-api/auth/credential-auth.ts`
- Create: `src/lib/external-api/security/strict-rate-limit.ts`
- Create: `src/lib/external-api/security/network-fingerprint.ts`
- Create: `src/lib/external-api/security/audit.ts`
- Create: `src/lib/external-api/http/boundary.ts`
- Modify: `.env.example`
- Test: `tests/unit/external-api/credential-secret.test.ts`
- Test: `tests/unit/external-api/credential-auth.test.ts`
- Test: `tests/unit/external-api/strict-rate-limit.test.ts`
- Test: `tests/unit/external-api/network-fingerprint.test.ts`
- Test: `tests/unit/external-api/audit-redaction.test.ts`
- Test: `tests/integration/external-api-request-boundary.test.ts`

**Skills:** `superpowers:test-driven-development`.

**Gate:** Implement and mock the Redis boundary now, but do not create/upgrade a Redis database until the Task 0 cost gate is approved.

**Step 1: Write failing authentication and security-boundary tests**

Prove:

- server secrets contain at least 256 random bits, carry a parseable non-secret prefix, and compare with `timingSafeEqual`;
- bearer parsing rejects cookies, query tokens, malformed prefixes, duplicate authorization headers, oversize headers, and non-Bearer schemes;
- route authentication resolves credential, durable principal, company, class, scopes, allowed sources, epoch, and current feature flag without caller-selected company data;
- revoked, expired, overlap-retired, disabled-company, and wrong-class credentials return only stable safe errors;
- pre-auth limiting uses a rotating HMAC network fingerprint plus presented non-secret prefix, never a plain IP hash or attempted secret;
- principal and company windows atomically enforce every published burst/minute/day limit;
- missing Redis config, timeout, malformed response, or Redis error returns `503 rate_limit_unavailable`;
- there is no process-memory fallback;
- 429 includes only safe retry/remaining metadata;
- audit redaction recursively removes authorization, token/key/secret, contact, message, answers, URL query, filename/storage, and signed-URL data;
- request ID, bounded parsing, pre-auth limit, bearer auth, principal/company limit, handler, response envelope, and audit execute in the documented order.

Run:

```bash
npx vitest run tests/unit/external-api/credential-secret.test.ts tests/unit/external-api/credential-auth.test.ts tests/unit/external-api/strict-rate-limit.test.ts tests/unit/external-api/network-fingerprint.test.ts tests/unit/external-api/audit-redaction.test.ts tests/integration/external-api-request-boundary.test.ts
```

Expected: red.

**Step 2: Implement one reusable route boundary**

- Generate a versioned HMAC-SHA-256 lookup digest from the bearer secret under a server pepper; never log or persist the bearer value.
- Call `authenticate_external_api_credential_as_system` and return an immutable request actor.
- Use atomic Redis Lua/EVAL or an equivalent transaction for pre-auth, principal, and company windows.
- Fail closed if the limiter cannot prove a decision.
- Store the network fingerprint in the separately expiring relation from Task 2.
- Pass the server request ID into every guarded command/read. That RPC writes the authenticated base audit row in the same transaction as its result; `boundary.ts` then finalizes timing, response class, limiter/idempotency/cache result, metric set/grouping/result size, and no content. Pre-auth failures use the separate audit wrapper after throttling.
- Make `boundary.ts` accept only an explicit required credential class/scope set and a typed handler so a route cannot forget a security stage.
- Document dedicated secrets/config as `EXTERNAL_API_CREDENTIAL_HMAC_KEYS`, `EXTERNAL_API_NETWORK_HMAC_KEYS`, `EXTERNAL_API_IDEMPOTENCY_HMAC_KEYS`, `EXTERNAL_API_REDIS_REST_URL`, and `EXTERNAL_API_REDIS_REST_TOKEN`. Credential/network rings carry an active `kid` plus bounded validation overlap. The idempotency ring carries one active writer plus KMS-protected lookup-only historical keys: a `kid` cannot be removed while any upload/submission/external-ID ledger digest references it. Missing referenced key material is a fail-closed startup/health error, never permission to create a new lead. No code path silently falls back to a default.

**Step 3: Make tests green and commit**

Run the Step 1 command, then:

```bash
git add src/lib/external-api/auth src/lib/external-api/security src/lib/external-api/http/boundary.ts .env.example tests/unit/external-api tests/integration/external-api-request-boundary.test.ts
git commit -m "feat(api): secure the external request boundary"
```

---

### Task 4: Build integration-authorized settings APIs and pilot gating

**Files:**

- Create: `src/lib/external-api/settings/actor.ts`
- Create: `src/lib/external-api/settings/settings-service.ts`
- Create: `src/app/api/settings/external-api/route.ts`
- Create: `src/app/api/settings/external-api/sources/route.ts`
- Create: `src/app/api/settings/external-api/sources/[sourceId]/route.ts`
- Create: `src/app/api/settings/external-api/credentials/route.ts`
- Create: `src/app/api/settings/external-api/credentials/[credentialId]/route.ts`
- Create: `src/app/api/settings/external-api/credentials/[credentialId]/rotate/route.ts`
- Create: `src/app/api/settings/external-api/credentials/[credentialId]/revoke/route.ts`
- Modify: `src/lib/feature-flags/feature-flag-definitions.ts`
- Modify: `src/app/api/feature-flags/route.ts`
- Modify: `src/app/api/admin/ai-features/route.ts`
- Modify: `src/app/api/admin/ai-features/[companyId]/route.ts`
- Modify: `src/app/admin/system/_components/company-ai-features.tsx`
- Test: `tests/integration/external-api-settings-routes.test.ts`
- Modify/Test: `tests/integration/inbox/feature-flags-route.test.ts`
- Modify/Test: `tests/integration/admin-ai-features-patch.test.ts`

**Skills:** `superpowers:test-driven-development`.

**Step 1: Write failing route and reveal-once management tests**

Prove:

- raw secrets never reach logs, database payloads, errors, or list responses;
- create and rotate reveal once;
- PATCH can rename or change a future expiry but cannot change class/company;
- revoke is immediate and idempotent;
- intake credentials cannot gain analytics scopes and vice versa;
- `analytics.financial.read` requires `analytics.leads.read`;
- source IDs are opaque and forms always include `default`;
- active actor, `settings.integrations`, company, feature flag, and in-transaction RPC checks all fail closed;
- `external_api` appears as a synthetic company flag and is operable through the existing admin override surface.

Run:

```bash
npx vitest run tests/integration/external-api-settings-routes.test.ts tests/integration/inbox/feature-flags-route.test.ts tests/integration/admin-ai-features-patch.test.ts
```

Expected: red.

**Step 2: Implement the management boundary**

- Resolve Firebase identity to one active OPS user; never accept email fallback or body `companyId`.
- Call only the guarded RPCs from Task 2.
- Use Task 3's `credential-secret.ts`, return raw material exactly once, and retain only transient local variables.
- Return prefix, creator, dates, status, scopes, source restrictions, last successful use, rejection count, and health summaries.
- Add `external_api` as a generic per-company pilot flag. It gates the settings section and all `/v1` business execution, but it must not gate all of `/settings`.

**Step 3: Make tests green and commit**

Run the Step 1 command, then:

```bash
git add src/lib/external-api src/app/api/settings/external-api src/lib/feature-flags src/app/api/feature-flags/route.ts src/app/api/admin/ai-features src/app/admin/system/_components/company-ai-features.tsx tests
git commit -m "feat(settings): manage website api access"
```

---

### Task 5: Add the `COMMS › WEBSITE` settings surface

**Files:**

- Create: `src/components/settings/website-integration-tab.tsx`
- Create: `src/components/settings/website-integration/source-register.tsx`
- Create: `src/components/settings/website-integration/credential-register.tsx`
- Create: `src/components/settings/website-integration/source-dialog.tsx`
- Create: `src/components/settings/website-integration/credential-dialog.tsx`
- Create: `src/components/settings/website-integration/secret-reveal-dialog.tsx`
- Modify: `src/components/settings/settings-domains.tsx`
- Modify: `src/i18n/dictionaries/en/settings.json`
- Modify: `src/i18n/dictionaries/es/settings.json`
- Test: `tests/unit/components/settings/website-integration-tab.test.tsx`
- Test: `tests/unit/components/settings/settings-domains.test.ts`
- Create: `tests/unit/i18n/settings-parity.test.ts`

**Skills:** `ops-copywriter:ops-copywriter`, `custom-skills:ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:ui-ux-pro-max`, `custom-skills:audit-design-system`, `superpowers:test-driven-development`.

**Step 1: Write the state and accessibility tests first**

Cover:

- hidden until both `external_api` and `settings.integrations` resolve true;
- `Website` lives under `Comms`, not the dev-only Advanced section;
- first-use state has one clear `CONNECT WEBSITE` action;
- configured state is compact: source health first, then credentials;
- create intake and analytics credentials through separate flows;
- the company-wide pseudonymous warning appears before analytics creation;
- the monetary-data warning appears before financial scope;
- the raw secret is selectable/copyable once, is absent after dismissal, and never enters local/session storage or a query cache;
- rotate/revoke/expiry confirmations preserve keyboard focus;
- owner-visible failures use safe copy;
- English/Spanish keys remain in parity.

Run:

```bash
npx vitest run tests/unit/components/settings/website-integration-tab.test.tsx tests/unit/components/settings/settings-domains.test.ts tests/unit/i18n/settings-parity.test.ts
```

Expected: red.

**Step 2: Implement the state-aware interface**

- Reuse `Surface`/`Card`, `RegisterTable`, `RegisterEmpty`, `Tag`, `Button`, `Dialog`, `AlertDialog`, `Input`, `Select`, existing authenticated-fetch, and toast patterns.
- Do not reuse `developer-tab.tsx`.
- Show source/form IDs with copy actions, allowed origins, default phone region, optional default owner, last accepted submission, pending/rejected file counts, credential status, last use, and recent rejection count.
- Keep one-time configuration visually subordinate after it is complete.
- Use token classes only; no hardcoded color, spacing, radius, or font values.
- Reuse existing settings transitions; add no new motion.

**Step 3: Verify visually and with keyboard**

Run the focused tests, then use Playwright against the local app to verify:

- empty, configured, expired, revoked, and rotation-overlap states;
- narrow viewport and 200% zoom;
- keyboard-only creation, copy, close, rotate, and revoke;
- no horizontal overflow and no secret persistence after reload.

Keep temporary screenshots in `docs/artifacts/external-api/` during verification and remove them unless they are deliberately retained as reference evidence.

**Step 4: Run the design-system audit and commit**

Use `custom-skills:audit-design-system`. Fix every reported hardcoded visual value or accessibility defect before:

```bash
git add src/components/settings src/i18n/dictionaries tests/unit/components/settings tests/unit/i18n
git commit -m "feat(settings): add website integration controls"
```

---

### Task 6: Define private S3, GuardDuty, queue, and cookieless delivery infrastructure

**Files:**

- Create: `infra/external-intake-storage.yaml`
- Create: `docs/runbooks/external-intake-storage.md`
- Create: `src/lib/external-api/uploads/s3-client.ts`
- Create: `src/lib/external-api/uploads/upload-capability.ts`
- Create: `src/lib/external-api/uploads/cloudfront-delivery.ts`
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/unit/external-api/upload-capability.test.ts`
- Test: `tests/unit/external-api/cloudfront-delivery.test.ts`
- Test: `tests/integration/external-api-storage-policy.test.ts`

**Skills:** `superpowers:test-driven-development`.

**Gate:** Do not provision until `docs/runbooks/external-api-cost-and-service-gate.md` is approved.

**Step 1: Write failing infrastructure-policy tests**

Assert the template has:

- a dedicated bucket, Block Public Access, bucket-owner enforced ownership, versioning, default encryption, and no public ACL/policy;
- quarantine, accepted-original, and safe-derivative prefixes;
- 24-hour unclaimed/rejected lifecycle cleanup plus durable application cleanup, with every delete deferred until the upload capability expiry plus clock-skew margin so the current object continues blocking replay;
- conditional create-only upload permissions and no upload-time read/list/delete;
- a bucket-policy deny for `PutObject` that omits `If-None-Match: *`, so create-only is enforced even if a signer regression drops the condition;
- S3 ObjectCreated and GuardDuty results delivered to queues with DLQs;
- GuardDuty limited to the intake bucket/prefix;
- CloudFront origin access control, trusted signing key group, no public S3 origin, restrictive response headers, and separate inline-image versus forced-download behavior;
- protected attachment behaviors use caching disabled (`min/default/max TTL = 0`) and allow exact-path invalidation for privacy erasure;
- GET denial unless the object carries both clean-scan and accepted-disposition tags;
- exact environment outputs without embedding secrets.

Run:

```bash
npx vitest run tests/unit/external-api/upload-capability.test.ts tests/unit/external-api/cloudfront-delivery.test.ts tests/integration/external-api-storage-policy.test.ts
```

Expected: red.

**Step 2: Implement infrastructure as code**

- Use SigV4 `PutObject` presigning with exact random key, `If-None-Match: *`, signed exact `Content-Length`, signed content type, and checksum when provided. Add a real-browser integration test proving the browser-generated request preserves every signed header, exact-size success works, short/long bodies fail, a missing condition is denied by bucket policy, and the same target cannot be replaced. If any supported browser/runtime cannot preserve the exact signed request, stop at the infrastructure/cost gate and design the authenticated streaming fallback; do not silently fall back to an ordinary reusable presigned PUT or an unbounded multipart upload.
- Expiry must be short enough that revocation exposure is bounded.
- Treat browser CORS as transport, not authorization. Use `AllowedOrigins: ["*"]` only for credentialless `PUT`/`HEAD` with the exact signed headers; expose only `ETag`, `x-amz-version-id`, and the expected checksum header; never permit browser `GET`, list, or delete. `allowed_browser_origins` is an integration-compatibility/audit policy: an optional requested browser origin must match the authenticated source before issuance, but neither UI nor docs may imply that a forgeable `Origin` header is an authorization control. The source-bound conditional capability and guarded submission claim remain the security boundaries.
- Use CloudFront signed URLs for accepted files with attachment caching disabled. Documents use `Content-Disposition: attachment`, `application/octet-stream` where necessary, `nosniff`, restrictive CSP, and no app cookies. Only metadata-stripped image derivatives may render inline. Privacy erasure submits exact-path invalidations as defense in depth and verifies both origin deletion and delivery denial; include invalidation requests in the cost gate.
- Add only the AWS SDK packages actually required, such as SQS and CloudFront signing.
- Emit and document `EXTERNAL_INTAKE_AWS_REGION`, `EXTERNAL_INTAKE_S3_BUCKET`, `EXTERNAL_INTAKE_UPLOAD_QUEUE_URL`, `EXTERNAL_INTAKE_SCAN_QUEUE_URL`, `EXTERNAL_INTAKE_CLOUDFRONT_DOMAIN`, `EXTERNAL_INTAKE_CLOUDFRONT_KEY_PAIR_ID`, and `EXTERNAL_INTAKE_CLOUDFRONT_PRIVATE_KEY`. Use a dedicated least-privilege AWS principal rather than widening the existing public-image credentials.

**Step 3: Validate without provisioning**

Run:

```bash
aws cloudformation validate-template --template-body file://infra/external-intake-storage.yaml
npx vitest run tests/unit/external-api/upload-capability.test.ts tests/unit/external-api/cloudfront-delivery.test.ts tests/integration/external-api-storage-policy.test.ts
```

Expected: template validation and tests pass. If AWS credentials are unavailable, record that exact blocker; do not weaken the tests.

**Step 4: Commit**

```bash
git add infra/external-intake-storage.yaml docs/runbooks/external-intake-storage.md src/lib/external-api/uploads .env.example package.json package-lock.json tests
git commit -m "feat(storage): define private intake file infrastructure"
```

---

### Task 7: Add replay-safe upload intents and durable quotas

**Files:**

- Create: `supabase/migrations/20260727102600_external_intake_upload_foundation.sql`
- Create: `src/lib/external-api/uploads/upload-service.ts`
- Create: `src/app/v1/intake/uploads/route.ts`
- Modify: `src/lib/types/database.types.ts`
- Test: `tests/unit/supabase/external-intake-upload-migration.test.ts`
- Test: `tests/unit/external-api/upload-service.test.ts`
- Test: `tests/integration/external-api-intake-uploads.test.ts`
- Test: `tests/sql/external-intake-upload-contract.sql`

**Skills:** `supabase:supabase`, `supabase:supabase-postgres-best-practices`, `superpowers:test-driven-development`.

**Step 1: Write failing state-machine and race tests**

Prove:

- upload-batch idempotency uses principal identity, canonical manifest hash, source, and form;
- exact replay returns the same upload IDs and does not reserve twice;
- changed manifest conflicts;
- expired batches return 410;
- reservations atomically enforce 1 GiB/company/24h, 100 pending objects, five concurrent inspections, ten files, 25 MiB/file, and 50 MiB/batch;
- source/form IDs cannot cross a principal's grant;
- an optional requested browser origin must exactly match the authenticated source's configured list before a capability is issued; omission is allowed for server-side upload, and this check is never described as authentication;
- states are exactly `issued → uploaded → claimed → pending_inspection → accepted/rejected`, plus `closed_missing` and `expired`;
- one immutable object version/checksum can be recorded once;
- concurrent batches cannot oversubscribe byte/object quota;
- failed capability creation rolls back or releases its reservation safely.

Run focused Vitest plus:

```bash
npm run test:external-api:sql -- --match intake-upload
```

Expected: red.

**Step 2: Implement guarded upload commands**

The migration adds private batch, intent, rolling-byte, pending-object, scan-slot, and cleanup reservation records. Public service-role wrappers must:

- revalidate credential digest, principal epoch, company, `intake.write`, source, and form in-transaction;
- use principal-scoped idempotency digests and versioned canonical hashes;
- reserve quotas under company-first locks;
- return only opaque public upload IDs and safe state;
- allow a fresh short capability for the same still-empty immutable target on exact replay;
- never expose bucket, key, version, checksum, or provider internals.

`upload-service.ts` calls the guarded reservation, generates capabilities only for eligible rows, and compensates safely when signing fails.

**Step 3: Implement the route**

`POST /v1/intake/uploads` uses the shared request boundary, external bearer auth, strict limiter, audit, no-store response, and itemized stable results.

**Step 4: Verify, regenerate, and commit**

Run:

```bash
npx supabase db reset
npx supabase db lint
npx vitest run tests/unit/supabase/external-intake-upload-migration.test.ts tests/unit/external-api/upload-service.test.ts tests/integration/external-api-intake-uploads.test.ts
npm run test:external-api:sql -- --match intake-upload
```

Regenerate types, then commit:

```bash
git add supabase/migrations/20260727102600_external_intake_upload_foundation.sql src/lib/external-api/uploads src/app/v1/intake/uploads src/lib/types/database.types.ts tests
git commit -m "feat(api): add replay-safe upload intents"
```

---

### Task 8: Inspect, quarantine, sanitize, and retain files

**Files:**

- Create: `supabase/migrations/20260727102700_external_intake_attachment_processing.sql`
- Create: `src/lib/external-api/uploads/file-policy.ts`
- Create: `src/lib/external-api/uploads/structural-inspector.ts`
- Create: `src/lib/external-api/uploads/image-sanitizer.ts`
- Create: `src/lib/external-api/uploads/attachment-worker.ts`
- Create: `src/lib/external-api/uploads/attachment-runtime.ts`
- Create: `src/lib/external-api/uploads/queue-consumer.ts`
- Create: `src/app/api/cron/external-api-maintenance/route.ts`
- Modify: `vercel.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/lib/types/database.types.ts`
- Create: `tests/fixtures/external-api/files/README.md`
- Test: `tests/unit/external-api/attachment-policy.test.ts`
- Test: `tests/unit/external-api/structural-inspector.test.ts`
- Test: `tests/unit/external-api/attachment-worker.test.ts`
- Test: `tests/unit/supabase/external-intake-attachment-processing-migration.test.ts`
- Test: `tests/integration/external-api-maintenance-cron.test.ts`

**Skills:** `supabase:supabase`, `superpowers:test-driven-development`.

**Step 1: Build a safe fixture corpus and failing tests**

Use tiny purpose-built fixtures for:

- JPEG, PNG, WebP, HEIC/HEIF;
- clean/active/encrypted/corrupt PDF;
- plain text and CSV;
- clean, macro-bearing, encrypted, malformed, and archive-bomb DOC/DOCX/XLS/XLSX;
- recognized DWG and bounded text/binary DXF;
- executable, script, HTML, SVG, generic archive, mismatch, polyglot, oversize, checksum mismatch, and corrupt image cases.

Do not add copyrighted customer files or real PII.

Tests must prove:

- byte signature wins over filename/MIME;
- executables, scripts, HTML, SVG, archives, password protection, macros, active content, mismatches, and decompression bombs reject;
- GuardDuty `NO_THREATS_FOUND` is necessary but not sufficient;
- `THREATS_FOUND`, `UNSUPPORTED`, `ACCESS_DENIED`, `FAILED`, missing, and late results never become clean;
- duplicate S3/GuardDuty queue delivery is idempotent;
- scan-slot acquisition/release and lease recovery are company-scoped;
- pending inspection retries with bounded backoff and becomes `inspection_unavailable` at 24 hours;
- unsafe/unclaimed/orphan objects enter indefinitely retryable cleanup, with terminal unsafe or inspection-unavailable bytes scheduled for deletion within the following 24 hours;
- no cleanup deletes the current object or creates a delete marker before its upload capability expiry plus clock-skew margin, so `If-None-Match: *` keeps the same still-valid capability unusable;
- a reject/cleanup/reuse race within the original capability lifetime returns a conditional-write failure and records no new object version;
- image derivatives decode/re-encode and strip metadata;

Expected: red.

**Step 2: Implement guarded queues and state transitions**

Follow the lease/CAS/cleanup patterns in:

- `src/lib/api/services/email-attachments/attachment-runtime.ts`;
- `src/lib/api/services/email-conversion-photo-worker.ts`;
- `supabase/migrations/20260715173000_email_conversion_photo_materialization.sql`.

Do not reuse their mailbox identity, public project bucket, semantic “inspection,” or `upsert: true` storage behavior.

Add claim/complete/retry/cleanup RPCs with leases, generation fences, `FOR UPDATE SKIP LOCKED`, bounded attempts for processing, and unbounded cleanup retry until storage readback proves deletion. Cleanup carries `delete_not_before = capability_expires_at + clock_skew_margin`; a worker may make rejected content permanently unreadable immediately, but it must retain the current object as the create-only blocker until that time.

**Step 3: Implement the worker**

- Consume bounded S3 and GuardDuty queue batches.
- HEAD the exact object version and verify observed length/checksum.
- Run structural policy and malware-state reconciliation.
- Create safe image derivatives only after clean structural/malware results.
- Tag accepted objects so CloudFront/S3 policy can read them.
- Keep documents download-only.
- Never roll back or delete the lead because a file fails.
- Add only maintained parsers needed for byte-level proof: `file-type` for signatures, `yauzl` for bounded OOXML ZIP inspection, `cfb` for legacy DOC/XLS compound files, `pdf-lib` for parsed PDF action/encryption checks, and existing `sharp` for raster decode/re-encode. Validate licenses, lockfile integrity, and the deployed Vercel runtime against the fixture corpus before accepting them.

**Step 4: Add one maintenance cron**

The cron processes upload-arrival events, GuardDuty events, inspection work, 24-hour terminalization, expiry-safe orphan/rejected deletion, expired capabilities, credential overlap retirement, and retention in bounded slices. It uses `CRON_SECRET`, a lease, structured counts, and no PII logs.

**Step 5: Verify and commit**

Run local migration/lint, focused tests, and a storage-adapter integration test against a non-production bucket or an emulator. Regenerate types, then:

```bash
git add supabase/migrations/20260727102700_external_intake_attachment_processing.sql src/lib/external-api/uploads src/app/api/cron/external-api-maintenance vercel.json src/lib/types/database.types.ts tests
git commit -m "feat(api): inspect and retain private intake files"
```

---

### Task 9: Canonicalize intake, identity, and source attribution

**Files:**

- Create: `src/lib/external-api/intake/canonicalize.ts`
- Create: `src/lib/external-api/intake/contact-identity.ts`
- Create: `src/lib/external-api/intake/source-attribution.ts`
- Create: `src/lib/external-api/intake/idempotency.ts`
- Create: `src/lib/external-api/intake/email-correlation.ts`
- Modify: `src/lib/sms/phone-utils.ts`
- Modify: `.env.example`
- Test: `tests/unit/external-api/intake-canonicalization.test.ts`
- Test: `tests/unit/external-api/source-attribution.test.ts`
- Test: `tests/unit/external-api/email-correlation.test.ts`
- Modify/Test: `tests/lib/sms/phone-utils.test.ts`

**Skills:** `superpowers:test-driven-development`.

**Step 1: Write failing canonicalization tests**

Cover:

- validated lowercase email;
- explicit-international phone and source/default-region phone to E.164;
- local phone without reliable region retained as evidence but excluded from matching;
- normalized comparison names never used alone for identity;
- typed answer ordering and unordered list normalization;
- URL normalization with userinfo, fragment, and query removal;
- source-scoped opaque dictionary handles backed by private HMAC lookup digests for raw campaign/UTM/path values;
- attribution handles remain stable across credential, cursor, and email-correlation key rotation;
- attribution lookup-key rotation finds the existing random public dictionary handle through every retained key version, rekeys the private lookup, and never splits one campaign/UTM/path into a new public group;
- only OPS-approved dictionary labels reaching analytics;
- click-provider allowlist and presence flags without raw click IDs;
- canonical hash version covering exactly the approved fields and ignoring JSON order, whitespace, credential rotation, scan state, and request time;
- upload, submission, and external-submission replay still resolve the original ledger after credential rotation and after the active idempotency digest key changes;
- retirement of an idempotency digest key is refused while any retained ledger row references its `kid`; lookup-only historical keys never create new digests;
- authenticated-encrypted email correlation marker binding company, mailbox, source, submission, lead, expiry, and key version without exposing any bound identifier in readable token bytes;
- tamper, wrong-company, plain-public-ID, and expired marker rejection.

Run focused tests. Expected: red.

**Step 2: Implement deterministic pure functions**

- Extend phone normalization to valid ISO 3166-1 alpha-2 `CountryCode` values without changing existing US/CA caller behavior.
- Use the Task 2 private attribution dictionary: keyed digests are lookup material only, while a separate random opaque handle is the durable analytics dimension. Never return raw UTM, click ID, path, arbitrary `source_metadata`, or keyed lookup digests.
- Use one stable canonical JSON encoder.
- Store the digest `kid` beside every upload/submission/external-ID lookup digest. On lookup, compute candidates under the active and lookup-only retained keys; on new writes, use only the active key. Retain each historical key for at least the full life of every referencing ledger/tombstone so key rotation can never turn a retry into a fresh inquiry.
- Keep the dedicated `EXTERNAL_API_ATTRIBUTION_HMAC_KEYS` key ring independent from credentials, cursors, and email correlation. Old keys remain available until every dictionary row is rekeyed and verified; rotation cannot change an existing public attribution handle.
- Seal email-correlation payloads with versioned authenticated encryption (for example AES-256-GCM), random nonces, purpose/version binding, bounded ciphertext, and constant-time authentication. Keep `EXTERNAL_INTAKE_EMAIL_CORRELATION_KEYS` versioned so active overlap decrypts old markers without exposing their internal bindings or changing durable principal/submission identities.

**Step 3: Make tests green and commit**

```bash
git add src/lib/external-api/intake src/lib/sms/phone-utils.ts .env.example tests/unit/external-api tests/lib/sms/phone-utils.test.ts
git commit -m "feat(api): canonicalize external intake submissions"
```

---

### Task 10: Create the customer/contact, lead, submission, assignment, and outbox atomically

**Files:**

- Create: `supabase/migrations/20260727102900_external_lead_intake_command.sql`
- Create: `src/lib/external-api/intake/submission-service.ts`
- Modify: `src/lib/types/database.types.ts`
- Modify: `src/lib/api/services/unassigned-lead-assignment-delivery-service.ts`
- Test: `tests/unit/supabase/external-lead-intake-command-migration.test.ts`
- Test: `tests/unit/external-api/submission-service.test.ts`
- Modify/Test: `tests/unit/email/unassigned-lead-assignment-delivery-service.test.ts`
- Modify/Test: `tests/unit/api/lead-assignment-deliveries-cron.test.ts`
- Test: `tests/sql/external-lead-intake-contract.sql`

**Skills:** `supabase:supabase`, `supabase:supabase-postgres-best-practices`, `superpowers:test-driven-development`.

**Step 1: Write failing atomicity and concurrency tests**

Prove:

- same principal/key/hash returns one result; same key/different hash conflicts;
- same source/external ID/hash replays across transport keys; changed content conflicts;
- simultaneous same-key requests create one core result;
- simultaneous different-key inquiries for one new identity create one customer/contact and two leads;
- email/phone matches enumerate every active client/sub-client match instead of taking `LIMIT 1`;
- exact sub-client match keeps its parent on both `opportunities.client_id` and `client_ref`, stores the sub-client on the submission, and snapshots that contact;
- organization creates parent client + sub-client; person-only creates one client;
- conflicting identifiers create a separate structure plus immediate possible-duplicate review evidence;
- the public customer outcome is exactly `created_possible_duplicate`, without exposing implicated customer identities;
- no name-only merge, cross-company match, established-value overwrite, contact-to-parent move, or service-address write to customer;
- the private submission ledger preserves the exact validated original contact, organization, work description, service-address, ordered typed custom answers, raw bounded attribution/source payload, and optional external reference alongside its schema/canonicalization versions and canonical request hash;
- operational normalization may populate customer/lead fields but never rewrites the original ledger; an exact replay leaves every evidence value and creation timestamp byte-identical;
- app roles cannot update/delete/read the private evidence, public APIs never serialize it, and only the audited Task 12 privacy-erasure command may replace personal fields with a non-identifying tombstone;
- every genuine request gets a deterministic external `source_thread_key` and a fresh opportunity whose exact stored stage is `new_lead`;
- lead, immutable submission, upload claims, public handle, source projection, assignment event, and post-commit outbox all commit or all roll back;
- the source's validated configured coarse OPS source is used; a payload cannot supply or override it, and no implementation hardcodes `website`;
- referenced upload source/form/claim/version mismatch fails the core command;
- missing uploads close independently without failing the lead;
- when S3 accepted the exact object but the ObjectCreated queue event is delayed, synchronous object reconciliation observes and claims it rather than closing it as missing;
- eligible default owner is assigned atomically with `external_intake_default`;
- ineligible/absent owner produces a source-generic unassigned delivery visible to assignment-authorized users.

Expected: red.

**Step 2: Add normalized customer identity support**

Add a private normalized identity registry/backfill contract for active `clients` and `sub_clients`:

- normalized email and E.164 phone only;
- no unique constraint that would erase pre-existing ambiguity;
- sorted company-scoped advisory locks per normalized identity;
- repeated lookup under lock;
- app-side backfill with `libphonenumber-js`, writing a phone only when region evidence is reliable;
- maintenance hooks for future client/sub-client writes.

Do not reuse `lead-client-matcher.ts` phone-suffix/name fallback.

**Step 3: Reconcile referenced uploads synchronously**

Before calling the core command, `submission-service.ts` resolves each referenced opaque upload through a guarded server-only lookup and performs `HEAD` on its exact immutable object target when the database has not yet observed arrival. It verifies observed byte count, version, and expected checksum, then records arrival through the same idempotent guarded transition used by the queue consumer. A test must put the object, delay the queue event, submit immediately, and prove the file is claimed once; a truly absent or mismatched object still closes independently as `closed_missing`.

Do not trust client-supplied bucket, key, version, ETag, length, or checksum. The server derives every storage identity from the upload intent.

**Step 4: Implement one fixed core command**

Create `public.create_external_intake_submission_as_system` around private helpers. It must:

1. revalidate credential digest, principal epoch, company, class, scope, source, and form, and load the active source's configured coarse OPS source;
2. acquire company, idempotency/external-ID, and sorted identity locks;
3. return the existing completed result or reject a hash conflict;
4. resolve/create parent client and optional sub-client;
5. create the fresh `new_lead` opportunity with the source row's validated coarse OPS source, both client mirrors, contact snapshot, service address, source metadata only as protected evidence, and deterministic source key;
6. create the immutable submission;
7. claim exact immutable upload objects and close missing intents;
8. write normalized source attribution;
9. through the Task 2 foundation helper, create the opaque public lead handle plus the complete initial immutable source projection;
10. call the guarded assignment core;
11. write one durable post-commit intake outbox row.

Use the write-token and lock-order patterns from `20260715160000_lead_assignment_foundation.sql` and `20260723214524_company_mailbox_intake_owner.sql`.

The migration defines the append-only private submission ledger explicitly:

- bounded structured JSON for the exact validated original contact, organization, work, service address, ordered typed answers, attribution/source evidence, and optional external reference;
- separate normalized operational columns/relationships so matching never overwrites evidence;
- schema version, canonicalization version, canonical request hash, source/form/principal identities, and immutable creation time;
- constraints that reject executable/unbounded/unknown shapes and a trigger that blocks ordinary update/delete;
- one write-token-gated privacy-erasure path, installed completely in Task 12, that may redact personal JSON to a tombstone but cannot alter idempotency identity, public handle, creation evidence, or the non-identifying audit trail.

**Step 5: Generalize unassigned delivery**

Migrate `unassigned_lead_assignment_deliveries` from required email `connection_id` to validated `source_kind` + `source_id`, preserving email behavior and adding `external_intake`. Extend every assignment source check/helper to include `external_intake_default`.

**Step 6: Verify and commit**

Run local reset/lint, Vitest, and:

```bash
npm run test:external-api:sql -- --match lead-intake
```

Regenerate types, then:

```bash
git add supabase/migrations/20260727102900_external_lead_intake_command.sql src/lib/external-api/intake/submission-service.ts src/lib/types/database.types.ts src/lib/api/services/unassigned-lead-assignment-delivery-service.ts tests
git commit -m "feat(api): create leads atomically from external intake"
```

---

### Task 11: Expose intake config, submission, status, and downstream handoff

**Files:**

- Create: `src/app/v1/intake/config/route.ts`
- Create: `src/app/v1/intake/submissions/route.ts`
- Create: `src/app/v1/intake/submissions/[publicSubmissionId]/route.ts`
- Create: `src/lib/external-api/intake/outbox-worker.ts`
- Modify: `src/lib/api/services/lead-summary-service.ts`
- Modify: `src/lib/email/email-ingestion-routing.ts`
- Modify: `src/lib/api/services/sync-engine.ts`
- Test: `tests/integration/external-api-intake-config.test.ts`
- Test: `tests/integration/external-api-intake-submissions.test.ts`
- Test: `tests/integration/external-api-intake-status.test.ts`
- Test: `tests/unit/external-api/intake-outbox-worker.test.ts`
- Modify/Test: `tests/integration/lead-summary-refresh-cron.test.ts`
- Create: `tests/unit/email/external-intake-correlation-routing.test.ts`
- Modify/Test: `tests/unit/email/opportunity-relationship-matching.test.ts`
- Modify/Test: `tests/unit/email/email-opportunity-title-sync-engine.test.ts`

**Skills:** `superpowers:test-driven-development`.

**Step 1: Write failing endpoint tests**

Prove:

- only an active intake principal can call the routes;
- config returns only its active source/forms, host, default ISO phone region, file policy, limits, and contract version;
- submission returns 201 first time, 200 with `replayed: true` on exact retry, and itemized attachment states;
- a repeated external submission ID with changed canonical content returns `409 external_submission_conflict`;
- status returns only the creating principal's public IDs, creation/outcome, safe attachment states, and bounded polling guidance;
- another principal and an unknown public ID produce the same 404;
- no intake response echoes contact, answers, message, customer, storage, or internal IDs;
- post-commit notification/enrichment failure cannot undo or duplicate the lead.

Expected: red.

**Step 2: Implement the thin public routes**

Each route uses:

1. request ID;
2. strict body/query parsing;
3. pre-auth throttle;
4. bearer authentication;
5. principal/company/route throttle;
6. service/RPC call;
7. redacted audit;
8. stable response envelope.

No route accepts `company_id`, assignee, user ID, bucket, storage path, or arbitrary field selection.

**Step 3: Implement post-commit behavior**

The outbox worker:

- dispatches the existing assignment notification/delivery machinery;
- requests targeted lead-summary refresh using protected original submission context;
- does not create a fake email thread, email activity, or correspondence event;
- retries with idempotent delivery identity.

For a source that mirrors notification email, return a single-purpose authenticated-encrypted correlation marker. Its serialized form must not reveal company, mailbox, source, submission, lead, expiry, or other internal identifiers. In email ingestion, authenticate and decrypt it before generic contact-form matching and link the real provider message to the existing opportunity. A plain public submission/lead ID never links.

**Step 4: Reconcile latest email code**

Because `sync-engine.ts`, classifier, and lead-summary code changed upstream after the design commit, re-read their complete current implementations and add the marker/context at their narrowest current seams. Preserve all newer commercial-evidence guards.

**Step 5: Verify and commit**

Run the focused intake, summary, and email-routing suites, then:

```bash
git add src/app/v1/intake src/lib/external-api/intake src/lib/api/services/lead-summary-service.ts src/lib/email/email-ingestion-routing.ts src/lib/api/services/sync-engine.ts tests
git commit -m "feat(api): expose intake configuration and submissions"
```

---

### Task 12: Surface accepted intake photos and files to authorized operators

**Files:**

- Create: `supabase/migrations/20260727103100_external_intake_lead_file_access.sql`
- Modify: `src/lib/api/services/opportunity-assigned-context-service.ts`
- Modify: `src/lib/api/services/project-file-service.ts`
- Create: `src/lib/external-api/uploads/project-file-projection-worker.ts`
- Create: `src/lib/external-api/uploads/erasure-worker.ts`
- Modify: `src/lib/external-api/uploads/attachment-runtime.ts`
- Modify: `src/lib/external-api/uploads/cloudfront-delivery.ts`
- Modify: `src/app/api/cron/external-api-maintenance/route.ts`
- Create: `src/app/api/opportunities/[id]/intake-attachments/[attachmentId]/route.ts`
- Create: `src/app/(dashboard)/pipeline/_components/pipeline-detail-files-tab.tsx`
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-detail-photos-tab.tsx`
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-detail-panel.tsx`
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-detail-tab-bar.tsx`
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-mode-types.ts`
- Modify: `src/i18n/dictionaries/en/pipeline.json`
- Modify: `src/i18n/dictionaries/es/pipeline.json`
- Modify: `src/lib/types/database.types.ts`
- Test: `tests/integration/external-intake-attachment-serving.test.ts`
- Test: `tests/integration/external-intake-project-file-access.test.ts`
- Test: `tests/unit/external-api/project-file-projection-worker.test.ts`
- Test: `tests/unit/external-api/erasure-worker.test.ts`
- Test: `tests/integration/external-intake-privacy-erasure.test.ts`
- Test: `tests/unit/services/project-file-service.test.ts`
- Test: `tests/unit/components/pipeline/pipeline-detail-files-tab.test.tsx`
- Create: `tests/unit/components/pipeline/pipeline-detail-photos-tab.test.tsx`
- Modify/Test: `tests/unit/pipeline/pipeline-detail-assigned-context-tabs.test.tsx`
- Modify/Test: `tests/unit/pipeline/pipeline-detail-body.test.tsx`

**Skills:** `ops-copywriter:ops-copywriter`, `custom-skills:ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:ui-ux-pro-max`, `custom-skills:audit-design-system`, `superpowers:test-driven-development`.

**Step 1: Write failing authorization and presentation tests**

Prove:

- only a user with current lead-view access receives descriptors or a redirect;
- company/lead/attachment mismatch and quarantined/rejected/deleted objects are indistinguishable 404s;
- the app never proxies 25 MiB bodies;
- the authorized route issues only a short CloudFront redirect;
- image thumbnails/lightbox use safe derivatives, never originals;
- documents force download from the cookieless origin;
- accepted intake images join the existing Photos chronology with source `Website`;
- a `Files` tab appears only when accepted non-image or original-download entries exist;
- filenames are safe text and pending/rejected files do not appear as trusted content.
- conversion creates one idempotent private project relationship for each clean source attachment without changing the immutable intake attachment;
- clean photos use a private authorized project-photo representation and never the current public `project-photos` bucket;
- clean documents use a generic private project-file relationship and remain forced-download;
- conversion-before-scan and scan-before-conversion both converge to the same relationship;
- repeated conversion triggers, queue delivery, and worker retries do not duplicate links or copies;
- privacy erasure removes source objects, derivatives, project links/copies, and CloudFront paths before it completes.

Expected: red.

**Step 2: Add guarded lead and project file relationships**

Extend the assigned-context RPC/service with allowlisted accepted intake attachment descriptors. The migration also adds:

- a private generic project-file relationship keyed uniquely by canonical project + source attachment + representation;
- a durable projection outbox with leases/generation fencing;
- one trigger/helper that enqueues when an opportunity is linked to a project;
- one attachment-acceptance helper that enqueues when a clean file arrives after conversion.

`project-file-projection-worker.ts` creates only the minimum private representation needed by the project: a metadata-stripped private image derivative for photos or an authorized relationship to the clean download-only document. It records the source attachment and object-version lineage, never mutates/deletes the source ledger, and never writes an original intake object into the existing public `project-photos` bucket.

Extend `ProjectFileService` with the allowlisted `intake_attachment` source type and authorized descriptors/download redirects. Do not expose S3 keys, versions, scanner data, original URLs, or another lead/project's rows.

**Step 3: Add cookieless redirects and state-aware UI**

- The route rechecks lead access and asks `cloudfront-delivery.ts` for the correct derivative/original disposition.
- Keep accepted website images in the existing Photos tab.
- Add a Files tab only when the lead actually has files, using the existing workspace atoms and tab grammar.
- Add no permanent setup or API status UI to the lead record.
- Do not add a permanent project tab merely because the relationship exists. Reuse existing project/client file consumers through `ProjectFileService`; add a project surface only if the current state-aware workspace has an existing file affordance.

**Step 4: Prove conversion and erasure convergence**

Add guarded privacy-erasure request/claim/finalize functions and a durable erasure outbox now that submissions, leads, attachments, and project relationships all exist. The worker:

- blocks new visibility and claims first;
- honors only an audited live legal hold with authority, scope, reason, and expiry;
- waits for any still-valid upload capability plus clock-skew margin before deleting its current object blocker;
- deletes every original version, derivative, project copy/link, and exact CloudFront path;
- redacts contact/work/answer/raw-source evidence to an append-only non-identifying submission tombstone;
- appends the external lead deletion tombstone through the Task 2 projection helper;
- completes only after database, versioned-origin, and cookieless-delivery readback agree.

The maintenance cron processes the durable erasure queue in bounded leased batches. Run a conversion-before-scan fixture, a scan-before-conversion fixture, duplicate outbox delivery, capability-still-valid erasure, and post-expiry erasure completion. For each, verify relation/copy counts by database and private-storage readback. Conversion must not be marked failed because a file projection is pending; the durable job retries independently and exposes operational health.

**Step 5: Audit, verify, and commit**

Run focused tests, keyboard/zoom checks, the design-system audit, local migration lint, and regenerate types. Then:

```bash
git add supabase/migrations/20260727103100_external_intake_lead_file_access.sql src/lib/api/services/opportunity-assigned-context-service.ts src/lib/api/services/project-file-service.ts src/lib/external-api/uploads src/app/api/opportunities src/app/'(dashboard)'/pipeline/_components src/i18n/dictionaries src/lib/types/database.types.ts tests
git commit -m "feat(pipeline): surface accepted intake files"
```

---

### Task 13: Make lifecycle, response, archive, merge, deletion, and conversion evidence atomic

**Files:**

- Create: `supabase/migrations/20260727103200_external_analytics_lifecycle_evidence.sql`
- Modify: `src/lib/api/services/opportunity-service.ts`
- Modify: `src/lib/api/services/opportunity-lifecycle-service.ts`
- Modify: `src/lib/api/services/email-thread-service.ts`
- Modify: `src/lib/api/services/opportunity-lifecycle-action-service.ts`
- Modify: `src/lib/api/services/project-conversion-service.ts`
- Modify: `src/lib/api/services/duplicate-detection-service.ts`
- Modify: `src/lib/email/opportunity-correspondence-classifier.ts`
- Modify: `src/lib/types/database.types.ts`
- Test: `tests/unit/supabase/external-analytics-lifecycle-evidence-migration.test.ts`
- Test: `tests/sql/external-analytics-lifecycle-contract.sql`
- Create: `tests/unit/services/opportunity-mutation-evidence.test.ts`
- Modify/Test: `tests/unit/email/opportunity-lifecycle-action-service.test.ts`
- Modify/Test: `tests/unit/services/project-conversion-service.test.ts`
- Modify/Test: `tests/unit/services/duplicate-merge-service.test.ts`
- Modify/Test: `tests/unit/email/opportunity-correspondence-classifier.test.ts`

**Skills:** `supabase:supabase`, `supabase:supabase-postgres-best-practices`, `superpowers:test-driven-development`.

**Task 0 reconciliation note:** Extend the current
`public.record_opportunity_correspondence_event(...)` command in place. Preserve
its company advisory-lock/opportunity row-lock order, provider-message
idempotency, exact activity validation, single-transaction event/counter
projection, and the recruiting-provider-noise path that remains
non-meaningful. Include both exact-message recovery wrappers (reparent and
create-target) in the response-definition and `counts_as_first_response`
proofs. Do not restore the superseded two-request insert/apply seam.

**Step 1: Inventory every mutation path**

Search for all writes affecting:

- stage/stage-entered/win probability;
- won, lost, disqualified, discarded;
- archive/unarchive/delete;
- merge/merge target;
- project conversion;
- inquiry receipt;
- inbound/outbound correspondence.

Write a failing migration/source-contract test that lists every supported callsite. A newly discovered direct write must fail the inventory test.

**Step 2: Write failing behavior tests**

Prove:

- opportunity mutation and evidence append commit together or both roll back;
- canonical `inquiry_received_at` exists with exact/provider/manual/fallback quality;
- every supported stage and terminal mutation records canonical event time;
- merge/deletion creates non-identifying projection evidence;
- project conversion remains distinct from win;
- project conversion and the Task 12 attachment-projection outbox enqueue commit together; file projection failure never rolls back the project and retries idempotently;
- correspondence records a versioned response classification and explicit `counts_as_first_response`;
- automated acknowledgement, delivery receipt, internal note, and manual `handled_at` never count;
- substantive human/configured automation can count;
- historical uncertainty remains unknown and reduces coverage.

**Step 3: Implement guarded commands**

Move current non-atomic flows behind fixed RPCs. In particular replace:

- the two-step `OpportunityService.moveOpportunityStage`;
- direct archive/unarchive/delete writes;
- email-thread batch archive/unarchive opportunity writes;
- any merge or conversion path that writes evidence after the business row.

Preserve all existing authorization and newer email commercial guards.

**Step 4: Verify and commit**

Run local reset/lint, all affected lifecycle/email tests, and:

```bash
npm run test:external-api:sql -- --match analytics-lifecycle
```

Regenerate types, then:

```bash
git add supabase/migrations/20260727103200_external_analytics_lifecycle_evidence.sql src/lib/api/services src/lib/email src/lib/types/database.types.ts tests
git commit -m "fix(pipeline): make external lifecycle evidence atomic"
```

---

### Task 14: Complete safe projections, dependency triggers, and the historical backfill

**Files:**

- Create: `supabase/migrations/20260727103300_external_lead_projection.sql`
- Create: `src/lib/external-api/analytics/source-projection.ts`
- Create: `src/lib/external-api/analytics/projection-service.ts`
- Create: `src/lib/external-api/analytics/projection-backfill.ts`
- Create: `scripts/backfill-external-lead-projections.mjs`
- Modify: `package.json`
- Modify: `src/lib/types/database.types.ts`
- Test: `tests/unit/supabase/external-lead-projection-migration.test.ts`
- Test: `tests/unit/external-api/source-projection.test.ts`
- Test: `tests/unit/external-api/projection-service.test.ts`
- Test: `tests/integration/external-lead-projection-backfill.test.ts`
- Test: `tests/sql/external-lead-projection-contract.sql`

**Skills:** `supabase:supabase`, `supabase:supabase-postgres-best-practices`, `superpowers:test-driven-development`.

**Step 1: Write failing projection tests**

Prove:

- every retained lead receives one opaque, unguessable, stable public handle;
- source projection exists for API, email, phone, referral, social, walk-in, repeat, manual, and unknown evidence;
- API source/form/site are authenticated; raw campaign/UTM/path/click values never enter projection output;
- historical missing evidence stays null;
- every externally visible change appends a company-monotonic immutable version in the same transaction;
- opportunity, lifecycle, source, project conversion, invoice, and payment changes all produce the needed projection version;
- projection payload has an explicit schema version and allowlist;
- merge/deletion tombstones contain only approved fields;
- projection rows cannot be mutated by app roles.

Expected: red.

**Step 2: Extend the Task 2 foundation with complete triggers and retention**

Do not recreate the handle, dictionary, sequence, baseline, or version tables from Task 2. Extend them with:

- current baseline retention plus 30-day incremental event/tombstone retention;
- fixed append helpers/triggers for every exposed-field dependency.

Financial fields may exist inside the private projection payload so a high-water snapshot remains stable, but serializers must strip them unless the current principal has `analytics.financial.read`.

**Step 3: Implement an executable, no-invention backfill**

The backfill:

- assigns public handles to every canonical company lead;
- maps only evidence present in canonical fields/events;
- excludes merged duplicates from canonical cohorts while retaining their tombstones;
- never changes ownership, stage, customer, source evidence, or money rows;
- checkpoints by internal ID and is resumable/idempotent.

The migration adds a private backfill-run/checkpoint relation plus fixed service-role-only claim/process/verify functions with leases, bounded batches, write-token fencing, and per-company completion state. `scripts/backfill-external-lead-projections.mjs` is the only operator entrypoint and `npm run api:backfill-lead-projections` invokes it.

The command supports:

```bash
npm run api:backfill-lead-projections -- --local --dry-run
npm run api:backfill-lead-projections -- --local --execute
npm run api:backfill-lead-projections -- --local --verify
```

- `--dry-run` reports canonical/merged/deleted lead counts, missing handles, source evidence coverage, expected writes, and current checkpoint without mutation.
- `--execute` processes bounded batches, records an opaque run ID, and resumes the same incomplete run after a crash or lease expiry.
- `--verify` fails unless every retained canonical lead has exactly one handle/current baseline, sequence continuity holds, merged/deleted evidence is correct, and protected business-row checksums are unchanged.
- The script refuses production by default. Production requires the exact pilot company, an approved launch-runbook reference, and an explicit production flag; analytics enablement stays blocked until `--verify` succeeds.

The integration test kills the process after a committed batch, resumes it, repeats the final batch, and proves no duplicate handle/version plus an unchanged opportunity/customer/financial checksum.

**Step 4: Verify and commit**

Run local migration/lint, the executable projection race/immutability contracts, all three backfill modes, focused tests, and type generation:

```bash
npm run test:external-api:sql -- --match lead-projection
npm run api:backfill-lead-projections -- --local --dry-run
npm run api:backfill-lead-projections -- --local --execute
npm run api:backfill-lead-projections -- --local --verify
```

```bash
git add supabase/migrations/20260727103300_external_lead_projection.sql src/lib/external-api/analytics scripts/backfill-external-lead-projections.mjs package.json src/lib/types/database.types.ts tests
git commit -m "feat(analytics): add external lead projections"
```

---

### Task 15: Expose stable full/incremental lead synchronization

**Files:**

- Create: `src/lib/external-api/analytics/cursor.ts`
- Create: `src/lib/external-api/analytics/lead-feed-service.ts`
- Create: `src/lib/external-api/analytics/private-cache.ts`
- Create: `src/app/v1/analytics/leads/route.ts`
- Modify: `.env.example`
- Test: `tests/unit/external-api/cursor.test.ts`
- Test: `tests/unit/external-api/lead-feed-service.test.ts`
- Test: `tests/integration/external-api-analytics-leads.test.ts`
- Test: `tests/sql/external-lead-feed-contract.sql`

**Skills:** `supabase:supabase`, `superpowers:test-driven-development`.

**Step 1: Write failing cursor, privacy, and pagination tests**

Prove:

- analytics class plus `analytics.leads.read` is required;
- intake credentials and financial-only malformed grants fail;
- default/max page size is 100/250;
- first full page captures a high-water, pages a stable latest-version snapshot by public lead ID, and has no gaps/duplicates under concurrent updates;
- filtered full snapshots have no sync checkpoint;
- incremental mode reads every event in sequence and cannot mix business filters;
- a lead may appear multiple times in one incremental scan and applies in order;
- `next_sync_checkpoint` appears only on the terminal page;
- cursors/checkpoints bind principal, epoch, company, scopes, API/projection version, filters, sort, and high-water;
- decoded transport text contains no readable company, principal, user, lead, projection-sequence, or database identifier;
- cursor expiry is one hour; stale incremental checkpoint is 410;
- revocation/epoch change fails before cache lookup;
- default DTO contains no PII, content, storage, raw attribution, assignee/mailbox, or internal IDs;
- exposed lifecycle timestamps are rounded to minute precision;
- financial fields appear only with the additive scope and use the same snapshot high-water.

Expected: red.

**Step 2: Implement opaque authenticated-encrypted cursors and fixed database reads**

- Seal every cursor/checkpoint with versioned authenticated encryption (for example AES-256-GCM), random nonces, purpose/API-version binding, bounded ciphertext, and constant-time authentication failure handling.
- Name the configured key ring `EXTERNAL_API_CURSOR_ENCRYPTION_KEYS`; absence is a startup/configuration error, never an ephemeral generated key.
- A signed-but-readable base64url payload is forbidden. The serialized token must reveal only its non-sensitive format/key-version prefix and opaque ciphertext; no internal identifier or sequence may be readable.
- Database read functions revalidate credential/principal epoch/scopes inside the call.
- Full snapshot and incremental checkpoint semantics must match the design exactly.

**Step 3: Add private cache**

- Revalidate current epoch before lookup.
- Key by principal, epoch, company, scopes, route/API/projection versions, filters, high-water, time range, and timezone.
- Cache lead feed for 60 seconds.
- Never cache intake/status or use a shared/public cache.
- A cache outage falls back to the guarded database read; a limiter outage remains fail-closed.

**Step 4: Verify and commit**

Run focused tests plus the executable concurrent-update scenarios:

```bash
npm run test:external-api:sql -- --match lead-feed
```

```bash
git add src/lib/external-api/analytics src/app/v1/analytics/leads .env.example tests
git commit -m "feat(api): expose checkpointed lead analytics"
```

---

### Task 16: Add versioned standardized metrics and exact financial attribution

**Files:**

- Create: `supabase/migrations/20260727103400_external_lead_metrics_v1.sql`
- Create: `src/lib/external-api/analytics/metric-definitions/v1.ts`
- Create: `src/lib/external-api/analytics/metric-definitions/index.ts`
- Create: `src/lib/external-api/analytics/financial-attribution.ts`
- Create: `src/lib/external-api/analytics/metrics-service.ts`
- Create: `src/app/v1/analytics/metrics/route.ts`
- Modify: `src/lib/types/database.types.ts`
- Test: `tests/unit/supabase/external-lead-metrics-v1-migration.test.ts`
- Test: `tests/unit/external-api/metric-definitions-v1.test.ts`
- Test: `tests/unit/external-api/financial-attribution.test.ts`
- Test: `tests/unit/external-api/metrics-service.test.ts`
- Test: `tests/integration/external-api-analytics-metrics.test.ts`
- Test: `tests/sql/external-lead-metrics-v1-contract.sql`

**Skills:** `supabase:supabase`, `supabase:supabase-postgres-best-practices`, `superpowers:test-driven-development`.

**Step 1: Encode v1 definitions as failing executable examples**

Create fixtures that prove every approved metric:

- received, active, discarded, current-stage distribution, outcome distribution, disqualified, project-converted, stage-reached, decided, won/lost, response coverage, all medians, intake outcomes, customer match/create, attribution completeness, lifecycle completeness;
- open estimated value, won/average value, invoiced event total, paid event total, and currency with financial scope.

Test exact rules:

- received cohort uses half-open `inquiry_received_at`;
- archived genuine leads remain in cohort;
- active excludes every terminal outcome;
- outcome distribution is mutually exclusive across active, archived unresolved, won, lost, disqualified, discarded, converted-without-decision, and deleted, with documented precedence;
- project conversion can overlap won/lost;
- win rate denominator is `won + lost`;
- stage funnels use evidence and return known/unknown coverage;
- medians start at canonical inquiry receipt;
- invoice is nondeleted and not `draft`/`void`, dated by `issue_date`, including `written_off`;
- payment is nonvoided, parent invoice nondeleted/not `void`, dated by `payment_date`;
- direct invoice opportunity wins, else canonical project `COALESCE(project_ref, project_id) → opportunity_ref`, counted once;
- missing/ambiguous attribution is excluded and disclosed;
- company timezone/DST and half-open local dates are correct;
- financial DATE metrics reject non-midnight boundaries with 422;
- group totals reconcile, and small cohorts under five suppress derived/financial cells while counts remain;
- every result carries definition, basis, population, unit, counts, coverage, timezone, range, freshness, and currency metadata.
- every response reports `generated_at` and the exact `data_through` high-water used for the calculation.

Expected: red.

**Step 2: Implement an immutable definition registry**

- `v1.ts` exports IDs, basis, population text, units, scope, supported groupings, minimum cohort, replacement/sunset metadata, and response schema.
- Omitted version selects current.
- Each superseded version remains callable for at least 12 months after its own replacement.
- Incompatible semantics require a new metric ID/version; never silently rewrite v1.

**Step 3: Implement fixed SQL and service orchestration**

- Use fixed allowlisted metric/grouping inputs, no dynamic caller SQL.
- Default range is previous 30 company-local calendar days; support 7/30/90, bounded custom ≤366 days, and constrained lifetime.
- Allow one time bucket plus one source dimension.
- Revalidate principal/scope/epoch in the database call.
- Cache <90-day responses for 60 seconds and 90–366/lifetime for at most five minutes after epoch revalidation.

**Step 4: Verify and commit**

Run local reset/lint, focused tests, and the executable DST/financial fixtures:

```bash
npm run test:external-api:sql -- --match lead-metrics
```

Regenerate types, then:

```bash
git add supabase/migrations/20260727103400_external_lead_metrics_v1.sql src/lib/external-api/analytics src/app/v1/analytics/metrics src/lib/types/database.types.ts tests
git commit -m "feat(api): add versioned lead metrics"
```

---

### Task 17: Add security alerts, retention, credential retirement, and integration health

**Files:**

- Create: `src/lib/external-api/security/security-alerts.ts`
- Modify: `src/lib/external-api/auth/credential-auth.ts`
- Modify: `src/lib/external-api/http/responses.ts`
- Modify: `src/lib/external-api/uploads/attachment-runtime.ts`
- Modify: `src/lib/external-api/intake/outbox-worker.ts`
- Modify: `src/app/api/cron/external-api-maintenance/route.ts`
- Modify: `src/lib/api/services/notification-service.ts`
- Modify: `src/lib/notifications/notification-meta.ts`
- Modify: `.env.example`
- Modify/Test: `tests/unit/external-api/strict-rate-limit.test.ts`
- Modify/Test: `tests/unit/external-api/network-fingerprint.test.ts`
- Modify/Test: `tests/unit/external-api/audit-redaction.test.ts`
- Test: `tests/unit/external-api/security-alerts.test.ts`
- Test: `tests/integration/external-api-revocation-cache.test.ts`
- Test: `tests/integration/external-api-maintenance-retention.test.ts`

**Skills:** `ops-copywriter:ops-copywriter`, `superpowers:test-driven-development`.

**Step 1: Write failing security tests**

Prove:

- pre-auth limiting uses rotating HMAC network fingerprint + presented non-secret prefix, never plain IP hash or attempted secret;
- principal and company windows enforce every published per-minute/burst/day limit;
- missing Redis config, timeout, malformed response, or Redis error returns `503 rate_limit_unavailable`;
- there is no process-memory fallback;
- 429 includes safe retry/remaining metadata;
- revocation/epoch check occurs before analytics cache lookup;
- audit redaction recursively removes authorization, token, key, secret, contact, message, answers, URL query, filename/storage, and signed URL data;
- fingerprints expire at 30 days without deleting the non-network audit record;
- credential/network overlap retirement never removes an idempotency digest key; referenced idempotency `kid` coverage is health-checked and missing material fails closed;
- scope denials plus cross-source and cross-company attempts remain auditable without retaining payload content;
- repeated auth failures, cross-tenant attempts, and hostile upload patterns emit one deduped owner-visible event without content;
- maintenance retires rotation overlaps, expires uploads, deletes tombstones/events on schedule, and exposes bounded health counts.

Expected: red.

**Step 2: Harden the shipped request boundary**

Extend the Task 3 Redis/audit boundary with retention metrics, rejection aggregation, cache-result auditing, and failure-injection coverage. Keep it separate from `src/lib/utils/ratelimit.ts`; no route may acquire a process-memory or fail-open fallback.

**Step 3: Implement safe audit and notifications**

- Audit every protected request after pre-auth outcome is known.
- Store route, principal/credential IDs, company, timing, response class, limiter/idempotency/cache result, metric set/grouping/result size, and short-lived network fingerprint only.
- Add the explicit `external_api_security` notification type with an internal action to `/settings?section=website`.
- Notify only eligible active owners/admins and use durable dedupe.

**Step 4: Make every `/v1` route use the boundary**

Add an integration test that enumerates the six public handlers and fails if any omits request ID, pre-auth limiting, bearer auth, company limiting, audit, safe envelope, and cache policy.

**Step 5: Verify and commit**

```bash
npx vitest run tests/unit/external-api tests/integration/external-api-revocation-cache.test.ts tests/integration/external-api-maintenance-retention.test.ts
git add src/lib/external-api src/app/v1 src/app/api/cron/external-api-maintenance src/lib/api/services/notification-service.ts src/lib/notifications/notification-meta.ts .env.example tests
git commit -m "feat(api): add external api operations and retention"
```

---

### Task 18: Publish generated OpenAPI, examples, runbooks, and Bible truth

**Files:**

- Create: `scripts/generate-external-api-openapi.ts`
- Create: `docs/api/openapi-v1.json`
- Create: `docs/api/external-lead-intake-and-analytics.md`
- Create: `docs/api/examples/javascript.mjs`
- Create: `docs/api/examples/typescript.ts`
- Create: `docs/api/examples/php.php`
- Create: `docs/api/examples/http.sh`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/contract/external-api-openapi.test.ts`
- Modify in an isolated Bible worktree after conflict coordination:
  - `/Users/jacksonsweet/Projects/OPS/ops-software-bible/03_DATA_ARCHITECTURE.md`
  - `/Users/jacksonsweet/Projects/OPS/ops-software-bible/04_API_AND_INTEGRATION.md`
  - `/Users/jacksonsweet/Projects/OPS/ops-software-bible/07_SPECIALIZED_FEATURES.md`
  - `/Users/jacksonsweet/Projects/OPS/ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`
  - `/Users/jacksonsweet/Projects/OPS/ops-software-bible/13_EMAIL_SYSTEM.md`
  - `/Users/jacksonsweet/Projects/OPS/ops-software-bible/21_ANALYTICS_SYSTEM.md`
  - `/Users/jacksonsweet/Projects/OPS/ops-software-bible/08_DEPLOYMENT_AND_OPERATIONS.md`

**Skills:** `ops-copywriter:ops-copywriter`, `superpowers:test-driven-development`.

**Step 1: Write an OpenAPI drift test**

The test regenerates in memory and compares byte-for-byte with `docs/api/openapi-v1.json`. It also proves:

- exactly six public routes;
- bearer security and distinct scope descriptions;
- request/response/error schemas reference the runtime Zod contracts;
- no schema includes forbidden PII/storage/internal fields;
- examples validate against the same schemas.

Expected: red.

**Step 2: Generate rather than hand-maintain the contract**

Add `npm run api:openapi`. The generator consumes the runtime contract registry and emits deterministic JSON ordering. Do not extend the stale Bubble-era `API-REFERENCE.md`.

**Step 3: Write copy-paste server examples**

Include:

- secure environment secret loading;
- config discovery;
- upload-batch idempotency and direct browser handoff without exposing the OPS secret;
- submission retry and status polling;
- lead full sync, incremental sync, terminal checkpoint commit;
- metrics timezone/date examples;
- rotation/revocation guidance;
- bold warning that normal credentials never belong in public browser code.

Use placeholders only; no live secret, customer data, or internal IDs.

**Step 4: Update the Software Bible safely**

The Bible checkout is currently separate, ahead/behind, dirty, and the target files already have uncommitted work. Do not edit that checkout in place.

Before documentation work:

1. identify/coordinate the owner of those edits;
2. wait for or preserve their changes in a commit;
3. create a dedicated Bible worktree/branch from the reconciled current main;
4. update the exact files listed above;
5. commit the Bible changes in the Bible repository only.

Document credentials/OAuth capability, intake/upload/customer/idempotency, source attribution, lifecycle/response evidence, attachment privacy/erasure, projections, every metric denominator, financial scope, rate/cache/revocation/audit, notification/email handoff, operations, and actual approved costs.

**Step 5: Verify and commit**

Run:

```bash
npm run api:openapi
npx vitest run tests/contract/external-api-openapi.test.ts
```

Then:

```bash
git add scripts/generate-external-api-openapi.ts docs/api package.json package-lock.json tests/contract/external-api-openapi.test.ts
git commit -m "docs(api): publish external api contract"
```

Commit the Bible separately as:

```bash
git commit -m "docs(api): document external intake and analytics"
```

---

### Task 19: Full verification, load proof, pilot rollout, and launch acceptance

**Files:**

- Create: `scripts/verify-external-api-load.mjs`
- Create: `tests/e2e/external-api-settings.spec.ts`
- Create: `tests/e2e/external-api-launch-scenario.spec.ts`
- Create: `docs/runbooks/external-api-launch.md`
- Modify: `docs/runbooks/external-api-cost-and-service-gate.md` with measured results

**Skills:** `superpowers:verification-before-completion`, `custom-skills:audit-design-system`.

**Step 1: Run schema and security verification**

Against local Supabase:

```bash
npx supabase db reset
npx supabase db lint
```

Run every `tests/sql/external-*.sql` concurrency/tenant contract. Then use a disposable Supabase branch/staging project to verify:

```bash
npm run test:external-api:sql
```

- migrations apply in order;
- after the final rebase, every pending external-API migration version sorts
  after the latest version already applied to the target; renumber the complete
  pending series together before branch verification if `main` advanced;
- RLS/grants/function ACLs/fixed search paths match the tests;
- cross-company service-role misuse fails;
- backfill is resumable and non-mutating to business state;
- database advisors show no newly introduced security or critical performance finding.

Do not apply production migrations.

**Step 2: Run focused and repository-wide checks**

Run:

```bash
npx vitest run tests/unit/external-api tests/integration/external-api-*.test.ts tests/contract/external-api-openapi.test.ts
npm run type-check
npm run lint
npm run build
npm test -- --run
```

Expected:

- every new/focused test passes;
- type-check, lint, and build pass;
- the full suite is no worse than the exact post-merge baseline recorded by Task 0 for the same base commit; investigate any changed failure instead of labeling it pre-existing.

**Step 3: Run real storage and scan acceptance in staging**

Prove:

- conditional capability cannot read/list/delete/replace/reuse or exceed its signed length;
- clean and hostile fixture files produce the correct states;
- GuardDuty/SQS duplicate and delayed events are idempotent;
- scanner outage remains quarantined and terminalizes at 24 hours under a clock-controlled test;
- CloudFront refuses unclean objects, strips cookies, and returns the exact safe headers;
- erased object versions and derivatives are absent by storage readback, exact paths are invalidated, prior signed delivery URLs are denied, and the lead feed emits the non-identifying deletion tombstone.

**Step 4: Run load and failure tests**

`verify-external-api-load.mjs` exercises expected and approved-high concurrency without real customer data:

- same-key submission races;
- same-customer/different-key races;
- upload quota reservation races;
- 250-row full and incremental pages during concurrent changes;
- grouped metrics at 7/30/90/366-day and lifetime bounds;
- Redis, SQS, GuardDuty-result, Supabase, and cache failure injection.

Record p50/p95/p99 latency, database query plans, queue lag, cache hit rate, error rates, and estimated monthly cost. No protected route may fail open.

**Step 5: Run UI and launch scenario**

Use Playwright for Settings and the 12-step approved launch scenario:

1. configure source/form and separate credentials;
2. submit contact/work/attribution with two photos and one PDF;
3. accept one photo/PDF and reject one unsafe photo without losing the lead;
4. match/create the correct client/sub-client;
5. create one fresh lead and assignment/unassigned visibility;
6. reconcile file status;
7. associate a later real email through the authenticated-encrypted marker/normal matcher;
8. replay without duplicate records/events;
9. full sync all company leads without PII;
10. get versioned/suppressed metrics;
11. add financial scope and get only approved values;
12. revoke and prove the next request/cache access fails.

Run two mandatory branches beside that canonical 12-step scenario:

- convert the lead before and after file inspection, then prove clean photo/document projection is private, idempotent, and source-preserving;
- erase the intake and prove originals, derivatives, project relationships/copies, delivery paths, protected personal content, and the external projection reconcile to a deletion tombstone.

**Step 6: Produce the launch runbook**

`docs/runbooks/external-api-launch.md` must list:

- migration and infrastructure order;
- environment variables and secret rotation;
- rollback/disable steps;
- exact dry-run/execute/verify backfill commands, run ID/checkpoint recovery, protected-row checksum readback, and the rule that analytics cannot enable before verification succeeds;
- pilot company/source setup;
- monitors and alert thresholds;
- cost budget and stop threshold;
- privacy erasure procedure;
- exact smoke tests.

Initial availability stays behind `external_api`. Enable one pilot only after Jackson approves costs, production migration, deployment, and the named company.

**Step 7: Final commit**

```bash
git add scripts/verify-external-api-load.mjs tests/e2e/external-api-settings.spec.ts tests/e2e/external-api-launch-scenario.spec.ts docs/runbooks/external-api-launch.md docs/runbooks/external-api-cost-and-service-gate.md
git commit -m "test(api): prove external api launch contract"
```

## Definition of done

This initiative is complete only when:

- all six `/v1` endpoints satisfy the approved contract;
- customer/contact matching, fresh lead creation, assignment, upload claims, public handle, attribution, and outbox are atomic and race-proven;
- accepted photos/files are private, safely visible to authorized operators, and independently fail without losing the lead;
- later communication remains owned by the real email engine;
- all company leads appear in a stable privacy-safe feed with source characteristics and no forbidden data;
- every metric definition, denominator, timezone, financial rule, suppression rule, and version is executable and documented;
- limiter outage fails closed, revocation precedes cache, and cross-tenant denial is proven;
- storage/scan/queue/cache/database costs are measured and approved;
- OpenAPI/examples/Bible/runbooks match the implementation;
- focused tests, type-check, lint, build, full-suite comparison, staging storage tests, load tests, and the launch scenario are green;
- no production mutation, push, deploy, provisioning, or pilot enablement has happened without separate authorization.

## Execution handoff

Plan complete and saved to `docs/plans/2026-07-23-external-lead-intake-and-analytics-api.md`. Choose one execution mode:

1. **Subagent-Driven (this session)** — use `superpowers:subagent-driven-development`; execute one task at a time with fresh implementer/reviewer passes and stop at the cost/provisioning/production gates.
2. **Parallel Session** — open a fresh session in this worktree and use `custom-skills:executing-plans` with this plan, preserving the same gates and atomic commit sequence.

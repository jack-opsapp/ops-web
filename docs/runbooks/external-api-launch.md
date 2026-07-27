# External Lead API Launch

**Status:** blocked at paid-service approval
**Production state:** no migration, infrastructure, environment, deployment, or
company enablement has been applied
**Default:** fail closed

This is the operating order for the External Lead Intake and Analytics API.
The API remains unavailable to every company until the final company-specific
`external_api` override is enabled.

## Release gates

Do not start production work until all gates are recorded in the launch record:

1. Jackson approves the refreshed AWS, Upstash, Vercel, and Supabase cost
   readback.
2. Jackson approves the production migration and deployment.
3. Jackson names the one pilot company and website source.
4. The disposable staging acceptance stack passes storage, scan, queue, CDN,
   load, browser, privacy-erasure, and rollback tests.
5. The projection backfill completes and verifies before analytics is enabled.
6. A rollback operator and security-response owner are present for the pilot.

Any failed gate stops the launch. Do not weaken an upload condition, reuse a
general Redis database, bypass malware quarantine, enable another company, or
silently omit analytics evidence.

## Release order

### 1. Record the release

Create one restricted launch record containing:

- release commit;
- migration versions;
- Supabase project and branch identifiers;
- AWS account and region;
- CloudFormation stack ID;
- Upstash database ID and plan;
- Vercel project and deployment IDs;
- pilot company UUID;
- pilot source hostname;
- backfill run ID;
- storage/load/acceptance artifact paths;
- rollback operator and security owner;
- approved monthly budget and stop threshold.

Do not put credentials, signing keys, customer content, storage object keys, or
database URLs in the record.

### 2. Provision the dedicated Redis boundary

Create a dedicated production Redis database in the same operating region as
the API. Enable the approved production plan and Prod Pack. Record the measured
plan, SLA, region, command allowance, storage allowance, and monthly fixed
cost.

Set only:

- `EXTERNAL_API_REDIS_REST_URL`
- `EXTERNAL_API_REDIS_REST_TOKEN`

Verify from a staging deployment that Redis unavailability produces `503` for
every protected route. A process-memory or fail-open fallback is forbidden.

### 3. Provision private intake storage

Validate and deploy `infra/external-intake-storage.yaml` in the approved AWS
account and region. The stack creates the dedicated versioned bucket,
create-only signer, private worker, S3 arrival queue and DLQ, GuardDuty Malware
Protection plan, scan-result queue and DLQ, EventBridge rule, CloudFront origin
access control, signing key group, response policies, and cookieless
distribution.

Review the generated IAM policies before creation. The upload signer must have
no read, list, overwrite, or delete permission. The worker identity must never
be returned to a browser.

Record these stack outputs:

- `EXTERNAL_INTAKE_AWS_REGION`
- `EXTERNAL_INTAKE_S3_BUCKET`
- `EXTERNAL_INTAKE_UPLOAD_QUEUE_URL`
- `EXTERNAL_INTAKE_SCAN_QUEUE_URL`
- `EXTERNAL_INTAKE_CLOUDFRONT_DOMAIN`
- `EXTERNAL_INTAKE_CLOUDFRONT_DISTRIBUTION_ID`
- `EXTERNAL_INTAKE_CLOUDFRONT_KEY_PAIR_ID`

Create and store these secrets separately:

- `EXTERNAL_INTAKE_UPLOAD_AWS_ACCESS_KEY_ID`
- `EXTERNAL_INTAKE_UPLOAD_AWS_SECRET_ACCESS_KEY`
- `EXTERNAL_INTAKE_WORKER_AWS_ACCESS_KEY_ID`
- `EXTERNAL_INTAKE_WORKER_AWS_SECRET_ACCESS_KEY`
- `EXTERNAL_INTAKE_CLOUDFRONT_PRIVATE_KEY`

The CloudFront private key never enters CloudFormation, source control, logs,
browser responses, or a client-visible environment value.

### 4. Install application secrets

Generate independent random keys for each purpose:

- `EXTERNAL_API_CREDENTIAL_HMAC_KEYS`
- `EXTERNAL_API_NETWORK_HMAC_KEYS`
- `EXTERNAL_API_IDEMPOTENCY_HMAC_KEYS`
- `EXTERNAL_API_ATTRIBUTION_HMAC_KEYS`
- `EXTERNAL_INTAKE_EMAIL_CORRELATION_KEYS`
- `EXTERNAL_API_CURSOR_ENCRYPTION_KEYS`
- `CRON_SECRET`

Use the versioned JSON envelopes shown in `.env.example`. Do not reuse a key
between purposes.

Rotation order:

1. add the new key version and make it active;
2. retain every old lookup/decryption key;
3. deploy and verify new writes use the new version;
4. run maintenance and inspect referenced idempotency key versions;
5. remove an old key only after no retained ledger, tombstone, cursor window,
   attribution value, or email marker can require it.

Maintenance fails closed with `external_api_idempotency_key_missing` if a
retained idempotency version is absent.

### 5. Apply migrations in one ordered series

Immediately before applying, read the live migration ledger. Every version
below must sort after the latest production version. If `main` has advanced,
renumber the complete series together and rerun all SQL and contract checks.

Apply in this exact order:

1. `20260727102500_external_api_authorization_foundation.sql`
2. `20260727102600_external_intake_upload_foundation.sql`
3. `20260727102700_external_intake_attachment_processing.sql`
4. `20260727102800_external_intake_idempotency_rotation.sql`
5. `20260727102900_external_lead_intake_command.sql`
6. `20260727103000_external_intake_public_routes.sql`
7. `20260727103100_external_intake_lead_file_access.sql`
8. `20260727103200_external_analytics_lifecycle_evidence.sql`
9. `20260727103300_external_lead_projection.sql`
10. `20260727103350_external_lead_feed.sql`
11. `20260727103400_external_lead_metrics_v1.sql`
12. `20260727103500_external_api_operations.sql`

The first migration creates no public HTTP route and enables no company. After
application, verify:

- every private table has RLS enabled and no client grants;
- every public command is executable only by `service_role`;
- every security-definer function has a fixed search path;
- every company/source/form check fails across tenants;
- all twelve migrations exist once in the ledger;
- database security and performance advisors show no new finding caused by
  this series.

Do not edit or delete a successfully applied migration. Correct a production
defect with a new forward migration.

### 6. Deploy with every company disabled

Deploy the application commit with all required infrastructure and secret
values present. Leave every `external_api` company override disabled.

Smoke the disabled state:

- Website settings is not visible for an unapproved company;
- all six public endpoints deny credentials for an unapproved company;
- missing Redis, storage, queue, signing, encryption, or HMAC configuration
  returns a safe unavailable response;
- no response or log contains a credential, contact value, filename, storage
  key, scanner detail, SQL error, or stack trace.

### 7. Backfill projections

Use a non-production branch first. These environment values must point to that
exact target:

```bash
export EXTERNAL_API_BACKFILL_SUPABASE_URL="<staging-supabase-url>"
export EXTERNAL_API_BACKFILL_SERVICE_ROLE_KEY="<staging-service-role-key>"
```

Dry-run:

```bash
node scripts/backfill-external-lead-projections.mjs \
  --local \
  --dry-run \
  --company-id "<pilot-company-uuid>"
```

For a remote disposable branch, use the branch URL but keep the script's
production guard intact. The current command intentionally accepts `--local`
only for loopback and `--production` only for the exact production project; a
remote branch is verified through the SQL contract runner and branch RPC
readbacks.

After separate production approval, execute:

```bash
node scripts/backfill-external-lead-projections.mjs \
  --production \
  --execute \
  --allow-production \
  --company-id "<approved-pilot-company-uuid>" \
  --launch-runbook "docs/runbooks/external-api-launch.md" \
  --batch-size 100
```

Then verify:

```bash
node scripts/backfill-external-lead-projections.mjs \
  --production \
  --verify \
  --allow-production \
  --company-id "<approved-pilot-company-uuid>" \
  --launch-runbook "docs/runbooks/external-api-launch.md"
```

Save the safe JSON result. It contains the run ID, status, checkpoint, counts,
and verification checksum; it must not contain lead content.

Recovery:

- `pending`: claim and continue;
- `running` with a live lease: wait; never start a second worker;
- `running` with an expired lease: rerun execute to reclaim the same run;
- `failed`: preserve the run/checkpoint, diagnose, correct forward, then resume;
- `complete`: run verify;
- `verified`: compare the protected-row checksum and counts to the dry-run.

The backfill may write only external projection/evidence tables. Its protected
business-row checksum must remain unchanged. Analytics must not be enabled if
status is not `verified`, counts differ, or the protected-row checksum changes.

### 8. Complete staging acceptance

Run SQL contracts against only the approved disposable branch:

```bash
export EXTERNAL_API_SQL_DATABASE_URL="<session-mode-branch-postgres-url>"
export EXTERNAL_API_SQL_SSL_ROOT_CERT="<absolute-supabase-ca-path>"

node scripts/run-external-api-sql-contracts.mjs \
  --allow-disposable-branch \
  --expected-project-ref "<branch-project-ref>"
```

Run the deterministic settings browser proof:

```bash
node_modules/.bin/playwright test \
  tests/e2e/external-api-settings.spec.ts \
  --project=chromium \
  --workers=1
```

Run expected and approved-high load profiles only against the staging
hostname:

```bash
export EXTERNAL_API_LOAD_CONFIRM=staging
export OPS_API_BASE_URL="<staging-api-origin>"
export OPS_INTAKE_CREDENTIAL="<staging-intake-credential>"
export OPS_ANALYTICS_CREDENTIAL="<staging-analytics-credential>"

node scripts/verify-external-api-load.mjs \
  --confirm-staging \
  --profile expected

node scripts/verify-external-api-load.mjs \
  --confirm-staging \
  --profile high
```

The report is written under `docs/artifacts/` and records p50/p95/p99, error
rate, route counts, page behavior, replay behavior, and fail-closed probes.
Record read-only database query plans, SQS oldest-message age, DLQ depth, and
Redis cache-hit telemetry beside it.

Run the canonical storage/lifecycle/privacy scenario after the paid staging
stack and isolated acceptance driver exist:

```bash
export EXTERNAL_API_STAGING_ACCEPTANCE=1
export OPS_API_BASE_URL="<staging-api-origin>"
export EXTERNAL_API_ACCEPTANCE_DRIVER_URL="<isolated-staging-driver-origin>"
export EXTERNAL_API_ACCEPTANCE_DRIVER_TOKEN="<isolated-driver-token>"

node_modules/.bin/playwright test \
  tests/e2e/external-api-launch-scenario.spec.ts \
  --project=chromium \
  --workers=1
```

The driver is staging-only, synthetic-data-only, inaccessible from production,
and destroyed after acceptance. The scenario must prove the twelve approved
steps plus conversion before/after inspection and complete erasure. A skipped
scenario is not a pass.

### 9. Enable one pilot company

Only after every prior gate is green:

1. confirm the exact pilot company UUID and website hostname;
2. enable one `admin_feature_overrides` row with
   `feature_key = 'external_api'`;
3. read it back;
4. open Settings → Website and create one source;
5. issue separate intake and analytics credentials;
6. keep financial scope off until specifically approved;
7. install credentials only in the website's server-side secret store;
8. submit one synthetic inquiry and complete every smoke test below;
9. begin the 24-hour observation window.

Never put a credential in browser JavaScript, a URL, source control, logs, a
tag manager, or browser analytics.

## Monitors and stop thresholds

Page the operator and disable the pilot immediately for any of:

- cross-company read/write or authorization ambiguity;
- a protected route serving while Redis or authorization state is unavailable;
- a quarantined/rejected object delivered by CloudFront;
- one idempotency replay creating a second lead, customer, event, or upload;
- a privacy erasure leaving any object version, derivative, relationship,
  signed delivery path, or protected projection content;
- any credential, contact value, filename, object key, provider error, or SQL
  detail in logs or responses;
- any DLQ message;
- oldest queue message over 5 minutes;
- malware scan pending over 30 minutes;
- API 5xx rate over 1% for 5 minutes;
- intake p95 over 2 seconds or analytics p95 over 3 seconds for 15 minutes;
- maintenance health backlog increasing for two consecutive runs;
- monthly forecast at 80% of the approved budget;
- actual/forecast cost at the approved hard stop.

Owner-visible security notifications are persistent until reviewed. Five
credential rejections in 15 minutes, a source/company denial, or an unsafe
upload creates one deduplicated Website settings alert.

## Rollback and disable

The first rollback action is company disablement, not a database rollback:

1. set the pilot `external_api` override to disabled;
2. read it back;
3. revoke every intake and analytics credential;
4. verify the next request returns `401` with `Cache-Control: no-store`;
5. leave workers running long enough to settle already-uploaded quarantine
   objects and execute any approved erasures;
6. stop new queue consumption only after queue state and retention are recorded;
7. preserve append-only audit, immutable submission, projection, and tombstone
   evidence;
8. keep the private bucket and signing boundary until every retained file is
   reconciled or erased.

Do not reverse applied schema by dropping tables or rewriting business rows.
Do not destroy versioned storage while accepted files or erasure obligations
exist. A corrected release uses forward migrations and a new deployment.

## Privacy erasure

For the exact authorized intake:

1. create the erasure request and record its safe request ID;
2. revoke active delivery;
3. delete every original, derivative, noncurrent object version, project
   relationship/copy, and exact delivery path;
4. submit exact CloudFront invalidation paths;
5. read back S3 version absence;
6. verify all prior signed URLs deny access;
7. remove protected personal content from the immutable intake representation
   under the guarded erasure command;
8. emit one non-identifying deletion tombstone in the external feed;
9. retain only the content-free audit proof;
10. verify the request end to end.

Never erase by bucket prefix guessing. The database ledger supplies the exact
versioned keys.

## Pilot smoke tests

All must pass after enablement:

1. `GET /v1/intake/config` returns only the approved source/form.
2. A normal credential placed in browser code is rejected by review; the
   browser receives only a one-file upload capability.
3. Exact-size conditional upload succeeds once; read/list/delete/replace,
   shorter/longer bodies, and reuse fail.
4. One submission creates one customer outcome, one fresh lead, one assignment
   outcome, and one immutable original-submission ledger.
5. One clean photo and PDF become private accepted files; one hostile file
   remains unavailable without losing the lead.
6. Same-key/same-body replay returns the same public IDs.
7. Same-key/changed-body returns `409`.
8. Full lead sync reaches a terminal checkpoint; incremental sync resumes from
   it without personal content.
9. Metrics return definition version, numerator, denominator, coverage, and
   suppression state.
10. A normal analytics credential is denied financial metrics.
11. Revocation denies the next request, including a would-be cache hit.
12. Disablement denies every company credential.

## Current acceptance state

- Code, migrations, generated OpenAPI, and local contracts: prepared.
- Disposable Supabase branch schema/SQL verification: in progress.
- Paid AWS/GuardDuty/SQS/CloudFront staging acceptance: not run; not approved.
- Dedicated production Redis failure proof: not run; not approved.
- Expected/high staging load reports: not run; staging services not approved.
- Canonical 12-step scenario: encoded, but a skip is expected until the paid
  staging stack and isolated acceptance driver are approved.
- Production migration/deployment/pilot: not approved and not performed.

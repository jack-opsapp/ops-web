# OPS External Lead API

The OPS External Lead API connects a custom website to OPS without making the website responsible for lead management.

It does four jobs:

1. creates the original customer, lead, and source-attribution record;
2. accepts photos and files through short-lived upload capabilities;
3. exposes a privacy-safe feed of every company lead and its source characteristics;
4. returns versioned lead metrics for a website analytics dashboard.

Later replies and attachments stay with the OPS email engine. The website sends the original submission only.

## Security boundary

**Never put a normal OPS credential in browser code.** Keep it in a server-side secret store. Do not place it in source control, URLs, logs, error trackers, tag managers, or browser analytics.

Use separate credentials:

- intake credential: `intake.write`;
- analytics credential: `analytics.leads.read`;
- financial analytics: add `analytics.financial.read` only when approved.

An intake credential is limited to approved website sources. Analytics credentials do not expose customer names, email addresses, phone numbers, street addresses, answers, photos, file names, or internal OPS identifiers.

Every protected request uses:

```http
Authorization: Bearer <server-side OPS credential>
```

Write requests also require a stable `Idempotency-Key`. Reuse the same key only when retrying the same logical request with the same body.

## Recommended integration

### 1. Read configuration

Call `GET /v1/intake/config` from the website server. Store the returned opaque `sourceId` and `formId`; do not invent or decode them.

The response also declares accepted file types and byte limits.

### 2. Reserve uploads

If the submission includes photos or files:

1. the browser sends file metadata to the website server;
2. the server calls `POST /v1/intake/uploads`;
3. the server returns only the single-use upload capabilities to the browser;
4. the browser uploads each file directly using the exact method and required headers;
5. the browser returns the opaque `uploadId` values to the website server.

The browser never receives the OPS credential. Each capability is short-lived, write-once, size-bound, and tied to one reserved object.

### 3. Create the original submission

Call `POST /v1/intake/submissions` with the contact, work summary, typed form answers, attribution, and any `uploadIds`.

OPS atomically:

- matches or creates the customer record;
- creates one fresh lead;
- applies the configured assignment or leaves it visibly unassigned;
- records the authenticated source and form;
- claims the upload reservations;
- returns opaque public handles.

The lead is not discarded if a file is later rejected. File safety is independent from lead creation.

### 4. Poll file status

Call `GET /v1/intake/submissions/{publicSubmissionId}` only while `attachmentProcessingTerminal` is false. Respect `pollAfterSeconds`. Stop when the state is terminal.

Safe attachment states are:

- `accepted`;
- `pending_inspection`;
- `rejected`;
- `missing`;
- `expired`.

No storage path or provider detail is returned.

## Lead analytics feed

`GET /v1/analytics/leads` exposes every company lead as a privacy-safe projection.

The feed includes:

- current stage and terminal disposition;
- lifecycle timestamps and reached-stage flags;
- response and conversion durations;
- source channel and integration type;
- opaque source, form, campaign, UTM, landing-page, and referrer characteristics;
- completeness and timing-quality signals;
- approved financial values only when the credential has financial scope.

It never includes customer contact information, free-form form content, photos, files, email content, or internal OPS IDs.

### Full sync

Start with:

```http
GET /v1/analytics/leads?mode=full&page_size=250
```

Follow `nextCursor` until it is `null`. The terminal page returns `nextSyncCheckpoint`; persist that checkpoint only after the complete full sync commits successfully in your database.

### Incremental sync

Use the committed checkpoint:

```http
GET /v1/analytics/leads?mode=incremental&sync_checkpoint=<checkpoint>&page_size=250
```

Follow `nextCursor` to the terminal page, apply upserts/merges/deletion tombstones atomically, then replace the stored checkpoint with `nextSyncCheckpoint`.

If a checkpoint expires, run a new full sync. Do not guess a missing page or advance a checkpoint after a partial write.

## Metrics

`GET /v1/analytics/metrics` returns executable metric definitions, not unlabeled totals.

Every cell includes:

- metric and definition version;
- population and basis;
- value, unit, numerator, and denominator;
- included and missing-evidence counts;
- cohort size and evidence coverage;
- grouping labels;
- suppression state;
- currency when applicable.

Examples:

```http
GET /v1/analytics/metrics?preset=30d&metric=leads_received&metric=cohort_decided_win_rate
GET /v1/analytics/metrics?preset=90d&metric=leads_received&group_by=week&group_by=source
GET /v1/analytics/metrics?preset=custom&from=2026-07-01&to=2026-07-27&metric=median_first_response_minutes
```

Custom dates are interpreted at company-local midnight. Detailed custom ranges cannot exceed 366 days. Lifetime results support ungrouped or source summaries.

Financial metric IDs require `analytics.financial.read`; otherwise the request is denied rather than silently returning partial financial data.

## Retries, rate limits, and cache

- Retry `429` only after the `Retry-After` delay.
- Retry `503` with bounded exponential backoff and jitter.
- Reuse the original idempotency key and body for write retries.
- Treat `409` as a changed-body or changed-identity conflict, not as success.
- Do not cache intake responses.
- The pilot does not use a shared server-side analytics cache. Every protected
  analytics request reauthorizes and reads the privacy-safe OPS projection.
- A caller may honor the returned private browser/server cache policy only
  inside its own trusted environment.
- Revocation is checked before any analytics cache read.

All responses include `x-request-id`. Record that safe request ID when support is needed; never record the credential or full request body.

## Rotation and revocation

Rotate credentials from OPS Settings before their expiry or whenever exposure is suspected. Update the server-side secret, verify a new request, then end the overlap window.

Revocation is immediate. The next protected request fails, including a request that would otherwise match a cached analytics result.

## Contract and examples

- [OpenAPI 3.1](./openapi-v1.json)
- [JavaScript](./examples/javascript.mjs)
- [TypeScript](./examples/typescript.ts)
- [PHP](./examples/php.php)
- [HTTP/curl](./examples/http.sh)

The OpenAPI file is generated from the same runtime schemas used by the six endpoints. CI rejects drift.

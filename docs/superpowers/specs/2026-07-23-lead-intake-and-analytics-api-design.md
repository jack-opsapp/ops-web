# External Lead Intake and Analytics API

**Date:** 2026-07-23

**Status:** Approved product design; implementation plan complete

**Scope:** OPS Web backend, integration settings, developer contract, and required OPS Software Bible updates

## 1. Outcome

OPS will expose a narrow, versioned external API that lets a trades business connect its website to OPS without giving the website broad access to the company's account.

The first release has two deliberately separate capabilities:

1. A website can submit one original inquiry, including photos and files. OPS creates or safely matches the customer, creates a new lead, preserves the original form submission, and hands the lead to the normal OPS lead, assignment, notification, and email workflows.
2. A company's website analytics backend can read a privacy-safe, company-wide lead feed and standardized lead metrics. It can understand where leads came from and what happened to them without receiving customer identities, messages, addresses, form answers, or attachment data.

This is a server-to-server API. A normal OPS API secret must never be embedded in browser JavaScript, a public form, or a mobile binary.

The design is intentionally reusable. Custom websites use server credentials first. Future WordPress, Wix, Squarespace, Zapier-style, and other platform integrations use OAuth grants backed by the same capability boundaries.

## 2. Product principles

### Purpose-built, not generic CRM access

The intake API means “submit this genuine inquiry to OPS.” It is not an external CRUD layer over `clients`, `opportunities`, storage buckets, email, or projects.

The analytics API means “show approved lead performance data.” It is not an export of internal tables.

### Never lose a lead because an attachment failed

Customer matching and lead creation are the atomic core. A missing, unsupported, corrupt, or unsafe attachment is reported separately and cannot roll back a valid lead.

### One genuine inquiry means one lead

The same customer may submit multiple real inquiries. OPS reuses a uniquely matched customer record but creates a new lead for every genuine inquiry. OPS deduplicates transport retries, not human intent.

### Preserve the source without polluting canonical records

Recognized contact and project fields populate OPS records. The exact original submission and arbitrary custom answers remain attached to the intake submission as immutable source evidence. Untrusted form content does not silently overwrite established customer data.

### Company-wide analytics without customer exposure

The lead feed covers all company leads, not only leads created by the connecting website. It exposes a curated source and lifecycle projection with opaque public identifiers. It excludes customer content and identity by default.

### OPS owns metric definitions

Websites should not download customers, jobs, invoices, or messages and invent their own conversion logic. OPS returns standardized metrics with a definition version, timezone, date range, and freshness timestamp.

## 3. Research findings

### Current OPS foundation

OPS already has the core business records:

- `clients` stores customers.
- `opportunities` stores leads and contains stage, source, value, lifecycle, correspondence, and timing fields.
- `stage_transitions`, `opportunity_dispositions`, and `opportunity_conversion_events` provide lifecycle evidence, although current mutation paths are not uniformly atomic or historically complete enough for an external metric contract.
- estimates, invoices, payments, and projects link back to opportunities.
- `opportunities` has a unique `(company_id, source_thread_key)` constraint that can support one canonical external-intake identity.
- pipeline services already calculate basic pipeline value, opportunity counts, win rate, deal size, and velocity.

The current model is not yet an external API:

- there is no external API credential model;
- there is no intake source or immutable website-submission ledger;
- lead source is coarse and campaign/form/landing-page attribution is not first-class;
- `source_metadata` is not consistently mapped into public lead models or metrics;
- current metrics are internal, often all-time, and are not an externally safe reporting contract;
- existing server-side service-role access bypasses RLS, so an external route cannot rely on browser RLS as its tenant boundary;
- the existing generic rate limiter can fall back to per-instance memory and can fail open, which is not acceptable for this API.

### Current attachment foundation

OPS has two materially different attachment patterns:

- `email-attachments` is private, content-verified, and represented by canonical attachment rows.
- `project-photos` is public and image-specific.

External intake files must follow the private attachment pattern. Public project-photo URLs are not a safe general-purpose foundation for original lead submissions or documents.

The original website submission remains the canonical source for files uploaded with the form. Later photos and files arriving through an associated email conversation remain canonical email attachments and are handled by the existing email engine.

### Market context

Current official public API documentation shows that Jobber, Housecall Pro, and ServiceTitan generally require integrations to read transactional records and derive their own reporting. HubSpot provides the strongest precedent for a separate aggregate analytics surface and dedicated analytics permission.

OPS will keep the useful separation while avoiding broad raw-record access:

- [Jobber API](https://developer.getjobber.com/docs/)
- [Jobber API limits](https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits/)
- [Housecall Pro API overview](https://help.housecallpro.com/en/articles/8505035-api-overview)
- [ServiceTitan authentication](https://developer.servicetitan.io/docs/getting-started/first-api-call)
- [HubSpot analytics breakdowns](https://developers.hubspot.com/docs/api-reference/legacy/reporting/reports/get-analytics-v2-reports-breakdown_by-time_period)
- [HubSpot scope reference](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/scopes)

## 4. Locked product decisions

| Area | Decision |
|---|---|
| Initial consumer | Custom-coded websites with a server component |
| Future consumers | Managed plugins and integration platforms using OAuth |
| Browser access | No reusable OPS secret in browser code |
| Intake shape | Purpose-built submission command, not generic CRUD |
| Customer behavior | Uniquely match and reuse; otherwise create |
| Lead behavior | Every genuine inquiry creates a new lead |
| Retry behavior | An exact retry returns the original result |
| Attachments | Private staged uploads referenced by the submission |
| Attachment failure | The lead still succeeds; file results are itemized |
| Custom questions | Preserved in the original submission |
| Later messages/files | Owned by the existing lead and email engines |
| Lead reporting | All company leads through a privacy-safe projection |
| Default read privacy | No PII, content, addresses, form answers, or attachments |
| Financial data | Separate optional permission |
| Credentials | Intake and analytics use separate server credentials |
| Future authorization | OAuth scopes map to the same capabilities |
| Rate limiting | Durable, shared, route-specific, and fail-closed |
| Metric behavior | Versioned OPS definitions, not client-side reconstruction |

## 5. Scope

### Included

- external credential creation, naming, reveal-once secret delivery, expiry, rotation, revocation, and audit;
- named website/intake sources and forms;
- private direct-upload slots for original-submission photos and files;
- atomic customer matching/creation, lead creation, and intake-ledger creation;
- immutable preservation of the original submission and normalized attribution;
- itemized attachment processing and quarantine;
- normal lead assignment, notifications, and downstream automation;
- company-wide privacy-safe lead feed;
- standardized lead metrics and source breakdowns;
- optional financial analytics scope;
- cursor pagination, incremental synchronization, rate limits, private caching, and versioned errors;
- OpenAPI documentation, copy-paste server examples, and an integration health surface inside OPS;
- required schema, API, security, and metric-definition documentation in the OPS Software Bible.

### Explicit non-goals

- generic external create/read/update/delete access to customers, leads, projects, estimates, invoices, or payments;
- browser-safe public write tokens;
- anonymous public analytics widgets;
- customer PII or message-content exports;
- an external endpoint for later replies, notes, or follow-up attachments;
- attachment download through the analytics API;
- outbound webhooks in the first release;
- arbitrary SQL-like filters, arbitrary JSON field selection, or arbitrary metric formulas;
- editing or deleting a previously accepted intake submission through the API;
- inferring missing campaign data for historical leads.

## 6. Capability and credential model

### Server credential classes

OPS issues two credential classes. A single long-lived server credential cannot combine them.

| Credential class | Allowed scopes | Purpose |
|---|---|---|
| Intake | `intake.write` | Discover its configured intake mapping, create upload intents, submit original inquiries, and reconcile only those submission results |
| Analytics | `analytics.leads.read`, optionally `analytics.financial.read` | Read the pseudonymous lead feed and approved metrics |

`analytics.financial.read` is additive and is invalid without `analytics.leads.read`.

The narrow intake configuration and result reads do not expose customer or lead records. They are part of safely completing the caller's own write command.

Each credential is:

- bound to exactly one OPS company;
- assigned a human-readable name;
- bound to a credential class;
- for intake credentials, restricted to one or more configured intake sources;
- stored only as a hash, with a non-secret visible prefix;
- shown in full exactly once at creation;
- optionally assigned an owner-chosen expiration date;
- rotatable with an overlap window;
- immediately revocable;
- stamped with creator, creation time, last-used time, expiry, and revocation evidence.

The request body never chooses `company_id`. Authentication resolves the company, credential class, scopes, and allowed source IDs before business logic runs.

Analytics credentials are always company-wide because the approved dashboard contract covers all leads. Source, campaign, and form parameters narrow a query; they do not narrow or expand the credential's authorization.

That grant is explicitly high trust. The feed is pseudonymous rather than anonymous: a party that already knows when a form was submitted may be able to recognize the corresponding row. Credential creation therefore warns the owner that `analytics.leads.read` grants server-side row-level lifecycle visibility for every company lead. The credential cannot be placed in public browser code. The optional financial grant carries a second warning that it adds per-lead monetary values and company totals.

### Owner controls

Only company owners or administrators with integration-management authority can create, rotate, expire, or revoke credentials. These actions produce security audit events.

The settings surface shows:

- credential name and class;
- intake source restriction when applicable;
- visible prefix;
- scopes;
- created by and created at;
- last successful use;
- recent rejection count;
- expiry, or no-expiry status, and current status;
- rotate and revoke controls.

The full secret never appears again.

### OAuth compatibility

Future managed plugins receive short-lived OAuth access tokens after an OPS owner grants the same scopes. OAuth clients may request both intake and analytics scopes because the owner sees and approves each capability separately. Refresh-token rotation, client review, redirect validation, and installation lifecycle are part of the plugin authorization layer, not long-lived website keys.

Every server-key family and OAuth installation has a durable authorization principal. Company, scopes, allowed intake sources, idempotency, rate limits, cursors, and cache identity bind to that principal—not to a replaceable key or short-lived access token. Token refresh and key rotation therefore cannot break retries or pagination.

## 7. Conceptual data model

The implementation plan will map these concepts to migrations and guarded database functions. The product contract requires the following durable records.

### `external_api_principals`

Represents the durable authorization grant behind either a server-key family or an OAuth installation:

- company;
- principal type;
- credential class and scopes;
- allowed intake sources;
- owner grant and revocation evidence;
- authorization version/epoch;
- status and lifecycle timestamps.

Rotating credentials or OAuth tokens does not change the principal. Revoking or changing the grant increments its authorization epoch.

### `external_api_credentials`

Stores the credential identity and policy:

- company;
- authorization principal;
- secret hash and visible prefix;
- name, creator, status, expiry, key family, last use, and revocation metadata.

Credential class, scopes, sources, and authorization epoch come from the principal and are not duplicated as independently mutable credential policy. Raw secrets are never stored.

### `lead_intake_sources`

Represents the company-controlled origin of an intake:

- company;
- stable public source ID;
- integration type;
- site label and canonical host;
- one or more configured form identifiers and labels;
- active/revoked state;
- default coarse OPS source;
- optional `default_intake_owner_id`;
- attribution policy and allowed browser origins for temporary upload capabilities.

The authenticated source binding is authoritative. A caller cannot claim to be another configured website through payload fields.

Allowed browser origins are an integration-compatibility and audit policy, not a substitute for the one-object upload capability. Browser CORS can reduce accidental cross-origin use, but non-browser clients can supply an `Origin` header; authorization therefore always comes from the short-lived create-only capability and the source-bound submission claim.

Every source has at least one form. OPS creates a stable `default` form when the website does not distinguish forms, so `form_id` is always explicit rather than nullable.

`default_intake_owner_id` uses the same company-membership, active-user, and assignment-authority validation as a mailbox default owner. It is configuration, never caller input.

### `lead_intake_submissions`

The append-only source ledger for the original inquiry:

- company and intake source;
- stable public submission ID;
- durable authorization principal and the credential used for the request;
- required idempotency-key digest and canonical request hash;
- optional caller-supplied external submission ID digest and protected original reference;
- resulting lead, matched parent-client, matched sub-client, and matched-contact-kind references;
- normalized canonical fields;
- exact custom answers and raw source payload;
- normalized attribution projection;
- customer-match outcome;
- processing outcome and timestamps.

The payload is append-only during normal operation. An audited privacy-erasure process can redact personal content while retaining a non-identifying operational tombstone.

Privacy erasure is a deliberate exception to normal immutability. A durable erasure outbox deletes the original private object and every derived preview/project copy, redacts submission and attachment rows to non-identifying tombstones, and emits the external lead deletion projection. The worker retries until database and storage readback prove every copy is gone. A documented legal hold can delay deletion, but the hold reason, authority, scope, and expiry are audited and cannot silently suppress the request.

### `lead_intake_attachments`

Represents every requested original-submission file:

- company, source, upload intent, and submission;
- safe display filename;
- private storage object reference;
- declared and detected MIME type;
- expected and observed size;
- caller checksum and observed checksum;
- inspection and malware-scan state;
- accepted, rejected, quarantined, expired, or deleted disposition;
- rejection code and processing timestamps.

Storage paths, signed URLs, and scan internals never enter analytics responses.

### `external_lead_handles`

Maps every company lead to a stable opaque public lead ID. It prevents external consumers from receiving internal database IDs and gives historical leads the same reporting contract as new intake leads.

### `external_lead_projection_versions`

Provides an append-only, externally safe version stream:

- company and opaque public lead ID;
- company-monotonic change sequence;
- projection schema version;
- operation: upsert, merge, or deletion tombstone;
- complete allowlisted projection as it existed at that sequence;
- source record update and projection timestamps.

Every change that affects an exposed field appends a version. Full snapshots and incremental synchronization read this immutable sequence rather than paginating mutable `opportunities` rows.

### `external_api_request_audit`

Records principal and credential identity, company, route, request time, outcome, response class, duration, rate-limit result, idempotency result, and a privacy-preserving network fingerprint.

It never records raw credentials, authorization headers, full request bodies, form answers, messages, file contents, or signed URLs.

## 8. External endpoint surface

The stable public contract is:

```text
GET  /v1/intake/config
POST /v1/intake/uploads
POST /v1/intake/submissions
GET  /v1/intake/submissions/{public_submission_id}
GET  /v1/analytics/leads
GET  /v1/analytics/metrics
```

Requests use HTTPS and `Authorization: Bearer <credential>`. Intake bodies use JSON after file bytes have been sent through the temporary upload capabilities. OAuth access tokens use the same bearer scheme.

Externally visible submission, upload, lead, source, form, and cursor identifiers are opaque and unguessable. They never reveal an internal sequential key or raw database ID.

Every response includes:

- a request ID;
- API version;
- server timestamp;
- a documented machine-readable result or error code.

Breaking contract changes require a new major path. Additive fields can be introduced within `v1`, but clients must be able to ignore fields they do not recognize.

## 9. Intake flow

### Step 0: discover the configured mapping

`GET /v1/intake/config` returns only the authenticated principal's active source and form IDs, labels, canonical site host, default ISO phone region, accepted file policy, request limits, and contract version. It returns no customer, lead, submission, or company business data.

Custom websites can persist these stable IDs in server configuration. A managed OAuth installation receives the same mapping in its installation result and can refresh it through this endpoint.

### Step 1: create upload intents

The website backend calls `POST /v1/intake/uploads` with metadata for the files selected on the original form:

- an `Idempotency-Key` header in the upload-batch namespace;
- required configured `source_id` and `form_id`;
- a caller-stable file ID within the batch;
- safe client filename;
- byte size;
- declared content type;
- SHA-256 checksum when the website can calculate it.

OPS validates the batch and returns one narrowly scoped, short-lived upload capability and opaque upload ID per eligible file.

The credential remains on the website server. A website may pass the temporary one-object upload capability to its browser so the browser can upload directly, but that capability:

- permits one object and one method;
- has a short expiry;
- enforces the declared upper size;
- is bound to the company, source, and upload intent;
- uses an unpredictable create-only object name;
- cannot list, read, replace, or delete any object.

A normal reusable presigned `PUT` is insufficient. On S3, OPS uses a SigV4 `PutObject` capability that signs the exact content length and `If-None-Match: *`, while bucket policy independently denies writes without the create-only condition. An authenticated streaming gateway is the fallback if real-browser verification cannot prove those constraints. S3 POST policy alone is not selected because its content-length range does not supply the required conditional create-only write. If the selected path cannot guarantee create-only, one-use, content-length-bounded uploads, it cannot be used directly.

Unclaimed upload objects expire after 24 hours and are deleted automatically.

Cleanup never removes the current object or creates a delete-marker gap while its upload capability can still be valid. The current quarantined object remains the `If-None-Match: *` blocker until capability expiry plus clock-skew margin; only then are all versions removed. A rejected or erased object becomes unreadable immediately, but deletion cannot make the original capability reusable.

The idempotency manifest includes the authorization principal, source, form, and ordered file metadata. An exact upload-batch replay returns the same upload IDs and current states. When an intent is still open and has no object, OPS may issue a fresh short-lived capability for the same immutable target. A different manifest under the same key returns `409 idempotency_conflict`. An expired batch returns `410 upload_batch_expired` and requires a new batch key. Per-file acceptance and rejection are stable on replay, so a timeout cannot create duplicate intents or consume quota twice.

### Step 2: upload privately

The file is written to a private quarantine location. Upload completion does not make it readable inside OPS. OPS records the exact immutable object version, observed byte count, and checksum before inspection.

OPS verifies:

- actual size;
- actual file signature and MIME type;
- checksum when supplied;
- extension/MIME consistency;
- archive and active-content policy;
- malware scan result.

The first-release allowlist covers common trade intake formats:

- JPEG, PNG, WebP, HEIC, and HEIF images;
- PDF;
- plain text and CSV;
- DOC/DOCX;
- XLS/XLSX;
- DWG and DXF trade drawings as private download-only files.

Executables, scripts, HTML, SVG, archives, password-protected documents, macro-enabled office files, and format mismatches are rejected. A batch may contain at most 10 files, each file may be at most 25 MiB, and the batch may be at most 50 MiB.

### Step 3: submit the inquiry

The website backend calls `POST /v1/intake/submissions` with:

- an `Idempotency-Key` header;
- configured source and form reference;
- contact name and at least one reply method: email or phone;
- optional organization name, ISO phone region, service address, requested work summary, preferred timing, and canonical form fields;
- arbitrary custom questions and answers;
- attribution data;
- the opaque upload IDs;
- an optional stable external submission ID.

OPS derives the authoritative company and allowed source from the credential. It normalizes and validates the payload, then executes the core database command atomically.

Every referenced upload intent must carry the same source and form as the submission. A cross-source upload ID returns `source_not_allowed`; a cross-form upload ID returns `form_not_allowed`. Neither is ever rebound.

The JSON body is capped at 256 KiB. The `answers` collection permits at most 100 entries. Each entry has a stable field key, human-readable label, and a bounded string, number, boolean, date, single-choice, or string-list value. Nested objects, binary data, executable markup, and file contents are not accepted in `answers`.

### Step 4: create the operational records

In one transaction, OPS:

1. locks the idempotency identity;
2. creates the immutable intake ledger row;
3. matches or creates the customer and contact relationship;
4. creates a fresh lead;
5. creates the externally safe lead handle;
6. atomically closes every referenced upload intent, claims each uploaded intent once, and binds its exact immutable object version and checksum to the submission;
7. records the source and attribution projection;
8. writes the durable outbox event that drives normal assignment, notification, and automation after commit.

If the core transaction fails, it creates none of these records.

The upload-intent state machine is `issued → uploaded → claimed → pending_inspection → accepted/rejected`, with terminal `closed_missing` and `expired` paths. Inspection may begin while an uploaded object is still unclaimed, but it cannot become visible until a submission claims it. A successful submission changes a referenced but not-yet-uploaded intent to `closed_missing` and invalidates its capability. An intent cannot be claimed by another submission, reused after expiry, or replaced after claim. A late or replacement object is left quarantined and deleted; it can never become an accepted attachment.

### Step 5: process files independently

Verified clean files become visible to authorized OPS users on the lead. Files still being scanned remain quarantined. Rejected files remain itemized in the submission result but are never exposed to an operator as trusted content.

If file inspection or malware scanning is temporarily unavailable, lead creation still succeeds and the file remains `pending_inspection` in quarantine while OPS retries with bounded backoff. OPS never treats scanner unavailability as a clean result.

The initial response reports each file as:

- `accepted`;
- `pending_inspection`;
- `rejected`;
- `missing`;
- `expired`.

The lead response is successful even if every file fails. Inspection has a maximum 24-hour window. A file still unscanned at that deadline becomes terminal `rejected` with safe code `inspection_unavailable`; its binary is deleted within the following 24 hours. Other rejected and terminally unsafe quarantined binaries are deleted within 24 hours after the non-content audit evidence is retained.

A malware-clean document is still untrusted active content. PDF, CSV, Office, DWG, and DXF files are delivered from an isolated cookieless origin with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`. OPS provides no inline preview unless a format-specific sanitizer or sandboxed isolated renderer produces a safe derivative. Inline images are decoded and re-encoded with metadata removed before display; the original remains private and download-only.

### Intake response

A first successful submission returns `201 Created` with:

- stable public submission ID;
- stable public lead ID;
- customer outcome: `created`, `matched`, or `created_possible_duplicate`;
- lead creation time;
- initial lead stage;
- itemized attachment states;
- a single-purpose authenticated-encrypted email correlation marker when the configured source mirrors notification email;
- request ID.

An exact replay returns `200 OK`, `replayed: true`, the original core outcome and identifiers, and the current attachment states. It never emits a second assignment or notification event.

### Submission status reconciliation

`GET /v1/intake/submissions/{public_submission_id}` lets the creating authorization principal reconcile only its own command result. It returns:

- public submission and lead IDs;
- creation time and replay-safe customer outcome;
- current attachment states and safe rejection codes;
- whether attachment processing is terminal.

It never echoes contact data, form answers, message content, customer data, lead content, storage references, or files. While an attachment is `pending_inspection`, the response provides bounded polling guidance. Once every attachment is terminal, no polling is required.

An unknown submission ID and a submission owned by another principal both return the same `404 submission_not_found` response.

## 10. Customer matching and lead identity

### Matching rules

OPS normalizes:

- email by validated address and case-insensitive canonical comparison;
- phone to an E.164-compatible canonical form where the supplied country context permits;
- human and company names for comparison only, never as a sole identity match.

Customer identity spans both `clients` and `sub_clients`. A `client` is the parent customer record; a `sub_client` is a person/contact under that customer.

OPS checks active, non-deleted identifiers across both tables:

- an exact match on a client links that client as both customer and contact;
- an exact match on a sub-client links its parent client as the customer and the sub-client as the contact;
- when an organization name is supplied but no safe match exists, OPS creates a parent client for the organization and a sub-client for the named contact;
- when no organization name is supplied and no safe match exists, OPS creates the named person as the client;
- when all exact identifier matches resolve to one parent customer and one unambiguous contact, OPS reuses both.

OPS reuses an existing customer only when the submitted identifiers resolve to one unambiguous customer/contact outcome within the authenticated company.

Canonical writes are:

- with an organization, `clients.name` receives the organization name; the named person, email, and phone belong on a `sub_clients` contact;
- without an organization, the named person and contact fields belong on `clients`, with no redundant sub-client;
- an existing sub-client match reuses its parent as `opportunities.client_id`, stores the exact sub-client relationship on the intake ledger, and snapshots that contact into the opportunity contact fields;
- a direct client match uses that client and snapshots its contact fields;
- a service address always maps to `opportunities.address`; it never updates either client or sub-client address automatically.

The intake ledger retains `matched_client_id`, nullable `matched_sub_client_id`, and `matched_contact_kind` because `opportunities` has no durable sub-client foreign key.

The source configuration supplies a default ISO phone region. A request may override it with a valid ISO 3166-1 alpha-2 region. A number with an explicit international prefix is normalized independently. A local-format number without reliable region context is preserved on the intake but is not used as a matching key.

OPS never:

- matches across companies;
- merges on name alone;
- overwrites an established non-empty customer field with unauthenticated form data;
- replaces an existing customer address with a service-location answer;
- silently combines two customers when email and phone point to different records.

If identifiers conflict, span different parent customers, or produce multiple contacts, OPS creates a separate customer/contact structure, marks it as a possible duplicate for internal review, and still creates the lead. This protects the inquiry without corrupting an existing customer.

When an existing customer/contact is uniquely matched, blank fields may be filled only on the matched entity and only with validated values that do not conflict. Contact data never silently moves from a sub-client onto its parent client. All submitted values remain preserved on the intake ledger regardless of whether they update the directory.

Matching is concurrency-safe across different inquiries. Before the final lookup, the transaction acquires deterministic company-scoped locks for every normalized email and phone identity key in sorted order, then repeats the match under lock. Two simultaneous genuine inquiries for the same new person can therefore create two leads while sharing one newly created customer.

### Idempotency rules

`Idempotency-Key` is required and is unique within the durable authorization principal.

- Same key and same canonical request hash: return the original result.
- Same key and different canonical request hash: return `409 idempotency_conflict`.
- Concurrent same-key requests: one transaction wins; all others return its result.
- Same customer and different idempotency key: create a new lead.
- Same content and different idempotency key: create a new lead unless the caller also repeats a unique external submission ID.
- Same source, same external submission ID, and same canonical request hash: return the original result even if the transport idempotency key changed.
- Same source and external submission ID with different content: return `409 external_submission_conflict`.

OPS does not use fuzzy contact, timestamp, IP, or message similarity to suppress a genuine inquiry.

Idempotency and external-submission identities are retained for the life of the operational submission ledger. Expiring or rotating a credential does not expire replay protection.

OPS stores a keyed digest of bounded idempotency and external-submission values, not the caller strings used for lookup. The protected original submission may preserve the external reference as submitted, subject to normal privacy erasure.

Each digest records its key version. Key rotation adds a new active writer but retains every historical lookup key for as long as a submission/upload/tombstone references it; a referenced key cannot be retired. Credential rotation therefore cannot convert an old retry into a fresh inquiry, and missing historical key material fails closed rather than bypassing replay detection.

The canonical request hash is explicitly versioned and covers:

- authorization principal, authenticated company, effective source, and form;
- normalized canonical contact and inquiry fields;
- typed custom answers ordered by stable field key, with unordered list values normalized;
- normalized attribution values;
- upload IDs ordered by caller-stable file ID;
- the external submission ID digest.

JSON property order, transport whitespace, rotating credential material, request time, upload capability, and asynchronous scan state do not affect the hash. A canonicalization-version change cannot reinterpret an existing ledger row.

## 11. Source and attribution contract

Every lead has a normalized source projection, whether it entered through this API, email, referral, phone, social, walk-in, repeat business, manual entry, or another supported source.

The normalized model includes:

- source channel;
- source integration type;
- authenticated intake source ID and label when applicable;
- site host and label;
- form ID and label;
- OPS-stable campaign handle and owner-approved display label;
- source-scoped opaque handles for `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, and `utm_content`;
- approved safe display labels for UTM dimensions when available;
- presence booleans for every captured attribution dimension;
- allowlisted click-provider code and a boolean indicating whether a click ID was captured;
- landing-page host, opaque path handle, and optional approved route label;
- referrer host, opaque path handle, and optional approved route label;
- canonical inquiry-received timestamp, lead-created timestamp, and attribution-captured timestamp;
- timing-source and timing-quality flags.

Raw UTM values, click IDs, and URL paths are stored only in protected intake evidence and are not returned directly by analytics. Landing and referrer URLs are normalized before analytics exposure: user information, fragments, query strings, and non-approved parameters are removed; the remaining path becomes a source-scoped opaque handle. The original source payload remains protected on the intake ledger.

Source, site, and form IDs are OPS-configured and authoritative. Campaign data is observed attribution, not authorization evidence. OPS derives stable keyed handles inside the authenticated source namespace from normalized UTM/campaign values; a caller-supplied external campaign ID is stored as untrusted source evidence and cannot select another source or company's campaign.

An analytics display label comes only from an OPS-managed attribution dictionary, never directly from an individual lead payload. Candidate labels are length-bounded, control-character stripped, restricted to safe text, checked for email/phone/URL and other direct-identifier patterns, and JSON encoded. Unsafe or unapproved values return only the opaque handle and presence flag. Website dashboards must output-encode all labels. This allows stable grouping without turning attacker-controlled UTM text into customer PII or executable content.

Attribution completeness is not an opaque score. Each projection reports explicit booleans for known channel, authenticated site, configured form, observed campaign, UTM set, landing page, and referrer. Metrics return the count and percentage present for each characteristic, with website-specific fields evaluated only across website-source leads.

For historical leads, OPS backfills the stable public handle and maps only source data already supported by evidence. Missing website, form, campaign, and UTM characteristics remain `null`. OPS does not invent attribution.

`inquiry_received_at` is when the business first received the inquiry, not necessarily when OPS later created the lead. For API submissions it is OPS's authenticated request-receipt time. For email it is the validated provider message time, bounded against ingestion time. For a manually entered phone, walk-in, or referral lead it is the explicit received time when supplied, otherwise lead creation time. The timing-quality flag identifies exact, provider-derived, manual, and creation-time fallback values.

## 12. Email and downstream lifecycle

The intake API owns only the original submission.

After lead creation:

- the normal OPS assignment rules run;
- the normal lead-created notification appears;
- the lead engine can summarize and enrich the submission;
- an operator or automation can respond through the existing email engine;
- replies, later photos, and later documents are captured from the associated email thread by existing email attachment infrastructure;
- normal stage, disposition, estimate, conversion, project, invoice, and payment behavior continues.

The API does not append later messages or attachments.

The external caller cannot choose an assignee or embed a user ID in a submission. A configured intake source may have a company-validated `default_intake_owner_id`. Lead creation assigns that owner atomically with assignment source `external_intake_default` when the user remains active and authorized.

If no default owner exists or the configured owner is no longer eligible, the lead enters the company-wide unassigned queue. The unassigned-delivery outbox must support `source_kind = external_intake` and the intake source ID instead of requiring an email connection. It notifies users who have assignment authority and cannot allow the lead to disappear merely because ordinary Operators can see only assigned leads.

An API submission receives a deterministic `source_thread_key` in the external-intake namespace. When an integration also sends a notification email, it must either disable email-based lead creation or include an OPS-issued, cryptographically authenticated and encrypted correlation marker so the email importer can validate the company, mailbox, and submission before attaching the message. The marker exposes no readable internal identity. The importer never links email from a plain public lead or submission ID. An uncorrelated duplicate notification email cannot be assumed to represent the same inquiry.

On lead-to-project conversion:

- original intake attachments remain linked to the immutable intake submission;
- clean photos can be projected idempotently into the project's authorized photo model;
- clean documents can be linked through a private generic project-file relationship;
- projection never changes or deletes the source attachment record.

Projection cannot make an intake file public. The current public project-photo bucket is not used unchanged for this purpose.

## 13. Privacy-safe pseudonymous lead feed

`GET /v1/analytics/leads` returns all company leads through an explicit allowlist. It includes open, won, lost, discarded, archived, and merged/tombstone states so an external dashboard can reconcile its local analytics.

Hard-deleted personal content is never returned. A non-identifying deletion tombstone remains available for 30 days so incremental consumers can remove the record from their cache.

The feed is not claimed to be anonymous. Stable IDs, source characteristics, and lifecycle timing can be correlated with information the credential holder already possesses. It is therefore server-only, explicitly owner-authorized, audited, and treated as pseudonymous company data.

### Allowed default fields

Each lead row can contain:

- opaque public lead ID;
- inquiry-received, created, updated, current-stage-entered, and terminal timestamps;
- current stage;
- canonical lifecycle disposition code, never free-text disposition notes;
- record state: active, archived, merged, or deleted tombstone;
- public merge-target lead ID when the record was merged;
- normalized source and attribution characteristics from Section 11;
- first-response timestamp and elapsed minutes;
- won, lost, disqualified, discarded, and project-converted timestamps;
- elapsed minutes to decision, win, and project conversion;
- flags indicating whether the lead reached each canonical funnel stage;
- source-data completeness flags.

Lifecycle timestamps are returned at minute precision. A deletion tombstone contains only the public lead ID, operation, and deletion time.

### Excluded default fields

The default lead feed never contains:

- internal customer, lead, user, company, email-thread, or storage IDs;
- customer or contact names;
- email addresses or phone numbers;
- street addresses or precise locations;
- inquiry summaries, messages, notes, custom answers, or email content;
- filenames, file types, attachments, storage paths, or signed URLs;
- assignee identity, employee identity, or mailbox identity;
- raw click IDs, raw referrer URLs, arbitrary request metadata, or arbitrary `source_metadata`;
- estimates, invoices, payments, or monetary values.

Unknown database columns are excluded automatically because the response is constructed from an explicit versioned allowlist. A new internal column never becomes externally visible by accident.

### Financial enrichment

With `analytics.financial.read`, the same lead row may additionally contain:

- estimated lead value;
- won value;
- invoiced total attributable to the lead;
- paid total attributable to the lead;
- currency.

It still excludes invoice line items, payment methods, invoice/customer identifiers, tax details, and documents.

Per-lead invoiced and paid totals use the same deletion, status, void, attribution, and currency rules defined for metrics in Section 14, accumulated through `data_through`.

### Pagination and incremental sync

The feed is backed by the append-only projection-version sequence from Section 7.

A full synchronization:

- defaults to 100 rows;
- permits at most 250 rows per page;
- captures a company-monotonic high-water sequence on the first page;
- selects the latest immutable projection version at or before that high-water mark for every lead;
- sorts the resulting stable snapshot by public lead ID;
- returns an opaque page cursor and, only on the terminal page of an unfiltered full synchronization, an opaque `next_sync_checkpoint`;
- supports bounded one-off snapshot filters for inquiry-received range, update range, source ID, campaign ID, form ID, stage, disposition, and record state;
- never accepts arbitrary field names, labels as authorization evidence, or raw JSON predicates.

A filtered snapshot omits `next_sync_checkpoint`; its cursor is valid only for paging that stable filtered snapshot. An incremental synchronization starts from the last committed unfiltered checkpoint. OPS returns immutable projection events after that sequence in sequence order, up to a newly captured high-water mark. A lead can appear more than once if it changed more than once; consumers upsert by public lead ID and apply merge or deletion operations in order. Incremental mode cannot be combined with business-field filters because a record moving out of a filter must not disappear silently.

Paginated incremental runs also return `next_sync_checkpoint` only on the terminal page. A consumer must finish and durably apply the entire full or incremental scan before replacing its prior checkpoint. It must not apply deltas before its baseline scan completes or advance after an intermediate page; doing either can skip unread events or let an older baseline overwrite newer state.

Page cursors and checkpoints encrypt and authenticate the authorization principal, authorization epoch, company, scopes, projection version, filters, sort, and high-water sequence. Their serialized form exposes no readable internal identity or sequence. They cannot be replayed with another principal, grant version, company, filter set, or API version.

The latest baseline projection for every retained lead remains available for full synchronization. Projection changes and deletion tombstones remain in the incremental stream for 30 days. Full-snapshot page cursors expire after one hour, and all versions needed by a valid cursor remain queryable for that lifetime. A checkpoint older than the retained sequence returns `410 sync_checkpoint_expired`; the consumer must perform a new full synchronization. Timestamp-only checkpoints are not accepted.

## 14. Standardized metrics

`GET /v1/analytics/metrics` returns precomputed definitions, not raw records disguised as a report.

### Metric catalog

Default lead analytics can request:

- leads received;
- cohort active lead count;
- cohort discarded lead count and discard rate;
- cohort current-stage distribution;
- cohort outcome distribution;
- cohort disqualified count and rate;
- project-converted count and rate;
- stage-reached funnel counts and rates;
- cohort decided lead count;
- cohort won count, lost count, and decided win rate;
- first-response coverage;
- median first-response minutes;
- median time to decision;
- median time to win;
- median time to project conversion;
- intake submissions accepted, rejected, and replayed;
- customers created and customers matched by external intake;
- source-attribution completeness;
- lifecycle-evidence completeness.

There is no opaque “source quality score.” A dashboard receives the underlying counts, rates, and timing evidence so the business meaning remains visible.

With `analytics.financial.read`, it can also request:

- cohort open estimated value;
- cohort won value;
- cohort average won value;
- invoiced event total;
- paid event total;
- currency.

### Definitions

- **Received-in-period cohort:** canonical non-merged leads with `inquiry_received_at` in the half-open requested interval. Archived leads remain included because they were genuine leads. Unless a metric explicitly says event-dated, all “cohort” metrics use this population and inspect its authoritative state at `data_through`.
- **Leads received:** size of the received-in-period cohort.
- **Cohort active leads:** cohort leads that are not archived and do not have a terminal won, lost, disqualified, discarded, merged, deleted, or converted-to-project outcome at `data_through`.
- **Cohort discarded leads and rate:** cohort leads discarded by `data_through`; rate is discarded divided by leads received.
- **Cohort current-stage distribution:** the cohort's authoritative stage at `data_through`. It is a current snapshot of a received cohort, not a reconstruction of historical daily stage inventory.
- **Cohort outcome distribution:** a mutually exclusive reconciliation of the cohort at `data_through`: active, archived unresolved, won, lost, disqualified, discarded, converted without a won/lost outcome, or deleted. Won/lost takes precedence over project conversion; merged duplicates are excluded from the canonical cohort.
- **Cohort disqualified count and rate:** leads with the distinct disqualified disposition divided by leads received. Disqualified is not collapsed into discarded or loss.
- **Project-converted count and rate:** cohort leads with a canonical project-conversion event divided by leads received. This lifecycle event can overlap won or lost and is therefore reported independently from the mutually exclusive outcome distribution.
- **Cohort decided leads:** cohort leads won or lost by `data_through`.
- **Cohort decided win rate:** won divided by `won + lost`; open and discarded leads are excluded from the denominator.
- **Stage-reached funnel:** for each cohort lead, stages supported by atomic transition or terminal lifecycle evidence. Pre-launch records with incomplete history contribute only to evidenced stages and are reported with `known_count`, `unknown_count`, and evidence coverage; OPS does not infer skipped historical transitions.
- **First response:** the earliest qualifying outbound correspondence sent by a person or a configured substantive automation after `inquiry_received_at`. Delivery receipts, internal notes, manual `handled_at`/WAITING markers, and automated receipt acknowledgements do not count.
- **Median first-response time:** median elapsed time among cohort leads with a qualifying response. Qualifying-response count, eligible lead count, and evidence coverage accompany the median.
- **Median time to decision:** median elapsed time from `inquiry_received_at` to the first authoritative won or lost transition.
- **Median time to win:** median elapsed time from `inquiry_received_at` to the first authoritative transition into won. Project conversion is not a substitute for winning.
- **Median time to project conversion:** median elapsed time from `inquiry_received_at` to the canonical project-conversion event, whether that conversion happened before, with, or after a won transition.
- **Cohort open estimated value:** sum of current estimated value at `data_through` for cohort leads that remain active.
- **Cohort won value and average:** `opportunities.actual_value` at `data_through` for cohort leads won by then; missing actual values are excluded and disclosed. Average is the included value divided by cohort won leads with an actual value. Approved estimates are not silently substituted.
- **Invoiced event total:** `invoices.total` where `deleted_at IS NULL`, `status NOT IN ('draft', 'void')`, and `issue_date` is in the company-local date interval. This intentionally includes `written_off`.
- **Paid event total:** `payments.amount` where `voided_at IS NULL`, the parent invoice is non-deleted and not `void`, and `payment_date` is in the company-local date interval. Deposits are included only once through their canonical payment record.

Financial attribution first uses `invoices.opportunity_id`. Otherwise it resolves the canonical project through `COALESCE(invoices.project_ref, invoices.project_id)` and uses `projects.opportunity_ref`. A record reachable through both paths is counted once. Ambiguous or missing attribution is excluded and reported through included and unattributed counts.

Source, campaign, and form grouping uses the canonical source projection as of `data_through`. Every financial result uses `companies.currency_code`. If records can contain different currencies, OPS returns separate currency groups and never sums them through an implicit exchange rate.

Every metric result carries:

- metric ID and definition version;
- basis: received cohort, current snapshot, or event-dated;
- population description;
- value and unit;
- numerator, denominator, included count, and missing-evidence count where applicable;
- grouping key and label;
- currency where applicable;
- suppression and evidence-coverage metadata.

### Required lifecycle evidence

Before external metrics launch, every supported lead-stage, disposition, win/loss, archive, merge, and project-conversion mutation must append canonical lifecycle evidence in the same database transaction. Existing non-atomic web mutation paths must move behind those guarded commands.

Qualifying correspondence events must record a response classification and an explicit `counts_as_first_response` decision. Existing `is_meaningful` and `handled_at` fields are not sufficient to distinguish a substantive automated reply from a receipt acknowledgement. Historical rows without the required evidence remain unknown and reduce the returned coverage; OPS does not infer certainty.

Metric semantics are versioned. Clients can pass `definition_version`; omitting it selects the current version. Every superseded definition version remains callable until its individually published sunset, no earlier than 12 months after its replacement. Multiple superseded versions can coexist during their own windows. An incompatible definition change receives a new metric ID or API major version rather than silently changing an existing pinned result.

### Time and grouping

The default range is the previous 30 calendar days. Presets cover 7, 30, and 90 days. A custom detailed request can cover at most 366 days.

A `lifetime` preset returns a fixed ungrouped summary and a source summary through `data_through`. It does not permit daily time buckets, campaign breakdowns, or form breakdowns across unlimited history.

Presets and date-only inputs resolve to midnight in the company's IANA timezone. Invoice `issue_date` and payment `payment_date` are database `DATE` values, so a request containing either financial event metric must use company-local midnight boundaries or date-only values. OPS applies `event_date >= from_local_date AND event_date < to_local_date`. A non-midnight custom timestamp with those metrics returns `422 date_alignment_required` instead of silently widening or truncating the interval.

Every response returns:

- half-open `from` and `to` timestamps;
- the company's canonical IANA timezone;
- `generated_at`;
- `data_through`;
- `metric_definition_version`;
- currency when financial data is present;
- included metric names and denominators.

Grouping supports:

- day, week, or month;
- source;
- campaign;
- form.

Received-cohort time buckets use `inquiry_received_at`; invoice and payment totals use their documented event dates. A request may use one time bucket plus one source dimension. It cannot create unlimited high-cardinality combinations. Counts remain available for small groups, while derived rates, medians, and financial aggregates are suppressed when the cohort is under five.

## 15. Security and tenant isolation

### Authentication

- Secrets use at least 256 bits of cryptographically secure entropy.
- Only hashes are stored.
- Authentication uses constant-time comparison.
- Authorization resolves the company and scopes before input-controlled record access.
- New credential, intake, audit, and projection tables live in a private schema or use enforced RLS with `PUBLIC`, `anon`, and `authenticated` table access revoked.
- Fixed database commands use a fixed safe `search_path`, fully qualified objects, minimal explicit grants, and no dynamic SQL from request values.
- Service-role database access is wrapped by fixed company-bound commands and projections.
- Each business transaction revalidates the authorization principal's status, epoch, credential class, scopes, company, and allowed intake source inside the transaction.
- No public route accepts a company ID as authorization evidence.

### Durable rate limits

Production rate limiting uses a durable shared store. It does not use per-process memory as a security fallback.

Initial published limits are:

| Route | Principal limit | Company limit |
|---|---:|---:|
| Intake config/status | 60/minute, burst 10/10 seconds | 10,000/day |
| Intake submissions | 60/minute, burst 10/10 seconds | 10,000/day |
| Upload intent batches | 30/minute, burst 10/10 seconds | 5,000/day |
| Lead feed | 30/minute, burst 10/10 seconds | 5,000/day |
| Metrics | 30/minute, burst 10/10 seconds | 5,000/day |

When the durable limiter is unavailable, protected routes return `503 rate_limit_unavailable`. They do not fail open.

Rate-limit responses include retry timing and remaining quota without exposing other credentials or company activity.

File protection also enforces rolling resource quotas:

- 1 GiB uploaded per company in 24 hours by default;
- at most 100 unclaimed or pending objects per company;
- at most five concurrent attachment inspections per company;
- the 50 MiB per-submission limit from Section 9.

Higher byte or concurrency quotas require an explicit company limit and cost review. The API rejects excess before issuing an upload capability.

The idempotent upload-batch transaction atomically reserves the declared bytes and object slots before returning capabilities. A replay reuses the same reservation. When bytes arrive, declared capacity converts to actual 24-hour consumption and only the unused difference is released; consumed bytes age out of the rolling window rather than being freed by claim. Expiry without upload releases the full reservation. Pending-object slots reconcile on claim and terminal processing. Concurrent batches cannot all pass a read-before-reserve check. Scan workers acquire the concurrency slot through the same durable quota system and release it on every terminal path.

Invalid and malformed authorization attempts are throttled before normal credential processing using a durable limit keyed by a rotating privacy-preserving network fingerprint and the presented non-secret token prefix. This protects the authentication path without storing attempted secrets.

### Input and content safety

- Strict request-size limits apply before JSON parsing.
- Unknown top-level intake fields are rejected; arbitrary form answers live only in the bounded `answers` collection.
- All strings have length, encoding, and control-character limits.
- URLs are parsed and normalized; they are never fetched during intake.
- File inspection uses bytes, not the caller's extension or MIME claim.
- Attachments remain quarantined until clean.
- Upload capabilities are create-only, one-object, one-use, content-length-bounded, and short-lived.
- Logs and traces redact authorization, contact, message, form-answer, URL-query, and upload data.

### Revocation and rotation

Revocation takes effect before the next protected command or response. Every request validates the principal's current authorization epoch before any response-cache lookup. Cache keys contain that epoch, so a stale key cannot serve data even if explicit invalidation is delayed.

Rotation creates a new secret under the same authorization principal. The owner can choose an overlap window up to 24 hours, after which the prior secret is revoked automatically. Idempotency identities remain stable across the principal so a deployment retry cannot create duplicate leads.

An already issued browser upload capability may remain cryptographically usable until its short expiry. Submission claim revalidates the current principal and source inside the transaction; content uploaded after revocation remains quarantined, cannot attach, and is deleted as an orphan.

### Audit and alerts

OPS audits:

- credential create, rotate, expire, revoke, and failed-use events;
- scope denials;
- cross-source and cross-company access attempts;
- idempotency conflicts;
- rate-limit denials and limiter outages;
- file rejection and quarantine outcomes;
- analytics request metric set, grouping, and result size;
- privacy erasure and tombstone creation.

Repeated authentication failures, cross-tenant attempts, or hostile upload patterns create an owner-visible security event without exposing submitted content in the notification.

Network fingerprints use an HMAC under a rotating server secret, never a plain IP hash. They are retained for 30 days, are readable only by the restricted security-audit path, and are deleted on schedule. Audit rows are append-only to application roles; payload and file tables are not readable through the audit surface.

## 16. Caching and freshness

Intake commands and submission-status responses are never response-cached.

Analytics caches are private and server-side:

- 60 seconds for the lead feed and ranges under 90 days;
- up to five minutes for metric requests covering 90–366 days or `lifetime`.

The cache key includes:

- authorization principal and current authorization epoch;
- company;
- scopes;
- endpoint and API version;
- metric-definition version;
- filters, groupings, projection high-water sequence, time window, and timezone.

It never contains the raw secret. Responses use private cache directives and never shared public caching. Revocation changes the authorization epoch before the next lookup and invalidates principal-specific cache entries.

`data_through` tells the website exactly how current the source data is.

## 17. Error contract

Errors use a stable envelope with request ID, HTTP status, machine-readable code, safe message, and field/file-level details when appropriate.

Core codes include:

- `invalid_credentials`;
- `credential_expired`;
- `credential_revoked`;
- `insufficient_scope`;
- `source_not_allowed`;
- `form_not_allowed`;
- `invalid_request`;
- `idempotency_conflict`;
- `external_submission_conflict`;
- `submission_not_found`;
- `upload_not_found`;
- `upload_expired`;
- `upload_batch_expired`;
- `upload_rejected`;
- `rate_limited`;
- `rate_limit_unavailable`;
- `cursor_invalid`;
- `sync_checkpoint_expired`;
- `range_too_large`;
- `date_alignment_required`;
- `definition_version_unsupported`;
- `temporarily_unavailable`;
- `internal_error`.

Validation errors do not expose internal table, storage, policy, function, or provider names.

The submission response distinguishes:

- core failure: no customer, lead, or submission created;
- core success with attachment exceptions: lead created and each file outcome reported;
- exact replay: original result returned with no repeated side effects.

Metric suppression is a successful response with a per-cell `suppressed: true` marker and cohort count. It is not an API error.

## 18. Operational behavior and observability

Track and alert on:

- credential use, failures, expiry, rotation, and revocation;
- intake acceptance, validation rejection, idempotent replay, conflict, and latency;
- customer match, creation, and possible-duplicate outcomes;
- lead creation and post-commit event delivery;
- attachment upload, expiry, inspection, rejection, scan latency, and quarantine;
- assignment and notification delivery;
- analytics request volume, latency, page size, cache hit rate, and suppressed cohorts;
- durable rate-limiter health;
- cross-tenant denial proof;
- metric query correctness and freshness lag;
- orphan uploads and failed source-to-project attachment projections.

Post-commit events use an outbox or equivalent durable delivery mechanism. A transient notification or enrichment failure does not undo the lead, and retries cannot repeat business records.

## 19. Rollout shape

This is one product initiative with two independently permissioned backend surfaces.

### Foundation

- durable authorization principal, credential, source, audit, idempotency, safe public lead handle, projection-version, and attachment-ledger schema;
- company-bound guarded database commands and projections;
- durable fail-closed rate limiting;
- source normalization and historical public-handle backfill;
- atomic lifecycle and response-classification evidence;
- append-only privacy and erasure behavior.

### Intake

- upload intent and quarantine processing;
- safe intake configuration and submission-status reconciliation;
- atomic submission command;
- customer matching and possible-duplicate handling;
- lead lifecycle event bridge;
- integration health and credential controls;
- API documentation and server examples.

### Analytics

- company-wide pseudonymous lead projection;
- stable snapshot pagination and incremental sync;
- standardized metric service and definitions;
- financial-scope enrichment;
- private caching and cohort suppression;
- analytics examples and dashboard guidance.

### Managed plugins

- OAuth authorization layer;
- platform-specific installation and mapping;
- the same intake payload, lead projection, metric definitions, and scopes;
- no plugin-specific fork of lead creation or reporting semantics.

Initial availability is company-flagged. Pilot companies receive explicit source configuration and integration validation. General availability follows security, load, tenant-isolation, and metric-definition proof.

Historical backfill creates public lead handles and maps evidence already present. It does not alter lead ownership, stage, customer linkage, source evidence, or financial records.

## 20. Cost gate

The design introduces variable operating costs:

- private object storage and retention;
- upload and attachment-download bandwidth;
- upload inspection and malware scanning;
- background processing and function execution;
- durable rate-limit storage and requests;
- analytics query, cache, and database load;
- audit retention and observability.

No new paid vendor or service tier is selected by this design, and no implementation cost is assumed to be free. Before implementation chooses a scanner, durable limiter, cache, or storage-tier change, OPS must compare current contracted capacity with expected lead/file volume and present exact current pricing and expected monthly cost for approval.

## 21. Verification matrix

### Credentials and authorization

- intake credentials cannot call analytics;
- analytics credentials cannot submit leads or create upload intents;
- analytics without financial scope cannot receive monetary fields or metrics;
- financial scope cannot exist without lead analytics scope;
- intake principals can use only their bound company and allowed intake sources;
- analytics access is an explicit company-wide pseudonymous row grant and cannot cross companies;
- intake configuration and submission-status reads return only the creating principal's safe command metadata;
- revoked and expired credentials fail immediately;
- rotation overlap and automatic retirement work;
- server-key rotation and OAuth token refresh preserve the durable authorization principal;
- raw secrets never appear in database, logs, errors, traces, or audit rows;
- private/RLS tables, grants, fixed `search_path`, and in-transaction principal revalidation withstand direct service-role misuse tests.

### Atomicity and idempotency

- customer/contact, lead, intake ledger, public handle, source projection, and outbox event commit together;
- forced failure at every transaction boundary leaves no partial core record;
- simultaneous same-key submissions produce one lead;
- same-key/different-body submissions conflict;
- upload-batch timeout and replay return the same intents without consuming quota twice;
- upload and submission source/form identities must match and cannot cross configured sources;
- credential rotation does not break replay safety;
- repeated genuine inquiries from the same customer create separate leads;
- post-commit retries do not duplicate assignments or notifications.

### Customer matching

- matching is company-scoped;
- exact client and sub-client identifiers resolve the correct parent customer and contact;
- an organization with a new contact creates a parent client and sub-client atomically;
- one unique email or region-safe phone match reuses the customer/contact;
- local-format phone numbers without reliable region context do not match;
- simultaneous different-key inquiries for the same new identity create one customer and two leads;
- name-only similarity does not merge;
- conflicting email/phone identities create a possible-duplicate customer and preserve the lead;
- submitted data does not overwrite established customer values;
- service addresses map to the opportunity and do not replace customer/contact addresses.

### Attachments

- valid supported files remain private and attach to the intake;
- missing, expired, oversize, mismatched, corrupt, active-content, macro-enabled, archived, and malicious files are rejected independently;
- a lead succeeds when one or every attachment fails;
- upload capabilities cannot read, list, replace, reuse, exceed declared length, or cross company boundaries;
- missing intents close with the submission, and late bytes cannot attach;
- scanner outage leaves content quarantined rather than treating it as clean;
- inspection becomes terminal `inspection_unavailable` after 24 hours and releases quota;
- rolling byte, pending-object, and scan-concurrency quotas reject excess before upload;
- concurrent upload batches reserve byte/object quota atomically and replay reuses the reservation;
- unclaimed and rejected binaries are deleted on schedule;
- active documents download from an isolated origin and cannot execute inline; displayed images are safe derivatives;
- clean image and document projection on conversion is idempotent;
- privacy erasure removes originals, previews, project copies, and projections or records an active legal hold;
- no analytics response leaks filename, type, storage path, URL, or scan details.

### Lead feed

- all canonical company leads appear regardless of source;
- archived and terminal leads remain represented;
- merged and deleted tombstones reconcile correctly;
- field allowlist contains no PII, content, identity, or storage data;
- raw UTM values cannot enter the feed; unsafe attribution labels reduce to opaque handles and presence flags;
- financial enrichment appears only with its scope;
- cursors cannot cross principals, authorization epochs, companies, filters, or versions;
- immutable high-water snapshots have no gaps or duplicates during concurrent updates;
- incremental sync catches every update and deletion tombstone;
- multiple versions of one lead apply in monotonic sequence order;
- `next_sync_checkpoint` appears only on a terminal page and is committed only after the entire scan applies;
- expired checkpoints return `410 sync_checkpoint_expired` and force a full resync;
- historical missing attribution remains null rather than inferred.

### Metrics

- lead, discarded, decided, won, and lost denominators match the documented definitions;
- active counts exclude archived and every terminal disposition, including disqualified and converted-to-project;
- the cohort outcome distribution reconciles every canonical lead exactly once, while project-conversion rate remains independently overlap-capable;
- current-stage snapshots are not mislabeled as cohort funnels;
- stage-reached funnels use atomic lifecycle evidence and disclose incomplete historical coverage;
- automated acknowledgements and `handled_at`/WAITING markers do not count as first response;
- winning and project conversion remain separate timing events;
- response and lifecycle durations start at canonical inquiry receipt rather than delayed lead creation;
- medians, counts, and missing-data denominators are correct;
- IANA timezone and daylight-saving boundaries use half-open intervals;
- grouped totals reconcile with ungrouped totals;
- invoice status/deletion, payment void, direct/project attribution, event-date, missing-value, and currency rules reconcile exactly;
- financial `DATE` metrics reject non-company-midnight boundaries and apply half-open local-date ranges;
- cohorts under five suppress derived and financial results;
- every metric returns basis, population, unit, counts, coverage, definition version, and freshness metadata;
- every pinned metric-definition version remains stable through its individual 12-month-or-longer support window.

### Security and operations

- service-role paths prove cross-tenant denial;
- rate limits are shared across application instances;
- limiter outage fails closed;
- principal revocation changes the authorization epoch before cache lookup and prevents late upload claim;
- invalid-credential abuse is durably throttled without storing attempted secrets;
- hostile payloads do not cause URL fetches, stored XSS, log injection, or decompression;
- audit records prove use without retaining submitted content;
- network fingerprints are rotating-secret HMACs and expire on schedule;
- expected production-volume queries meet latency and database-plan targets;
- outbox delivery survives worker failure without duplicate business effects;
- source default owners are company-valid and atomically assigned with `external_intake_default`;
- unassigned external-intake events use source kind/source ID, enter the visible queue, and notify assignment-authorized users.

## 22. Baseline state before implementation

The isolated worktree is based on `origin/main` at commit `5829a845`.

The full existing Vitest suite was run before this documentation change:

- 951 test files passed;
- 1 test file was skipped;
- 4 test files failed;
- 8,680 tests passed;
- 5 tests were skipped;
- 12 tests failed.

The failures are pre-existing and unrelated to this design:

- `tests/integration/uploads-presign.test.ts`;
- `tests/unit/email/email-opportunity-title-live-pattern.test.ts`;
- `tests/unit/email/sync-engine-ai-provider-isolation.test.ts`;
- `tests/unit/i18n/inbox-parity.test.ts`.

Implementation verification must compare against this baseline and cannot attribute these failures to the API work without new evidence.

## 23. Documentation obligations

Implementation is not complete until the OPS Software Bible documents:

- credential and OAuth capability model;
- intake and upload contracts;
- customer matching and idempotency rules;
- source and attribution model;
- canonical inquiry-received, response-classification, win, and conversion evidence;
- attachment privacy and lifecycle;
- external lead projection;
- every metric definition and denominator;
- financial scope behavior;
- rate limits, caching, revocation, audit, and error contracts;
- notification and email-engine handoff;
- operating costs and chosen service dependencies.

Developer documentation must include:

- OpenAPI contract;
- server-side examples for JavaScript/TypeScript, PHP, and a raw HTTP request;
- upload and idempotent retry examples;
- intake configuration and attachment-status polling examples;
- secure secret-storage guidance;
- attribution field guidance;
- lead-feed pagination and incremental-sync examples;
- metric definitions and timezone examples;
- rotation and revocation guidance;
- a clear warning that normal credentials never belong in browser code.

## 24. Launch acceptance scenario

1. A homeowner opens a subtrade's custom website and completes a quote form with contact information, a work description, campaign attribution, two photos, and a PDF.
2. The website backend resolves its configured source/form mapping, obtains private upload slots with a replay-safe batch key, and sends the binaries without exposing its OPS credential.
3. The backend submits the inquiry with one idempotency key.
4. OPS uniquely matches the existing client or sub-client contact, or creates the correct customer/contact structure, then always creates a fresh lead and preserves the exact original submission.
5. One valid photo and the PDF become available privately; an unsafe second photo is rejected without losing the lead. The backend can reconcile any initially pending inspection through the narrow submission-status endpoint.
6. The configured default intake owner receives the lead; if no eligible default owner exists, the lead remains visible in the unassigned queue and assignment-authorized users are notified.
7. The operator responds through OPS. The existing email engine associates later replies and attachments with the lead.
8. A network retry repeats the same submission. OPS returns the original public lead ID and emits no duplicate lead, assignment, or notification.
9. After the owner explicitly grants company-wide pseudonymous analytics, the website backend reads the stable checkpointed lead feed. It can see this lead's source, campaign, stage, and response timing, but no customer identity, message, address, answers, or files.
10. The website requests standardized source and funnel metrics. OPS returns versioned definitions, the company's timezone, the exact range, freshness, and suppressed small-cohort results.
11. If the owner separately grants financial analytics, the website can add approved lead values and totals. No invoice, payment, or customer record becomes readable.
12. The owner revokes the analytics credential. The next request fails, cached data is invalidated, and the audit trail proves the revocation.

That behavior is the first-release definition of done.

# Email Attachment Ingestion and Lead Attribution

Date: 2026-07-14
Status: Approved by product direction in the active email-pipeline hardening task

## Outcome

Every file carried by a synced Gmail or Microsoft 365 message is discovered, copied into private OPS-managed storage, tied to the exact email activity, and surfaced on the correct lead. Provider disconnection or message deletion must not remove the OPS copy. A file is never attached to a lead merely because another message reused the same provider thread.

This design covers initial import, ongoing inbound and outbound sync, reconnect catch-up, historical backfill, retries, lead reassignment/merge, and won conversion. It does not send email or mutate mailbox content.

## Why the current path is insufficient

- Ongoing sync records only a boolean and a placeholder count. It stores no bytes and no attachment URLs.
- Initial import copies only selected images, uses public/random storage paths, and overwrites the lead photo array.
- Gmail can return large inline photos while its top-level attachment flag is false. Small user photos are also discarded by a size heuristic.
- Microsoft 365 can return inline-only, item, reference, and paginated attachments that the current implementation misses.
- Provider attachment identity and inspection identity are not mailbox-scoped.
- The download proxy accepts provider identifiers and MIME from the caller, then chooses a mailbox by recency.
- A live reused/stale provider-thread relationship demonstrated that thread-only attribution can place Corinne's files on Sandra's lead.

## Canonical model

### `email_attachment_scans`

One durable scan job per exact email activity. It records company, connection, activity, provider message/thread identity, generation, status, attempt count, retry time, lease, and the last error.

Email-activity inserts enqueue a scan even when the provider's attachment boolean is false. This is deliberate: inline-only Gmail and Microsoft messages cannot be trusted to advertise attachments. A database claim function uses `FOR UPDATE SKIP LOCKED`, bounded leases, exponential retry, and generation checks so concurrent workers and mid-scan arrivals converge without duplicate work or lost work.

### `email_attachments`

This becomes the canonical provenance record. Identity is unique on:

`company_id + connection_id + message_id + attachment_id`

It stores the exact activity and provider thread, optional attributed opportunity, provider kind and MIME-part identity, inline/content-ID metadata, filename, reported and verified sizes, detected MIME, occurrence time, private storage location, SHA-256, ingestion state, retry state, and timestamps.

`attachment_inspections` references the canonical attachment UUID. Vision inspection reads the OPS-stored bytes and retries independently from file ingestion.

## Exact attribution and wrong-lead protection

The resolver starts from the exact activity identity:

`company_id + email_connection_id + email_message_id`

It never starts from sender or thread alone. The activity's current `opportunity_id` is then checked against known lead/client/contact email addresses:

- inbound: the external sender must match a known contact address;
- outbound: at least one external recipient must match a known contact address;
- an activity already marked for match review is never auto-attributed;
- when no safe match exists, the file remains attached to the email activity but has `attribution_status = needs_review` and is not surfaced on any lead.

This fails closed. A legitimate alias may require review; an unrelated person's file cannot silently appear on the wrong lead.

When an activity is reassigned, a database trigger clears and requeues its attachment attribution. Lead merge updates activities through the guarded merge path, so attachment attribution follows the winning lead. Won conversion needs no duplicate copy because the project retains `projects.opportunity_id`.

## Provider behavior

### Gmail

- Recursively walk every MIME part.
- Recognize regular attachments, inline parts with `Content-ID`, filename-less inline parts, nested multiparts, and body-embedded base64url data.
- Use provider attachment IDs when present and a deterministic synthetic ID derived from immutable `partId` for body-embedded data.
- Remove the blanket 5 KB image drop. Decoration suppression may only occur with positive evidence such as an inline disposition/content-ID plus known signature dimensions; uncertain images are retained.
- Check every Gmail response before parsing it.
- Compute `hasAttachments` recursively from the same parser so sync metadata agrees with the durable scan.

### Microsoft 365

- Enumerate attachments even when `hasAttachments` is false so CID inline content is included.
- Follow attachment collection pagination.
- Preserve `isInline`, `contentId`, and `@odata.type`.
- Download file and item attachments through the provider's raw-value endpoint.
- Record reference attachments as external provenance when Graph cannot return raw bytes; they are not falsely marked stored.

## Private, idempotent storage

The default backend is a dedicated private Supabase Storage bucket named `email-attachments`. It is created as non-public and has no browser-direct object policy. A future dedicated private S3 bucket can be selected explicitly, but the existing public asset bucket is not suitable for customer email files.

The object path is deterministic and tenant-scoped:

`{company}/{connection}/{sha256(message identity)}/{sha256(attachment identity)}/content`

Workers upload idempotently, verify the byte count and SHA-256, then mark the row stored. A retry targets the same database row and object path. Repeated quoted files remain distinct provenance rows; their hashes make duplicate content observable without confusing message identity.

## Serving files

`GET /api/integrations/email/attachment?id=<canonical UUID>` is the only byte route.

It:

- authenticates the OPS user and resolves company server-side;
- requires `inbox.view` or `pipeline.view`;
- loads filename, MIME, storage location, company, and owning mailbox from the canonical row;
- rejects unattributed cross-company access;
- ignores caller-supplied provider identity, company, mailbox, and MIME;
- streams only private OPS-stored bytes;
- uses safe `Content-Disposition`, `X-Content-Type-Options: nosniff`, restrictive CSP/sandbox headers, and private caching;
- permits inline rendering only for a conservative raster-image allowlist; SVG, HTML, executables, archives, and documents download.

The inbox files route reads canonical rows rather than Gmail/Microsoft live. Existing activity attachment arrays receive stable same-origin URLs so the current correspondence and Photos surfaces work without exposing storage URLs.

## Import, sync, and recovery

- Every email activity enqueue occurs at the durable activity boundary, before the provider cursor can be considered fully processed.
- A bounded attachment worker claims exact-message scans and handles enumeration, metadata persistence, download, storage, attribution, activity reconciliation, and inspection.
- The existing import extraction endpoint becomes a compatibility dispatcher into the same scan queue. It no longer writes `opportunities.images`.
- A migration backfills scan rows for historical email activities, including the 284 live rows whose attachment flag is true but attachment URL array is empty.
- Existing metadata-only attachment rows are re-scanned through their owning connection. Disconnected mailboxes remain pending and resume after reconnect.
- Provider deletion after a successful copy does not affect OPS access. Provider deletion before first copy records a terminal unavailable state with provenance rather than pretending the file was stored.

## Limits and safety

- Enumeration and upload have bounded page, file-count, and byte limits. Oversized files are recorded with `oversized`, attributed safely, and surfaced as unavailable rather than exhausting a function.
- Leases prevent stuck `processing` jobs. Exponential retry applies to transient provider/storage failures; auth failures pause until reconnect.
- Filenames are display metadata only and never become trusted paths or MIME authority.
- No path in this feature sends email. The user's no-send Gmail rule remains absolute.

## Verification contract

Completion requires automated proof for Gmail nested/CID/body-data/small-image/document cases; Microsoft inline-only/file/item/reference/pagination cases; mailbox identity collisions; reused threads with multiple leads; exact activity attribution and mismatch quarantine; retries and concurrent claims; import and ongoing sync; historical backfill; lead reassignment/merge/won conversion; private route authorization and MIME hardening; and migration execution against real PostgreSQL.

Live rollout proof is separate from local merge: after deployment, read-only checks must show canonical rows with stored private objects and correct activity/opportunity links for known real inbox scenarios. No Gmail message may be sent during verification.

## Cost

This introduces private object storage, provider read calls during scan/backfill, worker invocations, and download egress. Those are usage-based costs. The worker is bounded and idempotent to avoid repeated provider reads and duplicate storage, but exact monthly cost depends on attachment volume and file size and must be measured after rollout.

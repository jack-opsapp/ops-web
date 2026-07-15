# Email Attachment Ingestion and Lead Attribution Implementation Plan

Date: 2026-07-14
Design: `docs/superpowers/specs/2026-07-14-email-lead-attachment-design.md`

## 1. Lock the contracts with failing tests

- Add provider fixtures/tests for Gmail nested parts, inline `body.data`, content IDs, filename-less photos, small real photos, documents, and recursive attachment flags.
- Add Microsoft 365 tests for inline-only messages, paginated lists, file/item/reference attachment metadata, and raw byte retrieval.
- Add pure attribution tests for exact activity identity, known-participant validation, mismatch quarantine, and reassignment.
- Add storage tests for deterministic keys, MIME detection/fallback, idempotent retry, and safe filenames.
- Add route tests proving canonical-ID-only access, company/permission checks, stored MIME authority, download headers, and removal of live provider fallback.
- Add migration contract tests for mailbox-scoped uniqueness, queue claims, backfill, RLS, activity reconciliation, and reassignment triggers.

Run each focused suite before implementation and capture the expected failures.

## 2. Add the durable database model

- Add a migration that expands `email_attachments`, creates `email_attachment_scans`, scopes `attachment_inspections`, creates the private bucket, adds queue/refresh/reassignment functions and triggers, and backfills historical activity scans.
- Keep pre-contract columns during rollout so current code can coexist; add a later contract migration only after live backfill proof.
- Update generated database types and attachment service types.

## 3. Normalize provider attachment behavior

- Extend `EmailAttachmentMeta` with provider kind, part ID, content ID, inline flag, and download support.
- Add an exact-message enumeration method to both providers.
- Harden Gmail recursion/body-data download/recursive flag/error handling.
- Harden Microsoft inline-only enumeration, pagination, item raw bytes, and reference metadata.
- Keep thread enumeration as a compatibility wrapper over the same exact-message parser.

## 4. Build the canonical ingestion services

- Add pure helpers for deterministic identity/storage paths, MIME detection, safe filenames, image-render policy, and attribution decisions.
- Add a queue service that claims scans, resolves the exact activity, enumerates one provider message, upserts metadata, validates lead attribution, downloads bytes, stores privately, verifies hash/size, reconciles activity arrays, and schedules independent vision inspection.
- Make retries, auth pauses, oversized files, unsupported references, and terminal provider deletion explicit states.

## 5. Wire every ingestion path

- Enqueue from the email activity creation boundary for inbound and outbound mail.
- Dispatch bounded work from a cron worker and include it in `vercel.json`.
- Convert initial-import image extraction into a compatibility enqueue/backfill route; remove public uploads and `opportunities.images` overwrite behavior.
- Requeue pending scans on reconnect and activity reassignment.

## 6. Serve and surface stored files

- Replace the attachment proxy with canonical UUID lookup and private storage streaming.
- Convert the inbox thread Files route to canonical rows.
- Preserve stable activity attachment URLs so lead correspondence and Photos surfaces show stored email files without visual redesign.
- Ensure documents download and only safe raster images render inline.

## 7. Update system documentation

- Update the OPS Software Bible with the canonical schema, provider behaviors, security model, attribution rule, worker/retry lifecycle, cost surface, and operational verification queries.

## 8. Verify, commit, and integrate

- Run focused tests after each red/green step.
- Run the complete relevant email/inbox/supabase test suites, typecheck, lint on changed files, and build if the repo baseline permits.
- Execute migration tests against a real PostgreSQL instance; do not apply production DDL in this task.
- Inspect the diff for Gmail send calls or any mailbox mutation; none are allowed.
- Commit atomically, reconcile the latest local `main`, repeat focused verification, then merge into local `main` only if clean.
- Do not push, deploy, or apply production migrations without separate explicit authorization.

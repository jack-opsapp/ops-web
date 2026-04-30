# Email suppressions

Single source of truth: `public.email_suppressions`.

## Model

| Column | Purpose |
|---|---|
| `email` | Lower-cased recipient. |
| `list` | Suppression scope. `'global'` blocks all email. Per-list values (e.g. `'field_notes'`, `'product_updates'`) block only that channel. |
| `reason` | `hard_bounce` / `soft_bounce` / `spam_report` / `unsubscribe` / `group_unsubscribe` / `manual` / `invalid_address`. |
| `source` | `webhook` / `manual` / `backfill` / `import`. |
| `expires_at` | Optional auto-removal. NULL = permanent. |

## How addresses get suppressed

1. **Automatic via webhook trigger** (`trg_email_events_auto_suppress`): SendGrid Event Webhook receives `bounce` (hard or blocked), `spamreport`, `unsubscribe`, or `group_unsubscribe` → trigger inserts into `email_suppressions`.
2. **Manual via admin API**: `POST /api/admin/email/suppressions { email, reason, list? }`.
3. **Backfill** (one-time, migration `082`): historical `email_events` were scanned; surviving terminal events seeded the table.

Soft bounces are NOT auto-suppressed — SendGrid handles internal retry. Dropped events are NOT suppressed either; they are typically transient queue events.

## How sends respect suppression

Every send routes through `gatedSend` in `src/lib/email/sendgrid.tsx`. Before calling `sgMail.send`, it checks `isSuppressed(email, list)`. Suppressed sends are silently skipped and logged with `email_log.status = 'suppression_skipped'`.

Bulk sends (e.g. `sendBlogNewsletter`, `sendFieldNotesNewsletter`) use `filterSuppressed(emails, list)` to remove suppressed recipients in a single query before fan-out.

## Severity ordering on re-suppression

If an address is already suppressed and a new event arrives, the trigger keeps the more severe reason: `spam_report > hard_bounce > unsubscribe`. This means a complaint never gets downgraded to a generic unsubscribe.

## Removing a suppression

Operator-only. `DELETE /api/admin/email/suppressions/{email}?list=global`. Use sparingly — removing a suppression for a hard-bounced address risks a repeat bounce that will damage sender reputation.

## Related

- Webhook: `src/app/api/webhooks/sendgrid/route.ts`
- Helper: `src/lib/email/suppressions.ts`
- Send chokepoint: `src/lib/email/sendgrid.tsx` (`gatedSend`)
- Admin API: `src/app/api/admin/email/suppressions/`
- Migrations: `079_email_events_code_of_record.sql`, `080_email_suppressions.sql`, `081_email_auto_suppress_trigger.sql`, `082_email_suppressions_backfill.sql`, `083_email_log_status_doc.sql`

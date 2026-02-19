# QuickBooks Online Integration — Design Document

**Date:** 2026-02-18
**Status:** Approved
**Scope:** QuickBooks Online only (Sage deferred)

---

## Overview

Two-way sync between OPS and QuickBooks Online. OPS pushes clients, estimates, invoices, and payments to QB in real-time. OPS pulls changes from QB every 15 minutes via Vercel cron. Direct API integration using the QuickBooks Online Accounting API v3.

## Architecture

**Approach:** Direct API — OPS calls QuickBooks API from Next.js API routes. No middleware, no third-party connectors.

**Outbound (real-time):** Service layer hooks push data to QB after successful OPS operations. Non-blocking — sync failures are logged but don't block OPS operations.

**Inbound (15-min polling):** Vercel cron job queries QB's Change Data Capture (CDC) endpoint for modifications since `lastSyncAt`. Updates OPS records accordingly.

**Manual sync:** "Sync Now" button runs both push and pull immediately.

**Conflict resolution:** QB wins on financial fields (amounts, dates, line items). OPS wins on operational fields (status, assignments, internal notes). All conflicts logged.

---

## Database Schema

Migration: `supabase/migrations/008_accounting_schema.sql`

### accounting_connections

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | UUID PK | gen_random_uuid() | |
| company_id | TEXT NOT NULL | | |
| provider | TEXT NOT NULL | | `quickbooks` or `sage` |
| access_token | TEXT | null | OAuth access token |
| refresh_token | TEXT | null | OAuth refresh token |
| token_expires_at | TIMESTAMPTZ | null | |
| realm_id | TEXT | null | QuickBooks company/realm ID |
| is_connected | BOOLEAN | false | |
| last_sync_at | TIMESTAMPTZ | null | Last successful sync |
| sync_enabled | BOOLEAN | false | |
| webhook_verifier_token | TEXT | null | |
| created_at | TIMESTAMPTZ | now() | |
| updated_at | TIMESTAMPTZ | now() | |

UNIQUE constraint on (company_id, provider).

### accounting_sync_log

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | UUID PK | gen_random_uuid() | |
| company_id | TEXT NOT NULL | | |
| provider | TEXT NOT NULL | | |
| direction | TEXT NOT NULL | | `push` or `pull` |
| entity_type | TEXT NOT NULL | | `client`, `estimate`, `invoice`, `payment` |
| entity_id | TEXT | null | OPS record ID |
| external_id | TEXT | null | QuickBooks record ID |
| status | TEXT NOT NULL | | `success`, `error`, `skipped` |
| details | TEXT | null | Error message or summary |
| created_at | TIMESTAMPTZ | now() | |

### ALTER TABLE additions

Add `qb_id TEXT` column to:
- `clients`
- `estimates`
- `invoices`
- `payments`

These store the QuickBooks entity ID for the corresponding OPS record. Null means not yet synced.

---

## OAuth Flow

1. User clicks "Connect QuickBooks" → `POST /api/integrations/quickbooks`
2. Server generates Intuit OAuth URL with:
   - `client_id` from env
   - `redirect_uri` = `https://app.opsapp.co/api/integrations/quickbooks/callback`
   - `scope` = `com.intuit.quickbooks.accounting`
   - `state` = `{companyId}:{random}` (CSRF protection)
   - `response_type` = `code`
3. Returns `{ authUrl }` → frontend redirects user to Intuit
4. User authorizes → Intuit redirects to callback with `code` and `realmId`
5. Callback exchanges code for tokens via `POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`
6. Stores access_token, refresh_token, token_expires_at, realm_id in `accounting_connections`
7. Sets `is_connected = true`
8. Redirects user to `/accounting?connected=quickbooks`

### Token Refresh

Before any QB API call, check `token_expires_at`. If within 5 minutes of expiry:
- `POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` with `grant_type=refresh_token`
- Update stored tokens
- If refresh fails, set `is_connected = false` and log error

### Disconnect

- `DELETE /api/integrations/quickbooks` with `{ companyId }`
- Revoke token at Intuit's revoke endpoint
- Set `is_connected = false`, clear tokens

---

## Entity Mapping

### Client → QB Customer

| OPS Field | QB Field |
|-----------|----------|
| name | DisplayName |
| email | PrimaryEmailAddr.Address |
| phone | PrimaryPhone.FreeFormNumber |
| address (line1, city, state, zip) | BillAddr |
| qbId | Id (QB-assigned) |

### Estimate → QB Estimate

| OPS Field | QB Field |
|-----------|----------|
| estimateNumber | DocNumber |
| issueDate | TxnDate |
| expirationDate | ExpirationDate |
| lineItems[] | Line[] (SalesItemLineDetail) |
| total | TotalAmt |
| clientId → client.qbId | CustomerRef |
| clientMessage | CustomerMemo |
| qbId | Id (QB-assigned) |

### Invoice → QB Invoice

| OPS Field | QB Field |
|-----------|----------|
| invoiceNumber | DocNumber |
| issueDate | TxnDate |
| dueDate | DueDate |
| lineItems[] | Line[] (SalesItemLineDetail) |
| total | TotalAmt |
| balanceDue | Balance |
| clientId → client.qbId | CustomerRef |
| qbId | Id (QB-assigned) |

### Payment → QB Payment

| OPS Field | QB Field |
|-----------|----------|
| amount | TotalAmt |
| paymentDate | TxnDate |
| paymentMethod | PaymentMethodRef (mapped) |
| referenceNumber | PaymentRefNum |
| invoiceId → invoice.qbId | Line[].LinkedTxn (Invoice ref) |
| clientId → client.qbId | CustomerRef |
| qbId | Id (QB-assigned) |

---

## Sync Logic

### Outbound Push (Real-time)

After each successful OPS operation, check if QuickBooks is connected for that company. If yes, push asynchronously (fire-and-forget with error logging).

**Trigger points:**
- `ClientService.createClient()` / `updateClient()` → push Customer
- `EstimateService.createEstimate()` / `updateEstimate()` / `sendEstimate()` → push Estimate
- `InvoiceService.createInvoice()` / `updateInvoice()` / `sendInvoice()` → push Invoice
- `InvoiceService.recordPayment()` → push Payment
- Stripe webhook payment recorded → push Payment

**Push logic:**
1. Check `accounting_connections` for company — connected + sync_enabled?
2. If entity has `qb_id` → QB API update; if null → QB API create
3. On create success → store returned QB ID in `qb_id` column
4. Log to `accounting_sync_log` (success or error)

### Inbound Pull (15-min Cron)

Vercel cron triggers `GET /api/sync/quickbooks`.

1. Fetch all connected companies with `sync_enabled = true`
2. For each company, call QB CDC endpoint: `GET /cdc?entities=Customer,Estimate,Invoice,Payment&changedSince={lastSyncAt}`
3. For each changed entity:
   - Find matching OPS record by `qb_id`
   - If found → update OPS record with QB data (financial fields only)
   - If not found → create new OPS record (for entities created directly in QB)
4. Update `last_sync_at` on the connection
5. Log all changes to `accounting_sync_log`

### Conflict Resolution

- Financial fields (amounts, dates, line item totals): **QB wins** — the bookkeeper's edits in QB are authoritative
- Operational fields (status, team assignments, internal notes): **OPS wins** — field operations are authoritative
- Client contact info (name, email, phone): **Most recent edit wins** — compare `updated_at` timestamps

---

## Files

### New Files (~12)

| File | Purpose |
|------|---------|
| `supabase/migrations/008_accounting_schema.sql` | Tables + ALTER TABLE |
| `src/lib/api/services/quickbooks-client.ts` | QB API client: auth, token refresh, HTTP methods |
| `src/lib/api/services/quickbooks-sync.ts` | Sync orchestrator: push/pull per entity, conflict resolution, logging |
| `src/app/api/integrations/quickbooks/route.ts` | POST: OAuth initiation, DELETE: disconnect |
| `src/app/api/integrations/quickbooks/callback/route.ts` | GET: OAuth callback, token exchange |
| `src/app/api/sync/route.ts` | POST: manual sync trigger, GET: sync history |
| `src/app/api/sync/quickbooks/route.ts` | GET: cron-triggered pull |

### Modified Files (~6)

| File | Change |
|------|--------|
| `src/lib/api/services/invoice-service.ts` | Add QB push hooks |
| `src/lib/api/services/estimate-service.ts` | Add QB push hooks |
| `src/lib/api/services/client-service.ts` | Add QB push hooks |
| `src/lib/types/pipeline.ts` | Add `qbId` to Client, Estimate, Invoice, Payment interfaces |
| `src/app/api/webhooks/stripe/route.ts` | Add QB push after payment recording |
| `.env.example` / `.env.local.example` | Add QB env vars |
| `vercel.json` | Add cron job for sync |

---

## Environment Variables

```
QB_CLIENT_ID=           # Intuit developer app client ID
QB_CLIENT_SECRET=       # Intuit developer app client secret
QB_REDIRECT_URI=https://app.opsapp.co/api/integrations/quickbooks/callback
QB_ENVIRONMENT=production   # sandbox or production
```

---

## Verification Checklist

1. Connect QuickBooks from accounting page → OAuth flow completes
2. Create a client in OPS → appears as Customer in QB
3. Create an estimate → appears in QB
4. Send an invoice → appears in QB
5. Record a payment (manual or via portal) → appears in QB
6. Edit an invoice in QB → changes reflected in OPS after next sync
7. Create a customer in QB → appears as client in OPS after next sync
8. Disconnect QuickBooks → tokens cleared, sync stops
9. Reconnect → sync resumes
10. Sync history shows in accounting page UI

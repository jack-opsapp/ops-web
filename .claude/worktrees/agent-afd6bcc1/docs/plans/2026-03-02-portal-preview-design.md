# Client Portal Preview — Design

**Goal:** Let admins preview their client portal with sample data to see exactly what clients experience, accessed via a "Preview Portal" button on Settings > Portal Branding.

**Approach:** Preview Session Token — create a special short-lived token that bypasses email verification, auto-creates a session with a demo data flag, and opens the real portal with hardcoded sample data while using the admin's actual branding settings.

---

## Overall Flow

1. Admin clicks "Preview Portal" in Settings > Portal Branding
2. Client calls `POST /api/portal/preview` (Firebase-authenticated)
3. Server creates a preview token (`is_preview = true`, 15-min expiry, sentinel email `preview@ops.app`)
4. Server returns the token hex value
5. Client opens `/portal/{token}` in a new tab
6. Token landing page detects `is_preview` → auto-verifies (skips email form) → sets `ops-portal-session` cookie → redirects to `/portal/home`
7. Portal data endpoint detects `is_preview` on session → returns demo data (with admin's real branding)
8. Detail endpoints also detect preview and return demo detail data
9. A "Preview Mode" banner shows at the top of the portal

---

## Database & Type Changes

**Supabase migration** — add `is_preview` column to both tables:

- `portal_tokens.is_preview` — boolean, default false
- `portal_sessions.is_preview` — boolean, default false

**TypeScript type updates** in `lib/types/portal.ts`:

- `PortalToken` → add `isPreview: boolean`
- `PortalSession` → add `isPreview: boolean`

**Mapper updates** in `portal-auth-service.ts`:

- `mapTokenFromDb` → include `isPreview: !!row.is_preview`
- `mapSessionFromDb` → include `isPreview: !!row.is_preview`

---

## New API Endpoint — `POST /api/portal/preview`

- **Auth:** Requires Firebase dashboard auth (existing `requireAuth` pattern)
- **Creates** a portal token with:
  - `company_id` = admin's company
  - `client_id` = deterministic preview client ID (`00000000-0000-0000-0000-000000000000`)
  - `email` = `preview@ops.app`
  - `is_preview` = true
  - Short expiry (15 min)
- **Returns** `{ token: "abc123hex..." }`

---

## Token Landing Page & Verify Changes

**`/portal/[token]` page:**

- `validate-token` endpoint now also returns `isPreview`
- When `isPreview = true`: skip email form, auto-call verify with sentinel email, redirect to `/portal/home`

**`/api/portal/auth/verify` endpoint:**

- When token has `is_preview = true`: skip email match validation
- Set `is_preview = true` on the created session row

---

## Demo Data

**New file:** `lib/api/services/portal-demo-data.ts`

All demo data in one file. Uses deterministic IDs (`preview-est-1`, `preview-inv-1`, `preview-proj-1`) so detail endpoints can match them.

### `getDemoPortalData(companyId)`

Returns `PortalClientData`:

- **Client:** "Jane Smith", jane@example.com, "123 Oak Street"
- **Company + branding:** Fetched from real DB (admin sees their actual customizations)
- **Projects:** 2 sample projects ("Kitchen Renovation", "Deck Installation")
- **Estimates:** 3 estimates at different statuses (sent, viewed, approved)
- **Invoices:** 3 invoices at different statuses (sent, partially paid, paid)
- **Unread messages:** 1

### `getDemoEstimateDetail(estimateId)`

Returns estimate with sample line items (3-4 items with realistic descriptions and prices).

### `getDemoInvoiceDetail(invoiceId)`

Returns invoice with sample line items and payment history.

### `getDemoMessages()`

Returns 2-3 sample messages between company and client.

---

## Portal Endpoint Updates

Every portal API endpoint gains a preview check after `requirePortalSession()`:

| Endpoint | Preview behavior |
|----------|-----------------|
| `GET /api/portal/data` | Return `getDemoPortalData(session.companyId)` |
| `GET /api/portal/estimates/[id]` | Return `getDemoEstimateDetail(id)` |
| `GET /api/portal/invoices/[id]` | Return `getDemoInvoiceDetail(id)` |
| `GET /api/portal/projects/[id]` | Return demo project detail |
| `GET /api/portal/messages` | Return `getDemoMessages()` |
| POST endpoints (approve, message, etc.) | Return success without writing to DB |

---

## UI Changes

### Portal Branding Tab

- Add "Preview Portal" button (Eye icon) next to the Save button at the bottom
- On click: calls `POST /api/portal/preview`, then `window.open('/portal/{token}', '_blank')`
- Loading state while creating the preview token

### Portal Shell (all portal pages)

- When session is preview, show banner at top: "Preview Mode — This is how your clients see your portal"
- Banner uses the portal's accent color so it fits the branding

---

## Non-goals (v1)

- Preview does not write any real data to the database
- No cleanup needed — preview tokens expire in 15 min, sessions in 30 days (harmless)
- Detail views for questions/answers use simple demo data, not full interactive Q&A

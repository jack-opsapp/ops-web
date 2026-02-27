# Settings Buildout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build out all remaining placeholder settings tabs: remove Security/PIN, wire up Billing with Stripe, build Team Invites (SendGrid email + Twilio SMS), build comprehensive Team Management (fire/revoke/permissions/seats), and build Data Export/Delete.

**Architecture:** Five workstreams that share common infrastructure (auth store, company service, user service). Each workstream touches 1-3 files. Backend API routes already exist for Stripe and partial invite support — we extend them. New API routes needed for data export and account deletion.

**Tech Stack:** Next.js 15 API routes, Supabase (service-role for admin ops), Stripe SDK (@stripe/react-stripe-js for Elements), SendGrid (@sendgrid/mail), Twilio (new install), TanStack Query hooks, Zustand auth store.

---

## Workstream 1: Remove Security/PIN Tab

### Task 1: Delete Security Tab and Remove References

**Files:**
- Delete: `src/components/settings/security-tab.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx`

**Step 1: Remove the security tab from the settings page**

In `src/app/(dashboard)/settings/page.tsx`:
- Remove the `import { SecurityTab }` line (line 29)
- Remove `import { Shield }` from the lucide-react import (line 8) — BUT check if Shield is used by another tab reference first. It's used in the icon for security tab only in baseTabs, so remove.
- Remove `| "security"` from the `SettingsTab` type union (line 48)
- Remove `{ id: "security", label: "Security", icon: Shield }` from `baseTabs` array (line 64)
- Remove `{activeTab === "security" && <SecurityTab />}` from the render block (line 108)

**Step 2: Delete the security tab file**

Delete `src/components/settings/security-tab.tsx`

**Step 3: Verify build**

Run: `cd "/Users/jacksonsweet/Desktop/OPS LTD./OPS-Web" && npx next build --no-lint 2>&1 | tail -5`

**Step 4: Commit**

```
feat: remove Security/PIN settings tab
```

---

## Workstream 2: Build Comprehensive Team Management

### Task 2: Add Team Member Actions (Role Change, Deactivate, Remove Seat)

**Files:**
- Modify: `src/lib/hooks/use-users.ts` (add `useDeactivateUser` hook)
- Modify: `src/lib/hooks/use-company.ts` or wherever `useUpdateCompany` lives (for seat management hooks)
- Modify: `src/components/settings/team-tab.tsx` (complete rebuild)

**Step 1: Add useDeactivateUser and useRemoveTeamMember hooks**

In `src/lib/hooks/use-users.ts`, add:

```typescript
/**
 * Deactivate a team member (set isActive = false).
 */
export function useDeactivateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      UserService.updateUser(id, { isActive: false }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.users.lists() });
    },
  });
}

/**
 * Reactivate a team member (set isActive = true).
 */
export function useReactivateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      UserService.updateUser(id, { isActive: true }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.users.lists() });
    },
  });
}
```

**Step 2: Add seat management hooks**

Check where `useUpdateCompany` lives and add hooks that wrap `CompanyService.addSeatedEmployee` / `CompanyService.removeSeatedEmployee`. These may need new hooks in a `use-company.ts` or similar file. Create:

```typescript
export function useAddSeat() {
  const { company } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      CompanyService.addSeatedEmployee(company!.id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.company.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.users.lists() });
    },
  });
}

export function useRemoveSeat() {
  const { company } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      CompanyService.removeSeatedEmployee(company!.id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.company.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.users.lists() });
    },
  });
}
```

**Step 3: Rebuild team-tab.tsx with comprehensive team management**

Replace the current `team-tab.tsx` with a full implementation that includes:

1. **Invite section** (keep existing, will be wired in Task 3)
2. **Team Members list** with per-member actions:
   - **Role dropdown**: Admin / Office Crew / Field Crew — uses `useUpdateUserRole`
   - **Seat toggle**: Assigned/Unassigned — uses `useAddSeat`/`useRemoveSeat`
   - **Deactivate button**: Sets `isActive = false` — uses `useDeactivateUser`
   - **Reactivate button**: For deactivated members — uses `useReactivateUser`
3. **Admin badge** for company admins (from `company.adminIds`)
4. **Seat usage indicator** (from `company.seatedEmployeeIds.length` / `company.maxSeats`)
5. **ConfirmDialog** for deactivation (destructive action)

Each team member row shows:
- Avatar (initials) + Name + Email
- Role selector (pill buttons: Admin / Office Crew / Field Crew)
- Seat status indicator (seated/unseated)
- Actions dropdown (three-dot menu): Change Role, Toggle Seat, Deactivate/Reactivate

The current user should NOT be able to deactivate themselves. Admins can manage all members. Show a warning when seat limit is reached.

**Step 4: Verify build**

Run: `cd "/Users/jacksonsweet/Desktop/OPS LTD./OPS-Web" && npx next build --no-lint 2>&1 | tail -5`

**Step 5: Commit**

```
feat: add comprehensive team management with role changes, seat management, and deactivation
```

---

### Task 3: Wire Up Team Invites with SendGrid Email

**Files:**
- Modify: `src/app/api/auth/send-invite/route.ts` (wire SendGrid)
- Create: `src/lib/email/templates/team-invite.ts` (invite email template)
- Modify: `src/components/settings/team-tab.tsx` (use `useSendInvite` hook)

**Step 1: Create team invite email template**

Create `src/lib/email/templates/team-invite.ts` following the pattern of existing templates (magic-link.ts, etc.). The template should:
- Use the same `emailLayout` wrapper as other templates
- Include: company name, invite link (join URL with company code), inviter name
- CTA button: "Join [Company Name] on OPS"
- The join URL should be: `${NEXT_PUBLIC_APP_URL}/join?code=${company.externalId || company.id}`

**Step 2: Wire SendGrid into the send-invite route**

In `src/app/api/auth/send-invite/route.ts`, replace the TODO section with actual SendGrid email sending:

```typescript
import { sendTeamInvite } from "@/lib/email/sendgrid";

// Replace the TODO block with:
const inviteCode = company.external_id || company.id;

for (const email of emails) {
  await sendTeamInvite({
    email,
    companyName: company.name,
    inviteCode,
  });
}
```

Also add a `sendTeamInvite` function to `src/lib/email/sendgrid.ts`.

**Step 3: Update the invite form in team-tab.tsx**

Replace the fake `handleInvite` toast with the actual `useSendInvite()` hook:

```typescript
const sendInvite = useSendInvite();

function handleInvite() {
  if (!inviteEmail.trim()) {
    toast.error("Please enter an email address");
    return;
  }
  sendInvite.mutate([inviteEmail], {
    onSuccess: () => {
      toast.success("Invitation sent", { description: `Invite sent to ${inviteEmail}` });
      setInviteEmail("");
    },
    onError: (err) => toast.error("Failed to send invite", { description: err.message }),
  });
}
```

Also add a role field to the invite that gets passed through to the API (so the invited user gets the correct role pre-assigned).

**Step 4: Verify build**

**Step 5: Commit**

```
feat: wire up team invites with SendGrid email delivery
```

---

### Task 4: Add Twilio SMS Invites

**Files:**
- Install: `twilio` npm package
- Create: `src/lib/sms/twilio.ts` (SMS service)
- Modify: `src/app/api/auth/send-invite/route.ts` (add SMS support)
- Modify: `src/components/settings/team-tab.tsx` (add phone number input + SMS toggle)

**Step 1: Install Twilio**

```bash
cd "/Users/jacksonsweet/Desktop/OPS LTD./OPS-Web" && npm install twilio
```

**Step 2: Create Twilio SMS service**

Create `src/lib/sms/twilio.ts`:

```typescript
import twilio from "twilio";

function getClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error("Missing Twilio credentials");
  return twilio(accountSid, authToken);
}

function getFromNumber(): string {
  const num = process.env.TWILIO_FROM_NUMBER;
  if (!num) throw new Error("Missing TWILIO_FROM_NUMBER");
  return num;
}

export async function sendTeamInviteSMS(params: {
  phone: string;
  companyName: string;
  inviteCode: string;
}): Promise<void> {
  const client = getClient();
  const joinUrl = `${process.env.NEXT_PUBLIC_APP_URL}/join?code=${params.inviteCode}`;

  await client.messages.create({
    to: params.phone,
    from: getFromNumber(),
    body: `You've been invited to join ${params.companyName} on OPS. Tap to join: ${joinUrl}`,
  });
}
```

**Step 3: Update send-invite route to support SMS**

Modify the route to accept an optional `phones` array alongside `emails`. For each phone number, call `sendTeamInviteSMS`. Return counts for both email and SMS invites sent.

Update the request body interface:
```typescript
interface SendInviteBody {
  idToken: string;
  emails?: string[];
  phones?: string[];
  companyId: string;
}
```

**Step 4: Update team-tab.tsx invite form**

Add a toggle between "Email" and "SMS" invite modes. When SMS is selected, show a phone number input instead of email. The invite button calls the same API endpoint but with `phones` instead of `emails`.

Also update the `useSendInvite` hook and `UserService.sendInvite` to accept `{ emails?: string[], phones?: string[] }` instead of just `emails`.

**Step 5: Verify build + commit**

```
feat: add Twilio SMS team invites alongside email invites
```

---

## Workstream 3: Build Billing Tab with Stripe

### Task 5: Build Stripe Payment Method Collection UI

**Files:**
- Modify: `src/components/settings/billing-tab.tsx` (full rebuild)
- Create: `src/lib/hooks/use-billing.ts` (billing-specific hooks)
- Create: `src/app/api/stripe/payment-methods/route.ts` (list payment methods)
- Create: `src/app/api/stripe/invoices/route.ts` (list invoices)

**Step 1: Create API route to list payment methods**

Create `src/app/api/stripe/payment-methods/route.ts`:
- GET: Takes `companyId` as query param
- Fetches company's `stripe_customer_id` from Supabase
- Calls `stripe.paymentMethods.list({ customer, type: 'card' })`
- Returns array of `{ id, brand, last4, expMonth, expYear, isDefault }` (check customer.invoice_settings.default_payment_method to set isDefault)

**Step 2: Create API route to list invoices**

Create `src/app/api/stripe/invoices/route.ts`:
- GET: Takes `companyId` as query param
- Fetches company's `stripe_customer_id`
- Calls `stripe.invoices.list({ customer, limit: 20 })`
- Returns array of `{ id, number, date, amount, status, pdfUrl, hostedUrl }`

**Step 3: Create billing hooks**

Create `src/lib/hooks/use-billing.ts`:

```typescript
export function usePaymentMethods() { /* GET /api/stripe/payment-methods?companyId=X */ }
export function useSetupIntent() { /* wraps CompanyService.createSetupIntent */ }
export function useInvoices() { /* GET /api/stripe/invoices?companyId=X */ }
```

**Step 4: Rebuild billing-tab.tsx**

The billing tab should have three cards:

**Card 1: Payment Method**
- If no payment method: Show "Add Payment Method" button
- Clicking opens a modal with Stripe Elements (CardElement from `@stripe/react-stripe-js`)
- Uses `SetupIntent` flow: call `CompanyService.createSetupIntent()`, then `stripe.confirmCardSetup(clientSecret, { payment_method: { card } })`
- After success, refetch payment methods
- If payment method exists: Show card brand + last 4 + expiry, with "Update" and "Remove" buttons

**Card 2: Billing History**
- List invoices from `useInvoices()`
- Each row: Invoice number, date, amount, status badge (paid/open/draft), "View" link (hosted_invoice_url), "Download" link (invoice_pdf)
- Empty state if no invoices

**Card 3: Download Invoices**
- "Download All" button that downloads all invoice PDFs (or links to Stripe-hosted page)

The Stripe Elements provider (`<Elements>`) should wrap only the payment method modal, NOT the entire tab — load `@stripe/stripe-js` lazily with `loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)`.

**Step 5: Verify build + commit**

```
feat: build billing tab with Stripe payment methods and invoice history
```

---

## Workstream 4: Build Data Export

### Task 6: Build Data Export Functionality

**Files:**
- Create: `src/app/api/data/export/route.ts` (server-side export)
- Modify: `src/components/settings/data-privacy-tab.tsx` (wire up export)

**Step 1: Create the export API route**

Create `src/app/api/data/export/route.ts`:
- POST: Requires Firebase auth token
- Fetches ALL company data from Supabase using service-role client:
  - Company info
  - Users (team members)
  - Projects
  - Tasks
  - Clients
  - Estimates + line items
  - Invoices + line items + payments
  - Opportunities (pipeline)
  - Calendar events
  - Products (line item catalog)
- For each entity, fetch all rows with `company_id = X` and `deleted_at IS NULL`
- Return as JSON: `{ company: {...}, users: [...], projects: [...], ... }`
- Set response headers for file download: `Content-Disposition: attachment; filename="ops-data-export.json"`

**Step 2: Wire up the data-privacy-tab export button**

Replace the toast-only `handleExportData` with actual functionality:

```typescript
async function handleExportData() {
  setExporting(true);
  try {
    const { getIdToken } = await import("@/lib/firebase/auth");
    const idToken = await getIdToken();
    const res = await fetch("/api/data/export", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ companyId: company.id }),
    });
    if (!res.ok) throw new Error("Export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ops-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Data exported successfully");
  } catch (err) {
    toast.error("Export failed", { description: err instanceof Error ? err.message : "Unknown error" });
  } finally {
    setExporting(false);
  }
}
```

Add a loading spinner on the export button while `exporting` is true.

**Step 3: Verify build + commit**

```
feat: build data export with full company data download
```

---

## Workstream 5: Build Account Deletion

### Task 7: Build Account Deletion Functionality

**Files:**
- Create: `src/app/api/data/delete-account/route.ts` (server-side deletion)
- Modify: `src/components/settings/data-privacy-tab.tsx` (wire up delete)

**Step 1: Create the delete-account API route**

Create `src/app/api/data/delete-account/route.ts`:
- POST: Requires Firebase auth token + confirmation string
- Body: `{ idToken, companyId, confirmText: "DELETE" }`
- Validates the requesting user is a company admin (check `admin_ids` array)
- Performs cascade soft-delete using service-role Supabase client:
  1. Soft-delete all `calendar_events` where `company_id = X`
  2. Soft-delete all `tasks` where `company_id = X`
  3. Soft-delete all `estimate_line_items` for estimates in this company
  4. Soft-delete all `estimates` where `company_id = X`
  5. Soft-delete all `invoice_line_items` for invoices in this company
  6. Soft-delete all `invoices` where `company_id = X`
  7. Soft-delete all `payments` where `company_id = X`
  8. Soft-delete all `projects` where `company_id = X`
  9. Soft-delete all `opportunities` where `company_id = X`
  10. Soft-delete all `clients` where `company_id = X`
  11. Soft-delete all `products` where `company_id = X`
  12. Soft-delete all `task_types` where `company_id = X`
  13. Soft-delete all `users` where `company_id = X`
  14. Soft-delete the `company` itself
  15. If Stripe customer exists, cancel all subscriptions via `stripe.subscriptions.cancel()`
- Each soft-delete = `UPDATE SET deleted_at = NOW() WHERE company_id = X AND deleted_at IS NULL`
- Returns `{ success: true, deletedCounts: { ... } }`

**Step 2: Wire up the data-privacy-tab delete button**

Update `handleDeleteAccount` to:
1. Require typing "DELETE" in a text input inside the confirm dialog (add this input)
2. Call the API route
3. On success, sign out the user and redirect to login

```typescript
async function handleDeleteAccount() {
  if (confirmText !== "DELETE") {
    toast.error("Please type DELETE to confirm");
    return;
  }
  setDeleting(true);
  try {
    const { getIdToken } = await import("@/lib/firebase/auth");
    const idToken = await getIdToken();
    const res = await fetch("/api/data/delete-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, companyId: company.id, confirmText }),
    });
    if (!res.ok) throw new Error("Deletion failed");
    toast.success("Account deleted");
    // Sign out and redirect
    const { signOut } = await import("@/lib/firebase/auth");
    await signOut();
    window.location.href = "/login";
  } catch (err) {
    toast.error("Deletion failed", { description: err instanceof Error ? err.message : "Unknown error" });
  } finally {
    setDeleting(false);
  }
}
```

**Step 3: Verify build + commit**

```
feat: build account deletion with cascade soft-delete and Stripe cleanup
```

---

## Environment Variables Required

The following env vars must exist (verify in `.env.local`):

**Already configured (verify):**
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_PRICE_STARTER_MONTHLY`, `STRIPE_PRICE_STARTER_ANNUAL`
- `STRIPE_PRICE_TEAM_MONTHLY`, `STRIPE_PRICE_TEAM_ANNUAL`
- `STRIPE_PRICE_BUSINESS_MONTHLY`, `STRIPE_PRICE_BUSINESS_ANNUAL`
- `SENDGRID_API_KEY`
- `SENDGRID_FROM_EMAIL`
- `NEXT_PUBLIC_APP_URL`

**New (need to add):**
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`

---

## Execution Order

The recommended execution order (respecting dependencies):

1. **Task 1** — Remove Security/PIN (standalone, 5 min)
2. **Task 2** — Team management hooks + UI rebuild (standalone, 30 min)
3. **Task 3** — Wire SendGrid email invites (depends on Task 2 UI, 20 min)
4. **Task 4** — Add Twilio SMS invites (depends on Task 3, 25 min)
5. **Task 5** — Billing tab with Stripe (standalone, 40 min)
6. **Task 6** — Data export (standalone, 20 min)
7. **Task 7** — Account deletion (standalone, 25 min)

Tasks 1, 2, 5, 6 are independent and can be parallelized.
Tasks 3 and 4 must follow Task 2.
Task 7 is independent.

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/app/(dashboard)/settings/page.tsx` | Settings page with tab routing |
| `src/components/settings/team-tab.tsx` | Team management UI |
| `src/components/settings/billing-tab.tsx` | Billing/payment UI |
| `src/components/settings/data-privacy-tab.tsx` | Export + delete UI |
| `src/components/settings/security-tab.tsx` | TO BE DELETED |
| `src/lib/hooks/use-users.ts` | User/team TanStack Query hooks |
| `src/lib/api/services/user-service.ts` | User CRUD + auth workflows |
| `src/lib/api/services/company-service.ts` | Company CRUD + Stripe wrappers |
| `src/lib/email/sendgrid.ts` | SendGrid email sending |
| `src/lib/utils/csv-export.ts` | CSV export utility |
| `src/app/api/auth/send-invite/route.ts` | Invite API (has TODO for email) |
| `src/app/api/stripe/setup-intent/route.ts` | Stripe SetupIntent |
| `src/app/api/stripe/subscribe/route.ts` | Stripe subscription creation |
| `src/app/api/stripe/cancel/route.ts` | Stripe subscription cancellation |
| `src/app/api/webhooks/stripe/route.ts` | Stripe webhook handler |

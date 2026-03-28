# Client Portal Preview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let admins preview their client portal with sample data by clicking "Preview Portal" in Settings > Portal Branding, opening the real portal in a new tab with demo content and their actual branding.

**Architecture:** A special "preview" portal token is created server-side (bypassing email verification), which auto-creates a session flagged `is_preview`. All portal API endpoints check this flag and return hardcoded demo data instead of querying Supabase, while still using the admin's real branding settings.

**Tech Stack:** Next.js API routes, Supabase (migration), TypeScript, TanStack Query, portal CSS custom properties

---

### Task 1: Database Migration — Add `is_preview` Columns

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_add_portal_preview_flag.sql`

**Step 1: Write the migration SQL**

```sql
-- Add preview flag to portal_tokens and portal_sessions
ALTER TABLE portal_tokens
  ADD COLUMN IF NOT EXISTS is_preview boolean NOT NULL DEFAULT false;

ALTER TABLE portal_sessions
  ADD COLUMN IF NOT EXISTS is_preview boolean NOT NULL DEFAULT false;
```

**Step 2: Apply the migration**

Run: `npx supabase db push` or apply via Supabase dashboard.

**Step 3: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(portal): add is_preview column to portal_tokens and portal_sessions"
```

---

### Task 2: Update TypeScript Types and Mappers

**Files:**
- Modify: `src/lib/types/portal.ts:20-41` (PortalToken and PortalSession interfaces)
- Modify: `src/lib/api/services/portal-auth-service.ts:14-39` (mapTokenFromDb and mapSessionFromDb)

**Step 1: Add `isPreview` to PortalToken**

In `src/lib/types/portal.ts`, add `isPreview: boolean;` to the `PortalToken` interface after the `revokedAt` field (line 29):

```typescript
export interface PortalToken {
  id: string;
  companyId: string;
  clientId: string;
  email: string;
  token: string;
  expiresAt: Date;
  verifiedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
  isPreview: boolean;
}
```

**Step 2: Add `isPreview` to PortalSession**

In the same file, add `isPreview: boolean;` to `PortalSession` after `createdAt` (line 40):

```typescript
export interface PortalSession {
  id: string;
  portalTokenId: string;
  sessionToken: string;
  email: string;
  companyId: string;
  clientId: string;
  expiresAt: Date;
  createdAt: Date;
  isPreview: boolean;
}
```

**Step 3: Update `mapTokenFromDb` in portal-auth-service.ts**

Add at line 25 (before the closing brace):

```typescript
isPreview: !!(row.is_preview),
```

**Step 4: Update `mapSessionFromDb` in portal-auth-service.ts**

Add at line 38 (before the closing brace):

```typescript
isPreview: !!(row.is_preview),
```

**Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors (existing code doesn't break because `isPreview` is additive)

**Step 6: Commit**

```bash
git add src/lib/types/portal.ts src/lib/api/services/portal-auth-service.ts
git commit -m "feat(portal): add isPreview field to PortalToken and PortalSession types"
```

---

### Task 3: Add `createPreviewToken` Method to PortalAuthService

**Files:**
- Modify: `src/lib/api/services/portal-auth-service.ts:43-66` (add new method after `createPortalToken`)

**Step 1: Add the method**

Add this method to the `PortalAuthService` object, after `createPortalToken` (around line 66):

```typescript
/**
 * Create a short-lived preview token. No email verification required.
 * Uses a sentinel email and null client ID — preview sessions only serve demo data.
 */
async createPreviewToken(companyId: string): Promise<PortalToken> {
  const supabase = getServiceRoleClient();

  // 15-minute expiry
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("portal_tokens")
    .insert({
      company_id: companyId,
      client_id: "00000000-0000-0000-0000-000000000000",
      email: "preview@ops.app",
      is_preview: true,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create preview token: ${error.message}`);
  return mapTokenFromDb(data);
},
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/lib/api/services/portal-auth-service.ts
git commit -m "feat(portal): add createPreviewToken method to PortalAuthService"
```

---

### Task 4: Create the Preview API Endpoint

**Files:**
- Create: `src/app/api/portal/preview/route.ts`

**Step 1: Create the endpoint**

```typescript
/**
 * POST /api/portal/preview
 *
 * Admin-only route that creates a short-lived preview portal token.
 * Authenticated via Firebase/Supabase auth (dashboard user).
 *
 * Body: { companyId: string }
 * Returns: { token: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { PortalAuthService } from "@/lib/api/services/portal-auth-service";

export async function POST(req: NextRequest) {
  try {
    const admin = await verifyAdminAuth(req);

    if (!admin) {
      return NextResponse.json(
        { error: "Unauthorized - valid admin authentication required" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { companyId } = body as { companyId?: string };

    if (!companyId) {
      return NextResponse.json(
        { error: "Missing required field: companyId" },
        { status: 400 }
      );
    }

    const portalToken = await PortalAuthService.createPreviewToken(companyId);

    return NextResponse.json({ token: portalToken.token });
  } catch (error) {
    console.error("[portal/preview] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create preview token",
      },
      { status: 500 }
    );
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/app/api/portal/preview/route.ts
git commit -m "feat(portal): add POST /api/portal/preview endpoint for admin preview tokens"
```

---

### Task 5: Update Token Validation and Verification for Preview

**Files:**
- Modify: `src/app/api/portal/auth/validate-token/route.ts:32-36` (return `isPreview` in response)
- Modify: `src/app/api/portal/auth/verify/route.ts:28-29` (skip email validation for preview tokens)

**Step 1: Update validate-token to return `isPreview`**

In `src/app/api/portal/auth/validate-token/route.ts`, change the success response (around line 33) from:

```typescript
return NextResponse.json({
  valid: true,
  companyId: portalToken.companyId,
});
```

to:

```typescript
return NextResponse.json({
  valid: true,
  companyId: portalToken.companyId,
  isPreview: portalToken.isPreview,
});
```

**Step 2: Update verify to handle preview tokens**

In `src/app/api/portal/auth/verify/route.ts`, modify the `verifyAndCreateSession` call. Replace the call at line 29:

```typescript
const session = await PortalAuthService.verifyAndCreateSession(token, email);
```

The `verifyAndCreateSession` method needs to handle preview tokens. Instead of modifying it (which could break normal flow), add a preview-specific path before it:

Replace lines 28-29 with:

```typescript
// Look up the token to check if it's a preview token
const portalToken = await PortalAuthService.getTokenByValue(token);

let session;
if (portalToken?.isPreview) {
  // Preview tokens bypass email validation — auto-create session
  session = await PortalAuthService.createPreviewSession(portalToken);
} else {
  // Normal flow: validate email and create session
  session = await PortalAuthService.verifyAndCreateSession(token, email);
}
```

**Step 3: Add `createPreviewSession` to PortalAuthService**

In `src/lib/api/services/portal-auth-service.ts`, add this method after `verifyAndCreateSession`:

```typescript
/**
 * Create a session for a preview token. Skips email validation.
 * Marks the token as verified and creates a session with is_preview = true.
 */
async createPreviewSession(portalToken: PortalToken): Promise<PortalSession> {
  const supabase = getServiceRoleClient();

  // Check expiration
  if (new Date() > portalToken.expiresAt) {
    throw new Error("This preview link has expired");
  }

  // Mark token as verified
  await supabase
    .from("portal_tokens")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", portalToken.id);

  // Create session with preview flag
  const { data, error } = await supabase
    .from("portal_sessions")
    .insert({
      portal_token_id: portalToken.id,
      email: portalToken.email,
      company_id: portalToken.companyId,
      client_id: portalToken.clientId,
      is_preview: true,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create preview session: ${error.message}`);
  return mapSessionFromDb(data);
},
```

**Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

**Step 5: Commit**

```bash
git add src/app/api/portal/auth/validate-token/route.ts src/app/api/portal/auth/verify/route.ts src/lib/api/services/portal-auth-service.ts
git commit -m "feat(portal): handle preview tokens in validate and verify flows"
```

---

### Task 6: Update Token Landing Page for Auto-Verification

**Files:**
- Modify: `src/app/(portal)/portal/[token]/page.tsx` (add auto-verify when `isPreview`)

**Step 1: Update the landing page**

In `src/app/(portal)/portal/[token]/page.tsx`, modify the `validateToken` effect to handle preview tokens. Add `isPreview` state and auto-verify logic.

After the state declarations (line 13), add:

```typescript
const [isPreview, setIsPreview] = useState(false);
```

In the `validateToken` function, after `setStatus("valid")` (around line 23), add:

```typescript
if (data.isPreview) {
  setIsPreview(true);
}
```

Add a new `useEffect` after the validation effect to auto-verify preview tokens:

```typescript
// Auto-verify preview tokens (no email needed)
useEffect(() => {
  if (!isPreview || status !== "valid") return;

  async function autoVerify() {
    setIsVerifying(true);
    try {
      const res = await fetch("/api/portal/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email: "preview@ops.app" }),
      });

      if (res.ok) {
        router.push("/portal/home");
      } else {
        setStatus("error");
        setErrorMessage("Preview session could not be created");
      }
    } catch {
      setStatus("error");
      setErrorMessage("Something went wrong");
    } finally {
      setIsVerifying(false);
    }
  }
  autoVerify();
}, [isPreview, status, token, router]);
```

In the render, when `status === "valid" && isPreview`, show a loading state instead of the email form:

Add before the `{status === "valid" && (` block:

```tsx
{/* Preview: auto-verifying */}
{status === "valid" && isPreview && (
  <div className="flex flex-col items-center gap-3 py-8">
    <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--portal-accent, #417394)" }} />
    <p style={{ color: "var(--portal-text-secondary, #A7A7A7)" }} className="text-sm">
      Loading preview...
    </p>
  </div>
)}
```

Change the existing `{status === "valid" && (` to `{status === "valid" && !isPreview && (` to hide the email form during preview.

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add "src/app/(portal)/portal/[token]/page.tsx"
git commit -m "feat(portal): auto-verify preview tokens on landing page"
```

---

### Task 7: Create Demo Data Module

**Files:**
- Create: `src/lib/api/services/portal-demo-data.ts`

**Step 1: Create the demo data file**

This file contains all hardcoded demo data for preview mode. Key points:
- Uses deterministic IDs prefixed with `preview-` so detail endpoints can match them
- Fetches real company + branding from DB so admin sees their actual customizations
- Returns realistic sample data for a trades business

```typescript
/**
 * OPS Web - Portal Demo Data
 *
 * Hardcoded sample data for portal preview mode.
 * Uses deterministic IDs so detail endpoints can match them.
 * Fetches real company info and branding so the admin sees their actual customizations.
 */

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { PortalBrandingService } from "./portal-branding-service";
import type {
  PortalClientData,
  PortalCompanyInfo,
  PortalEstimate,
  PortalInvoice,
  PortalProject,
  PortalMessage,
} from "@/lib/types/portal";
import type { Client } from "@/lib/types/models";
import type { Estimate, Invoice, LineItem, Payment } from "@/lib/types/pipeline";

// ─── Deterministic IDs ───────────────────────────────────────────────────────

export const PREVIEW_IDS = {
  client: "preview-client-001",
  projects: ["preview-proj-001", "preview-proj-002"],
  estimates: ["preview-est-001", "preview-est-002", "preview-est-003"],
  invoices: ["preview-inv-001", "preview-inv-002", "preview-inv-003"],
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

// ─── Demo Client ─────────────────────────────────────────────────────────────

function getDemoClient(companyId: string): Client {
  return {
    id: PREVIEW_IDS.client,
    name: "Jane Smith",
    email: "jane@example.com",
    phoneNumber: "(555) 123-4567",
    address: "123 Oak Street",
    latitude: null,
    longitude: null,
    profileImageURL: null,
    notes: null,
    companyId,
    lastSyncedAt: null,
    needsSync: false,
    createdAt: daysAgo(90),
    deletedAt: null,
  };
}

// ─── Demo Projects ───────────────────────────────────────────────────────────

function getDemoProjects(): PortalProject[] {
  return [
    {
      id: PREVIEW_IDS.projects[0],
      title: "Kitchen Renovation",
      address: "123 Oak Street",
      status: "in_progress",
      startDate: daysAgo(14),
      endDate: daysFromNow(30),
      projectImages: [],
      estimateCount: 2,
      invoiceCount: 2,
    },
    {
      id: PREVIEW_IDS.projects[1],
      title: "Deck Installation",
      address: "123 Oak Street",
      status: "scheduled",
      startDate: daysFromNow(45),
      endDate: daysFromNow(60),
      projectImages: [],
      estimateCount: 1,
      invoiceCount: 1,
    },
  ];
}

// ─── Demo Estimates ──────────────────────────────────────────────────────────

function getDemoEstimates(): PortalEstimate[] {
  return [
    {
      id: PREVIEW_IDS.estimates[0],
      estimateNumber: "EST-1001",
      title: "Kitchen Countertops & Backsplash",
      status: "sent",
      total: 8750,
      issueDate: daysAgo(3),
      expirationDate: daysFromNow(27),
      hasUnansweredQuestions: true,
      projectId: PREVIEW_IDS.projects[0],
    },
    {
      id: PREVIEW_IDS.estimates[1],
      estimateNumber: "EST-1002",
      title: "Cabinet Refacing",
      status: "approved",
      total: 4200,
      issueDate: daysAgo(21),
      expirationDate: null,
      hasUnansweredQuestions: false,
      projectId: PREVIEW_IDS.projects[0],
    },
    {
      id: PREVIEW_IDS.estimates[2],
      estimateNumber: "EST-1003",
      title: "Composite Deck Build",
      status: "viewed",
      total: 12500,
      issueDate: daysAgo(5),
      expirationDate: daysFromNow(25),
      hasUnansweredQuestions: false,
      projectId: PREVIEW_IDS.projects[1],
    },
  ];
}

// ─── Demo Invoices ───────────────────────────────────────────────────────────

function getDemoInvoices(): PortalInvoice[] {
  return [
    {
      id: PREVIEW_IDS.invoices[0],
      invoiceNumber: "INV-2001",
      subject: "Cabinet Refacing — Deposit",
      status: "sent",
      total: 2100,
      balanceDue: 2100,
      issueDate: daysAgo(7),
      dueDate: daysFromNow(23),
      projectId: PREVIEW_IDS.projects[0],
    },
    {
      id: PREVIEW_IDS.invoices[1],
      invoiceNumber: "INV-2002",
      subject: "Demolition & Prep Work",
      status: "partial",
      total: 3500,
      balanceDue: 1750,
      issueDate: daysAgo(14),
      dueDate: daysAgo(1),
      projectId: PREVIEW_IDS.projects[0],
    },
    {
      id: PREVIEW_IDS.invoices[2],
      invoiceNumber: "INV-2003",
      subject: "Deck Materials Deposit",
      status: "sent",
      total: 6250,
      balanceDue: 6250,
      issueDate: daysAgo(2),
      dueDate: daysFromNow(28),
      projectId: PREVIEW_IDS.projects[1],
    },
  ];
}

// ─── Demo Messages ───────────────────────────────────────────────────────────

function getDemoMessages(companyId: string): PortalMessage[] {
  return [
    {
      id: "preview-msg-001",
      companyId,
      clientId: PREVIEW_IDS.client,
      projectId: PREVIEW_IDS.projects[0],
      estimateId: null,
      invoiceId: null,
      senderType: "company",
      senderName: "Your Company",
      content: "Hi Jane! Just wanted to confirm we're on track for the kitchen renovation. The countertop materials arrive next week.",
      readAt: null,
      createdAt: daysAgo(1),
    },
    {
      id: "preview-msg-002",
      companyId,
      clientId: PREVIEW_IDS.client,
      projectId: PREVIEW_IDS.projects[0],
      estimateId: null,
      invoiceId: null,
      senderType: "client",
      senderName: "Jane Smith",
      content: "That sounds great! Looking forward to seeing the progress.",
      readAt: daysAgo(1),
      createdAt: daysAgo(1),
    },
  ];
}

// ─── Demo Estimate Detail ────────────────────────────────────────────────────

const DEMO_LINE_ITEMS: Record<string, LineItem[]> = {
  [PREVIEW_IDS.estimates[0]]: [
    {
      id: "preview-li-001",
      companyId: "",
      estimateId: PREVIEW_IDS.estimates[0],
      invoiceId: null,
      name: "Granite Countertop — Island",
      description: "Level 3 granite, 48 sq ft, includes cut-out for sink",
      quantity: 1,
      unitPrice: 4200,
      amount: 4200,
      sortOrder: 0,
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
    },
    {
      id: "preview-li-002",
      companyId: "",
      estimateId: PREVIEW_IDS.estimates[0],
      invoiceId: null,
      name: "Tile Backsplash",
      description: "Subway tile, 32 sq ft, includes grout and labor",
      quantity: 1,
      unitPrice: 2800,
      amount: 2800,
      sortOrder: 1,
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
    },
    {
      id: "preview-li-003",
      companyId: "",
      estimateId: PREVIEW_IDS.estimates[0],
      invoiceId: null,
      name: "Demolition & Removal",
      description: "Remove existing countertops and backsplash, haul away debris",
      quantity: 1,
      unitPrice: 1750,
      amount: 1750,
      sortOrder: 2,
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
    },
  ],
  [PREVIEW_IDS.estimates[1]]: [
    {
      id: "preview-li-004",
      companyId: "",
      estimateId: PREVIEW_IDS.estimates[1],
      invoiceId: null,
      name: "Cabinet Door Refacing — 12 doors",
      description: "Shaker style, white oak veneer",
      quantity: 12,
      unitPrice: 275,
      amount: 3300,
      sortOrder: 0,
      createdAt: daysAgo(21),
      updatedAt: daysAgo(21),
    },
    {
      id: "preview-li-005",
      companyId: "",
      estimateId: PREVIEW_IDS.estimates[1],
      invoiceId: null,
      name: "New Hardware — Brushed Brass Pulls",
      description: "12 cabinet pulls + 4 drawer pulls",
      quantity: 16,
      unitPrice: 56.25,
      amount: 900,
      sortOrder: 1,
      createdAt: daysAgo(21),
      updatedAt: daysAgo(21),
    },
  ],
  [PREVIEW_IDS.estimates[2]]: [
    {
      id: "preview-li-006",
      companyId: "",
      estimateId: PREVIEW_IDS.estimates[2],
      invoiceId: null,
      name: "Composite Decking Material",
      description: "Trex Transcend, 400 sq ft, Spiced Rum color",
      quantity: 1,
      unitPrice: 7500,
      amount: 7500,
      sortOrder: 0,
      createdAt: daysAgo(5),
      updatedAt: daysAgo(5),
    },
    {
      id: "preview-li-007",
      companyId: "",
      estimateId: PREVIEW_IDS.estimates[2],
      invoiceId: null,
      name: "Railing System",
      description: "Aluminum railing, 60 linear ft, black",
      quantity: 1,
      unitPrice: 3200,
      amount: 3200,
      sortOrder: 1,
      createdAt: daysAgo(5),
      updatedAt: daysAgo(5),
    },
    {
      id: "preview-li-008",
      companyId: "",
      estimateId: PREVIEW_IDS.estimates[2],
      invoiceId: null,
      name: "Labor — Build & Install",
      description: "Framing, decking, railings, and stairs",
      quantity: 1,
      unitPrice: 1800,
      amount: 1800,
      sortOrder: 2,
      createdAt: daysAgo(5),
      updatedAt: daysAgo(5),
    },
  ],
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the full PortalClientData with demo content.
 * Fetches real company info and branding from the DB so admin sees their customizations.
 */
export async function getDemoPortalData(companyId: string): Promise<PortalClientData> {
  const supabase = getServiceRoleClient();

  // Fetch real company info and branding
  const [companyResult, branding] = await Promise.all([
    supabase
      .from("companies")
      .select("name, logo_url, phone, email")
      .eq("id", companyId)
      .maybeSingle(),
    PortalBrandingService.getBranding(companyId),
  ]);

  const company: PortalCompanyInfo = {
    name: (companyResult.data?.name as string) ?? "Your Company",
    logoUrl: (companyResult.data?.logo_url as string) ?? null,
    phone: (companyResult.data?.phone as string) ?? null,
    email: (companyResult.data?.email as string) ?? null,
  };

  return {
    client: getDemoClient(companyId),
    company,
    branding,
    projects: getDemoProjects(),
    estimates: getDemoEstimates(),
    invoices: getDemoInvoices(),
    unreadMessages: 1,
  };
}

/**
 * Returns a demo estimate with line items for detail view.
 */
export function getDemoEstimateDetail(estimateId: string): {
  id: string;
  estimateNumber: string;
  title: string | null;
  status: string;
  total: number;
  subtotal: number;
  taxRate: number | null;
  taxAmount: number;
  discountType: string | null;
  discountValue: number | null;
  discountAmount: number;
  clientMessage: string | null;
  terms: string | null;
  issueDate: Date;
  expirationDate: Date | null;
  lineItems: LineItem[];
  template: null;
} | null {
  const estimates = getDemoEstimates();
  const est = estimates.find((e) => e.id === estimateId);
  if (!est) return null;

  return {
    id: est.id,
    estimateNumber: est.estimateNumber,
    title: est.title,
    status: est.status,
    total: est.total,
    subtotal: est.total,
    taxRate: null,
    taxAmount: 0,
    discountType: null,
    discountValue: null,
    discountAmount: 0,
    clientMessage: "Thank you for choosing us! Please review the details below.",
    terms: "50% deposit required before work begins. Balance due upon completion.",
    issueDate: est.issueDate,
    expirationDate: est.expirationDate,
    lineItems: DEMO_LINE_ITEMS[est.id] ?? [],
    template: null,
  };
}

/**
 * Returns a demo invoice with line items and payments for detail view.
 */
export function getDemoInvoiceDetail(invoiceId: string): {
  id: string;
  invoiceNumber: string;
  subject: string | null;
  status: string;
  total: number;
  subtotal: number;
  balanceDue: number;
  amountPaid: number;
  taxRate: number | null;
  taxAmount: number;
  discountType: string | null;
  discountValue: number | null;
  discountAmount: number;
  clientMessage: string | null;
  terms: string | null;
  issueDate: Date;
  dueDate: Date;
  lineItems: LineItem[];
  payments: Payment[];
  template: null;
} | null {
  const invoices = getDemoInvoices();
  const inv = invoices.find((i) => i.id === invoiceId);
  if (!inv) return null;

  // Build line items based on invoice
  const lineItems: LineItem[] = [
    {
      id: `${invoiceId}-li-1`,
      companyId: "",
      estimateId: null,
      invoiceId: inv.id,
      name: inv.subject ?? "Services",
      description: "As per agreed scope of work",
      quantity: 1,
      unitPrice: inv.total,
      amount: inv.total,
      sortOrder: 0,
      createdAt: inv.issueDate,
      updatedAt: inv.issueDate,
    },
  ];

  // Build payments for partially paid invoices
  const payments: Payment[] = [];
  if (inv.status === "partial") {
    payments.push({
      id: `${invoiceId}-pay-1`,
      companyId: "",
      invoiceId: inv.id,
      clientId: PREVIEW_IDS.client,
      amount: inv.total - inv.balanceDue,
      paymentMethod: "card",
      referenceNumber: null,
      notes: null,
      paymentDate: daysAgo(7),
      stripePaymentIntent: null,
      createdBy: null,
      createdAt: daysAgo(7),
      voidedAt: null,
      voidedBy: null,
    });
  }

  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    subject: inv.subject,
    status: inv.status,
    total: inv.total,
    subtotal: inv.total,
    balanceDue: inv.balanceDue,
    amountPaid: inv.total - inv.balanceDue,
    taxRate: null,
    taxAmount: 0,
    discountType: null,
    discountValue: null,
    discountAmount: 0,
    clientMessage: null,
    terms: "Payment due within 30 days of invoice date.",
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    lineItems,
    payments,
    template: null,
  };
}

/**
 * Returns demo project detail for a given project ID.
 */
export function getDemoProjectDetail(projectId: string): {
  id: string;
  title: string;
  address: string | null;
  status: string;
  description: string | null;
  startDate: Date | null;
  endDate: Date | null;
  projectImages: string[];
} | null {
  const projects = getDemoProjects();
  const proj = projects.find((p) => p.id === projectId);
  if (!proj) return null;

  return {
    id: proj.id,
    title: proj.title,
    address: proj.address,
    status: proj.status,
    description: proj.id === PREVIEW_IDS.projects[0]
      ? "Full kitchen renovation including countertops, backsplash, and cabinet refacing."
      : "New composite deck with aluminum railing system and built-in stairs.",
    startDate: proj.startDate,
    endDate: proj.endDate,
    projectImages: [],
  };
}

/**
 * Returns demo messages for the messages page.
 */
export function getDemoPortalMessages(companyId: string): PortalMessage[] {
  return getDemoMessages(companyId);
}

/**
 * Check if an ID is a preview ID.
 */
export function isPreviewId(id: string): boolean {
  return id.startsWith("preview-");
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/lib/api/services/portal-demo-data.ts
git commit -m "feat(portal): add demo data module for portal preview mode"
```

---

### Task 8: Update Portal API Endpoints to Serve Demo Data

**Files:**
- Modify: `src/app/api/portal/data/route.ts` (add preview check)
- Modify: `src/app/api/portal/estimates/[id]/route.ts` (add preview check)
- Modify: `src/app/api/portal/invoices/[id]/route.ts` (add preview check)
- Modify: `src/app/api/portal/projects/[id]/route.ts` (add preview check)
- Modify: `src/app/api/portal/messages/route.ts` (add preview check for GET and POST)
- Modify: `src/app/api/portal/estimates/[id]/approve/route.ts` (no-op for preview)
- Modify: `src/app/api/portal/estimates/[id]/decline/route.ts` (no-op for preview)
- Modify: `src/app/api/portal/estimates/[id]/questions/route.ts` (demo data for GET, no-op for POST)
- Modify: `src/app/api/portal/invoices/[id]/pay/route.ts` (no-op for preview)

**Step 1: Update `GET /api/portal/data`**

In `src/app/api/portal/data/route.ts`, add after `const session = result;` (line 19):

```typescript
// Preview mode: return demo data
if (session.isPreview) {
  const { getDemoPortalData } = await import("@/lib/api/services/portal-demo-data");
  const demoData = await getDemoPortalData(session.companyId);
  return NextResponse.json(demoData);
}
```

**Step 2: Update `GET /api/portal/estimates/[id]`**

In `src/app/api/portal/estimates/[id]/route.ts`, add after `const { id } = await params;` (line 55):

```typescript
// Preview mode: return demo estimate
if (session.isPreview) {
  const { getDemoEstimateDetail } = await import("@/lib/api/services/portal-demo-data");
  const demoEstimate = getDemoEstimateDetail(id);
  if (!demoEstimate) {
    return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
  }
  return NextResponse.json(demoEstimate);
}
```

**Step 3: Update `GET /api/portal/invoices/[id]`**

In `src/app/api/portal/invoices/[id]/route.ts`, add after `const { id } = await params;` (line 54):

```typescript
// Preview mode: return demo invoice
if (session.isPreview) {
  const { getDemoInvoiceDetail } = await import("@/lib/api/services/portal-demo-data");
  const demoInvoice = getDemoInvoiceDetail(id);
  if (!demoInvoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  return NextResponse.json(demoInvoice);
}
```

**Step 4: Update `GET /api/portal/projects/[id]`**

In `src/app/api/portal/projects/[id]/route.ts`, add after `const { id } = await params;` (line 26):

```typescript
// Preview mode: return demo project
if (session.isPreview) {
  const { getDemoProjectDetail } = await import("@/lib/api/services/portal-demo-data");
  const demoProject = getDemoProjectDetail(id);
  if (!demoProject) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json(demoProject);
}
```

**Step 5: Update `GET /api/portal/messages` and `POST /api/portal/messages`**

In `src/app/api/portal/messages/route.ts`:

For GET, add after `const session = result;` (line 22):

```typescript
// Preview mode: return demo messages
if (session.isPreview) {
  const { getDemoPortalMessages } = await import("@/lib/api/services/portal-demo-data");
  return NextResponse.json({ messages: getDemoPortalMessages(session.companyId) });
}
```

For POST, add after `const session = result;` (line 51):

```typescript
// Preview mode: no-op, return fake success
if (session.isPreview) {
  return NextResponse.json({
    id: "preview-msg-new",
    content: body.content,
    senderType: "client",
    createdAt: new Date().toISOString(),
  }, { status: 201 });
}
```

**Step 6: Update action endpoints (approve, decline, questions, pay)**

For `src/app/api/portal/estimates/[id]/approve/route.ts`, add after `const { id } = await params;` (line 23):

```typescript
if (session.isPreview) {
  return NextResponse.json({ success: true });
}
```

For `src/app/api/portal/estimates/[id]/decline/route.ts`, add after `const { id } = await params;` (line 24):

```typescript
if (session.isPreview) {
  return NextResponse.json({ success: true });
}
```

For `src/app/api/portal/estimates/[id]/questions/route.ts`:

For GET, add after `const { id: estimateId } = await params;` (line 26):

```typescript
if (session.isPreview) {
  return NextResponse.json({ questions: [], answers: [] });
}
```

For POST, add after `const { id: estimateId } = await params;` (line 52):

```typescript
if (session.isPreview) {
  return NextResponse.json({ success: true, answers: [] });
}
```

For `src/app/api/portal/invoices/[id]/pay/route.ts`, add after `const { id: invoiceId } = await params;` (line 30):

```typescript
if (session.isPreview) {
  return NextResponse.json({ error: "Payments are disabled in preview mode" }, { status: 400 });
}
```

**Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

**Step 8: Commit**

```bash
git add src/app/api/portal/
git commit -m "feat(portal): serve demo data in all portal endpoints for preview sessions"
```

---

### Task 9: Add Preview Mode Banner to Portal Layout

**Files:**
- Modify: `src/app/(portal)/portal/layout.tsx:19-34` (detect preview session, show banner)

**Step 1: Add preview detection and banner**

In `src/app/(portal)/portal/layout.tsx`, add a `isPreview` state (after `unreadMessages` state, line 17):

```typescript
const [isPreview, setIsPreview] = useState(false);
```

In the `loadBranding` effect, after `setUnreadMessages(data.unreadMessages ?? 0);` (line 27), add a check for the preview session. The simplest approach: the `/api/portal/data` response already has the data — but it doesn't currently include `isPreview`. Instead, we can make a lightweight check.

Alternatively, add `isPreview` to the data response for preview sessions. In `src/app/api/portal/data/route.ts`, when returning demo data, add a flag:

Update the preview data return in `src/app/api/portal/data/route.ts` to:

```typescript
if (session.isPreview) {
  const { getDemoPortalData } = await import("@/lib/api/services/portal-demo-data");
  const demoData = await getDemoPortalData(session.companyId);
  return NextResponse.json({ ...demoData, isPreview: true });
}
```

Then in the layout's `loadBranding`, after setting unread messages:

```typescript
if (data.isPreview) {
  setIsPreview(true);
}
```

Now add the banner in the render, right after `<PortalShell branding={branding}>` (line 38):

```tsx
{isPreview && (
  <div
    className="text-center py-2 text-xs font-medium tracking-wide"
    style={{
      backgroundColor: "var(--portal-accent, #417394)",
      color: "#fff",
    }}
  >
    Preview Mode — This is how your clients see your portal
  </div>
)}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add "src/app/(portal)/portal/layout.tsx" src/app/api/portal/data/route.ts
git commit -m "feat(portal): add Preview Mode banner to portal layout"
```

---

### Task 10: Add "Preview Portal" Button to Branding Tab

**Files:**
- Modify: `src/components/settings/portal-branding-tab.tsx:438-454` (add preview button)

**Step 1: Add imports and state**

At the top of `portal-branding-tab.tsx`, add `Eye` to the lucide-react imports (line 4):

```typescript
import {
  Check,
  Loader2,
  Save,
  Moon,
  Sun,
  Eye,
} from "lucide-react";
```

Add `useAuthStore` import is already present (line 16). We need access to the auth token for the API call. Add import for `getAuth` from Firebase:

```typescript
import { getAuth } from "firebase/auth";
```

Inside the component, add state for preview loading (after `isDirty` state, around line 155):

```typescript
const [isPreviewLoading, setIsPreviewLoading] = useState(false);
```

**Step 2: Add the preview handler function**

After the `markDirty` function (around line 210):

```typescript
async function handlePreview() {
  if (!companyId || isPreviewLoading) return;
  setIsPreviewLoading(true);

  try {
    const auth = getAuth();
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error("Not authenticated");

    const res = await fetch("/api/portal/preview", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ companyId }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error ?? "Failed to create preview");
    }

    const { token: previewToken } = await res.json();
    window.open(`/portal/${previewToken}`, "_blank");
  } catch (err) {
    toast.error("Failed to open preview", {
      description: err instanceof Error ? err.message : "Please try again",
    });
  } finally {
    setIsPreviewLoading(false);
  }
}
```

**Step 3: Add the Preview button to the UI**

Replace the save button section (lines 438-454) with:

```tsx
{/* ── Actions ───────────────────────────────────────────────────── */}
<div className="flex items-center justify-between pt-1">
  <p className="font-kosugi text-[11px] text-text-disabled">
    {isDirty
      ? t("portalBranding.unsavedChanges")
      : t("portalBranding.allSaved")}
  </p>
  <div className="flex items-center gap-1.5">
    <Button
      variant="ghost"
      onClick={handlePreview}
      disabled={isPreviewLoading}
      loading={isPreviewLoading}
    >
      <Eye className="w-[16px] h-[16px]" />
      Preview Portal
    </Button>
    <Button
      variant="primary"
      onClick={() => saveMutation.mutate()}
      disabled={!isDirty || saveMutation.isPending || !isValidHex}
      loading={saveMutation.isPending}
    >
      <Save className="w-[16px] h-[16px]" />
      {t("portalBranding.saveBranding")}
    </Button>
  </div>
</div>
```

**Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

**Step 5: Commit**

```bash
git add src/components/settings/portal-branding-tab.tsx
git commit -m "feat(portal): add Preview Portal button to branding settings"
```

---

### Task 11: End-to-End Verification

**Step 1: Run full TypeScript check**

Run: `npx tsc --noEmit`
Expected: Zero errors

**Step 2: Start dev server and test manually**

Run: `npm run dev`

Test the full flow:
1. Navigate to Settings > Client Portal > Branding
2. Click "Preview Portal"
3. Verify new tab opens with the portal
4. Verify auto-verification (no email form shown)
5. Verify demo data appears (Jane Smith, Kitchen Renovation, etc.)
6. Verify your actual branding (colors, template, logo) is applied
7. Verify "Preview Mode" banner appears at top
8. Click into an estimate → verify demo line items load
9. Click into an invoice → verify demo data loads
10. Navigate to messages → verify demo messages appear

**Step 3: Final commit if any fixes needed**

```bash
git commit -m "fix(portal): address issues found during e2e testing"
```

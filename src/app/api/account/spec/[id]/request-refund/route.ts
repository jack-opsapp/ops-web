/**
 * POST /api/account/spec/[id]/request-refund
 *
 * Phase 1 customer Guarantee Refund request endpoint. Strictly buyer- or
 * account_holder-gated. Accepts ONLY a reason_text payload — every other
 * field on `spec_refund_requests` is server-computed. The customer cannot
 * influence eligibility, refund amount, Stripe IDs, internal notes, or
 * entitlement toggles.
 *
 * Auth: Firebase ID token (web dashboard) or Supabase JWT (iOS). The caller
 * must match `spec_projects.buyer_user_id` OR `spec_projects.account_holder_user_id`.
 * Non-members get 404 — never 403 — to avoid existence disclosure.
 *
 * Idempotency: the partial-unique index `spec_refund_one_guarantee_per_project_idx`
 * enforces one active Guarantee invocation per engagement at the DB level.
 * A 23505 from the insert is mapped to HTTP 409.
 *
 * Bible:
 *   - 04_CUSTOMER_UX.md § /account/spec/[id]/request-refund
 *   - 07_ROLLOUT.md § 9A (route contract)
 *   - 02_DATA_MODEL.md § spec_refund_requests + partial-unique index
 *   - 01_BUSINESS_MODEL.md § 3 (refund policy + exclusions)
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { computeRefundEligibility } from "@/lib/spec/refund-eligibility";
import { getSpecOperatorUserIds } from "@/lib/spec/get-spec-operator-user-ids";
import { OPS_OPERATIONS_COMPANY_ID } from "@/lib/spec/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_REASON_LENGTH = 50;
const MAX_REASON_LENGTH = 2000;

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface ProjectRow {
  id: string;
  buyer_user_id: string;
  account_holder_user_id: string | null;
  linked_company_id: string | null;
  tier: string;
  status: string;
  walkthrough_completed_at: string | null;
  customer_email: string | null;
  customer_name: string | null;
}

function extractToken(req: NextRequest): string | null {
  return (
    req.headers.get("authorization")?.replace(/^Bearer /, "") ||
    req.cookies.get("ops-auth-token")?.value ||
    req.cookies.get("__session")?.value ||
    null
  );
}

// Strip C0 control bytes (U+0000-U+001F) and DEL (U+007F), preserving \t,
// \n, and \r which textareas legitimately yield. Bible 04_CUSTOMER_UX.md
// mandates control-char stripping on customer-side reason input.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function sanitizeReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return raw.replace(CONTROL_CHARS, "").trim();
}

export async function POST(
  req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id: projectId } = await context.params;

  // ── 1. Auth ────────────────────────────────────────────────────────────
  const token = extractToken(req);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let verified;
  try {
    verified = await verifyAuthToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = (await findUserByAuth(
    verified.uid,
    verified.email,
    "id"
  )) as { id?: string } | null;
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Body validation ────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const reasonText = sanitizeReason(
    (body as { reason_text?: unknown } | null)?.reason_text
  );
  if (!reasonText) {
    return NextResponse.json(
      { error: "reason_text is required" },
      { status: 422 }
    );
  }
  if (reasonText.length < MIN_REASON_LENGTH) {
    return NextResponse.json(
      {
        error: `reason_text must be at least ${MIN_REASON_LENGTH} characters`,
      },
      { status: 422 }
    );
  }
  if (reasonText.length > MAX_REASON_LENGTH) {
    return NextResponse.json(
      {
        error: `reason_text must be at most ${MAX_REASON_LENGTH} characters`,
      },
      { status: 422 }
    );
  }

  // ── 3. Authorization against the project ──────────────────────────────
  const db = getServiceRoleClient();
  const { data: project, error: projectErr } = await db
    .from("spec_projects")
    .select(
      "id, buyer_user_id, account_holder_user_id, linked_company_id, tier, status, walkthrough_completed_at, customer_email, customer_name"
    )
    .eq("id", projectId)
    .maybeSingle();

  if (projectErr) {
    return NextResponse.json(
      { error: "Failed to load project" },
      { status: 500 }
    );
  }

  const projectRow = project as ProjectRow | null;
  if (
    !projectRow ||
    (projectRow.buyer_user_id !== user.id &&
      projectRow.account_holder_user_id !== user.id)
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // ── 4. Server-computed eligibility ────────────────────────────────────
  const { data: disputed } = await db
    .from("spec_payments")
    .select("id")
    .eq("spec_project_id", projectId)
    .eq("status", "disputed")
    .limit(1);

  const eligibility = computeRefundEligibility({
    walkthroughCompletedAt: projectRow.walkthrough_completed_at,
    status: projectRow.status,
    hasActiveDispute: (disputed?.length ?? 0) > 0,
    now: new Date(),
  });

  // ── 5. Insert spec_refund_requests with SAFE FIELDS ONLY ──────────────
  const { data: inserted, error: insertErr } = await db
    .from("spec_refund_requests")
    .insert({
      spec_project_id: projectId,
      request_source: "customer_initiated",
      customer_reason_text: reasonText,
      is_guarantee_invocation: eligibility.isGuaranteeInvocation,
      is_goodwill: eligibility.isGoodwill,
      status: "pending",
    })
    .select("id")
    .single();

  if (insertErr) {
    // Partial-unique index spec_refund_one_guarantee_per_project_idx.
    if (
      insertErr.code === "23505" ||
      /spec_refund_one_guarantee_per_project_idx/.test(
        insertErr.message ?? ""
      )
    ) {
      return NextResponse.json(
        {
          error:
            "A guarantee refund request is already open for this engagement.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Failed to file request" },
      { status: 500 }
    );
  }

  const requestId = (inserted as { id: string }).id;

  // ── 6. Notifications + internal conversion event (best-effort) ────────
  // Failure here MUST NOT undo the successful insert — the operator
  // notification path is non-critical for record integrity.
  await Promise.allSettled([
    dispatchCustomerAcknowledgement({
      projectId,
      recipientUserId: user.id,
      linkedCompanyId: projectRow.linked_company_id,
    }),
    dispatchOperatorAlert({
      projectId,
      tier: projectRow.tier,
      isGuaranteeInvocation: eligibility.isGuaranteeInvocation,
      customerLabel: projectRow.customer_name ?? projectRow.customer_email ?? "",
    }),
    logInternalRefundInvokedEvent({
      projectId,
      requestId,
      isGuaranteeInvocation: eligibility.isGuaranteeInvocation,
    }),
  ]);

  return NextResponse.json({ request_id: requestId }, { status: 201 });
}

async function dispatchCustomerAcknowledgement(args: {
  projectId: string;
  recipientUserId: string;
  linkedCompanyId: string | null;
}): Promise<void> {
  if (!args.linkedCompanyId) return; // notifications.company_id is NOT NULL
  const db = getServiceRoleClient();
  await db.from("notifications").insert({
    user_id: args.recipientUserId,
    company_id: args.linkedCompanyId,
    type: "spec_refund_requested",
    title: "SPEC refund request filed",
    body: "We received your refund request. Jackson will reach out within 1 business day.",
    is_read: false,
    persistent: false,
    action_url: `/account/spec/${args.projectId}/request-refund`,
    action_label: "VIEW",
  });
}

async function dispatchOperatorAlert(args: {
  projectId: string;
  tier: string;
  isGuaranteeInvocation: boolean;
  customerLabel: string;
}): Promise<void> {
  const operatorIds = await getSpecOperatorUserIds();
  if (operatorIds.length === 0) return;

  const db = getServiceRoleClient();
  const titlePrefix = args.isGuaranteeInvocation
    ? "GUARANTEE REFUND REQUESTED"
    : "REFUND REQUESTED";
  const tier = args.tier.toUpperCase();
  const customer = args.customerLabel?.trim();

  const rows = operatorIds.map((operatorId) => ({
    user_id: operatorId,
    company_id: OPS_OPERATIONS_COMPANY_ID,
    type: "spec_refund_request_pending",
    title: `${titlePrefix} — ${tier}`,
    body: customer
      ? `${customer} filed a refund request. Review in /admin/spec/refunds.`
      : "A customer filed a refund request. Review in /admin/spec/refunds.",
    is_read: false,
    persistent: true,
    action_url: "/admin/spec/refunds",
    action_label: "REVIEW",
  }));

  await db.from("notifications").insert(rows);
}

async function logInternalRefundInvokedEvent(args: {
  projectId: string;
  requestId: string;
  isGuaranteeInvocation: boolean;
}): Promise<void> {
  // `refund_invoked` is internal-only per 04_CUSTOMER_UX.md § Failure modes —
  // explicitly excluded from ad-platform conversion signals. We write it to
  // the conversion_event_outbox marked `internal_only` so the Stage C.1
  // outbox processor skips ad-platform dispatch. If the table doesn't exist
  // yet (pre-Stage A migrations), this is a no-op.
  const db = getServiceRoleClient();
  await db
    .from("conversion_event_outbox")
    .insert({
      event_name: "refund_invoked",
      event_payload: {
        spec_project_id: args.projectId,
        spec_refund_request_id: args.requestId,
        is_guarantee_invocation: args.isGuaranteeInvocation,
      },
      internal_only: true,
    })
    .then(() => undefined, () => undefined);
}

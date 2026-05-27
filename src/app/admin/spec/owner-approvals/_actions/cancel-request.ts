"use server";

import { revalidatePath } from "next/cache";

import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { requireSpecOperatorAction } from "@/lib/admin/spec-operator-guard";
import { writeSpecEmailOutbox } from "@/lib/spec/email-outbox";

/**
 * Cancel a pending owner-approval request.
 *
 * Effects:
 *  - `spec_owner_approval_requests.status = 'expired'`, `decided_at = now()`
 *  - Parent `spec_projects.status = 'cancelled'`,
 *    `cancellation_reason = 'owner_approval_cancelled_by_operator'`
 *  - Notify buyer via the `spec.owner_approval_declined` template (re-purposed
 *    for operator-initiated cancellation — see SPEC/05_ADMIN_UX.md note)
 *  - In-app notification to the buyer
 *
 * Bible: SPEC/05_ADMIN_UX.md § /admin/spec/owner-approvals — Cancel action.
 */

export interface CancelApprovalResult {
  ok: boolean;
  error?: string;
}

export async function cancelApprovalRequestAction(
  _prevState: CancelApprovalResult | null,
  form: FormData,
): Promise<CancelApprovalResult> {
  const ctx = await requireSpecOperatorAction();
  if (!ctx) return { ok: false, error: "Unauthorized" };

  const id = form.get("approvalRequestId");
  if (typeof id !== "string" || !id) {
    return { ok: false, error: "Missing approval request id" };
  }

  const db = getAdminSupabase();

  // Load the approval row + project under the operator gate.
  const { data: approvalRow, error: approvalErr } = await db
    .from("spec_owner_approval_requests")
    .select(
      "id, spec_project_id, status, tier, buyer_user_id, account_holder_user_id, linked_company_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (approvalErr || !approvalRow) {
    return { ok: false, error: "Approval request not found" };
  }
  const approval = approvalRow as {
    id: string;
    spec_project_id: string;
    status: string;
    tier: string;
    buyer_user_id: string;
    account_holder_user_id: string;
    linked_company_id: string;
  };
  if (approval.status !== "pending") {
    return {
      ok: false,
      error: `Approval cannot be cancelled from status '${approval.status}'`,
    };
  }

  const { data: projectRow, error: projectErr } = await db
    .from("spec_projects")
    .select("id, customer_email, customer_name, status")
    .eq("id", approval.spec_project_id)
    .maybeSingle();
  if (projectErr || !projectRow) {
    return { ok: false, error: "Project not found" };
  }
  const project = projectRow as {
    id: string;
    customer_email: string;
    customer_name: string | null;
    status: string;
  };

  const nowIso = new Date().toISOString();

  // Best-effort: cancel the parent project FIRST (the approval-row status
  // transition is the audit anchor; project cancellation MUST land for the
  // operator-cancellation to be coherent).
  const { error: projectUpdateErr } = await db
    .from("spec_projects")
    .update({
      status: "cancelled",
      cancelled_at: nowIso,
      cancellation_reason: "owner_approval_cancelled_by_operator",
      updated_at: nowIso,
    })
    .eq("id", project.id);
  if (projectUpdateErr) {
    return {
      ok: false,
      error: `Failed to cancel project: ${projectUpdateErr.message}`,
    };
  }

  const { error: approvalUpdateErr } = await db
    .from("spec_owner_approval_requests")
    .update({
      status: "expired",
      decided_at: nowIso,
    })
    .eq("id", approval.id);
  if (approvalUpdateErr) {
    return {
      ok: false,
      error: `Failed to update approval row: ${approvalUpdateErr.message}`,
    };
  }

  // Best-effort buyer email + in-app notification.
  await Promise.allSettled([
    writeSpecEmailOutbox({
      templateId: "spec.owner_approval_declined",
      recipientEmail: project.customer_email,
      recipientUserId: approval.buyer_user_id,
      specProjectId: project.id,
      payload: {
        customer_name: project.customer_name,
        tier: approval.tier,
        // Distinguish operator-initiated cancellation from
        // account_holder-initiated decline in the template payload.
        cancellation_reason: "owner_approval_cancelled_by_operator",
        cancelled_at: nowIso,
      },
    }),
    db.from("notifications").insert({
      user_id: approval.buyer_user_id,
      company_id: approval.linked_company_id,
      type: "spec_owner_approval_cancelled",
      title: "SPEC request cancelled",
      body: "Your SPEC purchase request has been cancelled. Reach out if this was unexpected.",
      is_read: false,
      persistent: false,
      action_url: "/spec",
      action_label: "VIEW",
    }),
  ]);

  revalidatePath("/admin/spec/owner-approvals");
  revalidatePath("/admin/spec");

  return { ok: true };
}

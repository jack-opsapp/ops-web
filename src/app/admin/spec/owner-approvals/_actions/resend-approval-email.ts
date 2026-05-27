"use server";

import { revalidatePath } from "next/cache";

import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { requireSpecOperatorAction } from "@/lib/admin/spec-operator-guard";
import { writeSpecEmailOutbox } from "@/lib/spec/email-outbox";

/**
 * Resend the `spec.owner_approval_required` email for a pending owner-approval
 * request. The approval-token hash is NOT regenerated — we reuse the existing
 * one so the original URL still works (and so the cron-driven token-expiry
 * countdown isn't reset).
 *
 * Bible: SPEC/05_ADMIN_UX.md § /admin/spec/owner-approvals — Resend action.
 */

export interface ResendApprovalEmailResult {
  ok: boolean;
  error?: string;
}

export async function resendApprovalEmailAction(
  _prevState: ResendApprovalEmailResult | null,
  form: FormData,
): Promise<ResendApprovalEmailResult> {
  const ctx = await requireSpecOperatorAction();
  if (!ctx) return { ok: false, error: "Unauthorized" };

  const id = form.get("approvalRequestId");
  if (typeof id !== "string" || !id) {
    return { ok: false, error: "Missing approval request id" };
  }

  const db = getAdminSupabase();

  const { data: approvalRow, error: approvalErr } = await db
    .from("spec_owner_approval_requests")
    .select(
      "id, spec_project_id, status, tier, approved_total_cents, approved_deposit_cents, account_holder_user_id, buyer_user_id, linked_company_id",
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
    approved_total_cents: number;
    approved_deposit_cents: number;
    account_holder_user_id: string;
    buyer_user_id: string;
    linked_company_id: string;
  };
  if (approval.status !== "pending") {
    return {
      ok: false,
      error: `Approval cannot be resent from status '${approval.status}'`,
    };
  }

  // Load account_holder + buyer + company name for the template payload.
  const [{ data: users }, { data: company }] = await Promise.all([
    db
      .from("users")
      .select("id, email, name")
      .in("id", [approval.account_holder_user_id, approval.buyer_user_id]),
    db
      .from("companies")
      .select("id, name")
      .eq("id", approval.linked_company_id)
      .maybeSingle(),
  ]);
  const userById = new Map(
    (users ?? []).map((u) => [
      (u as { id: string }).id,
      {
        email: (u as { email?: string }).email ?? null,
        name: (u as { name?: string }).name ?? null,
      },
    ]),
  );
  const accountHolder = userById.get(approval.account_holder_user_id);
  const buyer = userById.get(approval.buyer_user_id);
  if (!accountHolder?.email) {
    return { ok: false, error: "Account holder email missing" };
  }

  const result = await writeSpecEmailOutbox({
    templateId: "spec.owner_approval_required",
    recipientEmail: accountHolder.email,
    recipientUserId: approval.account_holder_user_id,
    specProjectId: approval.spec_project_id,
    payload: {
      account_holder_name: accountHolder.name,
      buyer_name: buyer?.name ?? null,
      buyer_email: buyer?.email ?? null,
      company_name: (company as { name?: string } | null)?.name ?? null,
      tier: approval.tier,
      approved_total_cents: approval.approved_total_cents,
      approved_deposit_cents: approval.approved_deposit_cents,
      // Token reuse — Stage H template embeds the existing token hash via the
      // payload's `approval_request_id`. The customer route resolves the link.
      approval_request_id: approval.id,
      is_resend: true,
    },
  });

  if ("error" in result) {
    return { ok: false, error: result.error };
  }

  revalidatePath("/admin/spec/owner-approvals");
  revalidatePath("/admin/spec");

  return { ok: true };
}

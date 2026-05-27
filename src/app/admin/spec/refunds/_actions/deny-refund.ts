"use server";

import { revalidatePath } from "next/cache";

import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { requireSpecOperatorAction } from "@/lib/admin/spec-operator-guard";
import { writeSpecEmailOutbox } from "@/lib/spec/email-outbox";

/**
 * Deny a pending refund request.
 *
 * Updates the request row with denial metadata, queues the `spec.refund_denied`
 * email outbox row, and writes a customer notification. The customer's
 * engagement is NOT affected — no entitlement flips, no project-status change.
 *
 * Re-checks the operator gate. The denial reason text is required (the
 * customer-facing email surfaces it verbatim — Jackson must write something).
 *
 * Bible: SPEC/05_ADMIN_UX.md § /admin/spec/refunds — Deny action.
 */

const MIN_DENIAL_REASON_LENGTH = 20;
const MAX_DENIAL_REASON_LENGTH = 2000;

export interface DenyRefundResult {
  ok: boolean;
  error?: string;
}

interface DenyPayload {
  refundRequestId: string;
  denialReason: string;
  internalNote: string | null;
}

function parseForm(form: FormData): DenyPayload | null {
  const refundRequestId = form.get("refundRequestId");
  const denialReason = form.get("denialReason");
  if (typeof refundRequestId !== "string" || !refundRequestId) return null;
  if (typeof denialReason !== "string") return null;
  const trimmed = denialReason.trim();
  if (
    trimmed.length < MIN_DENIAL_REASON_LENGTH ||
    trimmed.length > MAX_DENIAL_REASON_LENGTH
  ) {
    return null;
  }
  const internalNote = form.get("internalNote");
  return {
    refundRequestId,
    denialReason: trimmed,
    internalNote:
      typeof internalNote === "string" && internalNote.trim().length > 0
        ? internalNote.trim().slice(0, 4000)
        : null,
  };
}

export async function denyRefundAction(
  _prevState: DenyRefundResult | null,
  form: FormData,
): Promise<DenyRefundResult> {
  const ctx = await requireSpecOperatorAction();
  if (!ctx) return { ok: false, error: "Unauthorized" };

  const payload = parseForm(form);
  if (!payload) {
    return {
      ok: false,
      error: `Denial reason must be ${MIN_DENIAL_REASON_LENGTH}–${MAX_DENIAL_REASON_LENGTH} characters`,
    };
  }

  const db = getAdminSupabase();

  // Load the request + parent project under the operator gate.
  const { data: refundRow, error: refundErr } = await db
    .from("spec_refund_requests")
    .select(
      "id, spec_project_id, status, customer_reason_text, is_guarantee_invocation, is_goodwill",
    )
    .eq("id", payload.refundRequestId)
    .maybeSingle();
  if (refundErr || !refundRow) {
    return { ok: false, error: "Refund request not found" };
  }
  const refund = refundRow as {
    id: string;
    spec_project_id: string;
    status: string;
    customer_reason_text: string | null;
    is_guarantee_invocation: boolean | null;
    is_goodwill: boolean | null;
  };
  if (refund.status !== "pending") {
    return {
      ok: false,
      error: `Refund cannot be denied from status '${refund.status}'`,
    };
  }

  const { data: projectRow, error: projectErr } = await db
    .from("spec_projects")
    .select(
      "id, tier, customer_name, customer_email, linked_company_id, buyer_user_id",
    )
    .eq("id", refund.spec_project_id)
    .maybeSingle();
  if (projectErr || !projectRow) {
    return { ok: false, error: "Project not found" };
  }
  const project = projectRow as {
    id: string;
    tier: string;
    customer_name: string | null;
    customer_email: string;
    linked_company_id: string | null;
    buyer_user_id: string;
  };

  const nowIso = new Date().toISOString();
  const { error: updateErr } = await db
    .from("spec_refund_requests")
    .update({
      status: "denied",
      denied_at: nowIso,
      denied_by_user_id: ctx.userId,
      denial_reason_text: payload.denialReason,
      internal_note: payload.internalNote ?? undefined,
    })
    .eq("id", payload.refundRequestId);
  if (updateErr) {
    return { ok: false, error: `DB update failed: ${updateErr.message}` };
  }

  // Best-effort customer email + notification.
  await Promise.allSettled([
    writeSpecEmailOutbox({
      templateId: "spec.refund_denied",
      recipientEmail: project.customer_email,
      recipientUserId: project.buyer_user_id,
      specProjectId: project.id,
      payload: {
        customer_name: project.customer_name,
        tier: project.tier,
        denial_reason_text: payload.denialReason,
        is_guarantee_invocation: refund.is_guarantee_invocation === true,
        is_goodwill: refund.is_goodwill === true,
        customer_reason_text: refund.customer_reason_text,
        denied_at: nowIso,
      },
    }),
    project.linked_company_id
      ? db.from("notifications").insert({
          user_id: project.buyer_user_id,
          company_id: project.linked_company_id,
          type: "spec_refund_denied",
          title: "Refund request denied",
          body: "Your SPEC refund request has been reviewed. Check your email for details.",
          is_read: false,
          persistent: false,
          action_url: `/account/spec/${project.id}/request-refund`,
          action_label: "VIEW",
        })
      : Promise.resolve(),
  ]);

  revalidatePath("/admin/spec/refunds");
  revalidatePath("/admin/spec");

  return { ok: true };
}

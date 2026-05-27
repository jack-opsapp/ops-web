"use server";

import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { loadSpecProjectMinimal } from "@/lib/admin/spec-queries";
import { writeSpecEmailOutbox } from "@/lib/spec/email-outbox";
import {
  SPEC_ENTITLEMENT_CLEARABLE_REASONS,
  SPEC_ENTITLEMENT_TERMINAL_REASONS,
  type SpecEntitlementDisabledReason,
} from "@/lib/admin/spec-types";
import { OPS_OPERATIONS_COMPANY_ID } from "@/lib/admin/spec-constants";
import { denyNonOperator, requireSpecOperatorUserId } from "./_require-operator";

const VALID_DISABLED_REASONS: readonly SpecEntitlementDisabledReason[] = [
  "non_payment",
  "dispute",
  "refunded",
  "subscription_lapse",
  "customer_request",
  "ops_decision",
  "not_yet_delivered",
];

/**
 * Operationally critical action — toggles a `spec_module_entitlements` row
 * between `enabled = true` and `enabled = false`. Customer sees their access
 * to the module flip immediately.
 *
 * Hard rules enforced server-side:
 *   - Operator gate re-verified.
 *   - Entitlement row must exist and belong to the named project.
 *   - When DISABLING: `disable_reason` is required and must match the
 *     CHECK constraint enumeration. Stamps `disabled_at = now()`.
 *   - When ENABLING: existing `disabled_reason` must be CLEARABLE — i.e. NOT
 *     `refunded` or `subscription_lapse` (those are terminal and require the
 *     refund/Stripe flows to clear, not the operator toggle).
 *
 * Side effects on every successful toggle:
 *   1. UPDATE `spec_module_entitlements` (enabled, disabled_reason,
 *      enabled_at / disabled_at, updated_at).
 *   2. INSERT `audit_log` row (operator-scope: company_id = OPS_OPERATIONS,
 *      table_name = 'spec_module_entitlements', action = 'UPDATE').
 *   3. INSERT `spec_communications` row (channel = 'system') so Tab 2 + Tab 9
 *      reflect the change.
 *   4. INSERT `notifications` row to the customer's linked_company_id (rail
 *      notification — the customer's in-app rail catches this and shows the
 *      module's enabled/disabled state immediately).
 *   5. INSERT `spec_email_outbox` row with template
 *      `spec.entitlement_disabled` / `spec.entitlement_enabled`. NOTE: these
 *      template_ids are NOT yet registered in Stage H — flagged in the chip
 *      summary. The outbox row queues correctly; Stage H ignores unregistered
 *      template_ids until a future Stage H drop adds the renderers.
 *   6. INSERT `notifications` row for the operator rail.
 *   7. revalidatePath the project detail.
 */
export async function toggleEntitlement(formData: FormData): Promise<void> {
  const operatorId = await requireSpecOperatorUserId();
  if (!operatorId) denyNonOperator();

  const projectId = strField(formData, "project_id");
  const entitlementId = strField(formData, "entitlement_id");
  const intendedRaw = strField(formData, "intended_state");
  const disabledReasonRaw = strField(formData, "disabled_reason");

  if (!projectId) throw new Error("SYS :: MISSING PROJECT ID");
  if (!entitlementId) throw new Error("SYS :: MISSING ENTITLEMENT ID");
  if (intendedRaw !== "enabled" && intendedRaw !== "disabled") {
    throw new Error("SYS :: INVALID INTENDED STATE");
  }

  const project = await loadSpecProjectMinimal(projectId);
  if (!project) throw new Error("SYS :: PROJECT NOT FOUND");

  const db = getAdminSupabase();

  // Load + verify entitlement belongs to this project.
  const { data: oldRowRaw, error: oldErr } = await db
    .from("spec_module_entitlements")
    .select(
      "id, spec_project_id, company_id, module_key, enabled, disabled_reason, multiplier, surcharge_cents, stripe_subscription_item_id, entitled_at, enabled_at, disabled_at, updated_at, is_test",
    )
    .eq("id", entitlementId)
    .maybeSingle();
  if (oldErr) throw new Error(`SYS :: ENTITLEMENT LOOKUP FAILED · ${oldErr.message}`);
  if (!oldRowRaw) throw new Error("SYS :: ENTITLEMENT NOT FOUND");
  const oldRow = oldRowRaw as {
    id: string;
    spec_project_id: string;
    company_id: string;
    module_key: string;
    enabled: boolean;
    disabled_reason: SpecEntitlementDisabledReason | null;
  };
  if (oldRow.spec_project_id !== projectId) {
    throw new Error("SYS :: ENTITLEMENT DOES NOT BELONG TO PROJECT");
  }

  const nowIso = new Date().toISOString();

  let updatePayload: {
    enabled: boolean;
    disabled_reason: SpecEntitlementDisabledReason | null;
    enabled_at?: string | null;
    disabled_at?: string | null;
    updated_at: string;
  };
  let changeKind: "enabled" | "disabled";
  let auditDescription: string;

  if (intendedRaw === "disabled") {
    // DISABLING — validate reason.
    if (!VALID_DISABLED_REASONS.includes(disabledReasonRaw as SpecEntitlementDisabledReason)) {
      throw new Error(
        `SYS :: DISABLED REASON REQUIRED — one of ${VALID_DISABLED_REASONS.join(", ")}`,
      );
    }
    if (!oldRow.enabled) {
      throw new Error("SYS :: ALREADY DISABLED — NOTHING TO TOGGLE");
    }

    const reason = disabledReasonRaw as SpecEntitlementDisabledReason;
    updatePayload = {
      enabled: false,
      disabled_reason: reason,
      disabled_at: nowIso,
      updated_at: nowIso,
    };
    changeKind = "disabled";
    auditDescription = `Disabled — reason: ${reason}`;
  } else {
    // ENABLING — must not be terminal-reason.
    if (oldRow.enabled) {
      throw new Error("SYS :: ALREADY ENABLED — NOTHING TO TOGGLE");
    }
    if (
      oldRow.disabled_reason != null &&
      SPEC_ENTITLEMENT_TERMINAL_REASONS.includes(oldRow.disabled_reason)
    ) {
      throw new Error(
        `SYS :: TERMINAL DISABLED REASON · ${oldRow.disabled_reason} — operator cannot clear. Use refund/Stripe flow.`,
      );
    }
    if (
      oldRow.disabled_reason != null &&
      !SPEC_ENTITLEMENT_CLEARABLE_REASONS.includes(oldRow.disabled_reason)
    ) {
      // Defense in depth — shouldn't hit this unless schema diverges.
      throw new Error("SYS :: DISABLED REASON NOT CLEARABLE BY OPERATOR");
    }

    updatePayload = {
      enabled: true,
      disabled_reason: null,
      enabled_at: nowIso,
      updated_at: nowIso,
    };
    changeKind = "enabled";
    auditDescription = `Enabled — previous reason cleared (${oldRow.disabled_reason ?? "none"})`;
  }

  // 1. UPDATE the entitlement row.
  const { data: newRow, error: updateErr } = await db
    .from("spec_module_entitlements")
    .update(updatePayload)
    .eq("id", entitlementId)
    .select("*")
    .maybeSingle();
  if (updateErr) throw new Error(`SYS :: ENTITLEMENT UPDATE FAILED · ${updateErr.message}`);
  if (!newRow) throw new Error("SYS :: ENTITLEMENT UPDATE RETURNED NO ROW");

  // 2. audit_log row (operator scope).
  const { error: auditErr } = await db.from("audit_log").insert({
    table_name: "spec_module_entitlements",
    record_id: entitlementId,
    company_id: OPS_OPERATIONS_COMPANY_ID,
    action: "UPDATE",
    old_data: oldRowRaw,
    new_data: newRow,
    changed_by: operatorId,
  });
  if (auditErr) {
    // Audit is non-fatal — the toggle has already committed. Log + continue.
    console.error("[toggleEntitlement] audit_log insert failed:", auditErr.message);
  }

  // 3. spec_communications system entry (timeline + Tab 9).
  await db.from("spec_communications").insert({
    spec_project_id: projectId,
    direction: "outbound",
    channel: "system",
    summary: `Module entitlement · ${oldRow.module_key} · ${auditDescription}`,
    body: null,
    logged_by_user_id: operatorId,
    is_test: !!project.is_test,
  });

  // 4. Customer-facing in-app notification (rail).
  //    Critical: customer needs to see they've lost / regained access.
  //    Gated on linked_company_id being set — operator audit row above is
  //    always written even if we can't reach the customer rail.
  if (oldRow.company_id) {
    const customerNotifBody =
      changeKind === "disabled"
        ? `${formatModuleKey(oldRow.module_key)} access has been disabled. Reason: ${prettyReason(
            updatePayload.disabled_reason!,
          )}. We're in touch via email.`
        : `${formatModuleKey(oldRow.module_key)} access has been restored. You'll see the module reappear in OPS-Web within a minute.`;

    await db.from("notifications").insert({
      // Customer-side rail: addressed to the company, not a specific user.
      // The in-app rail consumer fans out to all company members.
      user_id: project.buyer_user_id,
      company_id: oldRow.company_id,
      type: changeKind === "disabled" ? "spec_entitlement_disabled" : "spec_entitlement_enabled",
      title:
        changeKind === "disabled"
          ? `Module access removed: ${formatModuleKey(oldRow.module_key)}`
          : `Module access restored: ${formatModuleKey(oldRow.module_key)}`,
      body: customerNotifBody,
      is_read: false,
      persistent: changeKind === "disabled", // Critical state — stays until acknowledged.
      action_url: "/dashboard",
      action_label: "OPEN OPS",
    });
  }

  // 5. Email outbox row — Stage H queue. Template not yet registered (flagged
  //    as a follow-up; see chip summary). The row queues correctly and ships
  //    once Stage H adds the renderer.
  const templateId =
    changeKind === "disabled" ? "spec.entitlement_disabled" : "spec.entitlement_enabled";
  const outboxResult = await writeSpecEmailOutbox({
    templateId,
    recipientEmail: project.customer_email,
    recipientUserId: project.buyer_user_id,
    specProjectId: projectId,
    payload: {
      spec_project_id: projectId,
      module_key: oldRow.module_key,
      module_label: formatModuleKey(oldRow.module_key),
      change_kind: changeKind,
      disabled_reason: updatePayload.disabled_reason ?? null,
      customer_name: project.customer_name,
    },
    isTest: !!project.is_test,
  });
  if ("error" in outboxResult) {
    console.error("[toggleEntitlement] email outbox enqueue failed:", outboxResult.error);
  }

  // 6. Operator rail notification.
  await db.from("notifications").insert({
    user_id: operatorId,
    company_id: OPS_OPERATIONS_COMPANY_ID,
    type:
      changeKind === "disabled"
        ? "spec_entitlement_disabled_op"
        : "spec_entitlement_enabled_op",
    title: `Entitlement ${changeKind}`,
    body: `${project.customer_name ?? project.customer_email} · ${oldRow.module_key} · ${auditDescription}`,
    is_read: false,
    action_url: `/admin/spec/${projectId}?tab=entitlements`,
    action_label: "VIEW ENTITLEMENTS",
  });

  revalidatePath(`/admin/spec/${projectId}`);
}

function strField(form: FormData, key: string): string {
  const v = form.get(key);
  if (typeof v !== "string") return "";
  return v.trim();
}

function formatModuleKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function prettyReason(r: SpecEntitlementDisabledReason): string {
  switch (r) {
    case "non_payment":
      return "non-payment";
    case "dispute":
      return "billing dispute";
    case "refunded":
      return "refund processed";
    case "subscription_lapse":
      return "subscription lapsed";
    case "customer_request":
      return "customer request";
    case "ops_decision":
      return "operator decision";
    case "not_yet_delivered":
      return "not yet delivered";
  }
}

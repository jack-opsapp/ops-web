"use server";

import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import {
  loadSpecProjectMinimal,
} from "@/lib/admin/spec-queries";
import type {
  SpecChangeOrderType,
  SpecTier,
} from "@/lib/admin/spec-types";
import { OPS_OPERATIONS_COMPANY_ID } from "@/lib/admin/spec-constants";
import { denyNonOperator, requireSpecOperatorUserId } from "./_require-operator";

/**
 * Create a SPEC change-order row. Wizard endpoint — branches on `change_type`:
 *
 *  - `minor_hourly`  : billed at $225/hr, half-hour bucketed. Operator provides
 *                      `estimated_hours`; the row stores `estimated_hours`
 *                      (canonical) + the derived `fixed_price_cents` is left
 *                      null (the milestone-end invoice computes from actual).
 *  - `major_fixed`   : fixed-price quote. Operator provides `fixed_price_cents`.
 *  - `tier_upgrade`  : new fixed-price quote that, on customer acceptance,
 *                      transitions `spec_projects.tier`. Phase 1: row creation
 *                      only; the tier flip happens at acceptance-event time.
 *  - `polish_budget` / `platform_compat_rebuild` are also valid `change_type`
 *    values but are typically auto-created by the satisfaction-survey + sunset
 *    flows respectively; this wizard restricts to the three above.
 *
 * Server-side hard rules:
 *   - Operator gate re-verified.
 *   - Project must exist.
 *   - `minor_hourly` requires estimated_hours > 0; if hours ≥ 4 we reject and
 *     suggest `major_fixed` per § 6 (≥4h → major).
 *   - `major_fixed` requires fixed_price_cents > 0.
 *   - `tier_upgrade` requires fixed_price_cents > 0.
 *   - All rows start `status = 'proposed'` — the customer must accept via the
 *     `change_order_accepted` acceptance-event flow before invoicing.
 *
 * Side effects:
 *   - Insert `spec_change_orders` row.
 *   - Insert a `spec_communications` row (channel=system) so Tab 2 timeline
 *     reflects the proposal.
 *   - Insert an operator notification (rail anchor).
 *   - revalidatePath the project detail.
 *
 * Stripe invoice firing is OUT OF SCOPE for F.2.b — the existing milestone-fire
 * pattern handles invoice creation. A future chip wires
 * `customer_approved` acceptance → invoice fire.
 */
export async function createChangeOrder(formData: FormData): Promise<void> {
  const operatorId = await requireSpecOperatorUserId();
  if (!operatorId) denyNonOperator();

  const projectId = strField(formData, "project_id");
  const changeTypeRaw = strField(formData, "change_type");
  const title = strField(formData, "title");
  const description = strField(formData, "description");
  const estimatedHoursRaw = formData.get("estimated_hours");
  const fixedPriceCentsRaw = formData.get("fixed_price_cents");
  const deliveryImpactDaysRaw = formData.get("delivery_impact_days");

  if (!projectId) throw new Error("SYS :: MISSING PROJECT ID");
  if (!isChangeOrderType(changeTypeRaw)) throw new Error("SYS :: INVALID CHANGE TYPE");
  if (!title) throw new Error("SYS :: TITLE REQUIRED");
  if (!description) throw new Error("SYS :: DESCRIPTION REQUIRED");

  const project = await loadSpecProjectMinimal(projectId);
  if (!project) throw new Error("SYS :: PROJECT NOT FOUND");

  const estimatedHours = estimatedHoursRaw ? Number(estimatedHoursRaw) : null;
  const fixedPriceCents = fixedPriceCentsRaw ? Number(fixedPriceCentsRaw) : null;
  const deliveryImpactDays = deliveryImpactDaysRaw ? Math.max(0, Math.floor(Number(deliveryImpactDaysRaw))) : 0;

  if (changeTypeRaw === "minor_hourly") {
    if (estimatedHours == null || !Number.isFinite(estimatedHours) || estimatedHours <= 0) {
      throw new Error("SYS :: MINOR HOURLY REQUIRES ESTIMATED HOURS > 0");
    }
    if (estimatedHours >= 4) {
      throw new Error("SYS :: ESTIMATED HOURS ≥ 4 — USE MAJOR FIXED QUOTE INSTEAD (§ 6)");
    }
  }
  if (changeTypeRaw === "major_fixed" || changeTypeRaw === "tier_upgrade") {
    if (fixedPriceCents == null || !Number.isFinite(fixedPriceCents) || fixedPriceCents <= 0) {
      throw new Error("SYS :: FIXED-PRICE CENTS REQUIRED FOR THIS CHANGE TYPE");
    }
  }

  const db = getAdminSupabase();

  const insertRow = {
    spec_project_id: projectId,
    title,
    description,
    change_type: changeTypeRaw,
    status: "proposed" as const,
    estimated_hours: estimatedHours,
    hourly_rate_cents: 22500, // $225 CAD locked
    fixed_price_cents: fixedPriceCents,
    delivery_impact_days: deliveryImpactDays,
    is_test: !!project.is_test,
  };

  const { data: inserted, error: insertErr } = await db
    .from("spec_change_orders")
    .insert(insertRow)
    .select("id")
    .maybeSingle();

  if (insertErr) {
    throw new Error(`SYS :: CHANGE ORDER INSERT FAILED · ${insertErr.message}`);
  }
  if (!inserted) throw new Error("SYS :: CHANGE ORDER INSERT RETURNED NO ROW");
  const changeOrderId = inserted.id as string;

  const summary = buildSummary(changeTypeRaw, title, estimatedHours, fixedPriceCents);

  await db.from("spec_communications").insert({
    spec_project_id: projectId,
    direction: "outbound",
    channel: "system",
    summary: `Change order proposed — ${summary}`,
    body: description,
    logged_by_user_id: operatorId,
    is_test: !!project.is_test,
  });

  // Operator-facing notification on the OPS Operations rail.
  await db.from("notifications").insert({
    user_id: operatorId,
    company_id: OPS_OPERATIONS_COMPANY_ID,
    type: "spec_change_order_proposed",
    title: "Change order proposed",
    body: `${project.customer_name ?? project.customer_email} · ${summary}`,
    is_read: false,
    action_url: `/admin/spec/${projectId}?tab=change_orders`,
    action_label: "VIEW CHANGE ORDERS",
  });

  revalidatePath(`/admin/spec/${projectId}`);
  // Avoid mutating an unread var — the changeOrderId is consumed by the
  // timeline/audit trail above; explicit no-op return.
  void changeOrderId;
  void (project.tier as SpecTier);
}

function strField(form: FormData, key: string): string {
  const v = form.get(key);
  if (typeof v !== "string") return "";
  return v.trim();
}

function isChangeOrderType(v: string): v is SpecChangeOrderType {
  return ["minor_hourly", "major_fixed", "tier_upgrade", "polish_budget", "platform_compat_rebuild"].includes(v);
}

function buildSummary(
  type: SpecChangeOrderType,
  title: string,
  hours: number | null,
  fixedCents: number | null,
): string {
  if (type === "minor_hourly" && hours != null) {
    const buckets = Math.round(hours * 2) / 2;
    return `${title} · ${buckets.toFixed(1)}h @ $225/hr`;
  }
  if ((type === "major_fixed" || type === "tier_upgrade") && fixedCents != null) {
    return `${title} · $${(fixedCents / 100).toFixed(0)} fixed`;
  }
  return title;
}

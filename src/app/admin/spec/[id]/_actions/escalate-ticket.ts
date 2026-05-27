"use server";

import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { loadSpecProjectMinimal } from "@/lib/admin/spec-queries";
import type { SpecTicketSeverity } from "@/lib/admin/spec-types";
import { OPS_OPERATIONS_COMPANY_ID } from "@/lib/admin/spec-constants";
import { denyNonOperator, requireSpecOperatorUserId } from "./_require-operator";

const VALID_SEVERITY: readonly SpecTicketSeverity[] = ["critical", "high", "cosmetic_enhancement"];

/**
 * Two operations packaged into one action, branched by `op`:
 *
 *   - `reclassify` — change the severity (e.g. customer files as "critical"
 *     but it's clearly cosmetic). Stamps the original `customer_classification`
 *     once (if not already set), then writes the new `severity`.
 *   - `escalate_to_change_order` — close the ticket as
 *     `escalated_to_change_order`, create a proposed `spec_change_orders` row
 *     (linked back via `linked_change_order_id`), and write the audit trail.
 *     The change order's defaults: change_type = 'minor_hourly', proposed.
 *     The operator can then edit the change order from Tab 6.
 */
export async function escalateTicket(formData: FormData): Promise<void> {
  const operatorId = await requireSpecOperatorUserId();
  if (!operatorId) denyNonOperator();

  const projectId = strField(formData, "project_id");
  const ticketId = strField(formData, "ticket_id");
  const op = strField(formData, "op");

  if (!projectId) throw new Error("SYS :: MISSING PROJECT ID");
  if (!ticketId) throw new Error("SYS :: MISSING TICKET ID");
  if (op !== "reclassify" && op !== "escalate_to_change_order") {
    throw new Error("SYS :: INVALID OP");
  }

  const project = await loadSpecProjectMinimal(projectId);
  if (!project) throw new Error("SYS :: PROJECT NOT FOUND");

  const db = getAdminSupabase();

  // Load the ticket and verify it belongs to this project.
  const { data: ticketRaw, error: ticketErr } = await db
    .from("spec_support_tickets")
    .select("id, title, description, severity, customer_classification, status, spec_project_id")
    .eq("id", ticketId)
    .maybeSingle();
  if (ticketErr) throw new Error(`SYS :: TICKET LOOKUP FAILED · ${ticketErr.message}`);
  if (!ticketRaw) throw new Error("SYS :: TICKET NOT FOUND");
  if ((ticketRaw.spec_project_id as string) !== projectId) {
    throw new Error("SYS :: TICKET DOES NOT BELONG TO PROJECT");
  }
  const ticket = ticketRaw as {
    id: string;
    title: string;
    description: string;
    severity: SpecTicketSeverity;
    customer_classification: SpecTicketSeverity | null;
    status: string;
  };

  if (op === "reclassify") {
    const newSeverityRaw = strField(formData, "new_severity");
    if (!VALID_SEVERITY.includes(newSeverityRaw as SpecTicketSeverity)) {
      throw new Error("SYS :: INVALID NEW SEVERITY");
    }
    if (newSeverityRaw === ticket.severity) {
      throw new Error("SYS :: SEVERITY UNCHANGED — NOTHING TO RECLASSIFY");
    }

    const updatePayload: {
      severity: SpecTicketSeverity;
      customer_classification?: SpecTicketSeverity | null;
    } = {
      severity: newSeverityRaw as SpecTicketSeverity,
    };
    // Stamp original classification once (only if not already preserved).
    if (ticket.customer_classification === null) {
      updatePayload.customer_classification = ticket.severity;
    }

    const { error: updateErr } = await db
      .from("spec_support_tickets")
      .update(updatePayload)
      .eq("id", ticketId);
    if (updateErr) throw new Error(`SYS :: SEVERITY UPDATE FAILED · ${updateErr.message}`);

    await db.from("spec_communications").insert({
      spec_project_id: projectId,
      direction: "outbound",
      channel: "system",
      summary: `Ticket reclassified — ${ticket.severity.toUpperCase()} → ${newSeverityRaw.toUpperCase()} · ${ticket.title}`,
      body: null,
      logged_by_user_id: operatorId,
      is_test: !!project.is_test,
    });

    revalidatePath(`/admin/spec/${projectId}`);
    return;
  }

  // op === "escalate_to_change_order"
  // 1. Create a proposed change order with the ticket details.
  const { data: changeOrder, error: coErr } = await db
    .from("spec_change_orders")
    .insert({
      spec_project_id: projectId,
      title: `[ESCALATED] ${ticket.title}`,
      description:
        `Escalated from ticket ${ticket.id}.\n\n` +
        `Original severity: ${ticket.severity}\n` +
        `Customer classification: ${ticket.customer_classification ?? ticket.severity}\n\n` +
        ticket.description,
      change_type: "minor_hourly",
      hourly_rate_cents: 22500,
      delivery_impact_days: 0,
      status: "proposed",
      is_test: !!project.is_test,
    })
    .select("id")
    .maybeSingle();
  if (coErr) throw new Error(`SYS :: CHANGE ORDER INSERT FAILED · ${coErr.message}`);
  if (!changeOrder) throw new Error("SYS :: CHANGE ORDER INSERT RETURNED NO ROW");

  // 2. Update ticket: status = escalated_to_change_order, link the change order.
  const { error: ticketUpdateErr } = await db
    .from("spec_support_tickets")
    .update({
      status: "escalated_to_change_order",
      linked_change_order_id: changeOrder.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", ticketId);
  if (ticketUpdateErr) {
    // Roll back the change order if we can't link it. Defensive — operator can
    // retry without a dangling proposed change order.
    await db.from("spec_change_orders").delete().eq("id", changeOrder.id);
    throw new Error(`SYS :: TICKET UPDATE FAILED · ${ticketUpdateErr.message}`);
  }

  await db.from("spec_communications").insert({
    spec_project_id: projectId,
    direction: "outbound",
    channel: "system",
    summary: `Ticket escalated to change order · ${ticket.title}`,
    body: `Linked change order: ${changeOrder.id}`,
    logged_by_user_id: operatorId,
    is_test: !!project.is_test,
  });

  await db.from("notifications").insert({
    user_id: operatorId,
    company_id: OPS_OPERATIONS_COMPANY_ID,
    type: "spec_ticket_escalated",
    title: "Ticket escalated to change order",
    body: `${project.customer_name ?? project.customer_email} · ${ticket.title}`,
    is_read: false,
    action_url: `/admin/spec/${projectId}?tab=change_orders`,
    action_label: "VIEW CHANGE ORDERS",
  });

  revalidatePath(`/admin/spec/${projectId}`);
}

function strField(form: FormData, key: string): string {
  const v = form.get(key);
  if (typeof v !== "string") return "";
  return v.trim();
}

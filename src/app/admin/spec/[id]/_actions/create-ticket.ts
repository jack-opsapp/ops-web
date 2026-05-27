"use server";

import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { loadSpecProjectMinimal } from "@/lib/admin/spec-queries";
import type { SpecTicketPhase, SpecTicketSeverity } from "@/lib/admin/spec-types";
import { OPS_OPERATIONS_COMPANY_ID } from "@/lib/admin/spec-constants";
import { denyNonOperator, requireSpecOperatorUserId } from "./_require-operator";

const VALID_SEVERITY: readonly SpecTicketSeverity[] = ["critical", "high", "cosmetic_enhancement"];
const VALID_PHASE: readonly SpecTicketPhase[] = ["support", "retainer", "ad_hoc"];

/**
 * Operator-side ticket creation. Phase 1: Jackson can log on behalf of the
 * customer. Phase 2 ships the customer-side filing UI.
 *
 * Side effects:
 *   - INSERT `spec_support_tickets` row.
 *   - INSERT `spec_communications` system row.
 *   - INSERT operator notification.
 */
export async function createTicket(formData: FormData): Promise<void> {
  const operatorId = await requireSpecOperatorUserId();
  if (!operatorId) denyNonOperator();

  const projectId = strField(formData, "project_id");
  const severityRaw = strField(formData, "severity");
  const phaseRaw = strField(formData, "phase");
  const title = strField(formData, "title");
  const description = strField(formData, "description");

  if (!projectId) throw new Error("SYS :: MISSING PROJECT ID");
  if (!VALID_SEVERITY.includes(severityRaw as SpecTicketSeverity)) {
    throw new Error("SYS :: INVALID SEVERITY");
  }
  if (!VALID_PHASE.includes(phaseRaw as SpecTicketPhase)) {
    throw new Error("SYS :: INVALID PHASE");
  }
  if (!title) throw new Error("SYS :: TITLE REQUIRED");
  if (!description) throw new Error("SYS :: DESCRIPTION REQUIRED");

  const project = await loadSpecProjectMinimal(projectId);
  if (!project) throw new Error("SYS :: PROJECT NOT FOUND");

  const db = getAdminSupabase();

  const { data: inserted, error } = await db
    .from("spec_support_tickets")
    .insert({
      spec_project_id: projectId,
      phase: phaseRaw,
      title,
      description,
      severity: severityRaw,
      status: "open",
      is_test: !!project.is_test,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    throw new Error(`SYS :: TICKET INSERT FAILED · ${error.message}`);
  }
  if (!inserted) throw new Error("SYS :: TICKET INSERT RETURNED NO ROW");

  await db.from("spec_communications").insert({
    spec_project_id: projectId,
    direction: "outbound",
    channel: "system",
    summary: `Ticket opened — ${severityRaw.toUpperCase()} · ${title}`,
    body: description,
    logged_by_user_id: operatorId,
    is_test: !!project.is_test,
  });

  await db.from("notifications").insert({
    user_id: operatorId,
    company_id: OPS_OPERATIONS_COMPANY_ID,
    type: "spec_ticket_opened",
    title: "Ticket opened",
    body: `${project.customer_name ?? project.customer_email} · ${severityRaw.toUpperCase()} · ${title}`,
    is_read: false,
    action_url: `/admin/spec/${projectId}?tab=tickets`,
    action_label: "VIEW TICKETS",
  });

  revalidatePath(`/admin/spec/${projectId}`);
}

function strField(form: FormData, key: string): string {
  const v = form.get(key);
  if (typeof v !== "string") return "";
  return v.trim();
}

"use server";

import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { loadSpecProjectMinimal } from "@/lib/admin/spec-queries";
import { writeSpecEmailOutbox } from "@/lib/spec/email-outbox";
import { KIND_TO_LIST } from "@/lib/email/constants";
import { denyNonOperator, requireSpecOperatorUserId } from "./_require-operator";

/**
 * Operator-side template email dispatch via Stage H's outbox.
 *
 * Flow:
 *   1. Operator gate re-checked.
 *   2. template_id validated against the registered SPEC template keys.
 *   3. recipient_email defaults to the project's customer_email (override via
 *      form field if Jackson wants to send to a non-default address).
 *   4. payload is a minimal JSONB carrying common SPEC variables (project id,
 *      tier, customer name, custom note). Stage H's renderer fills in the rest
 *      from the project record.
 *   5. spec_email_outbox row inserted — Stage H cron renders + ships.
 *   6. spec_communications system row inserted so the timeline shows the send.
 */
export async function sendTemplateEmail(formData: FormData): Promise<void> {
  const operatorId = await requireSpecOperatorUserId();
  if (!operatorId) denyNonOperator();

  const projectId = strField(formData, "project_id");
  const templateId = strField(formData, "template_id");
  const customRecipient = strField(formData, "recipient_email_override");
  const note = strField(formData, "operator_note");

  if (!projectId) throw new Error("SYS :: MISSING PROJECT ID");
  if (!templateId) throw new Error("SYS :: MISSING TEMPLATE");

  // Only SPEC templates registered in src/lib/email/constants.ts SPEC block.
  if (!KIND_TO_LIST[templateId] || !templateId.startsWith("spec.")) {
    throw new Error(`SYS :: TEMPLATE NOT REGISTERED · ${templateId}`);
  }

  const project = await loadSpecProjectMinimal(projectId);
  if (!project) throw new Error("SYS :: PROJECT NOT FOUND");

  const recipientEmail = customRecipient || project.customer_email;
  if (!recipientEmail || !/.+@.+/.test(recipientEmail)) {
    throw new Error("SYS :: RECIPIENT EMAIL INVALID");
  }

  // Outbox write — Stage H cron picks it up. payload deliberately minimal;
  // the Stage H renderer (template_id → React Email component) resolves the
  // rest from the project record.
  const outboxResult = await writeSpecEmailOutbox({
    templateId,
    recipientEmail,
    recipientUserId: project.buyer_user_id,
    specProjectId: projectId,
    payload: {
      spec_project_id: projectId,
      tier: project.tier,
      customer_name: project.customer_name,
      customer_email: project.customer_email,
      buyer_name: project.customer_name,
      operator_note: note || null,
    },
    isTest: project.is_test,
  });

  if ("error" in outboxResult) {
    throw new Error(`SYS :: OUTBOX WRITE FAILED · ${outboxResult.error}`);
  }

  const db = getAdminSupabase();
  await db.from("spec_communications").insert({
    spec_project_id: projectId,
    direction: "outbound",
    channel: "email",
    summary: `Operator-sent template — ${templateId} → ${recipientEmail}`,
    body: note || null,
    logged_by_user_id: operatorId,
    is_test: !!project.is_test,
  });

  revalidatePath(`/admin/spec/${projectId}`);
}

function strField(form: FormData, key: string): string {
  const v = form.get(key);
  if (typeof v !== "string") return "";
  return v.trim();
}

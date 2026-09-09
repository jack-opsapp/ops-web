import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isEmailWorkRoutingReceipt,
  loadEmailCustomerContext,
} from "./email-work-routing";
import { persistEmailWorkRouting } from "./persist-email-work-routing";

export interface ImportedWorkMessage {
  providerMessageId: string;
  providerThreadId: string;
  fromEmail: string;
  subject: string;
  occurredAt: Date;
  direction: "inbound" | "outbound";
  bodyText?: string | null;
  bodyTextClean?: string | null;
  toEmails?: string[];
  ccEmails?: string[];
}

/** Old import classifications do not carry current-message new-work authority. */
export async function retainImportForWorkReview(input: {
  supabase: SupabaseClient;
  companyId: string;
  connectionId: string;
  connectionEmail: string;
  customerEmail: string;
  messages: ImportedWorkMessage[];
  hydrateMessage?: (
    message: ImportedWorkMessage
  ) => Promise<ImportedWorkMessage>;
}): Promise<{ held: boolean; activitiesCreated: number }> {
  const { supabase } = input;
  const context = await loadEmailCustomerContext({
    supabase,
    companyId: input.companyId,
    contactEmails: [input.customerEmail],
  });
  const existing = new Map<string, Record<string, unknown>>();
  for (const message of input.messages) {
    const { data, error } = await supabase
      .from("activities")
      .select(
        "id, opportunity_id, client_id, project_id, match_confidence, email_thread_id, body_text, body_text_clean"
      )
      .eq("company_id", input.companyId)
      .eq("email_connection_id", input.connectionId)
      .eq("email_message_id", message.providerMessageId)
      .eq("type", "email")
      .maybeSingle();
    if (error) throw error;
    if (data) {
      if (data.email_thread_id !== message.providerThreadId)
        throw new Error("Imported message source changed");
      existing.set(message.providerMessageId, data);
    }
  }
  const latest = [...input.messages].sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()
  )[0];
  const latestRow = latest ? existing.get(latest.providerMessageId) : undefined;
  if (latestRow?.opportunity_id) return { held: false, activitiesCreated: 0 };
  const hasReceipt = [...existing.values()].some(
    (row) =>
      isEmailWorkRoutingReceipt(row) ||
      row.match_confidence === "work_routing_pending"
  );
  if (!hasReceipt && !context.projects.length && context.clientIds.length <= 1)
    return { held: false, activitiesCreated: 0 };
  if (!input.messages.length)
    throw new Error("Email history is missing. Reanalyze the mailbox.");
  let activitiesCreated = 0;
  for (let message of input.messages) {
    let row = existing.get(message.providerMessageId);
    if (row?.opportunity_id || isEmailWorkRoutingReceipt(row)) continue;
    // A final receipt must never make a metadata-only import unhydratable.
    if (
      typeof row?.body_text !== "string" &&
      typeof message.bodyText !== "string"
    ) {
      if (!input.hydrateMessage)
        throw new Error("Imported correspondence body is missing");
      const hydrated = await input.hydrateMessage(message);
      if (
        hydrated.providerMessageId !== message.providerMessageId ||
        hydrated.providerThreadId !== message.providerThreadId ||
        typeof hydrated.bodyText !== "string"
      ) {
        throw new Error("Imported correspondence source could not be verified");
      }
      message = hydrated;
    }
    if (row && typeof row.body_text !== "string") {
      const { data, error } = await supabase
        .from("activities")
        .update({
          body_text: message.bodyText,
          body_text_clean: message.bodyTextClean ?? null,
          content: message.bodyTextClean || message.bodyText,
        })
        .eq("id", row.id)
        .eq("company_id", input.companyId)
        .eq("email_connection_id", input.connectionId)
        .eq("email_message_id", message.providerMessageId)
        .eq("email_thread_id", message.providerThreadId)
        .eq("type", "email")
        .is("opportunity_id", null)
        .is("body_text", null)
        .select("id")
        .maybeSingle();
      if (error || !data)
        throw (
          error ?? new Error("Imported correspondence changed during hydration")
        );
    }
    const sourceContext = await loadEmailCustomerContext({
      supabase,
      companyId: input.companyId,
      contactEmails: [
        message.direction === "inbound"
          ? message.fromEmail
          : input.customerEmail,
      ],
    });
    const clientId =
      (row?.client_id as string | undefined) ??
      (sourceContext.clientIds.length === 1
        ? sourceContext.clientIds[0]
        : null);
    if (!row) {
      const { data, error } = await supabase
        .from("activities")
        .insert({
          company_id: input.companyId,
          opportunity_id: null,
          client_id: clientId,
          type: "email",
          email_connection_id: input.connectionId,
          email_message_id: message.providerMessageId,
          email_thread_id: message.providerThreadId,
          from_email: message.fromEmail,
          to_emails: message.toEmails ?? [
            message.direction === "outbound"
              ? input.customerEmail
              : input.connectionEmail,
          ],
          cc_emails: message.ccEmails ?? [],
          subject: message.subject,
          body_text: message.bodyText ?? null,
          body_text_clean: message.bodyTextClean ?? null,
          content: message.bodyTextClean ?? message.bodyText ?? null,
          direction: message.direction,
          created_at: message.occurredAt.toISOString(),
          is_read: false,
          match_confidence: "work_routing_pending",
          match_needs_review: true,
        })
        .select("id")
        .single();
      if (error || !data)
        throw error ?? new Error("Imported correspondence was not saved");
      row = data;
      activitiesCreated++;
    }
    await persistEmailWorkRouting({
      supabase,
      companyId: input.companyId,
      connectionId: input.connectionId,
      activityId: String(row!.id),
      providerMessageId: message.providerMessageId,
      providerThreadId: message.providerThreadId,
      routing:
        row!.project_id && clientId
          ? {
              action: "project",
              clientId,
              projectId: String(row!.project_id),
              reason: "existing_job",
            }
          : {
              action: "review",
              clientId,
              projectId: null,
              reason: "import_requires_new_work_evidence",
            },
    });
  }
  return { held: true, activitiesCreated };
}

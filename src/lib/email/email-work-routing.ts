import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeIlikeLiteral } from "@/lib/supabase/ilike-literal";
import { normalizePropertyAddressIdentity } from "@/lib/utils/property-address-identity";
import { cleanMessageBody } from "@/lib/api/services/conversation-state/message-cleaner";
import {
  extractForwardedSender,
  isForwardMarker,
  stripQuotedContentStrict,
} from "@/lib/utils/email-parsing";

export type EmailWorkIntent = "new_work" | "existing_job" | "uncertain";

export interface EmailCustomerContext {
  clientIds: string[];
  projects: Array<{
    id: string;
    clientId: string;
    address: string | null;
    status: string | null;
  }>;
}

export type EmailWorkRouting =
  | { action: "sales" }
  | {
      action: "project";
      clientId: string;
      projectId: string;
      reason: "existing_job";
    }
  | {
      action: "review";
      clientId: string | null;
      projectId: null;
      reason: string;
    };

export function isEmailWorkRoutingReceipt(
  activity: { match_confidence?: string | null } | null | undefined
): boolean {
  return (
    activity?.match_confidence === "existing_job" ||
    activity?.match_confidence === "work_intent_review"
  );
}

function normalizeEvidence(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** A forward's first customer message is current evidence; its reply chain is not. */
export function currentEmailWorkBody(email: {
  subject: string;
  bodyText: string;
  bodyTextClean?: string | null;
}): string {
  const raw = email.bodyText.replace(/\r\n?/g, "\n");
  if (
    isForwardMarker(email.subject, raw) &&
    extractForwardedSender(email.subject, raw)
  ) {
    const lines = raw.split("\n");
    const marker = lines.findIndex((line) =>
      /^\s*(?:begin forwarded message:|-{5,}\s*forwarded message)/i.test(line)
    );
    const from = lines.findIndex(
      (line, index) => index >= Math.max(0, marker) && /^\s*From:/i.test(line)
    );
    if (from >= 0) {
      const preamble = lines.slice(0, marker >= 0 ? marker : from).join("\n");
      // A forward inside a quoted reply is history, even if its headers are
      // unprefixed. Never substitute it for the author's current message.
      if (stripQuotedContentStrict(preamble).trim() !== preamble.trim()) {
        return cleanMessageBody(raw, {
          subject: email.subject,
          providerCleanBody: email.bodyTextClean,
        });
      }
      let end = from;
      let headers = 0;
      while (end < lines.length) {
        if (
          /^\s*(?:from|sent|date|to|cc|bcc|reply-to|subject):/i.test(lines[end])
        )
          headers++;
        else if (lines[end].trim()) break;
        end++;
      }
      if (headers >= 2)
        return cleanMessageBody(lines.slice(end).join("\n"), {});
    }
    // An unparseable forward cannot prove a new request from old quoted text.
    return "";
  }
  return cleanMessageBody(raw, {
    subject: email.subject,
    providerCleanBody: email.bodyTextClean,
  });
}

/** Evidence is a verbatim excerpt of the current message, never a model summary. */
export function hasSourceNewWorkEvidence(
  body: string,
  evidence: string | null | undefined
): boolean {
  const quote = normalizeEvidence(evidence ?? "");
  return quote.length >= 12 && normalizeEvidence(body).includes(quote);
}

export const EMAIL_WORK_INTENT_PROMPT = `
Separate customer identity from SALES INTENT in the current message:
- workIntent "new_work": an explicit request for a new job, new scope, quote/estimate, or a distinct additional job. Return newWorkEvidence as a short VERBATIM excerpt of the CURRENT message containing that request.
- workIntent "existing_job": delivery of already-agreed work: crew damage, defects, warranty/callback, reimbursement, invoice/payment questions, access, furniture removal, start-date confirmation or scheduling an existing job. These are correspondence, not new sales. A crew already working is evidence of an EXISTING job, never evidence of a new lead.
- workIntent "uncertain": the current message does not establish whether new work is requested. Never manufacture sales intent from the sender being a customer.
- newWorkEvidence must be null unless workIntent is "new_work". Quoted earlier requests and old signatures are context, not a new request. For a forwarded message, judge the forwarded customer's current message. If new scope is explicitly requested alongside an existing-job issue, use new_work and quote only the new request.
Existing-job correspondence is still a customer conversation: return verdict "lead" with workIntent "existing_job" so it is retained, not discarded as noise. For non-customer verdicts use workIntent "uncertain" and null newWorkEvidence.`;

export function parseEmailWorkIntent(
  raw: { workIntent?: unknown; newWorkEvidence?: unknown },
  sourceBody: string
): { workIntent: EmailWorkIntent; newWorkEvidence: string | null } {
  if (raw.workIntent === "existing_job")
    return { workIntent: "existing_job", newWorkEvidence: null };
  if (
    raw.workIntent === "new_work" &&
    typeof raw.newWorkEvidence === "string" &&
    hasSourceNewWorkEvidence(sourceBody, raw.newWorkEvidence)
  ) {
    return {
      workIntent: "new_work",
      newWorkEvidence: raw.newWorkEvidence.trim(),
    };
  }
  return { workIntent: "uncertain", newWorkEvidence: null };
}

export function decideEmailWorkRouting(input: {
  context: EmailCustomerContext;
  intent?: EmailWorkIntent | null;
  body: string;
  newWorkEvidence?: string | null;
  address?: string | null;
}): EmailWorkRouting {
  const clients = [...new Set(input.context.clientIds)];
  const clientId = clients.length === 1 ? clients[0] : null;
  const review = (reason: string): EmailWorkRouting => ({
    action: "review",
    clientId,
    projectId: null,
    reason,
  });
  if (clients.length > 1) return review("ambiguous_customer");
  if (input.intent !== "existing_job") {
    if (input.intent === "uncertain") return review("uncertain_work_intent");
    if (input.context.projects.length === 0) return { action: "sales" };
    return input.intent === "new_work" &&
      hasSourceNewWorkEvidence(input.body, input.newWorkEvidence)
      ? { action: "sales" }
      : review("existing_customer_requires_new_work_evidence");
  }
  if (!clientId) return review("existing_job_customer_unresolved");
  const address = normalizePropertyAddressIdentity(input.address);
  if (input.address?.trim() && !address)
    return review("job_address_unresolved");
  const projects = input.context.projects.filter(
    (project) =>
      project.clientId === clientId &&
      [
        "rfq",
        "estimated",
        "accepted",
        "in_progress",
        "completed",
        "closed",
      ].includes(project.status ?? "") &&
      (!address ||
        normalizePropertyAddressIdentity(project.address) === address)
  );
  if (projects.length !== 1)
    return review(
      projects.length ? "ambiguous_project" : "existing_job_project_unresolved"
    );
  return {
    action: "project",
    clientId,
    projectId: projects[0].id,
    reason: "existing_job",
  };
}

/** Independent of opportunity lifecycle: archived leads do not erase a customer/job. */
export async function loadEmailCustomerContext(input: {
  supabase: SupabaseClient;
  companyId: string;
  contactEmails: string[];
}): Promise<EmailCustomerContext> {
  const emails = [
    ...new Set(
      input.contactEmails
        .map((email) => email.trim().toLowerCase())
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    ),
  ];
  const clientIds = new Set<string>();
  for (const email of emails) {
    for (const table of ["clients", "sub_clients"] as const) {
      const { data, error } = await input.supabase
        .from(table)
        .select(table === "clients" ? "id" : "client_id")
        .eq("company_id", input.companyId)
        .ilike("email", escapeIlikeLiteral(email))
        .is("deleted_at", null);
      if (error)
        throw new Error(
          `Email customer identity read failed: ${error.message}`,
          { cause: error }
        );
      for (const row of data ?? []) {
        const id = (row as unknown as Record<string, unknown>)[
          table === "clients" ? "id" : "client_id"
        ];
        if (typeof id === "string") clientIds.add(id);
      }
    }
  }
  if (clientIds.size === 0) return { clientIds: [], projects: [] };
  // A subcontact is not authority to resurrect a deleted or merged parent.
  const { data: clients, error: clientError } = await input.supabase
    .from("clients")
    .select("id, merged_into_client_id")
    .eq("company_id", input.companyId)
    .in("id", [...clientIds])
    .is("deleted_at", null);
  if (clientError)
    throw new Error(
      `Email customer validation failed: ${clientError.message}`,
      { cause: clientError }
    );
  const ids = (clients ?? [])
    .filter((client) => !client.merged_into_client_id)
    .map((client) => client.id as string);
  if (ids.length === 0) return { clientIds: [], projects: [] };
  const projects: EmailCustomerContext["projects"] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await input.supabase
      .from("projects")
      .select("id, client_id, address, status")
      .eq("company_id", input.companyId)
      .in("client_id", ids)
      .is("deleted_at", null)
      .order("id")
      .range(offset, offset + 99);
    if (error)
      throw new Error(`Email customer projects read failed: ${error.message}`, {
        cause: error,
      });
    for (const row of data ?? [])
      projects.push({
        id: row.id,
        clientId: row.client_id,
        address: row.address,
        status: row.status,
      });
    if ((data?.length ?? 0) < 100) break;
  }
  return { clientIds: ids, projects };
}

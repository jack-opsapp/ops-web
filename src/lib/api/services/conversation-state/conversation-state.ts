// src/lib/api/services/conversation-state/conversation-state.ts
//
// The ORCHESTRATOR. One deterministic resolver builds a ConversationState per
// thread BEFORE any AI runs; parsing + drafting consume it instead of raw,
// polluted thread text. This file is the single composition point for the
// already-tested deterministic modules:
//
//   message-cleaner   → CleanMessage.cleanBody (quote + signature + overlap)
//   party-classifier  → direction + partyRole + meaningful (operator identity)
//   contact-resolver  → ResolvedContact (operator-excluded, shape-validated)
//   accept-detector   → AcceptSignal (deterministic won/accept floor)
//   sent-ledger       → SentLedgerEntry[] (what the operator already sent)
//   router            → RoutingDecision + confidence
//
// DESIGN (mirrors every sibling module):
//   - `assembleConversationState(input)` is a PURE function over already-fetched
//     plain data. No DB, no network, no model. It is the unit-tested core.
//   - `buildConversationState(threadId)` is a thin SEPARATE fetch wrapper that
//     loads the thread's messages, connection, operator identity, opportunity
//     stage, contact-form submitter, and commitments, then delegates to the
//     pure core. The pure core never calls it.
//
// See docs/inbox/clean-state-layer-spec.md § "The central contract".

import { extractEmailAddress } from "@/lib/utils/email-parsing";

import { cleanMessageBody } from "./message-cleaner";
import { classifyParty } from "./party-classifier";
import { resolveContact, type ContactFormSubmitter } from "./contact-resolver";
import { detectAccept } from "./accept-detector";
import { buildSentLedger, type CommitmentRecord } from "./sent-ledger";
import { route, type RouteInput } from "./router";
import type {
  AttachmentInspection,
  AttachmentKind,
  AttachmentRef,
  CleanMessage,
  ConversationState,
  LeadStage,
  OperatorIdentity,
} from "./types";

// ─── Pure-core input ──────────────────────────────────────────────────────────

/**
 * An attachment as known BEFORE inspection. `requiresInspection` and the vision
 * `inspection` are NOT supplied by the caller — the core derives `requiresInspection`
 * (image/PDF on a real customer inbound) and leaves `inspection` null for Phase 2.
 */
export interface RawAttachment {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /**
   * The CACHED vision inspection for this attachment, if one exists (Phase 2).
   * The fetch wrapper reads it from `attachment_inspections` — the pure core
   * NEVER calls vision; it only threads an already-computed inspection through to
   * the AttachmentRef so the deterministic accept-detector + router can read it.
   * null when the attachment has not been inspected yet.
   */
  inspection?: AttachmentInspection | null;
}

/**
 * One email message as loaded from `activities` (type='email'), shaped for the
 * pure core. `rawBody` = `activities.body_text` (verbatim); `providerCleanBody`
 * = `activities.body_text_clean` (the provider's quote-stripped body, populated
 * by P0-B) when available.
 */
export interface RawThreadMessage {
  providerMessageId: string;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  ccEmails?: string[];
  subject: string;
  sentAt: string; // ISO 8601
  rawBody: string;
  providerCleanBody?: string | null;
  attachments?: RawAttachment[];
}

export interface AssembleConversationStateInput {
  threadId: string;
  connectionId: string;
  companyId: string;
  operator: OperatorIdentity;
  rawMessages: RawThreadMessage[];
  stage: LeadStage;
  contactFormSubmitter?: ContactFormSubmitter | null;
  commitments?: CommitmentRecord[];
}

// ─── Small pure helpers ───────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lexicographic compare — ISO-8601 timestamps sort chronologically as strings. */
function cmpIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Bare, lowercased email from a raw "Name <email>" / plain address. */
function normalizeEmailBare(value: string | null | undefined): string {
  return extractEmailAddress(value ?? "").toLowerCase().trim();
}

/** A display name, or null when blank or itself an email address. */
function cleanDisplayName(value: string | null | undefined): string | null {
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  if (!v) return null;
  if (EMAIL_RE.test(v)) return null;
  return v;
}

/**
 * Deterministic attachment kind from mime type then filename extension.
 * Only `image` / `pdf` ever require inspection (the Phase 2 vision pass).
 */
function classifyAttachmentKind(mimeType: string, filename: string): AttachmentKind {
  const mt = (mimeType || "").toLowerCase();
  const fn = (filename || "").toLowerCase();
  if (mt.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?|svg)$/.test(fn)) {
    return "image";
  }
  if (mt.includes("pdf") || fn.endsWith(".pdf")) return "pdf";
  if (
    mt.includes("word") ||
    mt.includes("document") ||
    mt.includes("officedocument") ||
    mt.startsWith("text/") ||
    /\.(docx?|txt|rtf|pages|odt|csv|xlsx?)$/.test(fn)
  ) {
    return "document";
  }
  return "other";
}

/**
 * The greeting target: the actual author of the latest inbound message,
 * preferring real customer inbounds over any other inbound (e.g. a forwarder),
 * and never the linked client. Null email/name when there is no inbound.
 */
function deriveRecipient(messages: CleanMessage[]): {
  email: string | null;
  name: string | null;
} {
  const inbound = messages.filter((m) => m.direction === "inbound");
  const customer = inbound.filter((m) => m.isRealCustomerInbound);
  const pool = customer.length > 0 ? customer : inbound;
  if (pool.length === 0) return { email: null, name: null };
  const latest = [...pool].sort((a, b) => cmpIso(a.sentAt, b.sentAt))[pool.length - 1];
  return { email: latest.fromEmail || null, name: latest.fromName };
}

// ─── Pure core ────────────────────────────────────────────────────────────────

/**
 * Build the deterministic ConversationState from already-fetched plain data.
 *
 * Pipeline:
 *   1. Sort messages chronologically (overlap-strip + recipient need order).
 *   2. Per message: clean body (quote/signature/overlap) → classify party →
 *      derive attachments (requiresInspection) → flag real customer inbounds.
 *   3. Derive customerMessages, recipient, contact, accept, sentLedger, and the
 *      attachments-requiring-inspection roll-up.
 *   4. route(...) for the deterministic routing decision + confidence.
 *
 * No DB, no network, no model.
 */
export function assembleConversationState(
  input: AssembleConversationStateInput
): ConversationState {
  const { threadId, connectionId, companyId, operator, stage } = input;

  // 1. Chronological order.
  const sorted = [...input.rawMessages].sort((a, b) => cmpIso(a.sentAt, b.sentAt));

  // 2. Build each CleanMessage, accumulating prior CLEAN bodies for overlap
  //    stripping (a prior message's clean opening is what a reply inlines).
  const messages: CleanMessage[] = [];
  const priorCleanBodies: string[] = [];

  for (const raw of sorted) {
    const cleanBody = cleanMessageBody(raw.rawBody, {
      subject: raw.subject,
      priorBodies: priorCleanBodies.length > 0 ? [...priorCleanBodies] : undefined,
      providerCleanBody: raw.providerCleanBody ?? null,
    });

    // Classify from the RAW body so noise heuristics (bounce / marketing
    // "unsubscribe" footers) still see the signals the cleaner would strip.
    const classification = classifyParty(
      {
        fromEmail: raw.fromEmail,
        toEmails: raw.toEmails ?? [],
        ccEmails: raw.ccEmails ?? [],
        subject: raw.subject,
        body: raw.rawBody,
      },
      operator
    );

    const isCustomerInbound =
      classification.direction === "inbound" && classification.partyRole === "customer";

    const attachments: AttachmentRef[] = (raw.attachments ?? []).map((att) => {
      const kind = classifyAttachmentKind(att.mimeType, att.filename);
      return {
        filename: att.filename,
        mimeType: att.mimeType,
        sizeBytes: att.sizeBytes,
        kind,
        requiresInspection: isCustomerInbound && (kind === "image" || kind === "pdf"),
        // Thread the CACHED inspection through (Phase 2). The pure core does not
        // inspect; the fetch wrapper supplies any cached inspection on the raw
        // attachment, and the deterministic accept-detector/router read it here.
        inspection: att.inspection ?? null,
      };
    });

    // A real customer inbound carries genuinely new content OR an attachment —
    // an empty quote-only reply (cleanBody empty, no attachment) is dropped even
    // though the classifier (identity-based) calls it meaningful.
    const hasContent = cleanBody.trim().length > 0;
    const isRealCustomerInbound =
      isCustomerInbound &&
      classification.isMeaningful &&
      (hasContent || attachments.length > 0);

    messages.push({
      providerMessageId: raw.providerMessageId,
      direction: classification.direction,
      partyRole: classification.partyRole,
      fromEmail: normalizeEmailBare(raw.fromEmail),
      fromName: cleanDisplayName(raw.fromName),
      sentAt: raw.sentAt,
      cleanBody,
      rawBody: raw.rawBody,
      isRealCustomerInbound,
      attachments,
    });

    // Only meaningful new text is useful as a prior-body overlap signature.
    if (hasContent) priorCleanBodies.push(cleanBody);
  }

  // 3. Roll-ups.
  const customerMessages = messages.filter((m) => m.isRealCustomerInbound);
  const recipient = deriveRecipient(messages);

  const contact = resolveContact({
    messages,
    operator,
    contactFormSubmitter: input.contactFormSubmitter ?? null,
  });

  const accept = detectAccept(customerMessages);

  const outboundMessages = messages.filter((m) => m.direction === "outbound");
  const sentLedger = buildSentLedger({
    commitments: input.commitments ?? [],
    outboundMessages,
  });

  const attachmentsRequiringInspection = messages.flatMap((m) =>
    m.attachments.filter((a) => a.requiresInspection)
  );

  // 4. Route.
  const routeInput: RouteInput = {
    threadId,
    connectionId,
    companyId,
    operator,
    recipient,
    messages,
    customerMessages,
    contact,
    stage,
    accept,
    sentLedger,
    attachmentsRequiringInspection,
  };
  const { routing, routingReasons, confidence } = route(routeInput);

  return { ...routeInput, routing, routingReasons, confidence };
}

// ─── Thin fetch wrapper (separate; the pure core never calls this) ────────────
//
// Loads everything the pure core needs for one thread and delegates. The ONLY
// DB-touching surface in this module. Mirrors fetchOperatorIdentity /
// fetchCommitments — pure logic stays testable, I/O stays here.

import { requireSupabase } from "@/lib/supabase/helpers";
import { extractContactFormSubmission } from "@/lib/utils/email-parsing";
import type { SyncProfile } from "@/lib/types/email-connection";
import { fetchOperatorIdentity } from "./operator-identity";
import { fetchCommitments } from "./sent-ledger";
import { attachmentInspectionKey } from "./attachment-inspector";

const LEAD_STAGES: ReadonlySet<LeadStage> = new Set<LeadStage>([
  "new_lead",
  "qualifying",
  "quoting",
  "quoted",
  "follow_up",
  "negotiation",
  "won",
  "lost",
  "discarded",
]);

/** Validate a raw stage string against the union; unknown / missing → new_lead. */
function coerceStage(value: string | null | undefined): LeadStage {
  return value && LEAD_STAGES.has(value as LeadStage) ? (value as LeadStage) : "new_lead";
}

/** Postgres timestamptz → canonical ISO-8601 (lexicographically sortable). */
function toIso(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

interface ActivityEmailRow {
  email_message_id: string | null;
  from_email: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
  subject: string | null;
  body_text: string | null;
  body_text_clean: string | null;
  direction: "inbound" | "outbound" | null;
  created_at: string | null;
}

/**
 * Load a thread's attachments grouped by PROVIDER message id, each carrying its
 * CACHED vision inspection (Phase 2).
 *
 * Source of truth is `email_attachments` (provider message_id + attachment_id +
 * real filename/mime/size, captured at ingestion by the inspection runner) joined
 * to the `attachment_inspections` cache. This replaces the Phase-0 thin
 * project_photos path: it carries true identity (so PDFs are representable, not
 * just images) and the inspection that makes the deterministic accept-detector
 * fire on a signed estimate. A DETERMINISTIC DB READ only — no vision call here.
 */
async function loadThreadAttachments(
  supabase: ReturnType<typeof requireSupabase>,
  companyId: string,
  providerThreadId: string
): Promise<Map<string, RawAttachment[]>> {
  const byMessageId = new Map<string, RawAttachment[]>();

  const { data: attRows, error: attErr } = await supabase
    .from("email_attachments")
    .select("message_id, attachment_id, filename, mime_type, size_bytes")
    .eq("company_id", companyId)
    .eq("provider_thread_id", providerThreadId);
  if (attErr) {
    console.error("[conversation-state] email_attachments load failed:", attErr.message);
    return byMessageId;
  }
  const rows = (attRows ?? []) as Array<{
    message_id: string;
    attachment_id: string;
    filename: string | null;
    mime_type: string | null;
    size_bytes: number | null;
  }>;
  if (rows.length === 0) return byMessageId;

  // Cached inspections for the same thread, keyed by (message_id, attachment_id).
  const { data: inspRows } = await supabase
    .from("attachment_inspections")
    .select("message_id, attachment_id, summary, is_signed_estimate, facts, model")
    .eq("company_id", companyId)
    .eq("provider_thread_id", providerThreadId);
  const inspectionByKey = new Map<string, AttachmentInspection>();
  for (const r of (inspRows ?? []) as Array<{
    message_id: string;
    attachment_id: string;
    summary: string | null;
    is_signed_estimate: boolean | null;
    facts: Record<string, unknown> | null;
    model: string | null;
  }>) {
    inspectionByKey.set(attachmentInspectionKey(r.message_id, r.attachment_id), {
      summary: r.summary ?? "",
      isSignedEstimate: r.is_signed_estimate === true,
      facts: r.facts ?? {},
      model: r.model ?? "",
    });
  }

  for (const row of rows) {
    const list = byMessageId.get(row.message_id) ?? [];
    list.push({
      filename: row.filename?.trim() || row.attachment_id,
      mimeType: row.mime_type ?? "",
      sizeBytes: typeof row.size_bytes === "number" ? row.size_bytes : 0,
      inspection:
        inspectionByKey.get(attachmentInspectionKey(row.message_id, row.attachment_id)) ?? null,
    });
    byMessageId.set(row.message_id, list);
  }
  return byMessageId;
}

/** Re-extract the website contact-form submitter from the earliest inbound. */
function deriveContactFormSubmitter(
  activities: ActivityEmailRow[]
): ContactFormSubmitter | null {
  const firstInbound = activities.find((a) => a.direction === "inbound");
  if (!firstInbound) return null;
  const parsed = extractContactFormSubmission(
    firstInbound.subject ?? "",
    firstInbound.body_text ?? ""
  );
  if (!parsed) return null;
  return {
    name: parsed.name ?? null,
    email: parsed.email ?? null,
    phone: parsed.phone ?? null,
    address: parsed.address ?? null,
    company: parsed.company ?? null,
  };
}

/**
 * Build a ConversationState for one thread by id (`email_threads.id`).
 *
 * Loads the thread row, its connection (→ operator identity), the thread's
 * `activities` email messages, the linked opportunity's stage, the website
 * contact-form submitter (re-parsed from the first inbound), and the thread's
 * commitments, then delegates to the pure `assembleConversationState`.
 *
 * Returns null when the thread or its connection cannot be loaded.
 */
export async function buildConversationState(
  threadId: string
): Promise<ConversationState | null> {
  const supabase = requireSupabase();

  // 1. Canonical thread row → provider id + connection + opportunity + company.
  const { data: threadRow, error: threadErr } = await supabase
    .from("email_threads")
    .select("id, company_id, connection_id, provider_thread_id, opportunity_id")
    .eq("id", threadId)
    .maybeSingle();
  if (threadErr || !threadRow) {
    console.error(
      "[conversation-state] thread load failed:",
      threadErr?.message ?? `no thread ${threadId}`
    );
    return null;
  }
  const t = threadRow as {
    id: string;
    company_id: string;
    connection_id: string | null;
    provider_thread_id: string;
    opportunity_id: string | null;
  };
  if (!t.connection_id) {
    console.error("[conversation-state] thread has no connection:", threadId);
    return null;
  }

  // 2. Connection (email + sync_filters) → operator identity.
  const { data: connRow } = await supabase
    .from("email_connections")
    .select("email, sync_filters")
    .eq("id", t.connection_id)
    .maybeSingle();
  if (!connRow) {
    console.error("[conversation-state] connection load failed:", t.connection_id);
    return null;
  }
  const conn = connRow as { email: string; sync_filters: SyncProfile | null };
  const operator = await fetchOperatorIdentity(t.company_id, {
    email: conn.email,
    syncFilters: (conn.sync_filters ?? {}) as SyncProfile,
  });

  // 3. Thread messages from `activities` (type='email'), chronological.
  const { data: activityRows } = await supabase
    .from("activities")
    .select(
      "email_message_id, from_email, to_emails, cc_emails, subject, body_text, body_text_clean, direction, created_at"
    )
    .eq("company_id", t.company_id)
    .eq("type", "email")
    .eq("email_thread_id", t.provider_thread_id)
    .order("created_at", { ascending: true });
  const activities = (activityRows ?? []) as unknown as ActivityEmailRow[];

  // 4. Attachments (Phase 2): provider identity + cached inspection, keyed by
  //    provider message id. A deterministic DB read — no vision call here.
  const attachmentsByMessageId = await loadThreadAttachments(
    supabase,
    t.company_id,
    t.provider_thread_id
  );

  // 5. Map to the pure core's RawThreadMessage shape.
  const rawMessages: RawThreadMessage[] = activities
    .filter((a) => !!a.email_message_id)
    .map((a) => ({
      providerMessageId: a.email_message_id as string,
      fromEmail: a.from_email ?? "",
      // `activities` does not persist a sender display name (P0-C addresses the
      // create path; name verification falls back to the contact form here).
      fromName: null,
      toEmails: a.to_emails ?? [],
      ccEmails: a.cc_emails ?? [],
      subject: a.subject ?? "",
      sentAt: toIso(a.created_at),
      rawBody: a.body_text ?? "",
      // P0-B: the quote+signature-stripped body persisted at ingestion. NULL for
      // rows ingested before the column existed → the cleaner derives it from raw.
      providerCleanBody: a.body_text_clean,
      attachments: attachmentsByMessageId.get(a.email_message_id as string) ?? [],
    }));

  // 6. Opportunity stage.
  let stage: LeadStage = "new_lead";
  if (t.opportunity_id) {
    const { data: opp } = await supabase
      .from("opportunities")
      .select("stage")
      .eq("id", t.opportunity_id)
      .maybeSingle();
    stage = coerceStage((opp as { stage?: string | null } | null)?.stage);
  }

  // 7. Contact-form submitter (re-parsed; not persisted separately).
  const contactFormSubmitter = deriveContactFormSubmitter(activities);

  // 8. Commitments. source_id is the PROVIDER thread id — that is what the
  //    memory-service writes on extraction (memory-service.ts:467 via the sync
  //    engine, which passes the provider threadId). NOT the email_threads.id.
  const commitments = await fetchCommitments(t.company_id, t.provider_thread_id);

  return assembleConversationState({
    threadId: t.id,
    connectionId: t.connection_id,
    companyId: t.company_id,
    operator,
    rawMessages,
    stage,
    contactFormSubmitter,
    commitments,
  });
}

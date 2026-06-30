// src/lib/api/services/conversation-state/types.ts
//
// The deterministic "conversation state" contract. ONE resolver builds a
// ConversationState per thread BEFORE any AI runs; parsing + drafting consume
// it instead of raw, polluted thread text. See docs/inbox/clean-state-layer-spec.md.
//
// Design rules:
// - Everything here is derived deterministically (no model). AI runs on top of
//   this clean state, never to produce it.
// - "operator" = the connected mailbox owner / their company. Operator-owned
//   identity (email, phone, address, signature) must never leak into customer fields.

export type LeadStage =
  | "new_lead"
  | "qualifying"
  | "quoting"
  | "quoted"
  | "follow_up"
  | "negotiation"
  | "won"
  | "lost"
  | "discarded";

export type PartyRole = "customer" | "operator" | "internal" | "system" | "unknown";

export type AttachmentKind = "image" | "pdf" | "document" | "other";

export type RoutingDecision = "draft" | "update_lead_only" | "require_human_review";

/**
 * The operator's full identity set, built from authoritative data
 * (companies + users + connection), NOT the optional wizard SyncProfile JSON.
 *
 * A gmail/outlook-based operator is recognized by their EXACT addresses in
 * `emails`; PUBLIC provider domains are deliberately EXCLUDED from `domains`
 * (`domains` is a match-by-domain set — a public domain there would sweep every
 * customer on that provider into the operator set). See operator-identity.ts.
 */
export interface OperatorIdentity {
  emails: Set<string>; // connection.email ∪ company users' emails ∪ profile.userEmailAddresses (exact match)
  domains: Set<string>; // operator's PRIVATE/company domains only (public provider domains excluded)
  phones: Set<string>; // normalized company + user phones
  addresses: Set<string>; // normalized company address(es)
  companyName: string | null;
}

export interface AttachmentInspection {
  /** One-line description for the drafter ("hand-drawn deck layout, ~14ft x 20ft"). */
  summary: string;
  /** True when the attachment is (or contains) a signed/accepted estimate. */
  isSignedEstimate: boolean;
  /** Free-form structured facts the vision step extracted (dimensions, totals, etc.). */
  facts: Record<string, unknown>;
  model: string;
}

export interface AttachmentRef {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: AttachmentKind;
  /** image/diagram/PDF on a customer inbound — the drafter must not ignore it. */
  requiresInspection: boolean;
  /** Populated by the Phase 2 OpenAI vision pass; null until inspected. */
  inspection?: AttachmentInspection | null;
}

export interface CleanMessage {
  providerMessageId: string;
  direction: "inbound" | "outbound";
  partyRole: PartyRole;
  fromEmail: string;
  fromName: string | null;
  sentAt: string; // ISO 8601
  /** quote-stripped + signature-stripped + cross-message overlap-stripped. */
  cleanBody: string;
  /** retained verbatim for audit. */
  rawBody: string;
  /** direction=inbound ∧ partyRole=customer ∧ deterministically "meaningful". */
  isRealCustomerInbound: boolean;
  attachments: AttachmentRef[];
}

export type SentLedgerKind = "price" | "quote" | "commitment" | "promise";

export interface SentLedgerEntry {
  kind: SentLedgerKind;
  /** "Quoted $3,200 for 40ft cedar fence". */
  text: string;
  amount?: number | null;
  sentAt: string; // ISO 8601
  sourceMessageId: string;
}

export type FieldName = "name" | "email" | "phone" | "address";

export interface FieldProvenance {
  field: FieldName;
  source: string; // e.g. "contact_form", "email_signature", "from_header"
  confidence: number; // 0..1
  providerThreadId: string | null;
  sourceMessageId: string | null;
}

export interface ResolvedContact {
  /** Real person/business name. NEVER the email local-part as a verified value. */
  name: string | null;
  /** true only when sourced from a real display name / contact-form field. */
  nameIsVerified: boolean;
  email: string | null; // customer email (operator excluded)
  phone: string | null; // customer phone (operator excluded + shape-validated)
  address: string | null; // customer address (operator excluded + shape-validated)
  provenance: FieldProvenance[]; // persisted to lead_field_provenance
}

export interface AcceptSignal {
  detected: boolean;
  confidence: "high" | "low";
  /**
   * high → signed_estimate_attachment and/or explicit_accept_language.
   * low  → verbal_soft (ambiguous "sounds good", "ok" without commitment).
   */
  basis: ("signed_estimate_attachment" | "explicit_accept_language" | "verbal_soft")[];
  evidenceMessageIds: string[];
}

export interface ConversationState {
  threadId: string;
  connectionId: string;
  companyId: string;
  operator: OperatorIdentity;
  /** The actual author of the latest inbound message — bind the greeting to THIS, not the linked client. */
  recipient: { email: string | null; name: string | null };
  messages: CleanMessage[];
  /** messages.filter(m => m.isRealCustomerInbound) — the only text parsing/drafting should treat as customer input. */
  customerMessages: CleanMessage[];
  contact: ResolvedContact;
  stage: LeadStage;
  accept: AcceptSignal;
  /** What the operator has ALREADY sent (prices/quotes/promises) — the drafter must not restate these. */
  sentLedger: SentLedgerEntry[];
  attachmentsRequiringInspection: AttachmentRef[];
  routing: RoutingDecision;
  routingReasons: string[];
  /** 0..1; below the router threshold → require_human_review. */
  confidence: number;
}

// src/lib/api/services/conversation-state/contact-resolver.ts
//
// Deterministic customer-contact resolution for the conversation-state layer.
//
// Fixes the long-standing "signature / body-snippet pollutes phone/address" and
// "name falls back to email prefix as a verified value" defects. The pure core
// (`resolveContact`) takes ALREADY-FETCHED plain data and performs NO DB/network
// access; any Supabase persistence of provenance lives in the thin
// `persistContactProvenance` wrapper below, which the pure core never calls.
//
// Why this exists alongside lead-enrichment.ts: the legacy path only guards the
// EMAIL field against the operator's own identity (safeCustomerEmail), and only
// against connection/profile JSON — not the authoritative OperatorIdentity, and
// not on phone/address/name. extractFormField over-collects (runs into adjacent
// body + signature). This module applies operator-exclusion on EVERY field and a
// BOUNDED, shape-validated collector. See docs/inbox/clean-state-layer-spec.md.
//
// DRY: phone shape is gated through the shared sanitizeContactFormPhoneValue
// (email-parsing.ts) for the 7–15 digit tokenization, then a net-new structural
// guard rejects date-like runs / order numbers it lets through. Email parsing
// reuses extractEmailAddress. The CONTACT_FORM_* label sets and the operator
// email/displayName guards in lead-enrichment.ts are NOT exported (private), so
// the bounded collector defines a focused, local label set — see module notes.

import type {
  CleanMessage,
  FieldName,
  FieldProvenance,
  OperatorIdentity,
  ResolvedContact,
} from "@/lib/api/services/conversation-state/types";
import {
  extractEmailAddress,
  sanitizeContactFormPhoneValue,
} from "@/lib/utils/email-parsing";

export interface ContactFormSubmitter {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  company?: string | null;
}

export interface ResolveContactInput {
  messages: CleanMessage[];
  operator: OperatorIdentity;
  contactFormSubmitter?: ContactFormSubmitter | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A fromName / form name that carries no real identity. Mirrors the spirit of
// lead-enrichment's GENERIC_NAME_RE (which is private) — kept narrow on purpose.
const GENERIC_NAME_RE =
  /^(?:unknown|new lead|new customer|customer|lead|n\/a|na|null|undefined|none|-|—|no name|test)$/i;

// Local label set for the bounded address collector. The canonical
// CONTACT_FORM_* label arrays in email-parsing.ts are NOT exported, so this
// module owns a focused copy scoped to what the collector needs. (Noted to the
// caller — if those sets are exported later, swap to them.)
const ADDRESS_LABELS = [
  "address",
  "project address",
  "site address",
  "service address",
  "property address",
  "job location",
  "location",
];
// When collecting a multi-line address value, stop on the FIRST line that
// starts a different known field — never run into the message body / signature.
const NEXT_FIELD_LABELS = [
  "name",
  "full name",
  "first name",
  "last name",
  "email",
  "e-mail",
  "phone",
  "telephone",
  "mobile",
  "cell",
  "message",
  "comments",
  "comment",
  "details",
  "description",
  "company",
  "business",
  "budget",
  "subject",
  "address", // a second address label ends the current collection too
];

// Bounding guardrails for the address collector.
const ADDRESS_MAX_LINES = 4;
const ADDRESS_MAX_CHARS = 200;

// ── normalization helpers (pure) ─────────────────────────────────────────────

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const email = extractEmailAddress(value).toLowerCase().trim();
  return EMAIL_RE.test(email) ? email : null;
}

/** Digits-only key for operator phone-set membership tests. */
function phoneDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Loose key for operator address membership: lowercase, collapse non-alnum. */
function addressKey(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isOperatorEmail(email: string, operator: OperatorIdentity): boolean {
  if (operator.emails.has(email)) return true;
  const domain = email.split("@")[1] ?? "";
  return domain.length > 0 && operator.domains.has(domain);
}

function isOperatorPhone(phone: string, operator: OperatorIdentity): boolean {
  const digits = phoneDigits(phone);
  if (!digits) return false;
  for (const op of operator.phones) {
    const opDigits = phoneDigits(op);
    if (!opDigits) continue;
    if (opDigits === digits) return true;
    // tolerate a leading country-code difference (e.g. 1-prefixed)
    if (opDigits.length >= 7 && digits.endsWith(opDigits)) return true;
    if (digits.length >= 7 && opDigits.endsWith(digits)) return true;
  }
  return false;
}

function isOperatorAddress(address: string, operator: OperatorIdentity): boolean {
  const key = addressKey(address);
  if (!key) return false;
  for (const op of operator.addresses) {
    const opKey = addressKey(op);
    if (!opKey) continue;
    if (key === opKey || key.includes(opKey) || opKey.includes(key)) return true;
  }
  return false;
}

function isGenericName(value: string): boolean {
  return GENERIC_NAME_RE.test(value.trim());
}

// ── phone shape validation (net-new on top of the shared sanitizer) ──────────

// Reject runs that the digit-count gate accepts but are clearly NOT phones:
// pure date-like sequences ("2026 05 20", "2026-05-20") and bare order numbers.
function isPlausiblePhoneShape(token: string): boolean {
  const trimmed = token.trim();
  const digits = phoneDigits(trimmed);
  if (digits.length < 7 || digits.length > 15) return false;

  // Date-like: YYYY <sep> MM <sep> DD where MM/DD are calendar-valid.
  const dateLike = trimmed.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})$/);
  if (dateLike) {
    const month = Number(dateLike[2]);
    const day = Number(dateLike[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return false;
  }

  // Bare 8-digit ISO date with no separators ("20260520").
  if (/^\d{8}$/.test(digits)) {
    const y = Number(digits.slice(0, 4));
    const m = Number(digits.slice(4, 6));
    const d = Number(digits.slice(6, 8));
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return false;
    }
  }

  return true;
}

/**
 * Find a customer phone in free text. Scans candidate digit runs, gates each
 * through the shared sanitizer (digit-count + tokenization) AND the structural
 * guard, then rejects any value matching the operator's own line. Returns the
 * first surviving token, or null.
 */
function findCustomerPhone(
  text: string,
  operator: OperatorIdentity
): string | null {
  if (!text) return null;
  // Candidate phone-ish runs (mirrors the shared CONTACT_FORM_PHONE_TOKEN_RE).
  const tokenRe = /\+?\d[\d\s().-]{5,}\d/g;
  for (const match of text.matchAll(tokenRe)) {
    const { phone } = sanitizeContactFormPhoneValue(match[0]);
    if (!phone) continue;
    if (!isPlausiblePhoneShape(phone)) continue;
    if (isOperatorPhone(phone, operator)) continue;
    return phone;
  }
  return null;
}

// ── bounded address collection (net-new — does NOT call extractFormField) ────

function lineStartsWithLabel(line: string, labels: string[]): boolean {
  const trimmed = line.trim().toLowerCase();
  return labels.some((label) => {
    const l = label.toLowerCase();
    return (
      trimmed === l ||
      trimmed.startsWith(`${l}:`) ||
      trimmed.startsWith(`${l} :`)
    );
  });
}

function matchAddressLabel(line: string): { inline: string } | null {
  const trimmed = line.trim();
  for (const label of [...ADDRESS_LABELS].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:?\\s*(.*)$`, "i");
    const m = trimmed.match(re);
    if (m) return { inline: (m[1] ?? "").trim() };
  }
  return null;
}

/**
 * BOUNDED address collector. Finds the first address label, then collects its
 * value — inline plus any continuation lines — STOPPING at the first blank
 * line, the line cap, the char cap, or a known next-field label. Never runs on
 * into the message body or signature (the bug in the legacy extractFormField).
 */
function collectAddressFromText(text: string): string | null {
  if (!text) return null;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const labelHit = matchAddressLabel(lines[i]);
    if (!labelHit) continue;

    const collected: string[] = [];
    if (labelHit.inline) collected.push(labelHit.inline);

    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (!next) break; // blank line bounds the value
      if (lineStartsWithLabel(next, NEXT_FIELD_LABELS)) break; // next field bounds it
      if (collected.length >= ADDRESS_MAX_LINES) break; // hard line cap
      collected.push(next);
      if (collected.join(", ").length >= ADDRESS_MAX_CHARS) break; // char cap
    }

    const value = cleanText(collected.join(", "));
    if (value) return value;
  }
  return null;
}

// ── provenance accumulation ──────────────────────────────────────────────────

function provenance(
  field: FieldName,
  source: string,
  confidence: number,
  msg: CleanMessage | null
): FieldProvenance {
  return {
    field,
    source,
    confidence,
    providerThreadId: null,
    sourceMessageId: msg?.providerMessageId ?? null,
  };
}

// ── name derivation ──────────────────────────────────────────────────────────

/** Display name from a real fromName (rejecting generics / bare emails). */
function verifiedDisplayName(fromName: string | null | undefined): string | null {
  const cleaned = cleanText(fromName);
  if (!cleaned) return null;
  if (EMAIL_RE.test(cleaned)) return null;
  if (isGenericName(cleaned)) return null;
  return cleaned;
}

/**
 * Unverified fallback display derived from an email local-part. Returned as a
 * display value ONLY — nameIsVerified stays false for these. Never used as a
 * verified name.
 */
function unverifiedNameFromEmail(email: string | null): string | null {
  if (!email) return null;
  const local = email.split("@")[0] ?? "";
  if (!local) return null;
  const name = local
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
  return cleanText(name);
}

// ── pure core ────────────────────────────────────────────────────────────────

/**
 * Resolve the customer ResolvedContact deterministically from already-fetched
 * messages + the operator identity (+ an optional contact-form submitter). No
 * DB/network. Operator-owned email/phone/address/name are excluded on EVERY
 * field; phone is shape-validated; address collection is bounded; the email
 * local-part is NEVER a verified name.
 */
export function resolveContact(input: ResolveContactInput): ResolvedContact {
  const { messages, operator, contactFormSubmitter } = input;
  const prov: FieldProvenance[] = [];

  // The customer-role inbound messages are the only ones we treat as customer
  // input. Latest-first so "most recent customer statement" wins for free text.
  const customerMessages = messages
    .filter((m) => m.direction === "inbound" && m.partyRole === "customer")
    .filter((m) => {
      const e = normalizeEmail(m.fromEmail);
      return !e || !isOperatorEmail(e, operator);
    });
  const latestCustomer = customerMessages.length
    ? [...customerMessages].sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0]
    : null;

  // ── email ──────────────────────────────────────────────────────────────
  let email: string | null = null;
  const formEmail = normalizeEmail(contactFormSubmitter?.email);
  if (formEmail && !isOperatorEmail(formEmail, operator)) {
    email = formEmail;
    prov.push(provenance("email", "contact_form", 0.95, latestCustomer));
  }
  if (!email) {
    for (const m of customerMessages) {
      const candidate = normalizeEmail(m.fromEmail);
      if (candidate && !isOperatorEmail(candidate, operator)) {
        email = candidate;
        prov.push(provenance("email", "from_header", 0.9, m));
        break;
      }
    }
  }

  // ── name ───────────────────────────────────────────────────────────────
  let name: string | null = null;
  let nameIsVerified = false;
  const formName = verifiedDisplayName(contactFormSubmitter?.name);
  if (formName) {
    name = formName;
    nameIsVerified = true;
    prov.push(provenance("name", "contact_form", 0.95, latestCustomer));
  }
  if (!nameIsVerified) {
    for (const m of customerMessages) {
      const verified = verifiedDisplayName(m.fromName);
      if (verified) {
        name = verified;
        nameIsVerified = true;
        prov.push(provenance("name", "from_header", 0.85, m));
        break;
      }
    }
  }
  if (!nameIsVerified) {
    // Fallback DISPLAY ONLY — never marked verified, never blocks a later
    // verified name. Derived from the customer email local-part.
    const fallback = unverifiedNameFromEmail(email);
    if (fallback) {
      name = fallback;
      // nameIsVerified intentionally stays false
      prov.push(provenance("name", "email_local_part_unverified", 0.2, latestCustomer));
    }
  }

  // ── phone ──────────────────────────────────────────────────────────────
  let phone: string | null = null;
  if (contactFormSubmitter?.phone) {
    const { phone: formPhone } = sanitizeContactFormPhoneValue(contactFormSubmitter.phone);
    if (
      formPhone &&
      isPlausiblePhoneShape(formPhone) &&
      !isOperatorPhone(formPhone, operator)
    ) {
      phone = formPhone;
      prov.push(provenance("phone", "contact_form", 0.9, latestCustomer));
    }
  }
  if (!phone) {
    for (const m of customerMessages) {
      const candidate = findCustomerPhone(m.cleanBody, operator);
      if (candidate) {
        phone = candidate;
        prov.push(provenance("phone", "message_body", 0.6, m));
        break;
      }
    }
  }

  // ── address ────────────────────────────────────────────────────────────
  let address: string | null = null;
  const formAddress = cleanText(contactFormSubmitter?.address);
  if (formAddress && !isOperatorAddress(formAddress, operator)) {
    address = formAddress;
    prov.push(provenance("address", "contact_form", 0.9, latestCustomer));
  }
  if (!address) {
    for (const m of customerMessages) {
      const candidate = collectAddressFromText(m.cleanBody);
      if (candidate && !isOperatorAddress(candidate, operator)) {
        address = candidate;
        prov.push(provenance("address", "message_body", 0.55, m));
        break;
      }
    }
  }

  return { name, nameIsVerified, email, phone, address, provenance: prov };
}

// ── thin persistence wrapper (separate from the pure core) ───────────────────
//
// The pure core NEVER calls this. It is the only DB-touching surface in the
// module and exists so callers can write resolved provenance to the latent
// `lead_field_provenance` table without the pure resolver taking a Supabase
// dependency.
//
// SCHEMA (verified against prod `lead_field_provenance`): rows are keyed by
// (company_id, entity_type, entity_id) with field_name / value_snapshot / source
// / confidence / provider_thread_id / provider_message_id. company_id,
// entity_type, entity_id, field_name and source are NOT NULL; id / extracted_at /
// created_at / updated_at carry DB defaults and are not set here.

interface MinimalSupabaseInsert {
  from: (table: string) => {
    insert: (rows: Record<string, unknown>[]) => Promise<{ error: unknown }>;
  };
}

export interface PersistContactProvenanceInput {
  supabase: MinimalSupabaseInsert;
  companyId: string;
  /** lead_field_provenance.entity_type — the entity the value was written to. */
  entityType: "opportunity" | "client";
  /** lead_field_provenance.entity_id — the opportunity/client id. */
  entityId: string;
  /** Supplies the per-field provenance rows AND the value_snapshot per field. */
  contact: ResolvedContact;
  providerThreadId: string | null;
  /** Falls back per-row to the provenance entry's own sourceMessageId. */
  providerMessageId?: string | null;
}

/**
 * Persist resolved field provenance to `lead_field_provenance`. Thin, separate
 * from `resolveContact` (which stays pure). No-ops on an empty provenance list.
 */
export async function persistContactProvenance(
  input: PersistContactProvenanceInput
): Promise<{ error: unknown }> {
  const {
    supabase,
    companyId,
    entityType,
    entityId,
    contact,
    providerThreadId,
    providerMessageId,
  } = input;
  const rows = contact.provenance;
  if (rows.length === 0) return { error: null };

  const valueByField: Record<FieldName, string | null> = {
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    address: contact.address,
  };

  const payload = rows.map((p) => ({
    company_id: companyId,
    entity_type: entityType,
    entity_id: entityId,
    field_name: p.field,
    value_snapshot: valueByField[p.field] ?? null,
    source: p.source,
    confidence: p.confidence,
    provider_thread_id: p.providerThreadId ?? providerThreadId,
    provider_message_id: p.sourceMessageId ?? providerMessageId ?? null,
  }));
  return supabase.from("lead_field_provenance").insert(payload);
}

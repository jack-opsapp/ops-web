// src/lib/api/services/conversation-state/operator-identity.ts
//
// Builds the operator's FULL identity set — every email, domain, phone, and
// address that belongs to the connected mailbox owner or their company. This is
// the keystone of the clean-state layer: downstream party-classification and
// contact-resolution exclude anything in this set from customer fields, so
// "owner/self misclassified as customer" and "operator signature pollutes the
// customer phone/address" both collapse to "is it in the operator identity set?".
//
// CRITICAL FIX (vs. the wizard path): a gmail/outlook-based operator must still
// be recognized. We do that by enumerating their EXACT addresses into `emails`
// (connection + company users + profile) — so the operator's own mail matches by
// identity even on a public provider. What we must NOT do is put a PUBLIC
// provider domain (gmail.com / outlook.com / …) into `domains`: `domains` is a
// MATCH-BY-DOMAIN set, and matching a customer because they "also use gmail"
// would sweep every public-domain customer into the operator set — the
// party-classifier would mark them operator/outbound and the contact-resolver
// would exclude their email, silently losing the lead. So `domains` carries the
// operator's PRIVATE/company domains only; public provider domains are filtered
// out via the shared PUBLIC_EMAIL_DOMAINS set. A pure-gmail operator therefore
// has an empty `domains` set, which is correct — their identity lives in
// `emails`. (The wizard's identifyCompanyDomains also drops public domains, but
// it ALSO drops the operator's public-domain emails, collapsing the set
// entirely; that is the bug this module avoids.) See
// docs/inbox/clean-state-layer-spec.md.
//
// DESIGN:
// - `buildOperatorIdentity(input)` is a PURE function over already-fetched plain
//   data. It performs no DB/network access and is unit-tested with inline
//   fixtures.
// - `fetchOperatorIdentity(companyId, connection)` is a thin SEPARATE wrapper
//   that reads the authoritative company + active-user identity rows and then
//   delegates to the pure core. Any read failure is authoritative and retries
//   ingestion before contact facts can be written with an incomplete denylist.
//
// DRY NOTE: opportunity-relationship-matching.ts defines normalizeEmail /
// normalizePhone / normalizeAddress but does NOT export them (module-private
// `function` declarations). Per the build rules we may not edit that file and a
// private symbol cannot be imported, so the SAME normalization rules are
// replicated verbatim below to guarantee identical canonicalization across the
// layer. If those helpers are ever exported, swap these for the imports.

import type { OperatorIdentity } from "@/lib/api/services/conversation-state/types";
import type {
  EmailConnection,
  SyncProfile,
} from "@/lib/types/email-connection";
import { PUBLIC_EMAIL_DOMAINS } from "@/lib/types/pipeline";

// ─── Normalization (mirrors opportunity-relationship-matching.ts) ─────────────

/** Lowercased, trimmed email; null unless it contains an "@". */
function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized || !normalized.includes("@")) return null;
  return normalized;
}

/** Digit-only phone; null under 7 digits; strips a leading "1" country code on 11-digit numbers. */
function normalizePhone(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D+/g, "") ?? "";
  if (digits.length < 7) return null;
  return digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
}

/** Lowercased, punctuation-collapsed address; null under 8 chars. */
function normalizeAddress(value: string | null | undefined): string | null {
  const normalized = value
    ?.toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized && normalized.length >= 8 ? normalized : null;
}

/** The domain part of an email address, lowercased; null if absent. */
function emailDomain(email: string): string | null {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  return domain && domain.length > 0 ? domain : null;
}

/** A bare domain token (no "@"), lowercased + trimmed; null if empty. */
function normalizeDomain(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/^@/, "") ?? "";
  return normalized.length > 0 ? normalized : null;
}

// ─── Pure-core input ──────────────────────────────────────────────────────────

export interface OperatorCompanyInput {
  /** Display name; null when unknown. */
  name: string | null;
  /** Explicit company mail domains (e.g. an MX domain), if any are known. */
  emailDomains: string[];
  /** Raw company phone strings (companies.phone, etc.). */
  phones: string[];
  /** Raw company address strings. */
  addresses: string[];
}

export interface OperatorUserInput {
  email: string;
  phone?: string | null;
}

export interface BuildOperatorIdentityInput {
  /** The connected mailbox address (connection.email) — always the operator. */
  connectionEmail: string;
  /** Authoritative company users (from `users`), NOT the wizard JSON. */
  companyUsers: OperatorUserInput[];
  company: OperatorCompanyInput;
  /**
   * Optional wizard-derived profile. Used ADDITIVELY (never as the sole
   * authority): its email/domain/platform-sender arrays are unioned in.
   */
  syncProfile?: SyncProfile | null;
}

// ─── Pure core ────────────────────────────────────────────────────────────────

/**
 * Union every operator-owned email / domain / phone / address from the
 * authoritative sources (connection + company users + company record) plus the
 * optional wizard profile, with normalization and de-duplication.
 *
 * Public email domains are intentionally RETAINED in `domains`.
 */
export function buildOperatorIdentity(
  input: BuildOperatorIdentityInput
): OperatorIdentity {
  const emails = new Set<string>();
  const domains = new Set<string>();
  const phones = new Set<string>();
  const addresses = new Set<string>();

  // The operator DOMAIN set is match-by-domain, so it must hold PRIVATE/company
  // domains only. A public provider domain here would match every customer on
  // that provider — never add one, regardless of source.
  const addPrivateDomain = (domain: string | null | undefined) => {
    if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) domains.add(domain);
  };

  // Add an email (exact identity) and, when private, its domain. The operator's
  // public-domain address is recognized by `emails`; its public domain is NOT
  // added to `domains` (see the module header).
  const addEmail = (raw: string | null | undefined) => {
    const email = normalizeEmail(raw);
    if (!email) return;
    emails.add(email);
    addPrivateDomain(emailDomain(email));
  };

  const addPhone = (raw: string | null | undefined) => {
    const phone = normalizePhone(raw);
    if (phone) phones.add(phone);
  };

  const addAddress = (raw: string | null | undefined) => {
    const address = normalizeAddress(raw);
    if (address) addresses.add(address);
  };

  const addDomain = (raw: string | null | undefined) => {
    addPrivateDomain(normalizeDomain(raw));
  };

  // 1) Connected mailbox.
  addEmail(input.connectionEmail);

  // 2) Authoritative company users.
  for (const user of input.companyUsers) {
    addEmail(user.email);
    addPhone(user.phone);
  }

  // 3) Company record.
  for (const domain of input.company.emailDomains) addDomain(domain);
  for (const phone of input.company.phones) addPhone(phone);
  for (const address of input.company.addresses) addAddress(address);

  // 4) Optional wizard profile (additive only).
  const profile = input.syncProfile;
  if (profile) {
    for (const email of profile.userEmailAddresses ?? []) addEmail(email);
    for (const sender of profile.knownPlatformSenders ?? []) addEmail(sender);
    for (const domain of profile.companyDomains ?? []) addDomain(domain);
  }

  const companyName = input.company.name?.trim() || null;

  return { emails, domains, phones, addresses, companyName };
}

// ─── Thin fetch wrapper (separate; pure core does NOT call this) ──────────────

import { requireSupabase } from "@/lib/supabase/helpers";

/**
 * Fetch the plain data the pure core needs and build the OperatorIdentity.
 *
 * Reads the company record and active user roster directly so database failures
 * cannot be converted into an empty operator identity. The connection supplies
 * the authoritative mailbox address and the optional wizard SyncProfile.
 */
export async function fetchOperatorIdentity(
  companyId: string,
  connection: Pick<EmailConnection, "email" | "syncFilters">
): Promise<OperatorIdentity> {
  const supabase = requireSupabase();
  const [companyResult, usersResult] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, email, phone, address")
      .eq("id", companyId)
      .maybeSingle(),
    supabase
      .from("users")
      .select("email, phone")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .is("deleted_at", null),
  ]);

  if (companyResult.error) {
    throw new Error(
      `Failed to load operator company identity: ${companyResult.error.message}`
    );
  }
  if (!companyResult.data) {
    throw new Error(
      "Failed to load operator company identity: company not found"
    );
  }
  if (usersResult.error) {
    throw new Error(
      `Failed to load operator user identities: ${usersResult.error.message}`
    );
  }

  const company = companyResult.data as {
    name: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
  const userRows = (usersResult.data ?? []) as Array<{
    email: string | null;
    phone: string | null;
  }>;

  const companyUsers: OperatorUserInput[] = userRows.map((row) => ({
    email: row.email ?? "",
    phone: row.phone,
  }));
  if (company.email) {
    companyUsers.push({ email: company.email, phone: company.phone });
  }

  return buildOperatorIdentity({
    connectionEmail: connection.email,
    companyUsers,
    company: {
      name: company.name,
      emailDomains: [],
      phones: company.phone ? [company.phone] : [],
      addresses: company.address ? [company.address] : [],
    },
    syncProfile: connection.syncFilters ?? null,
  });
}

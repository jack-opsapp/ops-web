import { matchPlatform } from "@/lib/api/services/known-platforms";
import { extractEmailAddress } from "@/lib/utils/email-parsing";

export type EmailOpportunityTitleKind = "email_inquiry" | "estimate";

export type EmailOpportunityIdentitySource =
  | "client"
  | "contact"
  | "contact_form"
  | "inbound_sender"
  | "outbound_recipient";

export interface EmailOpportunityIdentityCandidate {
  source: EmailOpportunityIdentitySource;
  name?: string | null;
  email?: string | null;
}

export interface EmailOpportunityUnsafeIdentity {
  names?: Array<string | null | undefined>;
  emails?: Array<string | null | undefined>;
  domains?: Array<string | null | undefined>;
  platformEmails?: Array<string | null | undefined>;
}

export interface BuildEmailOpportunityTitleInput {
  kind: EmailOpportunityTitleKind;
  candidates: EmailOpportunityIdentityCandidate[];
  unsafe?: EmailOpportunityUnsafeIdentity;
}

const SOURCE_PRIORITY: Record<EmailOpportunityIdentitySource, number> = {
  contact_form: 0,
  inbound_sender: 1,
  outbound_recipient: 1,
  contact: 2,
  client: 3,
};

const GENERIC_LOCAL_PARTS = new Set([
  "admin",
  "contact",
  "hello",
  "info",
  "mail",
  "mailer-daemon",
  "no-reply",
  "noreply",
  "notifications",
  "office",
  "postmaster",
  "sales",
  "support",
  "team",
]);

const UNKNOWN_NAME_RE =
  /^(?:unknown|new lead|n\/a|na|null|undefined|none|-|—)$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_IDENTITY_NAME_LENGTH = 80;
const COMPANY_NAME_FILLER_RE =
  /\b(?:and|the|ltd|limited|inc|incorporated|llc|co|company|corp|corporation|group)\b/g;

function titleSuffix(kind: EmailOpportunityTitleKind): string {
  return kind === "estimate" ? "Estimate" : "Email Inquiry";
}

function cleanIdentityName(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/^"+|"+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || UNKNOWN_NAME_RE.test(cleaned) || EMAIL_RE.test(cleaned))
    return null;
  if (cleaned.length > MAX_IDENTITY_NAME_LENGTH) return null;
  return cleaned;
}

function normalizeEmail(value: string | null | undefined): string {
  return extractEmailAddress(value).toLowerCase().trim();
}

function emailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase().trim() ?? "";
}

function normalizeNameKey(value: string | null | undefined): string {
  return cleanIdentityName(value)?.toLowerCase() ?? "";
}

function companyNameKey(value: string | null | undefined): string {
  return (
    cleanIdentityName(value)
      ?.toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(COMPANY_NAME_FILLER_RE, " ")
      .replace(/\s+/g, "")
      .trim() ?? ""
  );
}

function domainNameKey(value: string | null | undefined): string {
  const domain = value?.toLowerCase().trim();
  if (!domain) return "";
  return companyNameKey(domain.split(".")[0]).replace(/and/g, "");
}

function unsafeSets(unsafe: EmailOpportunityUnsafeIdentity | undefined) {
  const names = new Set(
    (unsafe?.names ?? []).map(normalizeNameKey).filter(Boolean)
  );
  const emails = new Set(
    (unsafe?.emails ?? []).map(normalizeEmail).filter(Boolean)
  );
  const domains = new Set(
    (unsafe?.domains ?? [])
      .map((domain) => domain?.toLowerCase().trim())
      .filter(Boolean)
  );
  const domainNameKeys = new Set(
    (unsafe?.domains ?? []).map(domainNameKey).filter(Boolean)
  );
  const platformEmails = new Set(
    (unsafe?.platformEmails ?? []).map(normalizeEmail).filter(Boolean)
  );
  return { names, emails, domains, domainNameKeys, platformEmails };
}

function isUnsafeEmail(
  email: string,
  unsafe: ReturnType<typeof unsafeSets>
): boolean {
  if (!email) return false;
  if (unsafe.emails.has(email) || unsafe.platformEmails.has(email)) return true;
  const domain = emailDomain(email);
  if (domain && unsafe.domains.has(domain)) return true;
  return matchPlatform(email) !== null;
}

function matchesUnsafeDomainName(nameKey: string, domainKey: string): boolean {
  if (nameKey.length < 4 || domainKey.length < 4) return false;
  return (
    nameKey === domainKey ||
    nameKey.startsWith(domainKey) ||
    domainKey.startsWith(nameKey)
  );
}

function isUnsafeName(
  name: string,
  unsafe: ReturnType<typeof unsafeSets>
): boolean {
  const lowerName = name.toLowerCase();
  if (unsafe.names.has(lowerName)) return true;

  const nameKey = companyNameKey(name);
  for (const domainKey of unsafe.domainNameKeys) {
    if (matchesUnsafeDomainName(nameKey, domainKey)) return true;
  }

  return false;
}

function localPartToDisplayName(email: string): string | null {
  const localPart = email.split("@")[0]?.toLowerCase().trim();
  if (!localPart || GENERIC_LOCAL_PARTS.has(localPart)) return null;

  const display = localPart
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .trim();

  return cleanIdentityName(display);
}

function rankIdentityCandidates(
  candidates: EmailOpportunityIdentityCandidate[]
): EmailOpportunityIdentityCandidate[] {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => {
      const priorityDelta =
        SOURCE_PRIORITY[left.candidate.source] -
        SOURCE_PRIORITY[right.candidate.source];
      return priorityDelta || left.index - right.index;
    })
    .map(({ candidate }) => candidate);
}

function firstSafeDisplayName(
  candidates: EmailOpportunityIdentityCandidate[],
  unsafe: ReturnType<typeof unsafeSets>
): string | null {
  for (const candidate of candidates) {
    const email = normalizeEmail(candidate.email);
    if (email && isUnsafeEmail(email, unsafe)) continue;

    const name = cleanIdentityName(candidate.name);
    if (!name || isUnsafeName(name, unsafe)) continue;
    return name;
  }
  return null;
}

function firstSafeEmailName(
  candidates: EmailOpportunityIdentityCandidate[],
  unsafe: ReturnType<typeof unsafeSets>
): string | null {
  for (const candidate of candidates) {
    const email = normalizeEmail(candidate.email);
    if (!email || isUnsafeEmail(email, unsafe)) continue;

    const name = localPartToDisplayName(email);
    if (!name || isUnsafeName(name, unsafe)) continue;
    return name;
  }
  return null;
}

export function parseMailboxDisplayName(
  mailbox: string | null | undefined
): string | null {
  if (!mailbox) return null;
  const match = mailbox.match(/^\s*"?([^"<]+?)"?\s*<[^>]+@[^>]+>/);
  return cleanIdentityName(match?.[1] ?? null);
}

export function identityCandidateFromMailbox(
  source: EmailOpportunityIdentitySource,
  mailbox: string | null | undefined,
  explicitName?: string | null
): EmailOpportunityIdentityCandidate {
  return {
    source,
    name: cleanIdentityName(explicitName) ?? parseMailboxDisplayName(mailbox),
    email: normalizeEmail(mailbox),
  };
}

export function buildEmailOpportunityTitle(
  input: BuildEmailOpportunityTitleInput
): string {
  const unsafe = unsafeSets(input.unsafe);
  const candidates = rankIdentityCandidates(input.candidates);
  const identity =
    firstSafeDisplayName(candidates, unsafe) ??
    firstSafeEmailName(candidates, unsafe) ??
    "New Lead";

  return `${identity} — ${titleSuffix(input.kind)}`;
}

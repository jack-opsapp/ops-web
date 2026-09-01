export interface ConsentAuthorizationParameters {
  readonly clientId: string | null;
  readonly redirectUri: string | null;
  readonly responseType: string | null;
  readonly scope: string | null;
  readonly state: string | null;
  readonly codeChallenge: string | null;
  readonly codeChallengeMethod: string | null;
  readonly resource: string | null;
}

export interface ConsentScopeLine {
  readonly scope: string;
  readonly label: string;
}

export interface ConsentContext {
  readonly clientName: string;
  readonly companyName: string;
  readonly scopes: readonly ConsentScopeLine[];
  readonly consentCatalogRevision: string;
  readonly exposureRevision: string;
  readonly consentPreview: string;
  readonly expiresAt: string;
}

export type ConsentDecision = "approve" | "deny";

export interface ConsentDecisionBody {
  readonly decision: ConsentDecision;
  readonly consent_preview: string;
}

const REVISION_PATTERN = /^[0-9a-z][0-9a-z._:-]{0,127}$/;
const CONSENT_PREVIEW_PATTERN = /^ops_mcp_cp_[A-Za-z0-9_-]{43}$/;
const CANONICAL_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export function parseConsentContext(value: unknown): ConsentContext | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.clientName !== "string" || record.clientName === "") {
    return null;
  }
  if (typeof record.companyName !== "string" || record.companyName === "") {
    return null;
  }
  if (
    typeof record.consentCatalogRevision !== "string" ||
    !REVISION_PATTERN.test(record.consentCatalogRevision) ||
    typeof record.exposureRevision !== "string" ||
    !REVISION_PATTERN.test(record.exposureRevision) ||
    typeof record.consentPreview !== "string" ||
    !CONSENT_PREVIEW_PATTERN.test(record.consentPreview) ||
    !isCanonicalTimestamp(record.expiresAt)
  ) {
    return null;
  }
  if (!Array.isArray(record.scopes) || record.scopes.length === 0) return null;
  const scopes: ConsentScopeLine[] = [];
  const seenScopes = new Set<string>();
  for (const entry of record.scopes) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return null;
    }
    const line = entry as Record<string, unknown>;
    if (
      typeof line.scope !== "string" ||
      line.scope === "" ||
      seenScopes.has(line.scope)
    ) {
      return null;
    }
    if (typeof line.label !== "string" || line.label === "") return null;
    seenScopes.add(line.scope);
    scopes.push(Object.freeze({ scope: line.scope, label: line.label }));
  }
  return Object.freeze({
    clientName: record.clientName,
    companyName: record.companyName,
    scopes: Object.freeze(scopes),
    consentCatalogRevision: record.consentCatalogRevision,
    exposureRevision: record.exposureRevision,
    consentPreview: record.consentPreview,
    expiresAt: record.expiresAt,
  });
}

export function buildConsentDecisionBody(
  decision: ConsentDecision,
  context: ConsentContext
): Readonly<ConsentDecisionBody> {
  return Object.freeze({
    decision,
    consent_preview: context.consentPreview,
  });
}

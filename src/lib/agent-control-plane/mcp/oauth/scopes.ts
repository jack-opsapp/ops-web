import "server-only";

/**
 * OAuth scopes for the P1 read-only MCP surface: exactly the union of
 * requiredOAuthScopes across the nine externally exposable v6 reads —
 * nothing broader is grantable. Consent labels are plain OPS voice:
 * concrete, read-only-honest, no tech vocabulary.
 */

export const SUPPORTED_READ_SCOPES = Object.freeze([
  "ops.jobs.read",
  "ops.schedule.read",
  "ops.customers.read",
  "ops.customer_contacts.read",
  "ops.photos.read",
  "ops.correspondence.read",
  "ops.financials.read",
] as const);

export type SupportedReadScope = (typeof SUPPORTED_READ_SCOPES)[number];

const SUPPORTED_READ_SCOPE_SET: ReadonlySet<string> = new Set(
  SUPPORTED_READ_SCOPES
);

export const SCOPE_CONSENT_LABELS: Readonly<
  Record<SupportedReadScope, string>
> = Object.freeze({
  "ops.jobs.read": "See your jobs and their status",
  "ops.schedule.read": "See your schedule and who's assigned",
  "ops.customers.read": "See your clients and their jobs",
  "ops.customer_contacts.read":
    "See who to contact on a job and how to reach them",
  "ops.photos.read": "See which jobs are missing photos",
  "ops.correspondence.read": "See client email history on your jobs",
  "ops.financials.read": "See estimate and invoice summaries on your jobs",
});

export function isSupportedReadScope(
  value: string
): value is SupportedReadScope {
  return SUPPORTED_READ_SCOPE_SET.has(value);
}

/**
 * Resolve a requested space-delimited scope string to the grantable set.
 * Absent/blank requests default to the full read set (Claude may omit
 * scope); unknown scopes are rejected rather than silently dropped so a
 * client asking for authority we do not issue hears "no" explicitly.
 */
export function resolveRequestedScopes(
  rawScope: string | null | undefined
): readonly SupportedReadScope[] | null {
  if (rawScope == null || rawScope.trim() === "") {
    return SUPPORTED_READ_SCOPES;
  }
  const requested = rawScope.trim().split(/\s+/);
  if (requested.length > 32) return null;
  const resolved = new Set<SupportedReadScope>();
  for (const scope of requested) {
    if (!isSupportedReadScope(scope)) return null;
    resolved.add(scope);
  }
  if (resolved.size === 0) return null;
  return Object.freeze(
    SUPPORTED_READ_SCOPES.filter((scope) => resolved.has(scope))
  );
}

export function scopesToParameter(scopes: readonly string[]): string {
  return scopes.join(" ");
}

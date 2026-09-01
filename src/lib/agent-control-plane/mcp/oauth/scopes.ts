import "server-only";

import {
  MCP_EXPOSURE_V1,
  MCP_EXPOSURE_V3,
  type McpExposure,
} from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
import {
  INVISIBLE_OFFICE_MCP_SCOPE_CONSENT_LABELS,
  MCP_SCOPE_CONSENT_LABELS,
  type LabelledMcpScope,
} from "@/lib/agent-control-plane/registry/mcp-scope-catalog";

/**
 * Frozen compatibility views over immutable exposure v1: exactly the union
 * required by its eleven read tools. Active registration and consent resolve
 * their scope ceiling from the selected exposure instead; retaining these
 * exports keeps historical v1 grants and callers byte-compatible.
 */

export type SupportedReadScope = keyof typeof MCP_SCOPE_CONSENT_LABELS;

export const SUPPORTED_READ_SCOPES =
  MCP_EXPOSURE_V1.grantableScopes as readonly SupportedReadScope[];

const SUPPORTED_READ_SCOPE_SET: ReadonlySet<string> = new Set(
  SUPPORTED_READ_SCOPES
);

export const SCOPE_CONSENT_LABELS: Readonly<
  Record<SupportedReadScope, string>
> = Object.freeze(
  Object.fromEntries(
    SUPPORTED_READ_SCOPES.map((scope) => [
      scope,
      MCP_SCOPE_CONSENT_LABELS[scope],
    ])
  ) as Record<SupportedReadScope, string>
);

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
export function resolveRequestedScopes<const Exposure extends McpExposure>(
  rawScope: string | null | undefined,
  exposure: Exposure
):
  | readonly Extract<Exposure["grantableScopes"][number], LabelledMcpScope>[]
  | null {
  const consentLabels =
    exposure.revision === MCP_EXPOSURE_V3.revision
      ? INVISIBLE_OFFICE_MCP_SCOPE_CONSENT_LABELS
      : MCP_SCOPE_CONSENT_LABELS;
  if (rawScope == null || rawScope.trim() === "") {
    return exposure.grantableScopes as readonly Extract<
      Exposure["grantableScopes"][number],
      LabelledMcpScope
    >[];
  }
  const requested = rawScope.trim().split(/\s+/);
  if (requested.length > 32) return null;
  const grantable = new Set<string>(exposure.grantableScopes);
  const resolved = new Set<LabelledMcpScope>();
  for (const scope of requested) {
    if (
      !grantable.has(scope) ||
      !Object.prototype.hasOwnProperty.call(consentLabels, scope)
    ) {
      return null;
    }
    resolved.add(scope as LabelledMcpScope);
  }
  if (resolved.size === 0) return null;
  return Object.freeze(
    exposure.grantableScopes.filter((scope) =>
      resolved.has(scope as LabelledMcpScope)
    ) as Extract<Exposure["grantableScopes"][number], LabelledMcpScope>[]
  );
}

export function scopesToParameter(scopes: readonly string[]): string {
  return scopes.join(" ");
}

/** Exact subset check for an immutable dynamically registered client ceiling. */
export function areScopesWithinCeiling(
  scopes: readonly string[],
  scopeCeiling: readonly string[]
): boolean {
  if (scopes.length === 0 || scopeCeiling.length === 0) return false;
  const ceiling = new Set(scopeCeiling);
  return scopes.every((scope) => ceiling.has(scope));
}

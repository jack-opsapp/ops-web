import "server-only";

import { resolveActiveMcpExposure } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
import {
  MCP_SCOPE_CONSENT_LABELS,
  type LabelledMcpScope,
} from "@/lib/agent-control-plane/registry/mcp-scope-catalog";

/**
 * Compatibility views over the active immutable MCP exposure: exactly the
 * union required by its eleven read tools, with nothing broader grantable.
 * Consent labels remain concrete, read-only-honest, and free of technical
 * vocabulary.
 */

const ACTIVE_MCP_EXPOSURE = resolveActiveMcpExposure();

export const SUPPORTED_READ_SCOPES =
  ACTIVE_MCP_EXPOSURE.grantableScopes as readonly LabelledMcpScope[];

export type SupportedReadScope = (typeof SUPPORTED_READ_SCOPES)[number];

const SUPPORTED_READ_SCOPE_SET: ReadonlySet<string> = new Set(
  SUPPORTED_READ_SCOPES
);

export const SCOPE_CONSENT_LABELS: Readonly<
  Record<SupportedReadScope, string>
> = MCP_SCOPE_CONSENT_LABELS;

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

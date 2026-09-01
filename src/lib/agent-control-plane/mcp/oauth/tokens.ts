import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  consentLabelsForScopes,
  type McpConsentCatalog,
} from "./scope-catalog";
import type { McpExposure } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";

/**
 * Opaque bearer credentials for the MCP OAuth surface. Every credential is
 * 256 bits of entropy rendered base64url behind a greppable prefix; storage
 * and lookup use only the SHA-256 hex digest of the full presented string.
 * There is deliberately no signature: the authorization server and resource
 * server are the same deployment sharing one database, every claim is
 * resolved from the grant row on presentation, and revocation must bind on
 * the next call — properties a self-contained signed token cannot improve.
 */

export const ACCESS_TOKEN_PREFIX = "ops_mcp_at_" as const;
export const REFRESH_TOKEN_PREFIX = "ops_mcp_rt_" as const;
export const AUTHORIZATION_CODE_PREFIX = "ops_mcp_ac_" as const;
export const CONSENT_PREVIEW_PREFIX = "ops_mcp_cp_" as const;

export const ACCESS_TOKEN_TTL_SECONDS = 600 as const;
// 30 days.
export const REFRESH_TOKEN_TTL_SECONDS = 2_592_000 as const;
export const AUTHORIZATION_CODE_TTL_SECONDS = 300 as const;
export const CONSENT_PREVIEW_TTL_SECONDS = 300 as const;

const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export type CredentialPrefix =
  | typeof ACCESS_TOKEN_PREFIX
  | typeof REFRESH_TOKEN_PREFIX
  | typeof AUTHORIZATION_CODE_PREFIX
  | typeof CONSENT_PREVIEW_PREFIX;

export function mintCredential(prefix: CredentialPrefix): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Parse a presented credential of the expected kind into its storage digest.
 * Returns null for anything that is not shaped like a credential this server
 * mints — the caller must treat null exactly like an unknown credential.
 */
export function credentialDigest(
  presented: string,
  prefix: CredentialPrefix
): string | null {
  if (typeof presented !== "string") return null;
  if (!presented.startsWith(prefix)) return null;
  const secret = presented.slice(prefix.length);
  if (!SECRET_PATTERN.test(secret)) return null;
  return sha256Hex(presented);
}

export function isSha256Hex(value: string): boolean {
  return SHA256_HEX_PATTERN.test(value);
}

/** Constant-time equality for same-length secret material. */
export function secretsEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

export interface ImmutableConsentClaims {
  readonly scopes: readonly string[];
  readonly acceptedLabels: readonly string[];
  readonly consentCatalogRevision: string;
  readonly exposureRevision: string;
}

/**
 * Validate persisted authority against the exact active exposure selected by
 * the route. Refresh may preserve an older exposure revision, but it can
 * never add a scope or change the accepted labels stored on the grant.
 */
export function isConsentSnapshotValidForExposure(
  claims: ImmutableConsentClaims,
  activeExposure: McpExposure,
  consentCatalog: McpConsentCatalog,
  options: { readonly requireActiveExposureRevision: boolean }
): boolean {
  if (claims.consentCatalogRevision !== consentCatalog.revision) return false;
  if (
    options.requireActiveExposureRevision &&
    claims.exposureRevision !== activeExposure.revision
  ) {
    return false;
  }
  const grantable = new Set<string>(activeExposure.grantableScopes);
  if (
    claims.scopes.length === 0 ||
    claims.scopes.some((scope) => !grantable.has(scope))
  ) {
    return false;
  }
  const expectedLabels = consentLabelsForScopes(claims.scopes, consentCatalog);
  if (
    !expectedLabels ||
    expectedLabels.length !== claims.acceptedLabels.length
  ) {
    return false;
  }
  return expectedLabels.every(
    (label, index) => label === claims.acceptedLabels[index]
  );
}

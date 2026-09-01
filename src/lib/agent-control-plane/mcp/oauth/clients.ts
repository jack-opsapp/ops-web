import "server-only";

import {
  consentSnapshotForExposure,
  type McpConsentCatalog,
} from "./scope-catalog";
import { resolveRequestedScopes, scopesToParameter } from "./scopes";
import type { McpExposure } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";

/**
 * Dynamic client registration policy (RFC 7591) for the MCP mount.
 *
 * The MCP mount accepts public authorization-code clients from three connector
 * families. Claude uses its two exact hosted HTTPS callbacks, ChatGPT uses
 * its exact RFC 9207 stable callback, and Codex DCR binds an ephemeral port
 * before registering one literal IPv4 loopback callback. Every URI is stored
 * and compared byte-for-byte for the rest of the grant. CIMD and redirect
 * equivalence are deliberately not offered.
 */

export const REDIRECT_URI_ALLOWLIST = Object.freeze([
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
  "https://chatgpt.com/connector_platform_oauth_redirect",
] as const);

const CLAUDE_REDIRECT_URI_SET: ReadonlySet<string> = new Set(
  REDIRECT_URI_ALLOWLIST.slice(0, 2)
);
const CHATGPT_REDIRECT_URI = REDIRECT_URI_ALLOWLIST[2];

const MAX_REDIRECT_URI_LENGTH = 2_048;
const CODEX_LOOPBACK_REDIRECT_PATTERN =
  /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/callback\/[A-Za-z0-9_-]{8,128}$/u;

const ALLOWED_GRANT_TYPES: ReadonlySet<string> = new Set([
  "authorization_code",
  "refresh_token",
]);
const ALLOWED_RESPONSE_TYPES: ReadonlySet<string> = new Set(["code"]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const MAX_CLIENT_NAME_LENGTH = 256;
const MAX_SOFTWARE_FIELD_LENGTH = 128;

type ConnectorCallbackFamily = "claude" | "chatgpt" | "codex";

function connectorCallbackFamily(
  value: string
): ConnectorCallbackFamily | null {
  if (CLAUDE_REDIRECT_URI_SET.has(value)) return "claude";
  if (value === CHATGPT_REDIRECT_URI) return "chatgpt";

  // Validate raw text rather than a parsed URL. URL parsers normalize unsafe
  // numeric aliases such as 127.1 and 2130706433 into the loopback address.
  const match = CODEX_LOOPBACK_REDIRECT_PATTERN.exec(value);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535
    ? "codex"
    : null;
}

export function isAllowlistedRedirectUri(value: string): boolean {
  if (value.length > MAX_REDIRECT_URI_LENGTH) return false;
  return connectorCallbackFamily(value) !== null;
}

export interface ValidatedClientRegistration {
  readonly clientName: string;
  readonly redirectUris: readonly string[];
  readonly scope: string;
  readonly scopeCeiling: readonly string[];
  readonly consentCatalogRevision: string;
  readonly exposureRevision: string;
  readonly softwareId: string | null;
  readonly softwareVersion: string | null;
}

export interface ClientRegistrationRejection {
  readonly error: "invalid_client_metadata" | "invalid_redirect_uri";
  readonly errorDescription: string;
}

export type ClientRegistrationResult =
  | { readonly ok: true; readonly registration: ValidatedClientRegistration }
  | { readonly ok: false; readonly rejection: ClientRegistrationRejection };

function reject(
  error: ClientRegistrationRejection["error"],
  errorDescription: string
): ClientRegistrationResult {
  return { ok: false, rejection: { error, errorDescription } };
}

function sanitizedName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_CLIENT_NAME_LENGTH ||
    CONTROL_CHARACTERS.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function sanitizedSoftwareField(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length > MAX_SOFTWARE_FIELD_LENGTH) return undefined;
  if (CONTROL_CHARACTERS.test(trimmed)) return undefined;
  return trimmed === "" ? null : trimmed;
}

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((entry): entry is string => typeof entry === "string")) {
    return null;
  }
  return value;
}

/**
 * Validate an RFC 7591 registration payload against P1 policy. Unknown
 * metadata members are ignored per the RFC; everything load-bearing is
 * validated exactly.
 */
export function validateClientRegistration(
  payload: unknown,
  exposure: McpExposure,
  consentCatalog: McpConsentCatalog
): ClientRegistrationResult {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return reject(
      "invalid_client_metadata",
      "Registration payload must be a JSON object."
    );
  }
  const record = payload as Readonly<Record<string, unknown>>;

  const redirectUris = stringArray(record.redirect_uris);
  if (!redirectUris || redirectUris.length === 0) {
    return reject("invalid_redirect_uri", "redirect_uris is required.");
  }
  if (redirectUris.length > new Set(redirectUris).size) {
    return reject("invalid_redirect_uri", "redirect_uris must be unique.");
  }
  if (redirectUris.length > 8) {
    return reject("invalid_redirect_uri", "Too many redirect URIs.");
  }
  for (const uri of redirectUris) {
    if (!isAllowlistedRedirectUri(uri)) {
      return reject(
        "invalid_redirect_uri",
        "This authorization server does not accept the requested redirect URI."
      );
    }
  }
  const callbackFamilies = new Set(
    redirectUris.map((uri) => connectorCallbackFamily(uri))
  );
  if (callbackFamilies.size !== 1) {
    return reject(
      "invalid_redirect_uri",
      "redirect_uris must use one connector callback family."
    );
  }
  const callbackFamily = callbackFamilies.values().next().value as
    | ConnectorCallbackFamily
    | undefined;
  if (
    (callbackFamily === "codex" || callbackFamily === "chatgpt") &&
    redirectUris.length !== 1
  ) {
    return reject(
      "invalid_redirect_uri",
      callbackFamily === "codex"
        ? "Codex registration must use exactly one loopback redirect URI."
        : "ChatGPT registration must use exactly one redirect URI."
    );
  }

  const authMethod = record.token_endpoint_auth_method;
  if (authMethod !== undefined && authMethod !== "none") {
    return reject(
      "invalid_client_metadata",
      'Only public clients (token_endpoint_auth_method "none") are supported.'
    );
  }

  const grantTypes = record.grant_types;
  if (grantTypes !== undefined) {
    const parsed = stringArray(grantTypes);
    if (
      !parsed ||
      parsed.length === 0 ||
      !parsed.every((grantType) => ALLOWED_GRANT_TYPES.has(grantType)) ||
      !parsed.includes("authorization_code")
    ) {
      return reject(
        "invalid_client_metadata",
        "grant_types must be authorization_code with optional refresh_token."
      );
    }
  }

  const responseTypes = record.response_types;
  if (responseTypes !== undefined) {
    const parsed = stringArray(responseTypes);
    if (
      !parsed ||
      parsed.length === 0 ||
      !parsed.every((responseType) => ALLOWED_RESPONSE_TYPES.has(responseType))
    ) {
      return reject(
        "invalid_client_metadata",
        'response_types must be exactly ["code"].'
      );
    }
  }

  const clientName = sanitizedName(record.client_name) ?? "Claude";

  const scopeValue = record.scope;
  if (scopeValue !== undefined && typeof scopeValue !== "string") {
    return reject("invalid_client_metadata", "scope must be a string.");
  }
  const exposureSnapshot = consentSnapshotForExposure(exposure, consentCatalog);
  const resolvedScopes = resolveRequestedScopes(
    scopeValue as string | undefined,
    exposure
  );
  if (!resolvedScopes) {
    return reject(
      "invalid_client_metadata",
      "scope requests authority this server does not issue."
    );
  }

  const softwareId = sanitizedSoftwareField(record.software_id);
  const softwareVersion = sanitizedSoftwareField(record.software_version);
  if (softwareId === undefined || softwareVersion === undefined) {
    return reject("invalid_client_metadata", "software metadata is invalid.");
  }

  return {
    ok: true,
    registration: Object.freeze({
      clientName,
      redirectUris: Object.freeze([...redirectUris]),
      scope: scopesToParameter(resolvedScopes),
      scopeCeiling: resolvedScopes,
      consentCatalogRevision: exposureSnapshot.consentCatalogRevision,
      exposureRevision: exposureSnapshot.exposureRevision,
      softwareId,
      softwareVersion,
    }),
  };
}

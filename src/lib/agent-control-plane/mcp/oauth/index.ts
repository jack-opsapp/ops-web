import "server-only";

export {
  canonicalizeResourceUri,
  resolveMcpOAuthConfig,
  type McpOAuthConfig,
} from "./config";
export {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TOKEN_TTL_SECONDS,
  AUTHORIZATION_CODE_PREFIX,
  AUTHORIZATION_CODE_TTL_SECONDS,
  CONSENT_PREVIEW_PREFIX,
  CONSENT_PREVIEW_TTL_SECONDS,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_SECONDS,
  credentialDigest,
  isConsentSnapshotValidForExposure,
  isSha256Hex,
  mintCredential,
  secretsEqual,
  sha256Hex,
  type CredentialPrefix,
  type ImmutableConsentClaims,
} from "./tokens";
export {
  ACTIVE_MCP_CONSENT_CATALOG_REVISION,
  MCP_CONSENT_CATALOG,
  MCP_CONSENT_CATALOG_V1,
  MCP_CONSENT_CATALOG_V2,
  consentLabelsForScopes,
  consentSnapshotForExposure,
  resolveActiveMcpConsentCatalog,
  resolveMcpConsentCatalogRevision,
  type McpConsentCatalog,
  type McpConsentSnapshot,
} from "./scope-catalog";
export {
  isValidCodeChallenge,
  isValidCodeVerifier,
  s256Challenge,
  verifyS256Challenge,
} from "./pkce";
export {
  REDIRECT_URI_ALLOWLIST,
  isAllowlistedRedirectUri,
  validateClientRegistration,
  type ClientRegistrationResult,
  type ValidatedClientRegistration,
} from "./clients";
export { buildAuthorizationResponseUrl } from "./authorization-response";
export {
  SCOPE_CONSENT_LABELS,
  SUPPORTED_READ_SCOPES,
  areScopesWithinCeiling,
  isSupportedReadScope,
  resolveRequestedScopes,
  scopesToParameter,
  type SupportedReadScope,
} from "./scopes";
export {
  McpOAuthStoreError,
  appendRequestAudit,
  consumeAuthorizationCode,
  consumeConsentPreview,
  createAuthorizationCode,
  getClient,
  issueConsentPreview,
  listGrantsForUser,
  mintGrant,
  registerClient,
  resolveAccessToken,
  revokeGrant,
  revokeTokenByHash,
  rotateRefreshToken,
  type ClientRow,
  type ConsumedConsentPreviewRow,
  type ConsumedCodeRow,
  type GrantListRow,
  type McpOAuthRpcClient,
  type IssuedConsentPreviewRow,
  type MintedGrantRow,
  type RegisteredClientRow,
  type ResolvedAccessTokenRow,
  type RotatedGrantRow,
} from "./grants";

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
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_SECONDS,
  credentialDigest,
  isSha256Hex,
  mintCredential,
  secretsEqual,
  sha256Hex,
  type CredentialPrefix,
} from "./tokens";
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
export {
  SCOPE_CONSENT_LABELS,
  SUPPORTED_READ_SCOPES,
  isSupportedReadScope,
  resolveRequestedScopes,
  scopesToParameter,
  type SupportedReadScope,
} from "./scopes";
export {
  McpOAuthStoreError,
  appendRequestAudit,
  consumeAuthorizationCode,
  createAuthorizationCode,
  getClient,
  listGrantsForUser,
  mintGrant,
  registerClient,
  resolveAccessToken,
  revokeGrant,
  revokeTokenByHash,
  rotateRefreshToken,
  type ClientRow,
  type ConsumedCodeRow,
  type GrantListRow,
  type McpOAuthRpcClient,
  type MintedGrantRow,
  type RegisteredClientRow,
  type ResolvedAccessTokenRow,
  type RotatedGrantRow,
} from "./grants";

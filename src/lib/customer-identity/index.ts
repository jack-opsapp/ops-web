import "server-only";

/**
 * OPS customer identity broker (design: specs/2026-09-01-public-api-customer-identity-design.md).
 *
 * Routes obtain `CustomerIdentityDeps` from `getCustomerIdentityDeps()` and
 * pass it explicitly; when the customer auth project is unconfigured that
 * call throws `CustomerIdentityUnavailableError` before any network activity.
 */

export {
  CUSTOMER_AUTH_SECRET_KEY_ENV,
  CUSTOMER_AUTH_URL_ENV,
  CUSTOMER_IDENTITY_HMAC_KEYS_ENV,
  getCustomerAuthAdminClient,
  getCustomerIdentityDeps,
  parseCustomerIdentityHmacKeyRing,
  readCustomerIdentityConfig,
  type CustomerIdentityConfig,
  type CustomerIdentityDeps,
  type CustomerIdentityHmacKeyRing,
} from "./config";
export {
  SESSION_CREDENTIAL_PREFIX,
  emailDigest,
  mintSessionCredential,
  networkFingerprint,
  normalizeEmail,
  sessionDigest,
  sha256Hex,
} from "./credentials";
export {
  CustomerAccessError,
  CustomerContactConflictError,
  CustomerIdentityError,
  CustomerIdentityInputError,
  CustomerIdentityStoreError,
  CustomerIdentityUnavailableError,
  type CustomerAccessDenialCode,
  type CustomerIdentityErrorCode,
} from "./errors";
export {
  OTP_MAX_ATTEMPTS,
  startOtp,
  verifyOtp,
  type StartOtpInput,
  type StartOtpResult,
  type VerifyOtpInput,
  type VerifyOtpResult,
} from "./otp";
export {
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_PATH,
  SESSION_IDLE_TTL_SECONDS,
  clearSessionCookie,
  readSession,
  setSessionCookie,
  signOut,
  signOutEverywhere,
  type CustomerSession,
  type SessionCookieSink,
  type SessionCookieSource,
} from "./session";
export {
  requireMembership,
  resolveMembership,
  type CustomerMembership,
} from "./membership";
export {
  IDENTITY_EVENT_TYPES,
  MEMBERSHIP_EVIDENCE_KINDS,
  MEMBERSHIP_OUTCOMES,
  MEMBERSHIP_STATES,
  SESSION_STATUSES,
  appendIdentityEvent,
  confirmMembership,
  ensurePairwiseRef,
  listMembershipsForClient,
  readCustomerProfile,
  revokeMembership,
  type CustomerAuthAdminClient,
  type CustomerIdentityRpcClient,
  type CustomerProfileRow,
  type ProfileMembershipState,
  type IdentityEventMetadata,
  type IdentityEventType,
  type MembershipEvidenceKind,
  type MembershipListingRow,
  type MembershipOutcome,
  type MembershipState,
  type SessionStatus,
} from "./rpc";

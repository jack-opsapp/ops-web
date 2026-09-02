import "server-only";

import { z } from "zod-v4";

import { PostgresUuidSchema } from "@/lib/agent-control-plane/contracts/postgres-uuid";

import {
  CustomerContactConflictError,
  CustomerIdentityStoreError,
} from "./errors";

/**
 * Typed access to the customer identity system RPCs (design D8). Every row
 * that crosses this boundary is validated exactly against the P1 contract; a
 * malformed database result is an internal failure, never a partially
 * trusted value. Mirrors `agent-control-plane/mcp/oauth/grants.ts`.
 */

export interface CustomerIdentityRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
}

/**
 * The slice of the customer auth project's admin client the broker uses.
 * Structural so tests can stand in a plain object; supabase-js satisfies it.
 */
export interface CustomerAuthAdminClient {
  readonly auth: {
    signInWithOtp(credentials: {
      email: string;
      options?: { shouldCreateUser?: boolean };
    }): PromiseLike<{ readonly error: unknown }>;
    verifyOtp(params: {
      email: string;
      token: string;
      type: "email";
    }): PromiseLike<{
      readonly data: {
        readonly user: { readonly id: string } | null;
        readonly session: unknown;
      };
      readonly error: unknown;
    }>;
    readonly admin: {
      updateUserById(
        uid: string,
        attributes: { app_metadata?: object }
      ): PromiseLike<{ readonly error: unknown }>;
    };
  };
}

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const EmailDigestSchema = z.string().regex(/^[1-9][0-9]{0,4}:[0-9a-f]{64}$/);
const TimestampSchema = z.string().min(1);
const NonNegativeIntSchema = z.number().int().min(0);

export const MEMBERSHIP_STATES = [
  "active_forward_only",
  "active_full",
  "revoked",
  "merged",
] as const;
export const MEMBERSHIP_OUTCOMES = [
  "existing",
  "matched_forward_only",
  "matched_full",
  "created",
  "created_possible_duplicate",
] as const;
export const MEMBERSHIP_EVIDENCE_KINDS = [
  "none",
  "created_by_identity",
  "on_file_transacted",
  "staff_confirmed",
  "guest_claim",
] as const;
export const SESSION_STATUSES = ["ok", "expired", "revoked", "unknown"] as const;

export type MembershipState = (typeof MEMBERSHIP_STATES)[number];
export type MembershipOutcome = (typeof MEMBERSHIP_OUTCOMES)[number];
export type MembershipEvidenceKind = (typeof MEMBERSHIP_EVIDENCE_KINDS)[number];
export type SessionStatus = (typeof SESSION_STATUSES)[number];

const BeginOtpChallengeRowSchema = z
  .object({
    challenge_id: PostgresUuidSchema.nullable(),
    allowed: z.boolean(),
    retry_after_seconds: NonNegativeIntSchema,
  })
  .refine((row) => !row.allowed || row.challenge_id !== null);

const RecordOtpAttemptRowSchema = z.object({
  attempts: NonNegativeIntSchema,
  exhausted: z.boolean(),
});

const UpsertIdentityRowSchema = z.object({
  identity_id: PostgresUuidSchema,
  created: z.boolean(),
});

const ResolveSessionRowSchema = z
  .object({
    identity_id: PostgresUuidSchema.nullable(),
    session_id: PostgresUuidSchema.nullable(),
    status: z.enum(SESSION_STATUSES),
  })
  .refine(
    (row) =>
      row.status !== "ok" ||
      (row.identity_id !== null && row.session_id !== null)
  );

const ResolveMembershipRowSchema = z.object({
  membership_id: PostgresUuidSchema,
  client_id: PostgresUuidSchema,
  sub_client_id: PostgresUuidSchema.nullable(),
  state: z.enum(MEMBERSHIP_STATES),
  outcome: z.enum(MEMBERSHIP_OUTCOMES),
});

// A masked email keeps the first character and the domain only. Anything
// that still reads as a full mailbox is a leak and is refused.
const MaskedEmailSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => /\*/.test(value))
  .refine((value) => !/^[^*@\s]{2,}@/.test(value));

const MembershipListingRowSchema = z.object({
  membership_id: PostgresUuidSchema,
  state: z.enum(MEMBERSHIP_STATES),
  evidence_kind: z.enum(MEMBERSHIP_EVIDENCE_KINDS),
  contact_email_masked: MaskedEmailSchema,
  last_seen_at: TimestampSchema.nullable(),
});

// What `GET /api/customer/me` renders for one company. The display name is a
// customer-facing label (sub-client or client name); a raw uuid is never one.
const ProfileMembershipStateSchema = z.enum([...MEMBERSHIP_STATES, "none"]);
const CustomerProfileRowSchema = z.object({
  display_name: z
    .string()
    .min(1)
    .max(512)
    .refine((value) => !PostgresUuidSchema.safeParse(value).success)
    .nullable(),
  contact_email_masked: MaskedEmailSchema,
  membership_state: ProfileMembershipStateSchema,
});

// Pairwise refs are opaque public identifiers, shaped exactly as the
// `customer_pairwise_refs_public_ref_shape` constraint requires.
const PairwiseRefSchema = z.string().regex(/^cr_[0-9a-f]{32}$/);

export type BeginOtpChallengeRow = z.infer<typeof BeginOtpChallengeRowSchema>;
export type RecordOtpAttemptRow = z.infer<typeof RecordOtpAttemptRowSchema>;
export type UpsertIdentityRow = z.infer<typeof UpsertIdentityRowSchema>;
export type ResolveSessionRow = z.infer<typeof ResolveSessionRowSchema>;
export type ResolveMembershipRow = z.infer<typeof ResolveMembershipRowSchema>;
export type MembershipListingRow = z.infer<typeof MembershipListingRowSchema>;
export type CustomerProfileRow = z.infer<typeof CustomerProfileRowSchema>;
export type ProfileMembershipState = z.infer<typeof ProfileMembershipStateSchema>;

export const IDENTITY_EVENT_TYPES = [
  "otp_started",
  "otp_send_failed",
  "otp_refused",
  "otp_failed",
  "otp_verified",
  "identity_created",
  "session_issued",
  "session_revoked",
  "sessions_revoked_all",
  "contact_conflict",
] as const;
export type IdentityEventType = (typeof IDENTITY_EVENT_TYPES)[number];

type JsonPrimitive = string | number | boolean | null;
export type IdentityEventMetadata = {
  readonly [key: string]: JsonPrimitive | IdentityEventMetadata;
};

// The audit table never stores codes, tokens or session values (design §4).
// The broker enforces that at the boundary: any key that names a secret, or
// any string value shaped like one, is refused before the database sees it.
const FORBIDDEN_METADATA_KEY =
  /(code|token|secret|credential|password|hash|cookie|session_value|email|phone)/i;
const SECRET_SHAPED_VALUE =
  /(ops_cs_|ops_mcp_|eyJ[A-Za-z0-9_-]{10,}|^[0-9]{6}$|^[0-9a-f]{64}$|@)/;

function metadataIsSafe(metadata: IdentityEventMetadata): boolean {
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEY.test(key)) return false;
    if (typeof value === "string") {
      if (SECRET_SHAPED_VALUE.test(value)) return false;
    } else if (value !== null && typeof value === "object") {
      if (!metadataIsSafe(value)) return false;
    }
  }
  return true;
}

export async function callSystemRpc(
  client: CustomerIdentityRpcClient,
  functionName: string,
  args: Readonly<Record<string, unknown>>,
  operation: string
): Promise<unknown> {
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await client.rpc(functionName, args));
  } catch (cause) {
    throw new CustomerIdentityStoreError(operation, { cause });
  }
  if (error != null) {
    if (isContactConflict(error)) throw new CustomerContactConflictError();
    throw new CustomerIdentityStoreError(operation, { cause: error });
  }
  return data;
}

function isContactConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === "23505" &&
    typeof message === "string" &&
    message.includes("customer_contact_conflict")
  );
}

export function singleRow<T>(data: unknown, schema: z.ZodType<T>, operation: string): T {
  if (!Array.isArray(data) || data.length !== 1) {
    throw new CustomerIdentityStoreError(operation);
  }
  const parsed = schema.safeParse(data[0]);
  if (!parsed.success) throw new CustomerIdentityStoreError(operation);
  return parsed.data;
}

export function optionalSingleRow<T>(
  data: unknown,
  schema: z.ZodType<T>,
  operation: string
): T | null {
  if (data == null) return null;
  if (!Array.isArray(data)) throw new CustomerIdentityStoreError(operation);
  if (data.length === 0) return null;
  if (data.length !== 1) throw new CustomerIdentityStoreError(operation);
  const parsed = schema.safeParse(data[0]);
  if (!parsed.success) throw new CustomerIdentityStoreError(operation);
  return parsed.data;
}

export function scalar<T>(data: unknown, schema: z.ZodType<T>, operation: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new CustomerIdentityStoreError(operation);
  return parsed.data;
}

function requireUuid(value: string, operation: string): string {
  return scalar(value, PostgresUuidSchema, operation);
}

// ─── OTP challenges (design I8) ─────────────────────────────────────────────

export async function beginOtpChallenge(
  client: CustomerIdentityRpcClient,
  input: { emailDigest: string; networkFingerprint: string }
): Promise<BeginOtpChallengeRow> {
  const operation = "begin_customer_otp_challenge";
  scalar(input.emailDigest, EmailDigestSchema, operation);
  scalar(input.networkFingerprint, Sha256HexSchema, operation);
  const data = await callSystemRpc(
    client,
    "begin_customer_otp_challenge_as_system",
    {
      p_email_digest: input.emailDigest,
      p_network_fingerprint: input.networkFingerprint,
    },
    operation
  );
  return singleRow(data, BeginOtpChallengeRowSchema, operation);
}

/** Null means the challenge does not exist; the caller refuses uniformly. */
export async function recordOtpAttempt(
  client: CustomerIdentityRpcClient,
  input: { challengeId: string; success: boolean }
): Promise<RecordOtpAttemptRow | null> {
  const operation = "record_customer_otp_attempt";
  requireUuid(input.challengeId, operation);
  const data = await callSystemRpc(
    client,
    "record_customer_otp_attempt_as_system",
    { p_challenge_id: input.challengeId, p_success: input.success },
    operation
  );
  return optionalSingleRow(data, RecordOtpAttemptRowSchema, operation);
}

// ─── Identities ─────────────────────────────────────────────────────────────

export async function upsertIdentity(
  client: CustomerIdentityRpcClient,
  input: { authSubject: string; email: string }
): Promise<UpsertIdentityRow> {
  const operation = "upsert_customer_identity";
  const data = await callSystemRpc(
    client,
    "upsert_customer_identity_as_system",
    { p_auth_subject: input.authSubject, p_email: input.email },
    operation
  );
  return singleRow(data, UpsertIdentityRowSchema, operation);
}

// ─── Sessions (design I6) ───────────────────────────────────────────────────

export async function mintSession(
  client: CustomerIdentityRpcClient,
  input: { identityId: string; sessionHash: string; networkFingerprint: string }
): Promise<string> {
  const operation = "mint_customer_session";
  requireUuid(input.identityId, operation);
  scalar(input.sessionHash, Sha256HexSchema, operation);
  scalar(input.networkFingerprint, Sha256HexSchema, operation);
  const data = await callSystemRpc(
    client,
    "mint_customer_session_as_system",
    {
      p_identity_id: input.identityId,
      p_session_hash: input.sessionHash,
      p_network_fingerprint: input.networkFingerprint,
    },
    operation
  );
  return scalar(data, PostgresUuidSchema, operation);
}

export async function resolveSession(
  client: CustomerIdentityRpcClient,
  sessionHash: string
): Promise<ResolveSessionRow> {
  const operation = "resolve_customer_session";
  scalar(sessionHash, Sha256HexSchema, operation);
  const data = await callSystemRpc(
    client,
    "resolve_customer_session_as_system",
    { p_session_hash: sessionHash },
    operation
  );
  return singleRow(data, ResolveSessionRowSchema, operation);
}

export async function revokeSession(
  client: CustomerIdentityRpcClient,
  input: { sessionHash: string; reason: string }
): Promise<boolean> {
  const operation = "revoke_customer_session";
  scalar(input.sessionHash, Sha256HexSchema, operation);
  const data = await callSystemRpc(
    client,
    "revoke_customer_session_as_system",
    { p_session_hash: input.sessionHash, p_reason: input.reason },
    operation
  );
  return scalar(data, z.boolean(), operation);
}

export async function revokeAllSessions(
  client: CustomerIdentityRpcClient,
  input: { identityId: string; reason: string }
): Promise<number> {
  const operation = "revoke_all_customer_sessions";
  requireUuid(input.identityId, operation);
  const data = await callSystemRpc(
    client,
    "revoke_all_customer_sessions_as_system",
    { p_identity_id: input.identityId, p_reason: input.reason },
    operation
  );
  return scalar(data, NonNegativeIntSchema, operation);
}

// ─── Memberships (design §5.3) ──────────────────────────────────────────────

/**
 * Raw contract row. Carries the company-owned client ids and must never be
 * returned from a route; `membership.ts` projects it to the route-safe shape.
 */
export async function resolveMembershipRow(
  client: CustomerIdentityRpcClient,
  input: { identityId: string; companyId: string }
): Promise<ResolveMembershipRow | null> {
  const operation = "resolve_customer_membership";
  requireUuid(input.identityId, operation);
  requireUuid(input.companyId, operation);
  const data = await callSystemRpc(
    client,
    "resolve_customer_membership_as_system",
    { p_identity_id: input.identityId, p_company_id: input.companyId },
    operation
  );
  return optionalSingleRow(data, ResolveMembershipRowSchema, operation);
}

export async function confirmMembership(
  client: CustomerIdentityRpcClient,
  input: { membershipId: string; staffUserId: string }
): Promise<MembershipState> {
  const operation = "confirm_customer_membership";
  requireUuid(input.membershipId, operation);
  requireUuid(input.staffUserId, operation);
  const data = await callSystemRpc(
    client,
    "confirm_customer_membership_as_system",
    { p_membership_id: input.membershipId, p_staff_user_id: input.staffUserId },
    operation
  );
  return scalar(data, z.enum(MEMBERSHIP_STATES), operation);
}

export async function revokeMembership(
  client: CustomerIdentityRpcClient,
  input: { membershipId: string; staffUserId: string; reason: string }
): Promise<boolean> {
  const operation = "revoke_customer_membership";
  requireUuid(input.membershipId, operation);
  requireUuid(input.staffUserId, operation);
  const data = await callSystemRpc(
    client,
    "revoke_customer_membership_as_system",
    {
      p_membership_id: input.membershipId,
      p_staff_user_id: input.staffUserId,
      p_reason: input.reason,
    },
    operation
  );
  return scalar(data, z.boolean(), operation);
}

export async function listMembershipsForClient(
  client: CustomerIdentityRpcClient,
  input: { companyId: string; clientId: string }
): Promise<readonly MembershipListingRow[]> {
  const operation = "list_customer_memberships_for_client";
  requireUuid(input.companyId, operation);
  requireUuid(input.clientId, operation);
  const data = await callSystemRpc(
    client,
    "list_customer_memberships_for_client_as_system",
    { p_company_id: input.companyId, p_client_id: input.clientId },
    operation
  );
  if (data == null) return Object.freeze([]);
  if (!Array.isArray(data)) throw new CustomerIdentityStoreError(operation);
  return Object.freeze(
    data.map((row) => {
      const parsed = MembershipListingRowSchema.safeParse(row);
      if (!parsed.success) throw new CustomerIdentityStoreError(operation);
      return parsed.data;
    })
  );
}

/**
 * Profile for the hosted surface (`GET /api/customer/me`): display name from
 * the live membership's sub-client or client, the identity's live verified
 * email masked in the database, and the membership state or `none`.
 */
export async function readCustomerProfile(
  client: CustomerIdentityRpcClient,
  input: { identityId: string; companyId: string }
): Promise<CustomerProfileRow> {
  const operation = "read_customer_profile";
  requireUuid(input.identityId, operation);
  requireUuid(input.companyId, operation);
  const data = await callSystemRpc(
    client,
    "read_customer_profile_as_system",
    { p_identity_id: input.identityId, p_company_id: input.companyId },
    operation
  );
  return singleRow(data, CustomerProfileRowSchema, operation);
}

// ─── Integrations + pairwise refs (design I4) ───────────────────────────────

/** The company's hosted-pages integration (`kind = hosted_pages`), created on first use. */
export async function ensureHostedIntegration(
  client: CustomerIdentityRpcClient,
  input: { companyId: string }
): Promise<string> {
  const operation = "ensure_customer_hosted_integration";
  requireUuid(input.companyId, operation);
  const data = await callSystemRpc(
    client,
    "ensure_customer_hosted_integration_as_system",
    { p_company_id: input.companyId },
    operation
  );
  return scalar(data, PostgresUuidSchema, operation);
}

export async function ensurePairwiseRef(
  client: CustomerIdentityRpcClient,
  input: { identityId: string; integrationId: string }
): Promise<string> {
  const operation = "ensure_customer_pairwise_ref";
  requireUuid(input.identityId, operation);
  requireUuid(input.integrationId, operation);
  const data = await callSystemRpc(
    client,
    "ensure_customer_pairwise_ref_as_system",
    { p_identity_id: input.identityId, p_integration_id: input.integrationId },
    operation
  );
  return scalar(data, PairwiseRefSchema, operation);
}

// ─── Audit (single writer) ──────────────────────────────────────────────────

export async function appendIdentityEvent(
  client: CustomerIdentityRpcClient,
  input: {
    eventType: IdentityEventType;
    identityId: string | null;
    companyId: string | null;
    sessionId: string | null;
    networkFingerprint: string | null;
    metadata: IdentityEventMetadata;
  }
): Promise<void> {
  const operation = "append_customer_identity_event";
  if (!metadataIsSafe(input.metadata)) {
    throw new CustomerIdentityStoreError(operation);
  }
  if (input.identityId !== null) requireUuid(input.identityId, operation);
  if (input.companyId !== null) requireUuid(input.companyId, operation);
  if (input.sessionId !== null) requireUuid(input.sessionId, operation);
  if (input.networkFingerprint !== null) {
    scalar(input.networkFingerprint, Sha256HexSchema, operation);
  }
  await callSystemRpc(
    client,
    "append_customer_identity_event_as_system",
    {
      p_event_type: input.eventType,
      p_identity_id: input.identityId,
      p_company_id: input.companyId,
      p_session_id: input.sessionId,
      p_network_fingerprint: input.networkFingerprint,
      p_metadata: input.metadata,
    },
    operation
  );
}

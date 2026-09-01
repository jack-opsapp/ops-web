import "server-only";

import { z } from "zod-v4";

import { PostgresUuidSchema } from "@/lib/agent-control-plane/contracts/postgres-uuid";

/**
 * Typed access to the mcp_oauth system RPCs. Every row that crosses this
 * boundary is validated exactly; a malformed database result is an internal
 * failure, never a partially trusted value.
 */

export interface McpOAuthRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
}

const OAuthUuidSchema = z.uuid();
const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const TimestampSchema = z.string().min(1);
const PREVIEW_TIMESTAMP_PATTERN =
  /^((?!0000)\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-](\d{2}):(\d{2}))$/;
const RevisionIdSchema = z.string().regex(/^[0-9a-z][0-9a-z._:-]{0,127}$/);
const ScopesSchema = z
  .array(z.string().min(1).max(128))
  .min(1)
  .max(32)
  .refine((scopes) => new Set(scopes).size === scopes.length);
const AcceptedLabelsSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(256)
      .refine((label) => label === label.trim())
  )
  .min(1)
  .max(32);
const PkceChallengeSchema = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/);
const ConsentStateSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code < 0x20 || code === 0x7f) return false;
    }
    return true;
  })
  .nullable();

function canonicalPreviewTimestamp(value: string): string | null {
  const match = PREVIEW_TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
  const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ] as const;
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > monthDays[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    return null;
  }

  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const canonical = parsed.toISOString();
  return /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(canonical)
    ? canonical
    : null;
}

const PreviewTimestampSchema = z.string().transform((value, context) => {
  const canonical = canonicalPreviewTimestamp(value);
  if (canonical === null) {
    context.addIssue({
      code: "custom",
      message: "Invalid preview timestamp",
    });
    return z.NEVER;
  }
  return canonical;
});

function consentSnapshotAligned(row: {
  readonly scopes: readonly string[];
  readonly accepted_labels: readonly string[];
}): boolean {
  return row.scopes.length === row.accepted_labels.length;
}

function clientScopeAligned(row: {
  readonly scope: string;
  readonly scope_ceiling: readonly string[];
}): boolean {
  return row.scope === row.scope_ceiling.join(" ");
}

const RegisteredClientRowSchema = z
  .object({
    client_id: OAuthUuidSchema,
    client_name: z.string().min(1),
    redirect_uris: z.array(z.string().min(1)).min(1),
    token_endpoint_auth_method: z.literal("none"),
    grant_types: z.array(z.string().min(1)).min(1),
    response_types: z.array(z.string().min(1)).min(1),
    scope: z.string().min(1),
    scope_ceiling: ScopesSchema,
    consent_catalog_revision: RevisionIdSchema,
    exposure_revision: RevisionIdSchema,
    created_at: TimestampSchema,
  })
  .refine(clientScopeAligned);

const ClientRowSchema = z
  .object({
    client_id: OAuthUuidSchema,
    client_name: z.string().min(1),
    redirect_uris: z.array(z.string().min(1)).min(1),
    token_endpoint_auth_method: z.literal("none"),
    scope: z.string().min(1),
    scope_ceiling: ScopesSchema,
    consent_catalog_revision: RevisionIdSchema,
    exposure_revision: RevisionIdSchema,
    disabled: z.boolean(),
  })
  .refine(clientScopeAligned);

const IssuedConsentPreviewRowSchema = z.object({
  client_name: z.string().min(1).max(256),
  company_name: z.string().min(1).max(512),
  expires_at: PreviewTimestampSchema,
  rate_limited: z.boolean(),
});

const ConsumedConsentPreviewRowSchema = z
  .object({
    client_id: OAuthUuidSchema,
    user_id: PostgresUuidSchema,
    company_id: PostgresUuidSchema,
    client_name: z.string().min(1).max(256),
    company_name: z.string().min(1).max(512),
    redirect_uri: z.string().min(1).max(2048),
    response_type: z.literal("code"),
    scopes: ScopesSchema,
    accepted_labels: AcceptedLabelsSchema,
    consent_catalog_revision: RevisionIdSchema,
    exposure_revision: RevisionIdSchema,
    state: ConsentStateSchema,
    code_challenge: PkceChallengeSchema,
    code_challenge_method: z.literal("S256"),
    resource: z.string().min(1).max(2048),
    expires_at: PreviewTimestampSchema,
  })
  .refine(consentSnapshotAligned);

const ConsumedCodeRowSchema = z
  .object({
    user_id: PostgresUuidSchema,
    company_id: PostgresUuidSchema,
    scopes: ScopesSchema,
    accepted_labels: AcceptedLabelsSchema,
    consent_catalog_revision: RevisionIdSchema,
    exposure_revision: RevisionIdSchema,
    code_challenge: z.string().min(43).max(128),
    resource: z.string().min(1),
  })
  .refine(consentSnapshotAligned);

const MintedGrantRowSchema = z.object({
  grant_id: OAuthUuidSchema,
  revision: z.string().regex(/^[0-9a-f]{32}$/),
});

const RotatedGrantRowSchema = z
  .object({
    grant_id: OAuthUuidSchema,
    client_id: OAuthUuidSchema,
    user_id: PostgresUuidSchema,
    company_id: PostgresUuidSchema,
    scopes: ScopesSchema,
    accepted_labels: AcceptedLabelsSchema,
    consent_catalog_revision: RevisionIdSchema,
    exposure_revision: RevisionIdSchema,
    revision: z.string().regex(/^[0-9a-f]{32}$/),
    issuer: z.string().min(1),
    audience: z.string().min(1),
    reuse_detected: z.boolean(),
  })
  .refine(consentSnapshotAligned);

const ResolvedAccessTokenRowSchema = z
  .object({
    grant_id: OAuthUuidSchema,
    client_id: OAuthUuidSchema,
    client_name: z.string().min(1),
    user_id: PostgresUuidSchema,
    company_id: PostgresUuidSchema,
    scopes: ScopesSchema,
    accepted_labels: AcceptedLabelsSchema,
    consent_catalog_revision: RevisionIdSchema,
    exposure_revision: RevisionIdSchema,
    revision: z.string().regex(/^[0-9a-f]{32}$/),
    issuer: z.string().min(1),
    audience: z.string().min(1),
    expires_at: TimestampSchema,
    token_revoked: z.boolean(),
    grant_revoked: z.boolean(),
    client_disabled: z.boolean(),
  })
  .refine(consentSnapshotAligned);

const GrantListRowSchema = z.object({
  grant_id: OAuthUuidSchema,
  client_name: z.string().min(1),
  scopes: ScopesSchema,
  created_at: TimestampSchema,
  last_used_at: TimestampSchema.nullable(),
});

const CanaryBindingRowSchema = z.object({
  exposure_revision: RevisionIdSchema,
  consent_catalog_revision: RevisionIdSchema,
  expires_at: TimestampSchema,
});

export type RegisteredClientRow = z.infer<typeof RegisteredClientRowSchema>;
export type ClientRow = z.infer<typeof ClientRowSchema>;
export type IssuedConsentPreviewRow = z.infer<
  typeof IssuedConsentPreviewRowSchema
>;
export type ConsumedConsentPreviewRow = z.infer<
  typeof ConsumedConsentPreviewRowSchema
>;
export type ConsumedCodeRow = z.infer<typeof ConsumedCodeRowSchema>;
export type MintedGrantRow = z.infer<typeof MintedGrantRowSchema>;
export type RotatedGrantRow = z.infer<typeof RotatedGrantRowSchema>;
export type ResolvedAccessTokenRow = z.infer<
  typeof ResolvedAccessTokenRowSchema
>;
export type GrantListRow = z.infer<typeof GrantListRowSchema>;
export type CanaryBindingRow = z.infer<typeof CanaryBindingRowSchema>;

export class McpOAuthStoreError extends Error {
  constructor(operation: string) {
    super(`MCP OAuth store operation failed: ${operation}`);
    this.name = "McpOAuthStoreError";
  }
}

async function callRpc(
  client: McpOAuthRpcClient,
  functionName: string,
  args: Readonly<Record<string, unknown>>
): Promise<unknown> {
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await client.rpc(functionName, args));
  } catch {
    throw new McpOAuthStoreError(functionName);
  }
  if (error != null) throw new McpOAuthStoreError(functionName);
  return data;
}

function singleRow<T>(
  data: unknown,
  schema: z.ZodType<T>,
  operation: string
): T {
  if (!Array.isArray(data) || data.length !== 1) {
    throw new McpOAuthStoreError(operation);
  }
  const parsed = schema.safeParse(data[0]);
  if (!parsed.success) throw new McpOAuthStoreError(operation);
  return parsed.data;
}

function optionalSingleRow<T>(
  data: unknown,
  schema: z.ZodType<T>,
  operation: string
): T | null {
  if (data == null) return null;
  if (!Array.isArray(data)) throw new McpOAuthStoreError(operation);
  if (data.length === 0) return null;
  if (data.length !== 1) throw new McpOAuthStoreError(operation);
  const parsed = schema.safeParse(data[0]);
  if (!parsed.success) throw new McpOAuthStoreError(operation);
  return parsed.data;
}

export async function registerClient(
  client: McpOAuthRpcClient,
  input: {
    clientName: string;
    redirectUris: readonly string[];
    scope: string;
    scopeCeiling: readonly string[];
    consentCatalogRevision: string;
    exposureRevision: string;
    softwareId: string | null;
    softwareVersion: string | null;
  }
): Promise<RegisteredClientRow> {
  const data = await callRpc(client, "register_mcp_oauth_client_as_system", {
    p_client_name: input.clientName,
    p_redirect_uris: input.redirectUris,
    p_scope: input.scope,
    p_scope_ceiling: input.scopeCeiling,
    p_consent_catalog_revision: input.consentCatalogRevision,
    p_exposure_revision: input.exposureRevision,
    p_software_id: input.softwareId,
    p_software_version: input.softwareVersion,
  });
  return singleRow(
    data,
    RegisteredClientRowSchema,
    "register_mcp_oauth_client"
  );
}

export async function getClient(
  client: McpOAuthRpcClient,
  clientId: string
): Promise<ClientRow | null> {
  const data = await callRpc(client, "get_mcp_oauth_client_as_system", {
    p_client_id: clientId,
  });
  return optionalSingleRow(data, ClientRowSchema, "get_mcp_oauth_client");
}

export async function resolveCanaryBinding(
  client: McpOAuthRpcClient,
  input: {
    clientId: string;
    userId: string;
    companyId: string;
    exposureRevision: string;
    consentCatalogRevision: string;
  }
): Promise<CanaryBindingRow | null> {
  const data = await callRpc(client, "resolve_mcp_oauth_canary_as_system", {
    p_oauth_client_id: input.clientId,
    p_user_id: input.userId,
    p_company_id: input.companyId,
    p_exposure_revision: input.exposureRevision,
    p_consent_catalog_revision: input.consentCatalogRevision,
  });
  return optionalSingleRow(
    data,
    CanaryBindingRowSchema,
    "resolve_mcp_oauth_canary"
  );
}

export async function issueConsentPreview(
  client: McpOAuthRpcClient,
  input: {
    previewHash: string;
    clientId: string;
    userId: string;
    companyId: string;
    redirectUri: string;
    responseType: "code";
    scopes: readonly string[];
    acceptedLabels: readonly string[];
    consentCatalogRevision: string;
    exposureRevision: string;
    state: string | null;
    codeChallenge: string;
    codeChallengeMethod: "S256";
    resource: string;
    expiresAt: Date;
  }
): Promise<IssuedConsentPreviewRow | null> {
  const data = await callRpc(
    client,
    "issue_mcp_oauth_consent_preview_as_system",
    {
      p_preview_hash: input.previewHash,
      p_client_id: input.clientId,
      p_user_id: input.userId,
      p_company_id: input.companyId,
      p_redirect_uri: input.redirectUri,
      p_response_type: input.responseType,
      p_scopes: input.scopes,
      p_accepted_labels: input.acceptedLabels,
      p_consent_catalog_revision: input.consentCatalogRevision,
      p_exposure_revision: input.exposureRevision,
      p_state: input.state,
      p_code_challenge: input.codeChallenge,
      p_code_challenge_method: input.codeChallengeMethod,
      p_resource: input.resource,
      p_expires_at: input.expiresAt.toISOString(),
    }
  );
  return optionalSingleRow(
    data,
    IssuedConsentPreviewRowSchema,
    "issue_mcp_oauth_consent_preview"
  );
}

export async function consumeConsentPreview(
  client: McpOAuthRpcClient,
  input: { previewHash: string; userId: string; companyId: string }
): Promise<ConsumedConsentPreviewRow | null> {
  const data = await callRpc(
    client,
    "consume_mcp_oauth_consent_preview_as_system",
    {
      p_preview_hash: input.previewHash,
      p_user_id: input.userId,
      p_company_id: input.companyId,
    }
  );
  return optionalSingleRow(
    data,
    ConsumedConsentPreviewRowSchema,
    "consume_mcp_oauth_consent_preview"
  );
}

export async function createAuthorizationCode(
  client: McpOAuthRpcClient,
  input: {
    codeHash: string;
    clientId: string;
    userId: string;
    companyId: string;
    scopes: readonly string[];
    acceptedLabels: readonly string[];
    consentCatalogRevision: string;
    exposureRevision: string;
    redirectUri: string;
    codeChallenge: string;
    resource: string;
    expiresAt: Date;
  }
): Promise<void> {
  await callRpc(client, "create_mcp_oauth_authorization_code_as_system", {
    p_code_hash: input.codeHash,
    p_client_id: input.clientId,
    p_user_id: input.userId,
    p_company_id: input.companyId,
    p_scopes: input.scopes,
    p_accepted_labels: input.acceptedLabels,
    p_consent_catalog_revision: input.consentCatalogRevision,
    p_exposure_revision: input.exposureRevision,
    p_redirect_uri: input.redirectUri,
    p_code_challenge: input.codeChallenge,
    p_resource: input.resource,
    p_expires_at: input.expiresAt.toISOString(),
  });
}

export async function consumeAuthorizationCode(
  client: McpOAuthRpcClient,
  input: { codeHash: string; clientId: string; redirectUri: string }
): Promise<ConsumedCodeRow | null> {
  const data = await callRpc(
    client,
    "consume_mcp_oauth_authorization_code_as_system",
    {
      p_code_hash: input.codeHash,
      p_client_id: input.clientId,
      p_redirect_uri: input.redirectUri,
    }
  );
  return optionalSingleRow(
    data,
    ConsumedCodeRowSchema,
    "consume_mcp_oauth_authorization_code"
  );
}

export async function mintGrant(
  client: McpOAuthRpcClient,
  input: {
    codeHash: string;
    clientId: string;
    userId: string;
    companyId: string;
    activeExposureRevision: string;
    activeGrantableScopes: readonly string[];
    accessHash: string;
    refreshHash: string;
    issuer: string;
    audience: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
  }
): Promise<MintedGrantRow> {
  const data = await callRpc(client, "mint_mcp_oauth_grant_as_system", {
    p_code_hash: input.codeHash,
    p_client_id: input.clientId,
    p_user_id: input.userId,
    p_company_id: input.companyId,
    p_active_exposure_revision: input.activeExposureRevision,
    p_active_grantable_scopes: input.activeGrantableScopes,
    p_access_hash: input.accessHash,
    p_refresh_hash: input.refreshHash,
    p_issuer: input.issuer,
    p_audience: input.audience,
    p_access_expires_at: input.accessExpiresAt.toISOString(),
    p_refresh_expires_at: input.refreshExpiresAt.toISOString(),
  });
  return singleRow(data, MintedGrantRowSchema, "mint_mcp_oauth_grant");
}

export async function rotateRefreshToken(
  client: McpOAuthRpcClient,
  input: {
    presentedHash: string;
    clientId: string;
    activeGrantableScopes: readonly string[];
    newAccessHash: string;
    newRefreshHash: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
  }
): Promise<RotatedGrantRow | null> {
  const data = await callRpc(
    client,
    "rotate_mcp_oauth_refresh_token_as_system",
    {
      p_presented_hash: input.presentedHash,
      p_client_id: input.clientId,
      p_active_grantable_scopes: input.activeGrantableScopes,
      p_new_access_hash: input.newAccessHash,
      p_new_refresh_hash: input.newRefreshHash,
      p_access_expires_at: input.accessExpiresAt.toISOString(),
      p_refresh_expires_at: input.refreshExpiresAt.toISOString(),
    }
  );
  return optionalSingleRow(
    data,
    RotatedGrantRowSchema,
    "rotate_mcp_oauth_refresh_token"
  );
}

export async function resolveAccessToken(
  client: McpOAuthRpcClient,
  tokenHash: string,
  activeExposureRevision: string
): Promise<ResolvedAccessTokenRow | null> {
  const data = await callRpc(
    client,
    "resolve_mcp_oauth_access_token_as_system",
    {
      p_token_hash: tokenHash,
      p_active_exposure_revision: activeExposureRevision,
    }
  );
  return optionalSingleRow(
    data,
    ResolvedAccessTokenRowSchema,
    "resolve_mcp_oauth_access_token"
  );
}

export async function revokeGrant(
  client: McpOAuthRpcClient,
  input: { grantId: string; userId: string }
): Promise<boolean> {
  const data = await callRpc(client, "revoke_mcp_oauth_grant_as_system", {
    p_grant_id: input.grantId,
    p_user_id: input.userId,
  });
  return data === true;
}

export async function revokeTokenByHash(
  client: McpOAuthRpcClient,
  tokenHash: string
): Promise<void> {
  await callRpc(client, "revoke_mcp_oauth_token_as_system", {
    p_token_hash: tokenHash,
  });
}

export async function listGrantsForUser(
  client: McpOAuthRpcClient,
  input: { userId: string; companyId: string }
): Promise<readonly GrantListRow[]> {
  const data = await callRpc(
    client,
    "list_mcp_oauth_grants_for_user_as_system",
    { p_user_id: input.userId, p_company_id: input.companyId }
  );
  if (data == null) return Object.freeze([]);
  if (!Array.isArray(data)) {
    throw new McpOAuthStoreError("list_mcp_oauth_grants_for_user");
  }
  return Object.freeze(
    data.map((row) => {
      const parsed = GrantListRowSchema.safeParse(row);
      if (!parsed.success) {
        throw new McpOAuthStoreError("list_mcp_oauth_grants_for_user");
      }
      return parsed.data;
    })
  );
}

export async function appendRequestAudit(
  client: McpOAuthRpcClient,
  input: {
    requestId: string;
    grantId: string | null;
    clientId: string | null;
    actorUserId: string | null;
    companyId: string | null;
    tool: string | null;
    protocolEra: string | null;
    outcome:
      | "ok"
      | "domain_error"
      | "unauthenticated"
      | "forbidden"
      | "rate_limited"
      | "internal";
    errorCode: string | null;
    inputSha256: string | null;
    resultBytes: number | null;
    latencyMs: number | null;
  }
): Promise<void> {
  if (input.inputSha256 !== null) {
    const parsed = Sha256HexSchema.safeParse(input.inputSha256);
    if (!parsed.success) throw new McpOAuthStoreError("append_mcp_audit");
  }
  await callRpc(client, "append_mcp_request_audit_as_system", {
    p_request_id: input.requestId,
    p_grant_id: input.grantId,
    p_client_id: input.clientId,
    p_actor_user_id: input.actorUserId,
    p_company_id: input.companyId,
    p_tool: input.tool,
    p_protocol_era: input.protocolEra,
    p_outcome: input.outcome,
    p_error_code: input.errorCode,
    p_input_sha256: input.inputSha256,
    p_result_bytes: input.resultBytes,
    p_latency_ms: input.latencyMs,
  });
}

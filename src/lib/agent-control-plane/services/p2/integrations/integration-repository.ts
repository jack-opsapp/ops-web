import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
  P2DomainRevisionVectorSchema,
  P2EvidenceRefSchema,
  P2ProofRefSchema,
} from "@/lib/agent-control-plane/contracts";
import {
  GetIntegrationHealthResultSchema,
  IntegrationHealthItemSchema,
  IntegrationHealthSelectionSchema,
  INTEGRATION_HEALTH_MAX_ITEMS,
  INTEGRATION_HEALTH_MAX_SOURCE_ROWS,
  assertNoCompanyOperationsForbiddenFields,
  type GetIntegrationHealthResult,
} from "@/lib/agent-control-plane/contracts/company-operations";
import {
  isAuthorizedIntegrationHealthRead,
  type AuthorizedIntegrationHealthRead,
} from "./integration-authorization";
import {
  integrationHealthCollectionProofRef,
  integrationHealthEntityProofRef,
  integrationHealthEvidenceRef,
  integrationHealthProofContext,
  type IntegrationHealthSourceInspected,
} from "./integration-proof";

const RPC_NAME = "read_agent_integration_health_as_system" as const;
const TRUSTED_INTEGRATION_HEALTH_REPOSITORIES = new WeakSet<object>();

const CanonicalStringArraySchema = z
  .array(z.string().min(1).max(128))
  .max(64)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "INTEGRATION_HEALTH_ARRAY_NOT_CANONICAL"
  );
const SelectionVectorSchema = z
  .array(IntegrationHealthSelectionSchema)
  .min(1)
  .max(INTEGRATION_HEALTH_MAX_ITEMS);
const ExactRevisionsSchema = P2DomainRevisionVectorSchema.refine(
  (revisions) =>
    revisions.length === 2 &&
    revisions[0]?.domain === "company" &&
    revisions[1]?.domain === "integrations",
  "INTEGRATION_HEALTH_REVISION_VECTOR_INVALID"
);
const SourceInspectedSchema = z
  .object({
    accounting: z
      .number()
      .int()
      .min(0)
      .max(INTEGRATION_HEALTH_MAX_SOURCE_ROWS - 1),
    mailbox: z
      .number()
      .int()
      .min(0)
      .max(INTEGRATION_HEALTH_MAX_SOURCE_ROWS - 1),
  })
  .strict();
const RawRowSchema = z
  .object({
    item: IntegrationHealthItemSchema,
    proof_ref: P2ProofRefSchema,
    evidence_ref: P2EvidenceRefSchema,
  })
  .strict();
const RawSnapshotSchema = z
  .object({
    company_id: P2CanonicalUuidSchema,
    actor_user_id: P2CanonicalUuidSchema,
    oauth_grant_id: P2CanonicalUuidSchema,
    oauth_client_id: P2CanonicalUuidSchema,
    grant_revision: z.string().regex(/^[0-9a-f]{32}$/),
    granted_scope_ceiling: CanonicalStringArraySchema,
    permission_snapshot_revision: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    capability_id: z.literal("get_integration_health"),
    capability_revision: z.literal("get_integration_health:2026-08-22.v1"),
    capability_manifest_revision: z.literal(
      "2026-08-22.capability-manifest.v8"
    ),
    required_oauth_scopes: z.tuple([z.literal("ops.integrations.read")]),
    settings_integrations_scope: z.literal("all"),
    accounting_scope: z.literal("all").nullable(),
    email_scope: z.enum(["all", "own"]).nullable(),
    selections: SelectionVectorSchema,
    read_at: P2CanonicalTimestampSchema,
    source_revisions: ExactRevisionsSchema,
    source_inspected: SourceInspectedSchema,
    rows: z.array(RawRowSchema).min(1).max(INTEGRATION_HEALTH_MAX_ITEMS),
    collection_proof_ref: P2ProofRefSchema,
  })
  .strict();

type RawSnapshot = z.infer<typeof RawSnapshotSchema>;

export interface IntegrationHealthProofBinding {
  readonly sourceInspected: IntegrationHealthSourceInspected;
}

export type IntegrationHealthRepositoryResult =
  | Readonly<{
      state: "found";
      value: GetIntegrationHealthResult;
      proofBinding: IntegrationHealthProofBinding;
    }>
  | Readonly<{ state: "source_bound" }>
  | Readonly<{ state: "source_invalid" }>;

export interface IntegrationHealthRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface IntegrationHealthRpcRequest extends PromiseLike<IntegrationHealthRpcResult> {
  abortSignal?: (
    signal: AbortSignal
  ) => PromiseLike<IntegrationHealthRpcResult>;
}

export interface IntegrationHealthRpcClient {
  rpc(
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ): IntegrationHealthRpcRequest;
}

export interface IntegrationHealthRepository {
  read(input: {
    readonly authorization: AuthorizedIntegrationHealthRead;
    readonly signal?: AbortSignal;
  }): Promise<IntegrationHealthRepositoryResult>;
}

export class IntegrationHealthRepositoryError extends Error {
  readonly code:
    | "INTEGRATION_HEALTH_INVALID"
    | "INTEGRATION_HEALTH_READ_FAILED";

  constructor(
    code: IntegrationHealthRepositoryError["code"],
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "IntegrationHealthRepositoryError";
    this.code = code;
  }
}

function invalid(cause?: unknown): never {
  throw new IntegrationHealthRepositoryError("INTEGRATION_HEALTH_INVALID", {
    cause,
  });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value))
    return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function knownErrorState(
  error: unknown
): "source_bound" | "source_invalid" | null {
  try {
    if (typeof error !== "object" || error === null || Array.isArray(error)) {
      return null;
    }
    const record = error as Readonly<Record<string, unknown>>;
    if (
      record.code === "54000" &&
      record.message === "agent_integration_health_source_query_bound"
    ) {
      return "source_bound";
    }
    if (
      record.code === "22000" &&
      record.message === "agent_integration_health_source_data_invalid"
    ) {
      return "source_invalid";
    }
  } catch {
    return null;
  }
  return null;
}

function assertSnapshot(
  snapshot: RawSnapshot,
  authorization: AuthorizedIntegrationHealthRead
) {
  if (
    snapshot.company_id !== authorization.actorContext.companyId ||
    snapshot.actor_user_id !== authorization.actorContext.actorUserId ||
    snapshot.oauth_grant_id !== authorization.oauthGrantId ||
    snapshot.oauth_client_id !== authorization.oauthClientId ||
    snapshot.grant_revision !== authorization.grantRevision ||
    !sameJson(
      snapshot.granted_scope_ceiling,
      authorization.grantedScopeCeiling
    ) ||
    snapshot.permission_snapshot_revision !==
      authorization.actorContext.permissionSnapshotRevision ||
    snapshot.capability_id !== authorization.capabilityId ||
    snapshot.capability_revision !== authorization.capabilityRevision ||
    snapshot.capability_manifest_revision !==
      authorization.capabilityManifestRevision ||
    !sameJson(
      snapshot.required_oauth_scopes,
      authorization.requiredOAuthScopes
    ) ||
    snapshot.settings_integrations_scope !==
      authorization.settingsIntegrationsScope ||
    snapshot.accounting_scope !== authorization.accountingScope ||
    snapshot.email_scope !== authorization.emailScope ||
    !sameJson(snapshot.selections, authorization.query.integrations) ||
    snapshot.rows.length !== snapshot.selections.length ||
    snapshot.rows.some(
      (row, index) =>
        row.item.integration_type !==
          snapshot.selections[index]?.integration_type ||
        row.item.provider !== snapshot.selections[index]?.provider
    )
  ) {
    invalid();
  }
  assertNoCompanyOperationsForbiddenFields(snapshot.rows);
  const context = integrationHealthProofContext({
    authorization,
    readAt: snapshot.read_at,
    sourceRevisions: snapshot.source_revisions,
    sourceInspected: snapshot.source_inspected,
  });
  for (let index = 0; index < snapshot.rows.length; index += 1) {
    const row = snapshot.rows[index]!;
    const selection = snapshot.selections[index]!;
    if (
      row.proof_ref !==
        integrationHealthEntityProofRef({ context, item: row.item }) ||
      row.evidence_ref !== integrationHealthEvidenceRef({ context, selection })
    ) {
      invalid();
    }
  }
  const children = snapshot.rows.map((row, index) => ({
    selection: snapshot.selections[index]!,
    proof_ref: row.proof_ref,
    evidence_ref: row.evidence_ref,
  }));
  if (
    snapshot.collection_proof_ref !==
    integrationHealthCollectionProofRef({ context, children })
  ) {
    invalid();
  }
  const value = GetIntegrationHealthResultSchema.parse({
    items: snapshot.rows.map((row) => row.item),
    item_proofs: snapshot.rows.map((row) => ({
      proof_ref: row.proof_ref,
      read_at: snapshot.read_at,
      source_revisions: snapshot.source_revisions,
    })),
    evidence: snapshot.rows.map((row) => ({
      evidence_ref: row.evidence_ref,
      source_domain: "integrations",
      source_type: "integration_health_snapshot",
      occurred_at: snapshot.read_at,
    })),
    collection_proof: {
      proof_ref: snapshot.collection_proof_ref,
      read_at: snapshot.read_at,
      source_revisions: snapshot.source_revisions,
      returned_count: snapshot.rows.length,
      has_more: false,
    },
  });
  assertNoCompanyOperationsForbiddenFields(value);
  return deepFreeze({
    value,
    proofBinding: { sourceInspected: snapshot.source_inspected },
  });
}

export function createSupabaseIntegrationHealthRepository(
  client: IntegrationHealthRpcClient
): IntegrationHealthRepository {
  let suppliedRpc: IntegrationHealthRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as IntegrationHealthRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("An integration-health RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("An integration-health RPC client is required");
  }
  const rpc = (args: Readonly<Record<string, unknown>>) =>
    Reflect.apply(suppliedRpc!, client, [
      RPC_NAME,
      args,
    ]) as IntegrationHealthRpcRequest;

  const repository: IntegrationHealthRepository = {
    async read(input) {
      let authorization: AuthorizedIntegrationHealthRead;
      let signal: AbortSignal | undefined;
      try {
        authorization = input.authorization;
        signal = input.signal;
      } catch (error) {
        invalid(error);
      }
      if (!isAuthorizedIntegrationHealthRead(authorization)) invalid();
      if (signal?.aborted) {
        throw new IntegrationHealthRepositoryError(
          "INTEGRATION_HEALTH_READ_FAILED"
        );
      }
      let response: IntegrationHealthRpcResult;
      try {
        const request = rpc({
          p_request_id: authorization.actorContext.requestId,
          p_actor_user_id: authorization.actorContext.actorUserId,
          p_company_id: authorization.actorContext.companyId,
          p_oauth_grant_id: authorization.oauthGrantId,
          p_oauth_client_id: authorization.oauthClientId,
          p_grant_revision: authorization.grantRevision,
          p_granted_scope_ceiling: [...authorization.grantedScopeCeiling],
          p_permission_snapshot_revision:
            authorization.actorContext.permissionSnapshotRevision,
          p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
          p_capability_id: authorization.capabilityId,
          p_capability_revision: authorization.capabilityRevision,
          p_capability_manifest_revision:
            authorization.capabilityManifestRevision,
          p_required_oauth_scopes: [...authorization.requiredOAuthScopes],
          p_settings_integrations_scope:
            authorization.settingsIntegrationsScope,
          p_accounting_scope: authorization.accountingScope,
          p_email_scope: authorization.emailScope,
          p_selections: authorization.query.integrations.map((selection) => ({
            ...selection,
          })),
          p_source_limit: INTEGRATION_HEALTH_MAX_SOURCE_ROWS,
        });
        response =
          signal && typeof request.abortSignal === "function"
            ? await Reflect.apply(request.abortSignal, request, [signal])
            : await request;
      } catch (error) {
        throw new IntegrationHealthRepositoryError(
          "INTEGRATION_HEALTH_READ_FAILED",
          { cause: error }
        );
      }
      if (signal?.aborted) {
        throw new IntegrationHealthRepositoryError(
          "INTEGRATION_HEALTH_READ_FAILED"
        );
      }
      let responseError: unknown;
      let responseData: unknown;
      try {
        responseError = response.error;
        responseData = response.data;
      } catch (error) {
        throw new IntegrationHealthRepositoryError(
          "INTEGRATION_HEALTH_READ_FAILED",
          { cause: error }
        );
      }
      if (responseError) {
        const state = knownErrorState(responseError);
        if (state) return deepFreeze({ state });
        throw new IntegrationHealthRepositoryError(
          "INTEGRATION_HEALTH_READ_FAILED"
        );
      }
      try {
        const snapshot = RawSnapshotSchema.parse(responseData);
        return deepFreeze({
          state: "found" as const,
          ...assertSnapshot(snapshot, authorization),
        });
      } catch (error) {
        if (error instanceof IntegrationHealthRepositoryError) throw error;
        invalid(error);
      }
    },
  };
  TRUSTED_INTEGRATION_HEALTH_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedIntegrationHealthRepository(
  value: unknown
): value is IntegrationHealthRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_INTEGRATION_HEALTH_REPOSITORIES.has(value)
  );
}

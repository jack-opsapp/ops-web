import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
  P2DomainRevisionVectorSchema,
  P2ProofRefSchema,
} from "@/lib/agent-control-plane/contracts";
import {
  CompanyContextInputSchema,
  CompanyContextResultSchema,
  assertNoCompanyOperationsForbiddenFields,
  type CompanyContextResult,
} from "@/lib/agent-control-plane/contracts/company-operations";
import {
  isAuthorizedCompanyContextRead,
  type AuthorizedCompanyContextRead,
} from "./company-authorization";
import {
  companyContextProofMaterial,
  companyContextProofRef,
  type CompanyContextProofBinding,
} from "./company-proof";

const RPC_NAME = "read_agent_company_context_as_system" as const;
const TRUSTED_COMPANY_CONTEXT_REPOSITORIES = new WeakSet<object>();

const CanonicalStringArraySchema = z
  .array(z.string().min(1).max(128))
  .max(64)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "COMPANY_CONTEXT_ARRAY_NOT_CANONICAL"
  );
const ExactCompanyRevisionsSchema = P2DomainRevisionVectorSchema.refine(
  (revisions) => revisions.length === 1 && revisions[0]?.domain === "company",
  "COMPANY_CONTEXT_REVISION_VECTOR_INVALID"
);
const SourceInspectedSchema = z
  .object({
    companies: z.number().int().min(0).max(1),
    inventory_settings: z.number().int().min(0).max(1),
    company_settings: z.number().int().min(0).max(1),
  })
  .strict();
const RawResultSchema = CompanyContextResultSchema.omit({ proof: true });
const RawSnapshotSchema = z
  .object({
    company_id: P2CanonicalUuidSchema,
    actor_user_id: P2CanonicalUuidSchema,
    oauth_grant_id: P2CanonicalUuidSchema,
    oauth_client_id: P2CanonicalUuidSchema,
    grant_revision: z.string().regex(/^[0-9a-f]{32}$/),
    granted_scope_ceiling: CanonicalStringArraySchema,
    permission_snapshot_revision: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    capability_id: z.literal("get_company_context"),
    capability_revision: z.literal("get_company_context:2026-08-22.v1"),
    capability_manifest_revision: z.literal(
      "2026-08-22.capability-manifest.v8"
    ),
    required_oauth_scopes: z.tuple([z.literal("ops.company.read")]),
    settings_company_scope: z.literal("all"),
    query: CompanyContextInputSchema,
    read_at: P2CanonicalTimestampSchema,
    source_revisions: ExactCompanyRevisionsSchema,
    source_inspected: SourceInspectedSchema,
    result: RawResultSchema,
    proof_ref: P2ProofRefSchema,
  })
  .strict();

type RawSnapshot = z.infer<typeof RawSnapshotSchema>;

export type CompanyContextRepositoryResult =
  | Readonly<{
      state: "found";
      value: CompanyContextResult;
      proofBinding: CompanyContextProofBinding;
    }>
  | Readonly<{ state: "not_found" }>;

export interface CompanyContextRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface CompanyContextRpcRequest extends PromiseLike<CompanyContextRpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<CompanyContextRpcResult>;
}

export interface CompanyContextRpcClient {
  rpc(
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ): CompanyContextRpcRequest;
}

export interface CompanyContextRepository {
  read(input: {
    readonly authorization: AuthorizedCompanyContextRead;
    readonly signal?: AbortSignal;
  }): Promise<CompanyContextRepositoryResult>;
}

export class CompanyContextRepositoryError extends Error {
  readonly code: "COMPANY_CONTEXT_INVALID" | "COMPANY_CONTEXT_READ_FAILED";

  constructor(
    code: CompanyContextRepositoryError["code"],
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "CompanyContextRepositoryError";
    this.code = code;
  }
}

function invalid(cause?: unknown): never {
  throw new CompanyContextRepositoryError("COMPANY_CONTEXT_INVALID", {
    cause,
  });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function knownErrorState(error: unknown): "not_found" | null {
  try {
    if (typeof error !== "object" || error === null || Array.isArray(error)) {
      return null;
    }
    const record = error as Readonly<Record<string, unknown>>;
    if (
      record.code === "P0002" &&
      record.message === "agent_company_context_not_found_or_not_visible"
    ) {
      return "not_found";
    }
  } catch {
    return null;
  }
  return null;
}

function assertSnapshot(
  snapshot: RawSnapshot,
  authorization: AuthorizedCompanyContextRead
): Readonly<{
  value: CompanyContextResult;
  proofBinding: CompanyContextProofBinding;
}> {
  if (
    snapshot.company_id !== authorization.actorContext.companyId ||
    snapshot.actor_user_id !== authorization.actorContext.actorUserId ||
    snapshot.oauth_grant_id !== authorization.oauthGrantId ||
    snapshot.oauth_client_id !== authorization.oauthClientId ||
    snapshot.grant_revision !== authorization.grantRevision ||
    !sameStrings(
      snapshot.granted_scope_ceiling,
      authorization.grantedScopeCeiling
    ) ||
    snapshot.permission_snapshot_revision !==
      authorization.actorContext.permissionSnapshotRevision ||
    snapshot.capability_id !== authorization.capabilityId ||
    snapshot.capability_revision !== authorization.capabilityRevision ||
    snapshot.capability_manifest_revision !==
      authorization.capabilityManifestRevision ||
    !sameStrings(
      snapshot.required_oauth_scopes,
      authorization.requiredOAuthScopes
    ) ||
    snapshot.settings_company_scope !== authorization.settingsCompanyScope ||
    Object.keys(snapshot.query).length !== 0 ||
    snapshot.result.company_ref.id !== authorization.actorContext.companyId ||
    snapshot.source_inspected.companies !== 1
  ) {
    invalid();
  }
  assertNoCompanyOperationsForbiddenFields(snapshot.result);
  const material = companyContextProofMaterial({
    authorization,
    readAt: snapshot.read_at,
    sourceRevisions: snapshot.source_revisions,
    sourceInspected: snapshot.source_inspected,
    result: snapshot.result,
  });
  if (companyContextProofRef(material) !== snapshot.proof_ref) invalid();

  const value = CompanyContextResultSchema.parse({
    ...snapshot.result,
    proof: {
      proof_ref: snapshot.proof_ref,
      read_at: snapshot.read_at,
      source_revisions: snapshot.source_revisions,
    },
  });
  assertNoCompanyOperationsForbiddenFields(value);
  return deepFreeze({
    value,
    proofBinding: {
      sourceRevisions: snapshot.source_revisions,
      sourceInspected: snapshot.source_inspected,
    },
  });
}

export function createSupabaseCompanyContextRepository(
  client: CompanyContextRpcClient
): CompanyContextRepository {
  let suppliedRpc: CompanyContextRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as CompanyContextRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("A company-context RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("A company-context RPC client is required");
  }
  const rpc = (args: Readonly<Record<string, unknown>>) =>
    Reflect.apply(suppliedRpc!, client, [
      RPC_NAME,
      args,
    ]) as CompanyContextRpcRequest;

  const repository: CompanyContextRepository = {
    async read(input) {
      let authorization: AuthorizedCompanyContextRead;
      let signal: AbortSignal | undefined;
      try {
        authorization = input.authorization;
        signal = input.signal;
      } catch (error) {
        invalid(error);
      }
      if (!isAuthorizedCompanyContextRead(authorization)) invalid();
      if (signal?.aborted) {
        throw new CompanyContextRepositoryError("COMPANY_CONTEXT_READ_FAILED");
      }

      let response: CompanyContextRpcResult;
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
          p_settings_company_scope: authorization.settingsCompanyScope,
        });
        response =
          signal && typeof request.abortSignal === "function"
            ? await Reflect.apply(request.abortSignal, request, [signal])
            : await request;
      } catch (error) {
        throw new CompanyContextRepositoryError("COMPANY_CONTEXT_READ_FAILED", {
          cause: error,
        });
      }
      if (signal?.aborted) {
        throw new CompanyContextRepositoryError("COMPANY_CONTEXT_READ_FAILED");
      }

      let responseError: unknown;
      let responseData: unknown;
      try {
        responseError = response.error;
        responseData = response.data;
      } catch (error) {
        throw new CompanyContextRepositoryError("COMPANY_CONTEXT_READ_FAILED", {
          cause: error,
        });
      }
      if (responseError) {
        const state = knownErrorState(responseError);
        if (state) return deepFreeze({ state });
        throw new CompanyContextRepositoryError("COMPANY_CONTEXT_READ_FAILED");
      }

      try {
        const snapshot = RawSnapshotSchema.parse(responseData);
        return deepFreeze({
          state: "found" as const,
          ...assertSnapshot(snapshot, authorization),
        });
      } catch (error) {
        if (error instanceof CompanyContextRepositoryError) throw error;
        invalid(error);
      }
    },
  };
  TRUSTED_COMPANY_CONTEXT_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedCompanyContextRepository(
  value: unknown
): value is CompanyContextRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_COMPANY_CONTEXT_REPOSITORIES.has(value)
  );
}

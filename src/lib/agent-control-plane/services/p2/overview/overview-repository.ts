import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  OPERATIONAL_OVERVIEW_FETCH_LIMIT,
  OPERATIONAL_OVERVIEW_MAX_ATTENTION_COUNT,
  OPERATIONAL_OVERVIEW_MAX_COMPONENTS,
  OPERATIONAL_OVERVIEW_MAX_SOURCE_ROWS,
  OperationalOverviewComponentSourceInspectionVectorSchema,
  OperationalOverviewComponentItemSchema,
  OperationalOverviewComponentSchema,
  OperationalOverviewRevisionVectorSchema,
  GetOperationalOverviewResultSchema,
  assertNoOperationalOverviewForbiddenFields,
  type OperationalOverviewComponent,
  type OperationalOverviewComponentSourceInspection,
  type OperationalOverviewResult,
} from "@/lib/agent-control-plane/contracts/operational-overview";
import {
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
} from "@/lib/agent-control-plane/contracts/p2-common";
import {
  P2EvidenceRefSchema,
  P2ProofRefSchema,
} from "@/lib/agent-control-plane/contracts/p2-proof";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import {
  isAuthorizedOperationalOverviewRead,
  type AuthorizedOperationalOverviewRead,
} from "./overview-authorization";
import {
  operationalOverviewCollectionProofRef,
  operationalOverviewEntityProofRef,
  operationalOverviewEvidenceRef,
  operationalOverviewProofContext,
} from "./overview-proof";

const RPC_NAME = "read_agent_operational_overview_as_system" as const;
const TRUSTED_OPERATIONAL_OVERVIEW_REPOSITORIES = new WeakSet<object>();

const CanonicalStringArraySchema = z
  .array(z.string().min(1).max(128))
  .max(64)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "OPERATIONAL_OVERVIEW_ARRAY_NOT_CANONICAL"
  );
const SelectionSchema = z
  .object({
    component: OperationalOverviewComponentSchema,
    origin: z.enum(["explicit", "default"]),
  })
  .strict();
const SelectionVectorSchema = z
  .array(SelectionSchema)
  .min(1)
  .max(OPERATIONAL_OVERVIEW_MAX_COMPONENTS)
  .refine(
    (values) =>
      values.every(
        (value, index) =>
          index === 0 || values[index - 1]!.component < value.component
      ),
    "OPERATIONAL_OVERVIEW_SELECTIONS_NOT_CANONICAL"
  );
const PermissionScopesSchema = z.record(
  z.string().min(1).max(128),
  z.enum(["all", "assigned", "own"])
);
const AuthorizedComponentSchema = z
  .object({
    component: OperationalOverviewComponentSchema,
    origin: z.enum(["explicit", "default"]),
    required_oauth_scopes: CanonicalStringArraySchema,
    resolved_permission_scopes: PermissionScopesSchema,
    satisfied_permission_group_indexes: z.tuple([z.literal(0)]),
  })
  .strict();
const AuthorizedComponentVectorSchema = z
  .array(AuthorizedComponentSchema)
  .max(OPERATIONAL_OVERVIEW_MAX_COMPONENTS)
  .refine(
    (values) =>
      values.every(
        (value, index) =>
          index === 0 || values[index - 1]!.component < value.component
      ),
    "OPERATIONAL_OVERVIEW_AUTHORIZATIONS_NOT_CANONICAL"
  );
const WarningSchema = z
  .object({
    code: z.literal("DEFAULT_COMPONENT_OMITTED"),
    component: OperationalOverviewComponentSchema,
  })
  .strict();
const WarningVectorSchema = z
  .array(WarningSchema)
  .max(OPERATIONAL_OVERVIEW_MAX_COMPONENTS)
  .refine(
    (values) =>
      values.every(
        (value, index) =>
          index === 0 || values[index - 1]!.component < value.component
      ),
    "OPERATIONAL_OVERVIEW_WARNINGS_NOT_CANONICAL"
  );
const ItemRevisionVectorSchema = OperationalOverviewRevisionVectorSchema.refine(
  (revisions) => revisions.length > 0,
  "OPERATIONAL_OVERVIEW_ITEM_REVISION_VECTOR_EMPTY"
);
const RawRowSchema = z
  .object({
    item: OperationalOverviewComponentItemSchema,
    source_inspected: z.number().int().safe().nonnegative(),
    source_revisions: ItemRevisionVectorSchema,
    proof_ref: P2ProofRefSchema,
    evidence_ref: P2EvidenceRefSchema,
  })
  .strict();
const RawSnapshotSchema = z
  .object({
    request_id: z.string().trim().min(1).max(128),
    company_id: P2CanonicalUuidSchema,
    actor_user_id: P2CanonicalUuidSchema,
    oauth_grant_id: P2CanonicalUuidSchema,
    oauth_client_id: P2CanonicalUuidSchema,
    grant_revision: z.string().regex(/^[0-9a-f]{32}$/),
    granted_scope_ceiling: CanonicalStringArraySchema,
    permission_snapshot_revision: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    capability_id: z.literal("get_operational_overview"),
    capability_revision: z.literal("get_operational_overview:2026-08-22.v1"),
    capability_manifest_revision: z.literal(
      "2026-08-22.capability-manifest.v8"
    ),
    selections: SelectionVectorSchema,
    authorized_components: AuthorizedComponentVectorSchema,
    warnings: WarningVectorSchema,
    read_at: P2CanonicalTimestampSchema,
    source_revisions: OperationalOverviewRevisionVectorSchema,
    component_source_inspected:
      OperationalOverviewComponentSourceInspectionVectorSchema,
    source_inspected: z.number().int().safe().nonnegative(),
    rows: z.array(RawRowSchema).max(OPERATIONAL_OVERVIEW_MAX_COMPONENTS),
    collection_proof_ref: P2ProofRefSchema,
  })
  .strict();

type RawSnapshot = z.infer<typeof RawSnapshotSchema>;

export interface OperationalOverviewProofBinding {
  readonly componentSourceInspected: readonly OperationalOverviewComponentSourceInspection[];
  readonly sourceInspected: number;
}

export type OperationalOverviewRepositoryResult =
  | Readonly<{
      state: "found";
      value: OperationalOverviewResult;
      proofBinding: OperationalOverviewProofBinding;
    }>
  | Readonly<{ state: "source_bound" }>
  | Readonly<{ state: "source_invalid" }>;

export interface OperationalOverviewRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface OperationalOverviewRpcRequest extends PromiseLike<OperationalOverviewRpcResult> {
  abortSignal?: (
    signal: AbortSignal
  ) => PromiseLike<OperationalOverviewRpcResult>;
}

export interface OperationalOverviewRpcClient {
  rpc(
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ): OperationalOverviewRpcRequest;
}

export interface OperationalOverviewRepository {
  read(input: {
    readonly authorization: AuthorizedOperationalOverviewRead;
    readonly signal?: AbortSignal;
  }): Promise<OperationalOverviewRepositoryResult>;
}

export class OperationalOverviewRepositoryError extends Error {
  readonly code:
    | "OPERATIONAL_OVERVIEW_INVALID"
    | "OPERATIONAL_OVERVIEW_READ_FAILED";

  constructor(
    code: OperationalOverviewRepositoryError["code"],
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "OperationalOverviewRepositoryError";
    this.code = code;
  }
}

function invalid(cause?: unknown): never {
  throw new OperationalOverviewRepositoryError("OPERATIONAL_OVERVIEW_INVALID", {
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

function sameCanonical(left: unknown, right: unknown) {
  return (
    canonicalOperationalProjection(left as never) ===
    canonicalOperationalProjection(right as never)
  );
}

function serializedAuthorizedComponents(
  authorization: AuthorizedOperationalOverviewRead
) {
  return authorization.authorizedComponents.map((component) => ({
    component: component.component,
    origin: component.origin,
    required_oauth_scopes: [...component.requiredOAuthScopes],
    resolved_permission_scopes: { ...component.resolvedPermissionScopes },
    satisfied_permission_group_indexes: [0] as const,
  }));
}

function expectedRevisionDomains(component: OperationalOverviewComponent) {
  switch (component) {
    case "financial_attention":
      return [
        "expenses",
        "legacy_operational",
        "payments",
        "sales_documents",
      ] as const;
    case "integration_attention":
      return ["company", "integrations"] as const;
    case "schedule_readiness":
      return ["legacy_operational"] as const;
    case "stock_attention":
      return ["catalog", "purchasing"] as const;
    case "unresolved_correspondence":
      return [
        "legacy_job_history",
        "legacy_operational",
        "work_queue",
      ] as const;
    case "work_due":
      return ["legacy_operational", "tasks", "work_queue"] as const;
  }
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
      record.message === "agent_operational_overview_source_query_bound"
    ) {
      return "source_bound";
    }
    if (
      record.code === "22000" &&
      record.message === "agent_operational_overview_source_data_invalid"
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
  authorization: AuthorizedOperationalOverviewRead
) {
  const expectedAuthorizations = serializedAuthorizedComponents(authorization);
  if (
    snapshot.request_id !== authorization.actorContext.requestId ||
    snapshot.company_id !== authorization.actorContext.companyId ||
    snapshot.actor_user_id !== authorization.actorContext.actorUserId ||
    snapshot.oauth_grant_id !== authorization.oauthGrantId ||
    snapshot.oauth_client_id !== authorization.oauthClientId ||
    snapshot.grant_revision !== authorization.grantRevision ||
    !sameCanonical(
      snapshot.granted_scope_ceiling,
      authorization.grantedScopeCeiling
    ) ||
    snapshot.permission_snapshot_revision !==
      authorization.actorContext.permissionSnapshotRevision ||
    snapshot.capability_id !== authorization.capabilityId ||
    snapshot.capability_revision !== authorization.capabilityRevision ||
    snapshot.capability_manifest_revision !==
      authorization.capabilityManifestRevision ||
    !sameCanonical(snapshot.selections, authorization.selections) ||
    !sameCanonical(snapshot.authorized_components, expectedAuthorizations) ||
    !sameCanonical(snapshot.warnings, authorization.warnings) ||
    snapshot.rows.length !== authorization.authorizedComponents.length ||
    snapshot.rows.some(
      (row, index) =>
        row.item.component !==
        authorization.authorizedComponents[index]?.component
    ) ||
    !sameCanonical(
      snapshot.component_source_inspected,
      snapshot.rows.map((row) => ({
        component: row.item.component,
        source_inspected: row.source_inspected,
      }))
    ) ||
    snapshot.source_inspected !==
      snapshot.component_source_inspected.reduce(
        (total, inspection) => total + inspection.source_inspected,
        0
      ) ||
    (snapshot.rows.length === 0 &&
      (snapshot.source_revisions.length !== 0 ||
        snapshot.source_inspected !== 0))
  ) {
    invalid();
  }

  assertNoOperationalOverviewForbiddenFields(
    snapshot.rows.map((row) => row.item)
  );
  const context = operationalOverviewProofContext({
    authorization,
    readAt: snapshot.read_at,
    componentSourceInspected: snapshot.component_source_inspected,
  });
  const revisionByDomain = new Map<string, number>();
  for (const [index, row] of snapshot.rows.entries()) {
    const component = row.item.component;
    const domains = row.source_revisions.map((revision) => revision.domain);
    if (!sameCanonical(domains, expectedRevisionDomains(component))) invalid();
    for (const revision of row.source_revisions) {
      const existing = revisionByDomain.get(revision.domain);
      if (existing !== undefined && existing !== revision.source_revision) {
        invalid();
      }
      revisionByDomain.set(revision.domain, revision.source_revision);
    }
    if (
      row.proof_ref !==
        operationalOverviewEntityProofRef({
          context,
          item: row.item,
          sourceInspected: row.source_inspected,
          sourceRevisions: row.source_revisions,
        }) ||
      row.evidence_ref !==
        operationalOverviewEvidenceRef({
          context,
          component,
          sourceInspected: row.source_inspected,
          sourceRevisions: row.source_revisions,
        }) ||
      component !== authorization.authorizedComponents[index]?.component
    ) {
      invalid();
    }
  }
  const aggregateRevisions = [...revisionByDomain.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([domain, source_revision]) => ({ domain, source_revision }));
  if (!sameCanonical(snapshot.source_revisions, aggregateRevisions)) invalid();
  const children = snapshot.rows.map((row) => ({
    component: row.item.component,
    proof_ref: row.proof_ref,
    evidence_ref: row.evidence_ref,
    source_inspected: row.source_inspected,
    source_revisions: row.source_revisions,
  }));
  if (
    snapshot.collection_proof_ref !==
    operationalOverviewCollectionProofRef({
      context,
      sourceRevisions: snapshot.source_revisions,
      children,
    })
  ) {
    invalid();
  }

  const value = GetOperationalOverviewResultSchema.parse({
    items: snapshot.rows.map((row) => row.item),
    item_proofs: snapshot.rows.map((row) => ({
      proof_ref: row.proof_ref,
      read_at: snapshot.read_at,
      source_revisions: row.source_revisions,
    })),
    evidence: snapshot.rows.map((row) => ({
      evidence_ref: row.evidence_ref,
      source_domain: "overview",
      source_type: "operational_overview_component",
      occurred_at: snapshot.read_at,
    })),
    warnings: snapshot.warnings,
    collection_proof: {
      proof_ref: snapshot.collection_proof_ref,
      read_at: snapshot.read_at,
      source_revisions: snapshot.source_revisions,
      returned_count: snapshot.rows.length,
      has_more: false,
    },
  });
  assertNoOperationalOverviewForbiddenFields(value);
  return deepFreeze({
    value,
    proofBinding: {
      componentSourceInspected: snapshot.component_source_inspected,
      sourceInspected: snapshot.source_inspected,
    },
  });
}

export function createSupabaseOperationalOverviewRepository(
  client: OperationalOverviewRpcClient
): OperationalOverviewRepository {
  let suppliedRpc: OperationalOverviewRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as OperationalOverviewRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("An operational-overview RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("An operational-overview RPC client is required");
  }
  const rpc = (args: Readonly<Record<string, unknown>>) =>
    Reflect.apply(suppliedRpc!, client, [
      RPC_NAME,
      args,
    ]) as OperationalOverviewRpcRequest;

  const repository: OperationalOverviewRepository = {
    async read(input) {
      let authorization: AuthorizedOperationalOverviewRead;
      let signal: AbortSignal | undefined;
      try {
        authorization = input.authorization;
        signal = input.signal;
      } catch (error) {
        invalid(error);
      }
      if (!isAuthorizedOperationalOverviewRead(authorization)) invalid();
      if (signal?.aborted) {
        throw new OperationalOverviewRepositoryError(
          "OPERATIONAL_OVERVIEW_READ_FAILED"
        );
      }
      let response: OperationalOverviewRpcResult;
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
          p_selections: authorization.selections.map((selection) => ({
            ...selection,
          })),
          p_authorized_components:
            serializedAuthorizedComponents(authorization),
          p_warnings: authorization.warnings.map((warning) => ({ ...warning })),
          p_item_limit: OPERATIONAL_OVERVIEW_MAX_ATTENTION_COUNT,
          p_page_fetch_limit: OPERATIONAL_OVERVIEW_FETCH_LIMIT,
          p_source_limit: OPERATIONAL_OVERVIEW_MAX_SOURCE_ROWS,
        });
        response =
          signal && typeof request.abortSignal === "function"
            ? await Reflect.apply(request.abortSignal, request, [signal])
            : await request;
      } catch (error) {
        throw new OperationalOverviewRepositoryError(
          "OPERATIONAL_OVERVIEW_READ_FAILED",
          { cause: error }
        );
      }
      if (signal?.aborted) {
        throw new OperationalOverviewRepositoryError(
          "OPERATIONAL_OVERVIEW_READ_FAILED"
        );
      }
      let responseError: unknown;
      let responseData: unknown;
      try {
        responseError = response.error;
        responseData = response.data;
      } catch (error) {
        throw new OperationalOverviewRepositoryError(
          "OPERATIONAL_OVERVIEW_READ_FAILED",
          { cause: error }
        );
      }
      if (responseError) {
        const state = knownErrorState(responseError);
        if (state) return deepFreeze({ state });
        throw new OperationalOverviewRepositoryError(
          "OPERATIONAL_OVERVIEW_READ_FAILED"
        );
      }
      try {
        const snapshot = RawSnapshotSchema.parse(responseData);
        return deepFreeze({
          state: "found" as const,
          ...assertSnapshot(snapshot, authorization),
        });
      } catch (error) {
        if (error instanceof OperationalOverviewRepositoryError) throw error;
        invalid(error);
      }
    },
  };
  TRUSTED_OPERATIONAL_OVERVIEW_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedOperationalOverviewRepository(
  value: unknown
): value is OperationalOverviewRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_OPERATIONAL_OVERVIEW_REPOSITORIES.has(value)
  );
}

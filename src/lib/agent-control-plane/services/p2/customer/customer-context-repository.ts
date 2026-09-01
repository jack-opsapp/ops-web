import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  assertP2NoForbiddenFields,
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
  P2ProofRefSchema,
} from "@/lib/agent-control-plane/contracts";
import {
  CUSTOMER_CONTEXT_MAX_SOURCE_ROWS,
  CustomerContextContactPurposeSchema,
  CustomerContextJobKindSchema,
  CustomerContextResultSchema,
  CustomerContextSectionSchema,
  type CustomerContextResult,
} from "@/lib/agent-control-plane/contracts/customer-context";
import { canonicalizeP2DomainRevisions } from "../shared/domain-revisions";
import {
  customerContextProofMaterial,
  customerContextProofRef,
  type CustomerContextProofBinding,
  type CustomerContextRawSourceRevision,
} from "./customer-context-proof";
import {
  isAuthorizedCustomerContextRead,
  type AuthorizedCustomerContextRead,
} from "./customer-context-authorization";

const RPC_NAME = "read_agent_customer_context_as_system" as const;
const TRUSTED_REPOSITORIES = new WeakSet<object>();

const ScopeSchema = z.enum(["all", "assigned"]);
const CanonicalStringArraySchema = z
  .array(z.string().min(1).max(128))
  .max(64)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "CUSTOMER_CONTEXT_ARRAY_NOT_CANONICAL"
  );
const SelectedSectionsSchema = z
  .array(CustomerContextSectionSchema)
  .min(1)
  .max(CustomerContextSectionSchema.options.length)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "CUSTOMER_CONTEXT_SECTION_VECTOR_NOT_CANONICAL"
  );
const JobKindsSchema = z
  .array(CustomerContextJobKindSchema)
  .max(2)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "CUSTOMER_CONTEXT_JOB_KIND_VECTOR_NOT_CANONICAL"
  );
const GrantRevisionSchema = z.string().regex(/^[0-9a-f]{32}$/);
const SourceRevisionNumberSchema = z.number().int().safe().nonnegative();
const SourceRevisionVersionSchema = z
  .string()
  .regex(/^revision:(0|[1-9][0-9]*)$/);
const CustomerSourceRevisionSchema = z
  .object({
    domain: z.literal("customer"),
    source_revision: SourceRevisionNumberSchema,
  })
  .strict();
const OperationalSourceRevisionSchema = z
  .object({
    source_domain: z.literal("operations"),
    source_type: z.literal("operational_read_revision"),
    source_id: z.literal("private.agent_operational_read_revisions"),
    version: SourceRevisionVersionSchema,
  })
  .strict();
const ContactabilitySourceRevisionSchema = z
  .object({
    source_domain: z.literal("operations"),
    source_type: z.literal("contactability_revision"),
    source_id: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    version: SourceRevisionVersionSchema,
  })
  .strict();
const RawSourceRevisionSchema = z.union([
  CustomerSourceRevisionSchema,
  OperationalSourceRevisionSchema,
  ContactabilitySourceRevisionSchema,
]);
const SourceInspectedSchema = z
  .object({
    contacts: z.number().int().safe().min(0).max(501),
    duplicate_candidates: z.number().int().safe().min(0).max(501),
    opportunities: z.number().int().safe().min(0).max(501),
    projects: z.number().int().safe().min(0).max(501),
  })
  .strict();
export const CustomerContextProofBindingSchema = z
  .object({
    sourceRevisions: z.array(RawSourceRevisionSchema).min(1).max(3),
    sourceInspected: SourceInspectedSchema,
  })
  .strict();
const RawResultSchema = CustomerContextResultSchema.omit({ proof: true });
const RawSnapshotSchema = z
  .object({
    company_id: P2CanonicalUuidSchema,
    actor_user_id: P2CanonicalUuidSchema,
    oauth_grant_id: P2CanonicalUuidSchema,
    oauth_client_id: P2CanonicalUuidSchema,
    grant_revision: GrantRevisionSchema,
    granted_scope_ceiling: CanonicalStringArraySchema,
    permission_snapshot_revision: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    capability_id: z.literal("get_customer_context"),
    capability_revision: z.literal("get_customer_context:2026-08-22.v1"),
    capability_manifest_revision: z.literal(
      "2026-08-22.capability-manifest.v8"
    ),
    required_oauth_scopes: CanonicalStringArraySchema,
    clients_scope: ScopeSchema,
    pipeline_scope: ScopeSchema.nullable(),
    projects_scope: ScopeSchema.nullable(),
    customer_ref: z.discriminatedUnion("kind", [
      z
        .object({ kind: z.literal("client"), id: P2CanonicalUuidSchema })
        .strict(),
      z
        .object({ kind: z.literal("sub_client"), id: P2CanonicalUuidSchema })
        .strict(),
    ]),
    selected_sections: SelectedSectionsSchema,
    contact_purpose: CustomerContextContactPurposeSchema.nullable(),
    job_kinds: JobKindsSchema,
    read_at: P2CanonicalTimestampSchema,
    source_revisions: z.array(RawSourceRevisionSchema).min(1).max(3),
    source_inspected: SourceInspectedSchema,
    result: RawResultSchema,
    proof_ref: P2ProofRefSchema,
  })
  .strict();

type RawSnapshot = z.infer<typeof RawSnapshotSchema>;

export type CustomerContextRepositoryResult =
  | Readonly<{
      state: "found";
      value: CustomerContextResult;
      proofBinding: CustomerContextProofBinding;
    }>
  | Readonly<{ state: "not_found" }>
  | Readonly<{ state: "source_bound" }>;

interface CustomerContextRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

interface CustomerContextRpcRequest extends PromiseLike<CustomerContextRpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<CustomerContextRpcResult>;
}

export interface CustomerContextRpcClient {
  rpc(
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ): CustomerContextRpcRequest;
}

export interface CustomerContextRepository {
  read(input: {
    readonly authorization: AuthorizedCustomerContextRead;
    readonly signal?: AbortSignal;
  }): Promise<CustomerContextRepositoryResult>;
}

export class CustomerContextRepositoryError extends Error {
  readonly code: "CUSTOMER_CONTEXT_INVALID" | "CUSTOMER_CONTEXT_READ_FAILED";

  constructor(
    code: CustomerContextRepositoryError["code"],
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "CustomerContextRepositoryError";
    this.code = code;
  }
}

function invalid(cause?: unknown): never {
  throw new CustomerContextRepositoryError("CUSTOMER_CONTEXT_INVALID", {
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

function sameCustomerRef(
  left: Readonly<{ kind: string; id: string }>,
  right: Readonly<{ kind: string; id: string }>
) {
  return left.kind === right.kind && left.id === right.id;
}

function knownErrorState(error: unknown): "not_found" | "source_bound" | null {
  try {
    if (typeof error !== "object" || error === null) return null;
    const value = error as Readonly<Record<string, unknown>>;
    if (
      value.code === "P0002" &&
      value.message === "agent_customer_context_not_found_or_not_visible"
    ) {
      return "not_found";
    }
    if (
      value.code === "54000" &&
      value.message === "agent_customer_context_source_query_bound"
    ) {
      return "source_bound";
    }
  } catch {
    return null;
  }
  return null;
}

function requiredRevisionVector(
  snapshot: RawSnapshot,
  authorization: AuthorizedCustomerContextRead
) {
  const jobsSelected = authorization.query.sections.includes("job_rollup");
  const contactsSelected = authorization.query.sections.includes("contacts");
  const expectedLength = 1 + Number(jobsSelected) + Number(contactsSelected);
  const revisions = snapshot.source_revisions;
  let index = 0;
  const customer = revisions[index];
  index += 1;
  if (
    revisions.length !== expectedLength ||
    !customer ||
    !("domain" in customer) ||
    customer.domain !== "customer"
  ) {
    invalid();
  }
  if (jobsSelected) {
    const operational = revisions[index];
    index += 1;
    if (
      !operational ||
      !("source_type" in operational) ||
      operational.source_type !== "operational_read_revision"
    ) {
      invalid();
    }
  }
  if (contactsSelected) {
    const contactability = revisions[index];
    index += 1;
    if (
      !contactability ||
      !("source_type" in contactability) ||
      contactability.source_type !== "contactability_revision"
    ) {
      invalid();
    }
  }
  if (index !== revisions.length) invalid();
  const sourceRevisions =
    revisions as readonly CustomerContextRawSourceRevision[];
  return {
    raw: sourceRevisions,
    canonical: canonicalizeP2DomainRevisions(sourceRevisions),
  } as const;
}

function assertSnapshot(
  snapshot: RawSnapshot,
  authorization: AuthorizedCustomerContextRead
): Readonly<{
  value: CustomerContextResult;
  proofBinding: CustomerContextProofBinding;
}> {
  const query = authorization.query;
  const expectedJobKinds = query.job_kinds ?? [];
  const resultSections = Object.keys(snapshot.result.sections).sort(
    (left, right) => left.localeCompare(right)
  );
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
    snapshot.clients_scope !== authorization.clientsScope ||
    snapshot.pipeline_scope !== authorization.pipelineScope ||
    snapshot.projects_scope !== authorization.projectsScope ||
    !sameCustomerRef(snapshot.customer_ref, query.customer_ref) ||
    !sameStrings(snapshot.selected_sections, query.sections) ||
    snapshot.contact_purpose !== (query.contact_purpose ?? null) ||
    !sameStrings(snapshot.job_kinds, expectedJobKinds) ||
    !sameStrings(resultSections, query.sections) ||
    !sameCustomerRef(
      snapshot.result.customer.requested_ref,
      query.customer_ref
    ) ||
    Object.values(snapshot.source_inspected).some(
      (count) => count >= CUSTOMER_CONTEXT_MAX_SOURCE_ROWS
    ) ||
    (snapshot.result.sections.contacts?.result_budget_omitted_count ?? 0) !==
      0 ||
    (snapshot.result.sections.duplicate_state?.result_budget_omitted_count ??
      0) !== 0 ||
    (snapshot.result.sections.contacts?.purpose ?? null) !==
      (query.contact_purpose ?? null) ||
    !sameStrings(
      snapshot.result.sections.job_rollup?.kinds.map((item) => item.kind) ?? [],
      expectedJobKinds
    )
  ) {
    invalid();
  }

  const sourceRevisions = requiredRevisionVector(snapshot, authorization);
  const expectedProofRef = customerContextProofRef(
    customerContextProofMaterial({
      authorization,
      readAt: snapshot.read_at,
      sourceRevisions: sourceRevisions.raw,
      sourceInspected: snapshot.source_inspected,
      result: snapshot.result,
    })
  );
  if (snapshot.proof_ref !== expectedProofRef) invalid();
  const parsed = CustomerContextResultSchema.parse({
    ...snapshot.result,
    proof: {
      proof_ref: snapshot.proof_ref,
      read_at: snapshot.read_at,
      source_revisions: sourceRevisions.canonical,
    },
  });
  assertP2NoForbiddenFields(parsed);
  return deepFreeze({
    value: parsed,
    proofBinding: {
      sourceRevisions: sourceRevisions.raw,
      sourceInspected: snapshot.source_inspected,
    },
  });
}

export function createSupabaseCustomerContextRepository(
  client: CustomerContextRpcClient
): CustomerContextRepository {
  let suppliedRpc: CustomerContextRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as CustomerContextRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("A customer-context RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("A customer-context RPC client is required");
  }
  const rpc = (
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ) => Reflect.apply(suppliedRpc, client, [functionName, args]);

  const repository = {
    async read(input: {
      readonly authorization: AuthorizedCustomerContextRead;
      readonly signal?: AbortSignal;
    }): Promise<CustomerContextRepositoryResult> {
      let authorization: AuthorizedCustomerContextRead;
      let signal: AbortSignal | undefined;
      try {
        authorization = input.authorization;
        signal = input.signal;
      } catch (error) {
        invalid(error);
      }
      if (!isAuthorizedCustomerContextRead(authorization)) invalid();
      if (signal?.aborted) {
        throw new CustomerContextRepositoryError(
          "CUSTOMER_CONTEXT_READ_FAILED"
        );
      }

      let response: CustomerContextRpcResult;
      try {
        const request = rpc(RPC_NAME, {
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
          p_clients_scope: authorization.clientsScope,
          p_pipeline_scope: authorization.pipelineScope,
          p_projects_scope: authorization.projectsScope,
          p_customer_kind: authorization.query.customer_ref.kind,
          p_customer_id: authorization.query.customer_ref.id,
          p_sections: [...authorization.query.sections],
          p_contact_purpose: authorization.query.contact_purpose ?? null,
          p_job_kinds: [...(authorization.query.job_kinds ?? [])],
          p_source_limit: 501,
          p_item_limit: 25,
        });
        response =
          signal && typeof request?.abortSignal === "function"
            ? await Reflect.apply(request.abortSignal, request, [signal])
            : await request;
      } catch (error) {
        throw new CustomerContextRepositoryError(
          "CUSTOMER_CONTEXT_READ_FAILED",
          { cause: error }
        );
      }
      if (signal?.aborted) {
        throw new CustomerContextRepositoryError(
          "CUSTOMER_CONTEXT_READ_FAILED"
        );
      }

      let responseError: unknown;
      let responseData: unknown;
      try {
        responseError = response?.error;
        responseData = response?.data;
      } catch (error) {
        throw new CustomerContextRepositoryError(
          "CUSTOMER_CONTEXT_READ_FAILED",
          { cause: error }
        );
      }
      if (responseError) {
        const state = knownErrorState(responseError);
        if (state) return deepFreeze({ state });
        throw new CustomerContextRepositoryError(
          "CUSTOMER_CONTEXT_READ_FAILED"
        );
      }

      try {
        const snapshot = RawSnapshotSchema.parse(responseData);
        const found = assertSnapshot(snapshot, authorization);
        return deepFreeze({
          state: "found" as const,
          ...found,
        });
      } catch (error) {
        if (error instanceof CustomerContextRepositoryError) throw error;
        invalid(error);
      }
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository) as CustomerContextRepository;
}

export function isTrustedCustomerContextRepository(
  value: unknown
): value is CustomerContextRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}

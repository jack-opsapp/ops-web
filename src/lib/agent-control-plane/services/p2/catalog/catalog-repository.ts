import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
  P2DomainRevisionVectorSchema,
  P2EvidenceRefSchema,
  P2ProofRefSchema,
  type P2DomainRevision,
  type P2EntityProof,
  type P2EvidenceIdentity,
} from "@/lib/agent-control-plane/contracts";
import {
  CATALOG_FETCH_LIMIT,
  CATALOG_MAX_DETAIL_VARIANTS,
  CATALOG_MAX_OPTIONS,
  CATALOG_MAX_OPTION_VALUES,
  CATALOG_MAX_PHYSICAL_STOCK_GROUPS,
  CATALOG_MAX_RECIPES,
  CATALOG_MAX_SOURCE_ROWS,
  CATALOG_MAX_SUPPLIER_COSTS,
  CatalogItemDetailResultSchema,
  CatalogSearchItemSchema,
  CatalogStockStateSchema,
  assertNoCatalogForbiddenFields,
  type CatalogItemDetailResult,
  type CatalogSearchItem,
} from "@/lib/agent-control-plane/contracts/catalog-purchasing";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import {
  isAuthorizedGetCatalogItemRead,
  isAuthorizedSearchCatalogItemsRead,
  type AuthorizedGetCatalogItemRead,
  type AuthorizedSearchCatalogItemsRead,
  type CatalogAuthorizationCandidateBinding,
} from "./catalog-authorization";
import {
  CatalogCursorPredecessorSchema,
  type CatalogCursorContext,
} from "./catalog-cursor";
import {
  catalogCollectionProofRef,
  catalogDetailEntityProofRef,
  catalogDetailEvidenceRef,
  catalogDetailProofContext,
  catalogListEvidenceRef,
  catalogListProofContext,
  catalogSearchEntityProofRef,
  exactCatalogSourceRevisions,
  type CatalogDetailSource,
} from "./catalog-proof";

const LIST_RPC = "read_agent_catalog_items_as_system" as const;
const DETAIL_RPC = "read_agent_catalog_item_as_system" as const;
const TRUSTED_CATALOG_REPOSITORIES = new WeakSet<object>();

const CanonicalStringArraySchema = z
  .array(z.string().min(1).max(128))
  .max(64)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "CATALOG_ARRAY_NOT_CANONICAL"
  );
const PermissionScopesSchema = z
  .record(z.string().min(1).max(128), z.enum(["all", "assigned", "own"]))
  .refine(
    (value) =>
      Object.keys(value).length <= 32 &&
      Object.keys(value).every((key) =>
        (REGISTERED_ACTOR_PERMISSION_KEYS as readonly string[]).includes(key)
      ),
    "CATALOG_PERMISSION_VECTOR_INVALID"
  );
const SatisfiedGroupIndexesSchema = z
  .array(z.number().int().safe().min(0).max(31))
  .min(1)
  .max(32)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "CATALOG_GROUP_VECTOR_NOT_CANONICAL"
  );
const AuthorizationVariantSchema = z.enum(["catalog", "supplier_costs"]);
const CandidateSchema = z
  .object({
    variant_key: AuthorizationVariantSchema,
    required_oauth_scopes: CanonicalStringArraySchema,
    resolved_permission_scopes: PermissionScopesSchema,
    satisfied_permission_group_indexes: SatisfiedGroupIndexesSchema,
  })
  .strict();
const CandidatesSchema = z
  .array(CandidateSchema)
  .min(1)
  .max(2)
  .refine(
    (values) =>
      values[0]?.variant_key === "catalog" &&
      (values.length === 1 || values[1]?.variant_key === "supplier_costs"),
    "CATALOG_CANDIDATES_NOT_CANONICAL"
  );
const ExactSourceRevisionsSchema = P2DomainRevisionVectorSchema.refine(
  (revisions) => {
    try {
      exactCatalogSourceRevisions(revisions);
      return true;
    } catch {
      return false;
    }
  },
  "CATALOG_REVISION_VECTOR_INVALID"
);

const RawListRowSchema = z
  .object({
    item: CatalogSearchItemSchema,
    selected_authorization_variant: z.literal("catalog"),
    proof_ref: P2ProofRefSchema,
    evidence_ref: P2EvidenceRefSchema,
    predecessor: CatalogCursorPredecessorSchema,
  })
  .strict();

const BindingShape = {
  company_id: P2CanonicalUuidSchema,
  actor_user_id: P2CanonicalUuidSchema,
  oauth_grant_id: P2CanonicalUuidSchema,
  oauth_client_id: P2CanonicalUuidSchema,
  grant_revision: z.string().regex(/^[0-9a-f]{32}$/),
  granted_scope_ceiling: CanonicalStringArraySchema,
  permission_snapshot_revision: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  capability_manifest_revision: z.literal("2026-08-22.capability-manifest.v8"),
  authorization_candidates: CandidatesSchema,
  query: z.unknown(),
  read_at: P2CanonicalTimestampSchema,
  source_revisions: ExactSourceRevisionsSchema,
} as const;

const RawListSnapshotSchema = z
  .object({
    ...BindingShape,
    capability_id: z.literal("search_catalog_items"),
    capability_revision: z.literal("search_catalog_items:2026-08-22.v1"),
    ranking_revision: z.literal("catalog-ranking:2026-08-22.v1"),
    item_limit: z.number().int().min(1).max(25),
    cursor_read_at: P2CanonicalTimestampSchema.nullable(),
    cursor_source_revisions: z.array(z.unknown()).max(1),
    cursor_predecessor: CatalogCursorPredecessorSchema.nullable(),
    source_inspected: z.number().int().min(0).max(CATALOG_MAX_SOURCE_ROWS),
    source_has_more: z.boolean(),
    rows: z.array(RawListRowSchema).max(25),
    collection_proof_ref: P2ProofRefSchema,
  })
  .strict();

const SourceInspectedSchema = z
  .object({
    families: z.number().int().min(0).max(CATALOG_MAX_SOURCE_ROWS),
    variants: z.number().int().min(0).max(CATALOG_MAX_SOURCE_ROWS),
    options: z.number().int().min(0).max(CATALOG_MAX_SOURCE_ROWS),
    option_values: z.number().int().min(0).max(CATALOG_MAX_SOURCE_ROWS),
    recipes: z.number().int().min(0).max(CATALOG_MAX_SOURCE_ROWS),
    stock_units: z.number().int().min(0).max(CATALOG_MAX_SOURCE_ROWS),
    supplier_costs: z.number().int().min(0).max(CATALOG_MAX_SOURCE_ROWS),
  })
  .strict();
const RawDetailSnapshotSchema = z
  .object({
    ...BindingShape,
    capability_id: z.literal("get_catalog_item"),
    capability_revision: z.literal("get_catalog_item:2026-08-22.v1"),
    selected_authorization_variants: z
      .array(AuthorizationVariantSchema)
      .min(1)
      .max(2),
    source_inspected: SourceInspectedSchema,
    result: z.unknown(),
    proof_ref: P2ProofRefSchema,
    evidence_ref: P2EvidenceRefSchema,
  })
  .strict();

export interface CatalogReadRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface CatalogReadRpcRequest extends PromiseLike<CatalogReadRpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<CatalogReadRpcResult>;
}

export interface CatalogReadRpcClient {
  rpc(
    functionName: typeof LIST_RPC | typeof DETAIL_RPC,
    args: Readonly<Record<string, unknown>>
  ): CatalogReadRpcRequest;
}

export interface CatalogListRepositoryUnit {
  readonly item: CatalogSearchItem;
  readonly proof: P2EntityProof;
  readonly evidence: readonly P2EvidenceIdentity[];
  readonly predecessor: z.infer<typeof CatalogCursorPredecessorSchema>;
  readonly selectedAuthorization: CatalogAuthorizationCandidateBinding;
}

export interface CatalogListRepositoryPage {
  readonly units: readonly CatalogListRepositoryUnit[];
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: number;
  readonly sourceHasMore: boolean;
}

export type CatalogListRepositoryResult =
  | Readonly<{ state: "found"; page: CatalogListRepositoryPage }>
  | Readonly<{ state: "source_bound" }>
  | Readonly<{ state: "stale" }>;

export type CatalogDetailRepositoryResult =
  | Readonly<{ state: "found"; value: CatalogItemDetailResult }>
  | Readonly<{ state: "not_found" }>
  | Readonly<{ state: "source_bound" }>
  | Readonly<{ state: "stale" }>;

export interface CatalogReadRepository {
  list(input: {
    readonly authorization: AuthorizedSearchCatalogItemsRead;
    readonly cursor: CatalogCursorContext | null;
    readonly signal?: AbortSignal;
  }): Promise<CatalogListRepositoryResult>;
  get(input: {
    readonly authorization: AuthorizedGetCatalogItemRead;
    readonly signal?: AbortSignal;
  }): Promise<CatalogDetailRepositoryResult>;
}

export class CatalogReadRepositoryError extends Error {
  readonly code: "CATALOG_READ_FAILED" | "CATALOG_READ_INVALID";

  constructor(
    code: CatalogReadRepositoryError["code"],
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "CatalogReadRepositoryError";
    this.code = code;
  }
}

function invalid(cause?: unknown): never {
  throw new CatalogReadRepositoryError("CATALOG_READ_INVALID", { cause });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return (
      canonicalOperationalProjection(left as never) ===
      canonicalOperationalProjection(right as never)
    );
  } catch {
    return false;
  }
}

function serializedCandidates(
  authorization: AuthorizedSearchCatalogItemsRead | AuthorizedGetCatalogItemRead
) {
  return authorization.authorizationCandidates.map((candidate) => ({
    variant_key: candidate.variantKey,
    required_oauth_scopes: candidate.requiredOAuthScopes,
    resolved_permission_scopes: candidate.resolvedPermissionScopes,
    satisfied_permission_group_indexes:
      candidate.satisfiedPermissionGroupIndexes,
  }));
}

function projectedProofQuery(
  authorization: AuthorizedSearchCatalogItemsRead | AuthorizedGetCatalogItemRead
) {
  if (authorization.capabilityId !== "search_catalog_items") {
    return authorization.query;
  }
  const { cursor: _cursor, ...query } = authorization.query;
  return query;
}

function exactBinding(
  snapshot:
    | z.infer<typeof RawListSnapshotSchema>
    | z.infer<typeof RawDetailSnapshotSchema>,
  authorization: AuthorizedSearchCatalogItemsRead | AuthorizedGetCatalogItemRead
): boolean {
  return (
    snapshot.company_id === authorization.actorContext.companyId &&
    snapshot.actor_user_id === authorization.actorContext.actorUserId &&
    snapshot.oauth_grant_id === authorization.oauthGrantId &&
    snapshot.oauth_client_id === authorization.oauthClientId &&
    snapshot.grant_revision === authorization.grantRevision &&
    sameJson(
      snapshot.granted_scope_ceiling,
      authorization.grantedScopeCeiling
    ) &&
    snapshot.permission_snapshot_revision ===
      authorization.actorContext.permissionSnapshotRevision &&
    snapshot.capability_manifest_revision ===
      authorization.capabilityManifestRevision &&
    snapshot.capability_id === authorization.capabilityId &&
    snapshot.capability_revision === authorization.capabilityRevision &&
    sameJson(
      snapshot.authorization_candidates,
      serializedCandidates(authorization)
    ) &&
    sameJson(snapshot.query, projectedProofQuery(authorization))
  );
}

function selectedBaseCandidate(
  authorization: AuthorizedSearchCatalogItemsRead | AuthorizedGetCatalogItemRead
) {
  return (
    authorization.authorizationCandidates.find(
      (candidate) => candidate.variantKey === "catalog"
    ) ?? null
  );
}

function knownErrorState(
  error: unknown,
  detail: boolean
): "not_found" | "source_bound" | "stale" | null {
  try {
    if (typeof error !== "object" || error === null || Array.isArray(error)) {
      return null;
    }
    const record = error as Readonly<Record<string, unknown>>;
    if (
      detail &&
      record.code === "P0002" &&
      record.message === "agent_catalog_item_not_found_or_not_visible"
    ) {
      return "not_found";
    }
    if (
      record.code === "54000" &&
      (record.message === "agent_catalog_source_bound" ||
        record.message === "agent_catalog_result_bound")
    ) {
      return "source_bound";
    }
    if (
      record.code === "40001" &&
      record.message === "agent_catalog_read_stale"
    ) {
      return "stale";
    }
  } catch {
    return null;
  }
  return null;
}

function commonArguments(
  authorization: AuthorizedSearchCatalogItemsRead | AuthorizedGetCatalogItemRead
) {
  return {
    p_request_id: authorization.actorContext.requestId,
    p_company_id: authorization.actorContext.companyId,
    p_actor_user_id: authorization.actorContext.actorUserId,
    p_oauth_grant_id: authorization.oauthGrantId,
    p_oauth_client_id: authorization.oauthClientId,
    p_grant_revision: authorization.grantRevision,
    p_granted_scope_ceiling: [...authorization.grantedScopeCeiling],
    p_permission_snapshot_revision:
      authorization.actorContext.permissionSnapshotRevision,
    p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
    p_capability_manifest_revision: authorization.capabilityManifestRevision,
    p_capability_id: authorization.capabilityId,
    p_capability_revision: authorization.capabilityRevision,
    p_authorization_candidates: serializedCandidates(authorization),
  };
}

async function execute(
  request: CatalogReadRpcRequest,
  signal?: AbortSignal
): Promise<CatalogReadRpcResult> {
  if (signal?.aborted) {
    throw new CatalogReadRepositoryError("CATALOG_READ_FAILED");
  }
  try {
    const response =
      signal && typeof request.abortSignal === "function"
        ? await Reflect.apply(request.abortSignal, request, [signal])
        : await request;
    if (signal?.aborted) {
      throw new CatalogReadRepositoryError("CATALOG_READ_FAILED");
    }
    return response;
  } catch (error) {
    if (error instanceof CatalogReadRepositoryError) throw error;
    throw new CatalogReadRepositoryError("CATALOG_READ_FAILED", {
      cause: error,
    });
  }
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function expectedStockState(
  item: CatalogSearchItem
): z.infer<typeof CatalogStockStateSchema> {
  const warning = item.thresholds.warning_milliunits;
  const critical = item.thresholds.critical_milliunits;
  if (warning === null && critical === null) return "untracked";
  if (critical !== null && item.quantity_milliunits <= critical) {
    return "critical";
  }
  if (warning !== null && item.quantity_milliunits <= warning) return "warning";
  return "normal";
}

function matchesQuery(
  authorization: AuthorizedSearchCatalogItemsRead,
  item: CatalogSearchItem
): boolean {
  const query = authorization.query;
  if (item.stock_state !== expectedStockState(item)) return false;
  if (!query.stock_states.includes(item.stock_state)) return false;
  if (
    query.low_stock_only &&
    item.stock_state !== "critical" &&
    item.stock_state !== "warning"
  ) {
    return false;
  }
  if (
    (query.active_state === "active" && !item.active) ||
    (query.active_state === "inactive" && item.active)
  ) {
    return false;
  }
  if (
    query.category_ref &&
    item.category?.category_ref.id !== query.category_ref.id
  ) {
    return false;
  }
  if (!query.query) return true;
  const wanted = normalized(query.query.value);
  if (query.query.kind === "family") {
    return normalized(item.family_label) === wanted;
  }
  if (query.query.kind === "sku") {
    return item.sku !== null && normalized(item.sku) === wanted;
  }
  if (query.query.kind === "category") {
    return item.category !== null && normalized(item.category.label) === wanted;
  }
  return item.tags.some((tag) => normalized(tag) === wanted);
}

function predecessorComesBefore(
  left: CatalogCursorContext["predecessor"],
  right: CatalogCursorContext["predecessor"]
) {
  return (
    left.order[0] > right.order[0] ||
    (left.order[0] === right.order[0] && left.order[1] < right.order[1])
  );
}

function exactDetailSource(raw: unknown, costsSelected: boolean) {
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
  ) {
    invalid();
  }
  const keys = Object.keys(raw).sort();
  const expected = [
    "family",
    "options",
    "physical_stock",
    "recipes",
    "requested_ref",
    ...(costsSelected ? ["supplier_costs"] : []),
    "variants",
  ].sort();
  if (!sameJson(keys, expected)) invalid();
  assertNoCatalogForbiddenFields(raw, {
    supplierCostsSelected: costsSelected,
  });
  return raw as CatalogDetailSource;
}

export function createSupabaseCatalogReadRepository(
  client: CatalogReadRpcClient
): CatalogReadRepository {
  let suppliedRpc: CatalogReadRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as CatalogReadRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("A catalogue RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("A catalogue RPC client is required");
  }
  const rpc = (
    name: typeof LIST_RPC | typeof DETAIL_RPC,
    args: Readonly<Record<string, unknown>>
  ) =>
    Reflect.apply(suppliedRpc!, client, [name, args]) as CatalogReadRpcRequest;

  const repository: CatalogReadRepository = {
    async list(input) {
      if (!isAuthorizedSearchCatalogItemsRead(input.authorization)) invalid();
      const cursor = input.cursor;
      if (
        cursor !== null &&
        (!P2CanonicalTimestampSchema.safeParse(cursor.readAt).success ||
          !ExactSourceRevisionsSchema.safeParse(cursor.sourceRevisions)
            .success ||
          !CatalogCursorPredecessorSchema.safeParse(cursor.predecessor).success)
      ) {
        invalid();
      }
      const query = input.authorization.query;
      const response = await execute(
        rpc(LIST_RPC, {
          ...commonArguments(input.authorization),
          p_query_kind: query.query?.kind ?? null,
          p_query_value: query.query?.value ?? null,
          p_active_state: query.active_state,
          p_stock_states: [...query.stock_states],
          p_low_stock_only: query.low_stock_only,
          p_category_id: query.category_ref?.id ?? null,
          p_item_limit: query.limit,
          p_page_fetch_limit: Math.min(query.limit + 1, CATALOG_FETCH_LIMIT),
          p_source_limit: CATALOG_MAX_SOURCE_ROWS,
          p_cursor_read_at: cursor?.readAt ?? null,
          p_cursor_source_revisions: cursor
            ? cursor.sourceRevisions.map((revision) => ({ ...revision }))
            : [],
          p_after_updated_at: cursor?.predecessor.order[0] ?? null,
          p_after_variant_id: cursor?.predecessor.tie_breaker ?? null,
        }),
        input.signal
      );
      if (response.error) {
        const state = knownErrorState(response.error, false);
        if (state === "source_bound" || state === "stale") {
          return deepFreeze({ state });
        }
        throw new CatalogReadRepositoryError("CATALOG_READ_FAILED");
      }
      try {
        const snapshot = RawListSnapshotSchema.parse(response.data);
        const context = catalogListProofContext({
          authorization: input.authorization,
          cursor,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
          sourceHasMore: snapshot.source_has_more,
        });
        const selected = selectedBaseCandidate(input.authorization);
        if (!selected) invalid();
        const rowsValid = snapshot.rows.every(
          (row, index) =>
            row.selected_authorization_variant === "catalog" &&
            matchesQuery(input.authorization, row.item) &&
            row.predecessor.order[0] === row.item.updated_at &&
            row.predecessor.order[1] === row.item.variant_ref.id &&
            row.predecessor.tie_breaker === row.item.variant_ref.id &&
            row.proof_ref ===
              catalogSearchEntityProofRef({ context, item: row.item }) &&
            row.evidence_ref ===
              catalogListEvidenceRef({ context, item: row.item }) &&
            (index === 0 ||
              predecessorComesBefore(
                snapshot.rows[index - 1]!.predecessor,
                row.predecessor
              ))
        );
        const expectedCollection = catalogCollectionProofRef({
          context,
          returnedCount: snapshot.rows.length,
          hasMore: snapshot.source_has_more,
          children: snapshot.rows.map((row) => ({
            variant_ref: row.item.variant_ref,
            proof_ref: row.proof_ref,
            evidence_ref: row.evidence_ref,
          })),
        });
        if (
          !exactBinding(snapshot, input.authorization) ||
          snapshot.item_limit !== query.limit ||
          snapshot.cursor_read_at !== (cursor?.readAt ?? null) ||
          !sameJson(
            snapshot.cursor_source_revisions,
            cursor?.sourceRevisions ?? []
          ) ||
          !sameJson(snapshot.cursor_predecessor, cursor?.predecessor ?? null) ||
          (cursor !== null &&
            (snapshot.read_at !== cursor.readAt ||
              !sameJson(snapshot.source_revisions, cursor.sourceRevisions) ||
              (snapshot.rows[0] !== undefined &&
                !predecessorComesBefore(
                  cursor.predecessor,
                  snapshot.rows[0].predecessor
                )))) ||
          snapshot.source_inspected >= CATALOG_MAX_SOURCE_ROWS ||
          snapshot.source_inspected <
            snapshot.rows.length + (snapshot.source_has_more ? 1 : 0) ||
          snapshot.rows.length > query.limit ||
          (snapshot.source_has_more && snapshot.rows.length !== query.limit) ||
          !rowsValid ||
          snapshot.collection_proof_ref !== expectedCollection ||
          new Set(snapshot.rows.map((row) => row.item.variant_ref.id)).size !==
            snapshot.rows.length ||
          new Set(snapshot.rows.map((row) => row.proof_ref)).size !==
            snapshot.rows.length ||
          new Set(snapshot.rows.map((row) => row.evidence_ref)).size !==
            snapshot.rows.length
        ) {
          invalid();
        }
        const units = snapshot.rows.map((row) => ({
          item: row.item,
          proof: {
            proof_ref: row.proof_ref,
            read_at: snapshot.read_at,
            source_revisions: snapshot.source_revisions,
          },
          evidence: [
            {
              evidence_ref: row.evidence_ref,
              source_domain: "catalog" as const,
              source_type: "catalog_variant" as const,
              occurred_at: snapshot.read_at,
            },
          ],
          predecessor: row.predecessor,
          selectedAuthorization: selected,
        }));
        const page = {
          units,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
          sourceHasMore: snapshot.source_has_more,
        };
        assertNoCatalogForbiddenFields(page, {
          supplierCostsSelected: false,
        });
        return deepFreeze({ state: "found" as const, page });
      } catch (error) {
        if (error instanceof CatalogReadRepositoryError) throw error;
        invalid(error);
      }
    },

    async get(input) {
      if (!isAuthorizedGetCatalogItemRead(input.authorization)) invalid();
      const query = input.authorization.query;
      const costsSelected = query.sections.includes("supplier_costs");
      const response = await execute(
        rpc(DETAIL_RPC, {
          ...commonArguments(input.authorization),
          p_item_kind: query.item_ref.kind,
          p_item_id: query.item_ref.id,
          p_include_supplier_costs: costsSelected,
          p_source_limit: CATALOG_MAX_SOURCE_ROWS,
          p_variant_limit: CATALOG_MAX_DETAIL_VARIANTS,
          p_variant_fetch_limit: CATALOG_MAX_DETAIL_VARIANTS + 1,
          p_option_limit: CATALOG_MAX_OPTIONS,
          p_option_fetch_limit: CATALOG_MAX_OPTIONS + 1,
          p_option_value_limit: CATALOG_MAX_OPTION_VALUES,
          p_option_value_fetch_limit: CATALOG_MAX_OPTION_VALUES + 1,
          p_recipe_limit: CATALOG_MAX_RECIPES,
          p_recipe_fetch_limit: CATALOG_MAX_RECIPES + 1,
          p_stock_group_limit: CATALOG_MAX_PHYSICAL_STOCK_GROUPS,
          p_stock_group_fetch_limit: CATALOG_MAX_PHYSICAL_STOCK_GROUPS + 1,
          p_supplier_cost_limit: CATALOG_MAX_SUPPLIER_COSTS,
          p_supplier_cost_fetch_limit: CATALOG_MAX_SUPPLIER_COSTS + 1,
        }),
        input.signal
      );
      if (response.error) {
        const state = knownErrorState(response.error, true);
        if (state) return deepFreeze({ state });
        throw new CatalogReadRepositoryError("CATALOG_READ_FAILED");
      }
      try {
        const snapshot = RawDetailSnapshotSchema.parse(response.data);
        const source = exactDetailSource(snapshot.result, costsSelected);
        const value = CatalogItemDetailResultSchema.parse({
          ...source,
          evidence: [
            {
              evidence_ref: snapshot.evidence_ref,
              source_domain: "catalog",
              source_type: query.item_ref.kind,
              occurred_at: snapshot.read_at,
            },
          ],
          proof: {
            proof_ref: snapshot.proof_ref,
            read_at: snapshot.read_at,
            source_revisions: snapshot.source_revisions,
          },
        });
        const context = catalogDetailProofContext({
          authorization: input.authorization,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
        });
        const optionValueCount = value.options.reduce(
          (count, option) => count + option.values.length,
          0
        );
        if (
          !exactBinding(snapshot, input.authorization) ||
          !sameJson(value.requested_ref, query.item_ref) ||
          !sameJson(
            snapshot.selected_authorization_variants,
            input.authorization.variantKeys
          ) ||
          snapshot.source_inspected.families !== 1 ||
          snapshot.source_inspected.variants !== value.variants.length ||
          snapshot.source_inspected.options !== value.options.length ||
          snapshot.source_inspected.option_values !== optionValueCount ||
          snapshot.source_inspected.recipes !== value.recipes.length ||
          snapshot.source_inspected.stock_units < value.physical_stock.length ||
          snapshot.source_inspected.supplier_costs !==
            ("supplier_costs" in value ? value.supplier_costs.length : 0) ||
          Object.values(snapshot.source_inspected).some(
            (count) => count >= CATALOG_MAX_SOURCE_ROWS
          ) ||
          snapshot.proof_ref !==
            catalogDetailEntityProofRef({ context, result: source }) ||
          snapshot.evidence_ref !==
            catalogDetailEvidenceRef({
              companyId: input.authorization.actorContext.companyId,
              requestedRef: query.item_ref,
              familyUpdatedAt: value.family.updated_at,
            })
        ) {
          invalid();
        }
        assertNoCatalogForbiddenFields(value, {
          supplierCostsSelected: costsSelected,
        });
        return deepFreeze({ state: "found" as const, value });
      } catch (error) {
        if (error instanceof CatalogReadRepositoryError) throw error;
        invalid(error);
      }
    },
  };

  TRUSTED_CATALOG_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedCatalogReadRepository(
  value: unknown
): value is CatalogReadRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_CATALOG_REPOSITORIES.has(value)
  );
}

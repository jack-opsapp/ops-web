import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  assertP2NoForbiddenFields,
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
  P2EvidenceRefSchema,
  P2ProofRefSchema,
  type P2DomainRevision,
  type P2EntityProof,
  type P2EvidenceIdentity,
} from "@/lib/agent-control-plane/contracts";
import {
  GetSiteVisitContextResultSchema,
  SITE_VISIT_MAX_CHECKLIST_ANSWERS,
  SITE_VISIT_READ_FETCH_LIMIT,
  SITE_VISIT_READ_MAX_PAGE_ITEMS,
  SITE_VISIT_READ_MAX_SOURCE_ROWS,
  SiteVisitContextSectionSchema,
  SiteVisitSummarySchema,
  type GetSiteVisitContextResult,
} from "@/lib/agent-control-plane/contracts/site-visits";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import {
  isAuthorizedGetSiteVisitContextRead,
  isAuthorizedListSiteVisitsRead,
  type AuthorizedGetSiteVisitContextRead,
  type AuthorizedListSiteVisitsRead,
} from "./site-visit-authorization";
import {
  SiteVisitListCursorPredecessorSchema,
  type SiteVisitListCursorContext,
} from "./site-visit-cursor";
import {
  siteVisitContextEntityProofRef,
  siteVisitContextEvidenceRef,
  siteVisitContextProofContext,
  siteVisitListCollectionProofRef,
  siteVisitListEntityProofRef,
  siteVisitListEvidenceRef,
  siteVisitListProofContext,
  siteVisitListQueryProjection,
} from "./site-visit-proof";

const LIST_RPC = "read_agent_site_visits_as_system" as const;
const CONTEXT_RPC = "read_agent_site_visit_context_as_system" as const;
const TRUSTED_SITE_VISIT_REPOSITORIES = new WeakSet<object>();

const CanonicalStringArraySchema = z
  .array(z.string().min(1).max(128))
  .max(64)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "SITE_VISIT_ARRAY_NOT_CANONICAL"
  );
const LinkedScopeSchema = z.enum(["all", "assigned"]);
const CalendarScopeSchema = z.enum(["all", "own"]);
const SourceRevisionSchema = z
  .object({ source_revision: z.number().int().safe().nonnegative() })
  .strict();
const SiteVisitSourceRevisionSchema = SourceRevisionSchema.extend({
  domain: z.literal("site_visits"),
}).strict();
const ArtifactSourceRevisionSchema = SourceRevisionSchema.extend({
  domain: z.literal("artifacts"),
}).strict();
const ExactListRevisionsSchema = z.tuple([SiteVisitSourceRevisionSchema]);
const ContextRevisionsSchema = z.union([
  z.tuple([SiteVisitSourceRevisionSchema]),
  z.tuple([ArtifactSourceRevisionSchema, SiteVisitSourceRevisionSchema]),
]);
const ProofRefSchema = P2ProofRefSchema.refine(
  (value) => /^ops_proof:v1:[0-9a-f]{64}$/.test(value),
  "SITE_VISIT_PROOF_REF_INVALID"
);
const EvidenceRefSchema = P2EvidenceRefSchema.refine(
  (value) => /^ops_evidence:v1:[0-9a-f]{64}$/.test(value),
  "SITE_VISIT_EVIDENCE_REF_INVALID"
);
const OpportunityRefSchema = z
  .object({ kind: z.literal("opportunity"), id: P2CanonicalUuidSchema })
  .strict();
const TeamMemberRefSchema = z
  .object({ kind: z.literal("team_member"), id: P2CanonicalUuidSchema })
  .strict();
const SiteVisitRefSchema = z
  .object({ kind: z.literal("site_visit"), id: P2CanonicalUuidSchema })
  .strict();
const ListQueryProjectionSchema = z
  .object({
    view: z.enum(["booked_appointments", "visit_history"]),
    window_from: P2CanonicalTimestampSchema,
    window_to: P2CanonicalTimestampSchema,
    statuses: z
      .array(z.enum(["cancelled", "completed", "in_progress", "scheduled"]))
      .max(4)
      .refine(
        (values) =>
          new Set(values).size === values.length &&
          values.every(
            (value, index) => index === 0 || values[index - 1]! < value
          ),
        "SITE_VISIT_STATUS_VECTOR_NOT_CANONICAL"
      ),
    include_unlinked: z.boolean(),
    assignee_ref: TeamMemberRefSchema.nullable(),
    opportunity_ref: OpportunityRefSchema.nullable(),
  })
  .strict();
const SelectedSectionsSchema = z
  .array(SiteVisitContextSectionSchema)
  .min(1)
  .max(SiteVisitContextSectionSchema.options.length)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "SITE_VISIT_SECTION_VECTOR_NOT_CANONICAL"
  );
const SourceInspectedSchema = z
  .object({
    artifacts: z.number().int().min(0).max(SITE_VISIT_READ_MAX_SOURCE_ROWS),
    checklist_answers: z
      .number()
      .int()
      .min(0)
      .max(SITE_VISIT_READ_MAX_SOURCE_ROWS),
    deck_designs: z.number().int().min(0).max(SITE_VISIT_READ_MAX_SOURCE_ROWS),
    visits: z.number().int().min(0).max(SITE_VISIT_READ_MAX_SOURCE_ROWS),
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
  required_oauth_scopes: CanonicalStringArraySchema,
  calendar_scope: CalendarScopeSchema.nullable(),
  clients_scope: LinkedScopeSchema.nullable(),
  deck_builder_scope: LinkedScopeSchema.nullable(),
  pipeline_scope: LinkedScopeSchema,
  photos_scope: LinkedScopeSchema.nullable(),
  read_at: P2CanonicalTimestampSchema,
} as const;

const ListRowSchema = z
  .object({
    item: SiteVisitSummarySchema,
    proof_ref: ProofRefSchema,
    evidence_ref: EvidenceRefSchema,
    predecessor: SiteVisitListCursorPredecessorSchema,
  })
  .strict()
  .superRefine((row, context) => {
    const expectedTimestamp =
      row.predecessor.view === "booked_appointments"
        ? row.item.booking.state === "booked"
          ? row.item.booking.booked_at
          : null
        : row.item.created_at;
    if (
      expectedTimestamp === null ||
      row.predecessor.order[0] !== expectedTimestamp ||
      row.predecessor.order[1] !== row.item.site_visit_ref.id ||
      row.predecessor.tie_breaker !== row.item.site_visit_ref.id
    ) {
      context.addIssue({
        code: "custom",
        message: "SITE_VISIT_ROW_PREDECESSOR_INVALID",
      });
    }
  });

const RawListSnapshotSchema = z
  .object({
    ...BindingShape,
    capability_id: z.literal("list_site_visits"),
    capability_revision: z.literal("list_site_visits:2026-08-22.v1"),
    source_revisions: ExactListRevisionsSchema,
    query: ListQueryProjectionSchema,
    item_limit: z.number().int().min(1).max(SITE_VISIT_READ_MAX_PAGE_ITEMS),
    cursor_read_at: P2CanonicalTimestampSchema.nullable(),
    cursor_source_revisions: z.array(
      z
        .object({
          domain: z.literal("site_visits"),
          source_revision: z.number().int().safe().nonnegative(),
        })
        .strict()
    ),
    cursor_predecessor: SiteVisitListCursorPredecessorSchema.nullable(),
    source_inspected: z
      .number()
      .int()
      .min(0)
      .max(SITE_VISIT_READ_MAX_SOURCE_ROWS),
    source_has_more: z.boolean(),
    rows: z.array(ListRowSchema).max(SITE_VISIT_READ_MAX_PAGE_ITEMS),
    collection_proof_ref: ProofRefSchema,
  })
  .strict();

const RawContextResultSchema = GetSiteVisitContextResultSchema.omit({
  evidence: true,
  proof: true,
});
const RawContextSnapshotSchema = z
  .object({
    ...BindingShape,
    capability_id: z.literal("get_site_visit_context"),
    capability_revision: z.literal("get_site_visit_context:2026-08-22.v1"),
    source_revisions: ContextRevisionsSchema,
    anchor: z.enum(["opportunity", "unlinked"]),
    opportunity_ref: OpportunityRefSchema.nullable(),
    site_visit_ref: SiteVisitRefSchema,
    selected_sections: SelectedSectionsSchema,
    checklist_answer_limit: z
      .number()
      .int()
      .min(1)
      .max(SITE_VISIT_MAX_CHECKLIST_ANSWERS)
      .nullable(),
    timeline_limit: z.number().int().min(1).max(25).nullable(),
    source_inspected: SourceInspectedSchema,
    result: RawContextResultSchema,
    proof_ref: ProofRefSchema,
    evidence_ref: EvidenceRefSchema,
  })
  .strict();

export const SiteVisitContextProofBindingSchema = z
  .object({ sourceInspected: SourceInspectedSchema })
  .strict();
export type SiteVisitContextProofBinding = z.infer<
  typeof SiteVisitContextProofBindingSchema
>;

export interface SiteVisitReadRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface SiteVisitReadRpcRequest extends PromiseLike<SiteVisitReadRpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<SiteVisitReadRpcResult>;
}

export interface SiteVisitReadRpcClient {
  rpc(
    functionName: typeof LIST_RPC | typeof CONTEXT_RPC,
    args: Readonly<Record<string, unknown>>
  ): SiteVisitReadRpcRequest;
}

export interface SiteVisitListRepositoryUnit {
  readonly item: z.infer<typeof SiteVisitSummarySchema>;
  readonly proof: P2EntityProof;
  readonly evidence: readonly P2EvidenceIdentity[];
  readonly predecessor: z.infer<typeof SiteVisitListCursorPredecessorSchema>;
}

export interface SiteVisitListRepositoryPage {
  readonly units: readonly SiteVisitListRepositoryUnit[];
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: number;
  readonly sourceHasMore: boolean;
}

export type SiteVisitListRepositoryResult =
  | Readonly<{ state: "found"; page: SiteVisitListRepositoryPage }>
  | Readonly<{ state: "source_bound" }>
  | Readonly<{ state: "stale" }>;

export type SiteVisitContextRepositoryResult =
  | Readonly<{
      state: "found";
      value: GetSiteVisitContextResult;
      proofBinding: SiteVisitContextProofBinding;
    }>
  | Readonly<{ state: "not_found" }>
  | Readonly<{ state: "source_bound" }>
  | Readonly<{ state: "stale" }>;

export interface SiteVisitReadRepository {
  list(input: {
    readonly authorization: AuthorizedListSiteVisitsRead;
    readonly cursor: SiteVisitListCursorContext | null;
    readonly signal?: AbortSignal;
  }): Promise<SiteVisitListRepositoryResult>;
  get(input: {
    readonly authorization: AuthorizedGetSiteVisitContextRead;
    readonly signal?: AbortSignal;
  }): Promise<SiteVisitContextRepositoryResult>;
}

export class SiteVisitReadRepositoryError extends Error {
  readonly code: "SITE_VISIT_READ_INVALID" | "SITE_VISIT_READ_FAILED";

  constructor(
    code: SiteVisitReadRepositoryError["code"],
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "SiteVisitReadRepositoryError";
    this.code = code;
  }
}

function invalid(cause?: unknown): never {
  throw new SiteVisitReadRepositoryError("SITE_VISIT_READ_INVALID", { cause });
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

function sameJson(left: unknown, right: unknown) {
  try {
    return (
      canonicalOperationalProjection(left as never) ===
      canonicalOperationalProjection(right as never)
    );
  } catch {
    return false;
  }
}

function exactBinding(
  snapshot:
    | z.infer<typeof RawListSnapshotSchema>
    | z.infer<typeof RawContextSnapshotSchema>,
  authorization:
    AuthorizedListSiteVisitsRead | AuthorizedGetSiteVisitContextRead
) {
  return (
    snapshot.company_id === authorization.actorContext.companyId &&
    snapshot.actor_user_id === authorization.actorContext.actorUserId &&
    snapshot.oauth_grant_id === authorization.oauthGrantId &&
    snapshot.oauth_client_id === authorization.oauthClientId &&
    snapshot.grant_revision === authorization.grantRevision &&
    sameStrings(
      snapshot.granted_scope_ceiling,
      authorization.grantedScopeCeiling
    ) &&
    snapshot.permission_snapshot_revision ===
      authorization.actorContext.permissionSnapshotRevision &&
    snapshot.capability_id === authorization.capabilityId &&
    snapshot.capability_revision === authorization.capabilityRevision &&
    snapshot.capability_manifest_revision ===
      authorization.capabilityManifestRevision &&
    sameStrings(
      snapshot.required_oauth_scopes,
      authorization.requiredOAuthScopes
    ) &&
    snapshot.calendar_scope === authorization.calendarScope &&
    snapshot.clients_scope === authorization.clientsScope &&
    snapshot.deck_builder_scope === authorization.deckBuilderScope &&
    snapshot.pipeline_scope === authorization.pipelineScope &&
    snapshot.photos_scope === authorization.photosScope
  );
}

function knownErrorState(
  error: unknown,
  detail: boolean
): "not_found" | "source_bound" | "stale" | null {
  try {
    if (typeof error !== "object" || error === null) return null;
    const record = error as Readonly<Record<string, unknown>>;
    if (
      detail &&
      record.code === "P0002" &&
      record.message === "agent_site_visit_not_found_or_not_visible"
    ) {
      return "not_found";
    }
    if (
      record.code === "54000" &&
      (record.message === "agent_site_visit_source_query_bound" ||
        record.message === "agent_site_visit_result_bound" ||
        (detail && record.message === "agent_artifact_source_query_bound"))
    ) {
      return "source_bound";
    }
    if (
      record.code === "40001" &&
      record.message === "agent_site_visit_read_stale"
    ) {
      return "stale";
    }
  } catch {
    return null;
  }
  return null;
}

function resolvedPermissionScopes(
  authorization:
    AuthorizedListSiteVisitsRead | AuthorizedGetSiteVisitContextRead
) {
  return Object.fromEntries(
    [
      ["calendar.view", authorization.calendarScope],
      ["clients.view", authorization.clientsScope],
      ["deck_builder.view", authorization.deckBuilderScope],
      ["photos.view", authorization.photosScope],
      ["pipeline.view", authorization.pipelineScope],
    ]
      .filter((entry): entry is [string, string] => entry[1] !== null)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function commonArguments(
  authorization:
    AuthorizedListSiteVisitsRead | AuthorizedGetSiteVisitContextRead
) {
  return {
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
    p_capability_manifest_revision: authorization.capabilityManifestRevision,
    p_required_oauth_scopes: [...authorization.requiredOAuthScopes],
    p_resolved_permission_scopes: resolvedPermissionScopes(authorization),
  };
}

async function execute(
  request: SiteVisitReadRpcRequest,
  signal?: AbortSignal
): Promise<SiteVisitReadRpcResult> {
  if (signal?.aborted) {
    throw new SiteVisitReadRepositoryError("SITE_VISIT_READ_FAILED");
  }
  try {
    const response =
      signal && typeof request.abortSignal === "function"
        ? await Reflect.apply(request.abortSignal, request, [signal])
        : await request;
    if (signal?.aborted) {
      throw new SiteVisitReadRepositoryError("SITE_VISIT_READ_FAILED");
    }
    return response;
  } catch (error) {
    if (error instanceof SiteVisitReadRepositoryError) throw error;
    throw new SiteVisitReadRepositoryError("SITE_VISIT_READ_FAILED", {
      cause: error,
    });
  }
}

function predecessorComesBefore(
  view: "booked_appointments" | "visit_history",
  left: z.infer<typeof SiteVisitListCursorPredecessorSchema>,
  right: z.infer<typeof SiteVisitListCursorPredecessorSchema>
) {
  if (view === "booked_appointments") {
    return (
      left.order[0] < right.order[0] ||
      (left.order[0] === right.order[0] && left.order[1] < right.order[1])
    );
  }
  return (
    left.order[0] > right.order[0] ||
    (left.order[0] === right.order[0] && left.order[1] > right.order[1])
  );
}

function expectedContextRevisions(
  authorization: AuthorizedGetSiteVisitContextRead
) {
  const artifactSelected =
    authorization.query.sections.includes("artifact_summary") ||
    authorization.query.sections.includes("deck_design_refs");
  return artifactSelected ? ["artifacts", "site_visits"] : ["site_visits"];
}

function validateSourceInspected(input: {
  readonly snapshot: z.infer<typeof RawContextSnapshotSchema>;
  readonly authorization: AuthorizedGetSiteVisitContextRead;
}) {
  const inspected = input.snapshot.source_inspected;
  const sections = input.snapshot.result.sections;
  const artifactSelected =
    input.authorization.query.sections.includes("artifact_summary") ||
    input.authorization.query.sections.includes("deck_design_refs");
  const deckSelected =
    input.authorization.query.sections.includes("deck_design_refs");
  const checklistAnswersSelected =
    input.authorization.query.sections.includes("checklist_answers");
  const checklistSummarySelected =
    input.authorization.query.sections.includes("checklist_summary");
  const checklistSelected =
    checklistAnswersSelected || checklistSummarySelected;
  const checklistAnswers = sections.checklist_answers;
  const checklistSummary = sections.checklist_summary;
  const checklistLimit = input.authorization.query.checklist_answer_limit;
  const checklistCountsMatch = checklistSelected
    ? (!checklistSummarySelected ||
        (checklistSummary !== undefined &&
          checklistSummary.total_count === inspected.checklist_answers)) &&
      (!checklistAnswersSelected ||
        (checklistAnswers !== undefined &&
          checklistLimit !== undefined &&
          checklistAnswers.source_count ===
            Math.min(inspected.checklist_answers, checklistLimit) &&
          checklistAnswers.source_has_more ===
            inspected.checklist_answers > checklistLimit &&
          checklistAnswers.returned_count === checklistAnswers.source_count &&
          checklistAnswers.result_budget_omitted_count === 0))
    : inspected.checklist_answers === 0;
  return (
    inspected.visits === 1 &&
    Object.values(inspected).every(
      (count) => count < SITE_VISIT_READ_MAX_SOURCE_ROWS
    ) &&
    checklistCountsMatch &&
    (artifactSelected ||
      (inspected.artifacts === 0 && inspected.deck_designs === 0)) &&
    (sections.artifact_summary === undefined ||
      sections.artifact_summary.source_count === inspected.artifacts) &&
    (!deckSelected ||
      (sections.deck_design_refs !== undefined &&
        inspected.deck_designs === sections.deck_design_refs.length &&
        inspected.deck_designs <= 25)) &&
    (deckSelected || inspected.deck_designs === 0)
  );
}

export function createSupabaseSiteVisitReadRepository(
  client: SiteVisitReadRpcClient
): SiteVisitReadRepository {
  let suppliedRpc: SiteVisitReadRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as SiteVisitReadRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("A site-visit RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("A site-visit RPC client is required");
  }
  const rpc = (
    name: typeof LIST_RPC | typeof CONTEXT_RPC,
    args: Readonly<Record<string, unknown>>
  ) =>
    Reflect.apply(suppliedRpc!, client, [
      name,
      args,
    ]) as SiteVisitReadRpcRequest;

  const repository: SiteVisitReadRepository = {
    async list(input) {
      if (!isAuthorizedListSiteVisitsRead(input.authorization)) invalid();
      const cursor = input.cursor;
      if (
        cursor !== null &&
        (!P2CanonicalTimestampSchema.safeParse(cursor.readAt).success ||
          !ExactListRevisionsSchema.safeParse(cursor.sourceRevisions).success ||
          !SiteVisitListCursorPredecessorSchema.safeParse(cursor.predecessor)
            .success ||
          cursor.predecessor.view !== input.authorization.query.view)
      ) {
        invalid();
      }
      const query = siteVisitListQueryProjection(input.authorization);
      const response = await execute(
        rpc(LIST_RPC, {
          ...commonArguments(input.authorization),
          p_view_kind: query.view,
          p_window_from: query.window_from,
          p_window_to: query.window_to,
          p_statuses: [...query.statuses],
          p_include_unlinked: query.include_unlinked,
          p_assignee_user_id: query.assignee_ref?.id ?? null,
          p_opportunity_id: query.opportunity_ref?.id ?? null,
          p_item_limit: input.authorization.query.limit,
          p_page_fetch_limit: Math.min(
            input.authorization.query.limit + 1,
            SITE_VISIT_READ_FETCH_LIMIT
          ),
          p_source_limit: SITE_VISIT_READ_MAX_SOURCE_ROWS,
          p_cursor_read_at: cursor?.readAt ?? null,
          p_cursor_source_revisions: cursor
            ? cursor.sourceRevisions.map((revision) => ({ ...revision }))
            : [],
          p_after_order_at: cursor?.predecessor.order[0] ?? null,
          p_after_site_visit_id: cursor?.predecessor.tie_breaker ?? null,
        }),
        input.signal
      );
      if (response.error) {
        const state = knownErrorState(response.error, false);
        if (state === "source_bound" || state === "stale") {
          return deepFreeze({ state });
        }
        throw new SiteVisitReadRepositoryError("SITE_VISIT_READ_FAILED");
      }

      try {
        const snapshot = RawListSnapshotSchema.parse(response.data);
        const proofContext = siteVisitListProofContext({
          authorization: input.authorization,
          cursor,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
          sourceHasMore: snapshot.source_has_more,
        });
        const proofRefs = snapshot.rows.map((row) => row.proof_ref);
        const evidenceRefs = snapshot.rows.map((row) => row.evidence_ref);
        const ids = snapshot.rows.map((row) => row.item.site_visit_ref.id);
        const validRows = snapshot.rows.every(
          (row) =>
            row.predecessor.view === snapshot.query.view &&
            row.proof_ref ===
              siteVisitListEntityProofRef({
                context: proofContext,
                visit: row.item,
              }) &&
            row.evidence_ref ===
              siteVisitListEvidenceRef({
                context: proofContext,
                siteVisitRef: row.item.site_visit_ref,
              })
        );
        const collectionProofRef = siteVisitListCollectionProofRef({
          context: proofContext,
          returnedCount: snapshot.rows.length,
          hasMore: snapshot.source_has_more,
          children: snapshot.rows.map((row) => ({
            site_visit_ref: row.item.site_visit_ref,
            proof_ref: row.proof_ref,
            evidence_ref: row.evidence_ref,
          })),
        });
        if (
          !exactBinding(snapshot, input.authorization) ||
          !sameJson(snapshot.query, query) ||
          snapshot.item_limit !== input.authorization.query.limit ||
          snapshot.cursor_read_at !== (cursor?.readAt ?? null) ||
          !sameJson(
            snapshot.cursor_source_revisions,
            cursor?.sourceRevisions ?? []
          ) ||
          !sameJson(snapshot.cursor_predecessor, cursor?.predecessor ?? null) ||
          snapshot.source_inspected >= SITE_VISIT_READ_MAX_SOURCE_ROWS ||
          snapshot.rows.length > input.authorization.query.limit ||
          (snapshot.source_has_more &&
            snapshot.rows.length !== input.authorization.query.limit) ||
          !validRows ||
          snapshot.collection_proof_ref !== collectionProofRef ||
          proofRefs.includes(snapshot.collection_proof_ref) ||
          new Set(proofRefs).size !== proofRefs.length ||
          new Set(evidenceRefs).size !== evidenceRefs.length ||
          new Set(ids).size !== ids.length ||
          !snapshot.rows.every(
            (row, index) =>
              index === 0 ||
              predecessorComesBefore(
                snapshot.query.view,
                snapshot.rows[index - 1]!.predecessor,
                row.predecessor
              )
          )
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
              source_domain: "site_visits",
              source_type: "site_visit_snapshot",
              occurred_at: snapshot.read_at,
            },
          ],
          predecessor: row.predecessor,
        }));
        const page = {
          units,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
          sourceHasMore: snapshot.source_has_more,
        };
        assertP2NoForbiddenFields(page);
        return deepFreeze({ state: "found" as const, page });
      } catch (error) {
        if (error instanceof SiteVisitReadRepositoryError) throw error;
        invalid(error);
      }
    },

    async get(input) {
      if (!isAuthorizedGetSiteVisitContextRead(input.authorization)) invalid();
      const query = input.authorization.query;
      const response = await execute(
        rpc(CONTEXT_RPC, {
          ...commonArguments(input.authorization),
          p_site_visit_id: query.site_visit_ref.id,
          p_expected_anchor: query.anchor,
          p_expected_opportunity_id:
            query.anchor === "opportunity" ? query.opportunity_ref.id : null,
          p_sections: [...query.sections],
          p_source_limit: SITE_VISIT_READ_MAX_SOURCE_ROWS,
          p_artifact_source_limit: SITE_VISIT_READ_MAX_SOURCE_ROWS,
          p_checklist_answer_limit: query.checklist_answer_limit ?? 0,
          p_checklist_answer_fetch_limit: query.checklist_answer_limit
            ? Math.min(
                query.checklist_answer_limit + 1,
                SITE_VISIT_READ_FETCH_LIMIT
              )
            : 0,
          p_timeline_limit: query.timeline_limit ?? 0,
        }),
        input.signal
      );
      if (response.error) {
        const state = knownErrorState(response.error, true);
        if (state) return deepFreeze({ state });
        throw new SiteVisitReadRepositoryError("SITE_VISIT_READ_FAILED");
      }

      try {
        const snapshot = RawContextSnapshotSchema.parse(response.data);
        const resultSectionKeys = Object.keys(snapshot.result.sections).sort(
          (left, right) => left.localeCompare(right)
        );
        const expectedRevisionDomains = expectedContextRevisions(
          input.authorization
        );
        const actualRevisionDomains = snapshot.source_revisions.map(
          (revision) => revision.domain
        );
        const expectedOpportunityRef =
          query.anchor === "opportunity" ? query.opportunity_ref : null;
        if (
          !exactBinding(snapshot, input.authorization) ||
          snapshot.anchor !== query.anchor ||
          !sameJson(snapshot.opportunity_ref, expectedOpportunityRef) ||
          snapshot.site_visit_ref.id !== query.site_visit_ref.id ||
          !sameStrings(snapshot.selected_sections, query.sections) ||
          !sameStrings(resultSectionKeys, query.sections) ||
          snapshot.checklist_answer_limit !==
            (query.checklist_answer_limit ?? null) ||
          snapshot.timeline_limit !== (query.timeline_limit ?? null) ||
          !sameStrings(actualRevisionDomains, expectedRevisionDomains) ||
          !validateSourceInspected({
            snapshot,
            authorization: input.authorization,
          })
        ) {
          invalid();
        }
        const proofContext = siteVisitContextProofContext({
          authorization: input.authorization,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
        });
        if (
          snapshot.proof_ref !==
            siteVisitContextEntityProofRef({
              context: proofContext,
              result: snapshot.result,
            }) ||
          snapshot.evidence_ref !==
            siteVisitContextEvidenceRef({ context: proofContext })
        ) {
          invalid();
        }
        const value = GetSiteVisitContextResultSchema.parse({
          ...snapshot.result,
          evidence: [
            {
              evidence_ref: snapshot.evidence_ref,
              source_domain: "site_visits",
              source_type: "site_visit_snapshot",
              occurred_at: snapshot.read_at,
            },
          ],
          proof: {
            proof_ref: snapshot.proof_ref,
            read_at: snapshot.read_at,
            source_revisions: snapshot.source_revisions,
          },
        });
        assertP2NoForbiddenFields(value);
        return deepFreeze({
          state: "found" as const,
          value,
          proofBinding: { sourceInspected: snapshot.source_inspected },
        });
      } catch (error) {
        if (error instanceof SiteVisitReadRepositoryError) throw error;
        invalid(error);
      }
    },
  };

  TRUSTED_SITE_VISIT_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedSiteVisitReadRepository(
  value: unknown
): value is SiteVisitReadRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_SITE_VISIT_REPOSITORIES.has(value)
  );
}

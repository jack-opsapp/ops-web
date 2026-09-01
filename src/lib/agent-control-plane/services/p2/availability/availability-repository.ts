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
  AVAILABILITY_FETCH_LIMIT,
  AVAILABILITY_MAX_MEMBERS,
  AVAILABILITY_MAX_SOURCE_ROWS,
  AvailabilityMemberSummarySchema,
  AvailabilityWindowSchema,
  assertNoCompanyOperationsForbiddenFields,
  type AvailabilityMemberSummary,
} from "@/lib/agent-control-plane/contracts/company-operations";
import {
  isAuthorizedTeamAvailabilityRead,
  type AuthorizedTeamAvailabilityRead,
} from "./availability-authorization";
import {
  TeamAvailabilityCursorPredecessorSchema,
  type TeamAvailabilityCursorContext,
  type TeamAvailabilityCursorPredecessor,
} from "./availability-cursor";
import {
  teamAvailabilityCollectionProofRef,
  teamAvailabilityEntityProofRef,
  teamAvailabilityEvidenceRef,
  teamAvailabilityProofContext,
} from "./availability-proof";

const RPC_NAME = "read_agent_team_availability_as_system" as const;
const TRUSTED_TEAM_AVAILABILITY_REPOSITORIES = new WeakSet<object>();

const CanonicalStringArraySchema = z
  .array(z.string().min(1).max(128))
  .max(64)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "TEAM_AVAILABILITY_ARRAY_NOT_CANONICAL"
  );
const ExactSourceRevisionsSchema = P2DomainRevisionVectorSchema.refine(
  (revisions) =>
    revisions.length === 4 &&
    revisions[0]?.domain === "availability" &&
    revisions[1]?.domain === "site_visits" &&
    revisions[2]?.domain === "tasks" &&
    revisions[3]?.domain === "team",
  "TEAM_AVAILABILITY_REVISION_VECTOR_INVALID"
);
const CursorSourceRevisionsSchema = z.union([
  z.tuple([]),
  ExactSourceRevisionsSchema,
]);
const RawRowSchema = z
  .object({
    item: AvailabilityMemberSummarySchema,
    proof_ref: P2ProofRefSchema,
    evidence_ref: P2EvidenceRefSchema,
    predecessor: TeamAvailabilityCursorPredecessorSchema,
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
    capability_id: z.literal("list_team_availability"),
    capability_revision: z.literal("list_team_availability:2026-08-22.v1"),
    capability_manifest_revision: z.literal(
      "2026-08-22.capability-manifest.v8"
    ),
    ranking_revision: z.literal("availability-member-order:2026-08-22.v1"),
    required_oauth_scopes: z.tuple([z.literal("ops.team.read")]),
    view: z.enum(["company", "self"]),
    team_scope: z.literal("all").nullable(),
    calendar_scope: z.enum(["all", "own"]),
    starts_on: z.string(),
    ends_on: z.string(),
    company_timezone: z.string(),
    item_limit: z.number().int().min(1).max(AVAILABILITY_MAX_MEMBERS),
    cursor_read_at: P2CanonicalTimestampSchema.nullable(),
    cursor_source_revisions: CursorSourceRevisionsSchema,
    cursor_predecessor: TeamAvailabilityCursorPredecessorSchema.nullable(),
    read_at: P2CanonicalTimestampSchema,
    source_revisions: ExactSourceRevisionsSchema,
    member_source_inspected: z
      .number()
      .int()
      .min(0)
      .max(AVAILABILITY_MAX_SOURCE_ROWS - 1),
    schedule_source_inspected: z
      .number()
      .int()
      .min(0)
      .max(AVAILABILITY_MAX_SOURCE_ROWS - 1),
    source_has_more: z.boolean(),
    rows: z.array(RawRowSchema).max(AVAILABILITY_MAX_MEMBERS),
    collection_proof_ref: P2ProofRefSchema,
  })
  .strict();

export interface TeamAvailabilityUnit {
  readonly item: AvailabilityMemberSummary;
  readonly proof: {
    readonly proof_ref: string;
    readonly read_at: string;
    readonly source_revisions: {
      readonly domain: string;
      readonly source_revision: number;
    }[];
  };
  readonly evidence: readonly [
    {
      readonly evidence_ref: string;
      readonly source_domain: "availability";
      readonly source_type: "team_availability_snapshot";
      readonly occurred_at: string;
    },
  ];
  readonly predecessor: TeamAvailabilityCursorPredecessor;
}

export type TeamAvailabilityRepositoryResult =
  | Readonly<{
      state: "found";
      page: Readonly<{
        view: "company" | "self";
        startsOn: string;
        endsOn: string;
        timezone: string;
        units: readonly TeamAvailabilityUnit[];
        readAt: string;
        sourceRevisions: readonly {
          readonly domain: string;
          readonly source_revision: number;
        }[];
        memberSourceInspected: number;
        scheduleSourceInspected: number;
        sourceHasMore: boolean;
      }>;
    }>
  | Readonly<{ state: "source_bound" }>
  | Readonly<{ state: "source_invalid" }>
  | Readonly<{ state: "stale" }>;

export interface TeamAvailabilityRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface TeamAvailabilityRpcRequest extends PromiseLike<TeamAvailabilityRpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<TeamAvailabilityRpcResult>;
}

export interface TeamAvailabilityRpcClient {
  rpc(
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ): TeamAvailabilityRpcRequest;
}

export interface TeamAvailabilityRepository {
  list(input: {
    readonly authorization: AuthorizedTeamAvailabilityRead;
    readonly cursor: TeamAvailabilityCursorContext | null;
    readonly signal?: AbortSignal;
  }): Promise<TeamAvailabilityRepositoryResult>;
}

export class TeamAvailabilityRepositoryError extends Error {
  readonly code: "TEAM_AVAILABILITY_INVALID" | "TEAM_AVAILABILITY_READ_FAILED";

  constructor(
    code: TeamAvailabilityRepositoryError["code"],
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "TeamAvailabilityRepositoryError";
    this.code = code;
  }
}

function invalid(cause?: unknown): never {
  throw new TeamAvailabilityRepositoryError("TEAM_AVAILABILITY_INVALID", {
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

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function compareScalarText(left: string, right: string): number {
  const leftScalars = Array.from(left, (scalar) => scalar.codePointAt(0)!);
  const rightScalars = Array.from(right, (scalar) => scalar.codePointAt(0)!);
  const length = Math.min(leftScalars.length, rightScalars.length);
  for (let index = 0; index < length; index += 1) {
    if (leftScalars[index] !== rightScalars[index]) {
      return leftScalars[index]! - rightScalars[index]!;
    }
  }
  return leftScalars.length - rightScalars.length;
}

function predecessorComesBefore(
  left: TeamAvailabilityCursorPredecessor,
  right: TeamAvailabilityCursorPredecessor
) {
  const nameOrder = compareScalarText(left.order[0], right.order[0]);
  return (
    nameOrder < 0 || (nameOrder === 0 && left.tie_breaker < right.tie_breaker)
  );
}

function knownErrorState(
  error: unknown
): "source_bound" | "source_invalid" | "stale" | null {
  try {
    if (typeof error !== "object" || error === null || Array.isArray(error)) {
      return null;
    }
    const record = error as Readonly<Record<string, unknown>>;
    if (
      record.code === "54000" &&
      (record.message === "agent_availability_member_source_query_bound" ||
        record.message === "agent_availability_schedule_source_query_bound")
    ) {
      return "source_bound";
    }
    if (
      record.code === "40001" &&
      record.message === "agent_availability_snapshot_stale"
    ) {
      return "stale";
    }
    if (
      record.code === "22000" &&
      record.message === "agent_availability_source_data_invalid"
    ) {
      return "source_invalid";
    }
  } catch {
    return null;
  }
  return null;
}

async function execute(
  request: TeamAvailabilityRpcRequest,
  signal?: AbortSignal
): Promise<TeamAvailabilityRpcResult> {
  if (signal?.aborted) {
    throw new TeamAvailabilityRepositoryError("TEAM_AVAILABILITY_READ_FAILED");
  }
  try {
    const response =
      signal && typeof request.abortSignal === "function"
        ? await Reflect.apply(request.abortSignal, request, [signal])
        : await request;
    if (signal?.aborted) {
      throw new TeamAvailabilityRepositoryError(
        "TEAM_AVAILABILITY_READ_FAILED"
      );
    }
    return response;
  } catch (error) {
    if (error instanceof TeamAvailabilityRepositoryError) throw error;
    throw new TeamAvailabilityRepositoryError("TEAM_AVAILABILITY_READ_FAILED", {
      cause: error,
    });
  }
}

function exactBinding(
  snapshot: z.infer<typeof RawSnapshotSchema>,
  authorization: AuthorizedTeamAvailabilityRead
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
    snapshot.view === authorization.availabilityScope &&
    snapshot.team_scope === authorization.teamScope &&
    snapshot.calendar_scope === authorization.calendarScope &&
    snapshot.starts_on === authorization.query.starts_on &&
    snapshot.ends_on === authorization.query.ends_on &&
    snapshot.item_limit === authorization.itemLimit
  );
}

export function createSupabaseTeamAvailabilityRepository(
  client: TeamAvailabilityRpcClient
): TeamAvailabilityRepository {
  let suppliedRpc: TeamAvailabilityRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as TeamAvailabilityRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("A team-availability RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("A team-availability RPC client is required");
  }
  const rpc = (args: Readonly<Record<string, unknown>>) =>
    Reflect.apply(suppliedRpc!, client, [
      RPC_NAME,
      args,
    ]) as TeamAvailabilityRpcRequest;

  const repository: TeamAvailabilityRepository = {
    async list(input) {
      if (!isAuthorizedTeamAvailabilityRead(input.authorization)) invalid();
      const cursor = input.cursor;
      if (
        (input.authorization.availabilityScope === "self" && cursor !== null) ||
        (cursor !== null &&
          (!P2CanonicalTimestampSchema.safeParse(cursor.readAt).success ||
            !ExactSourceRevisionsSchema.safeParse(cursor.sourceRevisions)
              .success ||
            !TeamAvailabilityCursorPredecessorSchema.safeParse(
              cursor.predecessor
            ).success))
      ) {
        invalid();
      }
      const authorization = input.authorization;
      const response = await execute(
        rpc({
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
          p_view: authorization.availabilityScope,
          p_team_scope: authorization.teamScope,
          p_calendar_scope: authorization.calendarScope,
          p_starts_on: authorization.query.starts_on,
          p_ends_on: authorization.query.ends_on,
          p_item_limit: authorization.itemLimit,
          p_page_fetch_limit: Math.min(
            authorization.itemLimit + 1,
            AVAILABILITY_FETCH_LIMIT
          ),
          p_member_source_limit: AVAILABILITY_MAX_SOURCE_ROWS,
          p_schedule_source_limit: AVAILABILITY_MAX_SOURCE_ROWS,
          p_cursor_read_at: cursor?.readAt ?? null,
          p_cursor_source_revisions: cursor
            ? cursor.sourceRevisions.map((revision) => ({ ...revision }))
            : [],
          p_after_display_name: cursor?.predecessor.order[0] ?? null,
          p_after_member_id: cursor?.predecessor.tie_breaker ?? null,
        }),
        input.signal
      );
      if (response.error) {
        const state = knownErrorState(response.error);
        if (state) return deepFreeze({ state });
        throw new TeamAvailabilityRepositoryError(
          "TEAM_AVAILABILITY_READ_FAILED"
        );
      }

      try {
        const snapshot = RawSnapshotSchema.parse(response.data);
        const window = AvailabilityWindowSchema.parse({
          starts_on: snapshot.starts_on,
          ends_on: snapshot.ends_on,
          timezone: snapshot.company_timezone,
        });
        const expectedCursorRevisions = cursor?.sourceRevisions ?? [];
        const context = teamAvailabilityProofContext({
          authorization,
          cursor,
          readAt: snapshot.read_at,
          timezone: snapshot.company_timezone,
          sourceRevisions: snapshot.source_revisions,
          memberSourceInspected: snapshot.member_source_inspected,
          scheduleSourceInspected: snapshot.schedule_source_inspected,
          sourceHasMore: snapshot.source_has_more,
        });
        const validRows = snapshot.rows.every(
          (row, index) =>
            row.item.days[0]?.date === window.starts_on &&
            row.item.days.at(-1)?.date === window.ends_on &&
            row.predecessor.order[0] === row.item.display_name &&
            row.predecessor.order[1] === row.item.member_ref.id &&
            row.predecessor.tie_breaker === row.item.member_ref.id &&
            row.proof_ref ===
              teamAvailabilityEntityProofRef({ context, item: row.item }) &&
            row.evidence_ref ===
              teamAvailabilityEvidenceRef({
                context,
                memberRef: row.item.member_ref,
              }) &&
            (cursor === null ||
              predecessorComesBefore(cursor.predecessor, row.predecessor)) &&
            (index === 0 ||
              predecessorComesBefore(
                snapshot.rows[index - 1]!.predecessor,
                row.predecessor
              ))
        );
        const expectedCollection = teamAvailabilityCollectionProofRef({
          context,
          returnedCount: snapshot.rows.length,
          hasMore: snapshot.source_has_more,
          children: snapshot.rows.map((row) => ({
            member_ref: row.item.member_ref,
            proof_ref: row.proof_ref,
            evidence_ref: row.evidence_ref,
          })),
        });
        const selfShapeValid =
          authorization.availabilityScope !== "self" ||
          (snapshot.rows.length === 1 &&
            snapshot.rows[0]!.item.member_ref.id ===
              authorization.actorContext.actorUserId &&
            !snapshot.source_has_more);
        if (
          !exactBinding(snapshot, authorization) ||
          snapshot.cursor_read_at !== (cursor?.readAt ?? null) ||
          !sameJson(
            snapshot.cursor_source_revisions,
            expectedCursorRevisions
          ) ||
          !sameJson(snapshot.cursor_predecessor, cursor?.predecessor ?? null) ||
          (cursor !== null &&
            (snapshot.read_at !== cursor.readAt ||
              !sameJson(snapshot.source_revisions, cursor.sourceRevisions))) ||
          snapshot.member_source_inspected < snapshot.rows.length ||
          snapshot.rows.length > authorization.itemLimit ||
          (snapshot.source_has_more &&
            snapshot.rows.length !== authorization.itemLimit) ||
          !selfShapeValid ||
          !validRows ||
          snapshot.collection_proof_ref !== expectedCollection ||
          snapshot.rows.some(
            (row) => row.proof_ref === snapshot.collection_proof_ref
          ) ||
          new Set(snapshot.rows.map((row) => row.item.member_ref.id)).size !==
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
              source_domain: "availability" as const,
              source_type: "team_availability_snapshot" as const,
              occurred_at: snapshot.read_at,
            },
          ] as const,
          predecessor: row.predecessor,
        }));
        const page = {
          view: snapshot.view,
          startsOn: snapshot.starts_on,
          endsOn: snapshot.ends_on,
          timezone: snapshot.company_timezone,
          units,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          memberSourceInspected: snapshot.member_source_inspected,
          scheduleSourceInspected: snapshot.schedule_source_inspected,
          sourceHasMore: snapshot.source_has_more,
        };
        assertNoCompanyOperationsForbiddenFields(page);
        return deepFreeze({ state: "found" as const, page });
      } catch (error) {
        if (error instanceof TeamAvailabilityRepositoryError) throw error;
        invalid(error);
      }
    },
  };

  TRUSTED_TEAM_AVAILABILITY_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedTeamAvailabilityRepository(
  value: unknown
): value is TeamAvailabilityRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_TEAM_AVAILABILITY_REPOSITORIES.has(value)
  );
}

import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  EvidenceRefSchema,
  IanaTimeZoneSchema,
  SourceVersionSchema,
} from "@/lib/agent-control-plane/contracts";
import { ScheduledJobOccurrenceSchema } from "@/lib/agent-control-plane/contracts/schedule";
import { CONTRACT_VERSION } from "@/lib/agent-control-plane/contracts/version";
import {
  canonicalOperationalProjection,
  hashOperationalProjection,
} from "./operational-read-projection";
import {
  isAuthorizedScheduledJobsRead,
  type AuthorizedScheduledJobsRead,
} from "./scheduled-jobs-authorization";
import {
  hashOperationalReadQuery,
  isTrustedOperationalReadCursorCodec,
  OperationalReadCursorError,
  OperationalReadCursorPermissionStaleError,
  type OperationalReadCursorCodec,
} from "./operational-read-cursor";

const RPC_NAME = "read_agent_scheduled_jobs_as_system" as const;
const UUID_SCHEMA = z.string().uuid();
const SOURCE_FENCE_ID = "private.agent_operational_read_revisions";
const SCHEDULE_RULE_REVISIONS: readonly string[] = Object.freeze([]);
const SHA256_SCHEMA = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const PROJECTION_VERSION_SCHEMA = z
  .string()
  .regex(/^scheduled-job-occurrence-projection:v1:sha256:[0-9a-f]{64}$/);
const SOURCE_FENCE_SCHEMA = SourceVersionSchema.refine(
  (value) =>
    value.source_type === "operational_read_revision" &&
    value.source_id === SOURCE_FENCE_ID &&
    /^revision:\d+$/.test(value.version),
  "Operational source fence is invalid"
);
const NextCursorClaimsSchema = z
  .object({
    source_revision: z.number().int().nonnegative(),
    start_utc: z.string().datetime({ offset: false }),
    task_id: UUID_SCHEMA,
  })
  .strict();
const OccurrenceProofSchema = z
  .object({
    occurrence_ref: z
      .object({ kind: z.literal("project_task"), id: UUID_SCHEMA })
      .strict(),
    source_version: SourceVersionSchema,
    source_content_hash: SHA256_SCHEMA,
    evidence_id: z.string().min(1).max(512),
    projection: z
      .object({
        actor_user_id: UUID_SCHEMA,
        capability_id: z.literal("list_scheduled_jobs"),
        capability_manifest_revision: z.string().min(1).max(128),
        capability_revision: z.string().min(1).max(128),
        company_id: UUID_SCHEMA,
        occurrence: ScheduledJobOccurrenceSchema,
        permission_snapshot_revision: z.string().min(1).max(512),
        read_at: z.string().datetime({ offset: false }),
        source_revision: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
const RawSnapshotSchema = z
  .object({
    company_id: UUID_SCHEMA,
    permission_snapshot_revision: z.string().min(1).max(512),
    read_at: z.string().datetime({ offset: false }),
    source_fence: SOURCE_FENCE_SCHEMA,
    company_timezone: IanaTimeZoneSchema,
    display_timezone: IanaTimeZoneSchema,
    occurrences: z.array(ScheduledJobOccurrenceSchema).max(50),
    occurrence_proofs: z.array(OccurrenceProofSchema).max(50),
    returned_occurrence_count: z.number().int().min(0).max(50),
    next_cursor_claims: NextCursorClaimsSchema.nullable(),
    has_more: z.boolean(),
    source_versions: z.array(SourceVersionSchema).max(100),
    evidence: z.array(EvidenceRefSchema).max(100),
  })
  .strict();

export type ScheduledJobsSnapshot = z.infer<typeof RawSnapshotSchema>;
export interface ScheduledJobsRepositorySnapshot extends Omit<
  ScheduledJobsSnapshot,
  "next_cursor_claims" | "has_more"
> {
  readonly page: Readonly<{
    next_cursor: string | null;
    has_more: boolean;
  }>;
  readonly boundary_cursors: readonly string[];
}

export class ScheduledJobsRepositoryError extends Error {
  readonly code:
    | "SCHEDULED_JOBS_READ_FAILED"
    | "SCHEDULED_JOBS_STALE"
    | "SCHEDULED_JOBS_INVALID";
  readonly currentSourceVersion: z.infer<typeof SourceVersionSchema> | null;

  constructor(
    code: ScheduledJobsRepositoryError["code"],
    options?: ErrorOptions & {
      readonly currentSourceVersion?: z.infer<typeof SourceVersionSchema>;
    }
  ) {
    super(code, options);
    this.name = "ScheduledJobsRepositoryError";
    this.code = code;
    this.currentSourceVersion = options?.currentSourceVersion ?? null;
  }
}

interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}
export interface ScheduledJobsRpcRequest extends PromiseLike<RpcResult> {
  abortSignal?(signal: AbortSignal): PromiseLike<RpcResult>;
}
export interface ScheduledJobsRpcClient {
  rpc(
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ): ScheduledJobsRpcRequest;
}

declare const TRUSTED_SCHEDULED_JOBS_REPOSITORY: unique symbol;
const TRUSTED_REPOSITORIES = new WeakSet<object>();
export interface ScheduledJobsRepository {
  readonly [TRUSTED_SCHEDULED_JOBS_REPOSITORY]: true;
  read(input: {
    readonly authorization: AuthorizedScheduledJobsRead;
    readonly signal?: AbortSignal;
  }): Promise<ScheduledJobsRepositorySnapshot>;
}

function queryHash(proof: AuthorizedScheduledJobsRead): string {
  const { cursor: _cursor, ...query } = proof.query;
  return hashOperationalReadQuery({
    capability_id: proof.capabilityId,
    schema_revision: CONTRACT_VERSION,
    query,
  });
}

/**
 * PostgreSQL is the schedule resolver and rejects invalid civil times before
 * returning a snapshot. The signed projection carries the exact offset it
 * used so this verifier never silently changes meaning when the Node runtime
 * and database ship different IANA timezone-data revisions.
 */
function localInstantMatchesOffset(
  local: string,
  utc: string,
  offsetMinutes: number
): boolean {
  const utcInstant = Date.parse(utc);
  const localAsUtc = Date.parse(`${local}Z`);
  return (
    Number.isFinite(utcInstant) &&
    Number.isFinite(localAsUtc) &&
    localAsUtc === utcInstant + offsetMinutes * 60_000
  );
}

function localDateAtOffset(utc: string, offsetMinutes: number): string | null {
  const instant = Date.parse(utc);
  if (!Number.isFinite(instant)) return null;
  return new Date(instant + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

function predecessorLocalDateAtOffset(
  utc: string,
  offsetMinutes: number
): string | null {
  const instant = Date.parse(utc);
  if (!Number.isFinite(instant)) return null;
  return new Date(instant - 1 + offsetMinutes * 60_000)
    .toISOString()
    .slice(0, 10);
}

function sameSource(
  left: z.infer<typeof SourceVersionSchema>,
  right: z.infer<typeof SourceVersionSchema>
): boolean {
  return (
    left.source_domain === right.source_domain &&
    left.source_type === right.source_type &&
    left.source_id === right.source_id &&
    left.version === right.version
  );
}

function datePart(localDateTime: string): string {
  return localDateTime.slice(0, 10);
}

function nextLocalDate(localDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return null;
  const instant = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
  if (new Date(instant).toISOString().slice(0, 10) !== localDate) return null;
  return new Date(instant + 86_400_000).toISOString().slice(0, 10);
}

function previousLocalDate(localDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return null;
  const instant = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
  if (new Date(instant).toISOString().slice(0, 10) !== localDate) return null;
  return new Date(instant - 86_400_000).toISOString().slice(0, 10);
}

function assertSnapshot(
  snapshot: ScheduledJobsSnapshot,
  proof: AuthorizedScheduledJobsRead,
  decoded: ReturnType<OperationalReadCursorCodec["decode"]> | null
): void {
  const invalid = () => {
    throw new ScheduledJobsRepositoryError("SCHEDULED_JOBS_INVALID");
  };
  const sourceRevision = Number(snapshot.source_fence.version.slice(9));
  const expectedDisplayTimezone =
    proof.query.display_timezone ?? snapshot.company_timezone;
  const totalAssignments = snapshot.occurrences.reduce(
    (total, occurrence) => total + occurrence.assignments.length,
    0
  );
  if (
    snapshot.company_id !== proof.actorContext.companyId ||
    snapshot.permission_snapshot_revision !==
      proof.actorContext.permissionSnapshotRevision ||
    snapshot.returned_occurrence_count !== snapshot.occurrences.length ||
    snapshot.occurrences.length > proof.query.limit ||
    snapshot.display_timezone !== expectedDisplayTimezone ||
    totalAssignments > 100 ||
    snapshot.occurrence_proofs.length !== snapshot.occurrences.length ||
    snapshot.source_versions.length !== snapshot.occurrences.length + 1 ||
    snapshot.evidence.length !== snapshot.occurrences.length ||
    snapshot.has_more !== (snapshot.next_cursor_claims !== null) ||
    (snapshot.next_cursor_claims !== null &&
      snapshot.next_cursor_claims.source_revision !== sourceRevision) ||
    (decoded !== null &&
      (snapshot.read_at !== decoded.read_as_of ||
        sourceRevision !== decoded.source_revision)) ||
    !snapshot.source_versions.some(
      (source) =>
        source.source_domain === snapshot.source_fence.source_domain &&
        source.source_type === snapshot.source_fence.source_type &&
        source.source_id === snapshot.source_fence.source_id &&
        source.version === snapshot.source_fence.version
    )
  ) {
    invalid();
  }
  const occurrenceIds = new Set<string>();
  const proofSourceIds = new Set<string>();
  const proofEvidenceIds = new Set<string>();
  for (const [index, occurrence] of snapshot.occurrences.entries()) {
    const timing = occurrence.schedule;
    const occurrenceProof = snapshot.occurrence_proofs[index];
    const proofSource = occurrenceProof?.source_version;
    const proofEvidence = snapshot.evidence.find(
      (item) => item.evidence_id === occurrenceProof?.evidence_id
    );
    const expectedEvidenceId = `evidence:scheduled_job_occurrence_projection:${occurrence.occurrence_ref.id}`;
    const expectedLocator = `ops://projects/${occurrence.job_ref.id}/tasks/${occurrence.occurrence_ref.id}`;
    const expectedProjection = {
      actor_user_id: proof.actorContext.actorUserId,
      capability_id: proof.capabilityId,
      capability_manifest_revision: proof.capabilityManifestRevision,
      capability_revision: proof.capabilityRevision,
      company_id: proof.actorContext.companyId,
      occurrence,
      permission_snapshot_revision:
        proof.actorContext.permissionSnapshotRevision,
      read_at: snapshot.read_at,
      source_revision: sourceRevision,
    } as const;
    const exactProof =
      occurrenceProof?.occurrence_ref.kind === occurrence.occurrence_ref.kind &&
      occurrenceProof.occurrence_ref.id === occurrence.occurrence_ref.id &&
      PROJECTION_VERSION_SCHEMA.safeParse(proofSource?.version).success &&
      proofSource?.source_type === "scheduled_job_occurrence_projection" &&
      proofSource.source_domain === "operations" &&
      proofSource.source_id === occurrence.occurrence_ref.id &&
      proofSource.version ===
        `scheduled-job-occurrence-projection:v1:${occurrenceProof.source_content_hash}` &&
      occurrenceProof.evidence_id === expectedEvidenceId &&
      snapshot.source_versions.some((source) =>
        sameSource(source, proofSource)
      ) &&
      proofEvidence !== undefined &&
      sameSource(proofEvidence, proofSource) &&
      proofEvidence.locator === expectedLocator &&
      proofEvidence.occurred_at === snapshot.read_at &&
      proofEvidence.relationship === "supports" &&
      proofEvidence.trust === "authoritative_ops" &&
      proofEvidence.excerpt === undefined &&
      canonicalOperationalProjection(occurrenceProof.projection) ===
        canonicalOperationalProjection(expectedProjection) &&
      hashOperationalProjection(occurrenceProof.projection) ===
        occurrenceProof.source_content_hash;
    const localStartDate = datePart(timing.local_start);
    const localEndDate = datePart(timing.local_end_inclusive);
    const nextEndDate = nextLocalDate(localEndDate);
    const expectedAllDayStart = `${localStartDate}T00:00:00`;
    const expectedAllDayEndInclusive = `${localEndDate}T23:59:59.999999`;
    const validStart = timing.all_day
      ? timing.local_start === expectedAllDayStart &&
        timing.start_pre_boundary_utc_offset_minutes !== null &&
        localDateAtOffset(timing.start_utc, timing.start_utc_offset_minutes) ===
          localStartDate &&
        predecessorLocalDateAtOffset(
          timing.start_utc,
          timing.start_pre_boundary_utc_offset_minutes
        ) === previousLocalDate(localStartDate)
      : localInstantMatchesOffset(
          timing.local_start,
          timing.start_utc,
          timing.start_utc_offset_minutes
        );
    const validEnd = timing.all_day
      ? timing.local_end_inclusive === expectedAllDayEndInclusive &&
        nextEndDate !== null &&
        timing.end_pre_boundary_utc_offset_minutes !== null &&
        localDateAtOffset(
          timing.end_utc_exclusive,
          timing.end_utc_offset_minutes
        ) === nextEndDate &&
        predecessorLocalDateAtOffset(
          timing.end_utc_exclusive,
          timing.end_pre_boundary_utc_offset_minutes
        ) === localEndDate
      : localInstantMatchesOffset(
          timing.local_end_inclusive,
          timing.end_utc_exclusive,
          timing.end_utc_offset_minutes
        );
    const readAt = Date.parse(snapshot.read_at);
    const startAt = Date.parse(timing.start_utc);
    const endAt = Date.parse(timing.end_utc_exclusive);
    const observedMetadataIsCurrent =
      Date.parse(occurrence.task_updated_at) <= readAt &&
      Date.parse(occurrence.project_updated_at) <= readAt &&
      (occurrence.schedule_confirmed_at === null ||
        Date.parse(occurrence.schedule_confirmed_at) <= readAt);
    const expectedTimingState =
      occurrence.task_status !== "active"
        ? "past"
        : startAt > readAt
          ? "upcoming"
          : endAt > readAt
            ? "in_progress"
            : "past_due";
    if (
      timing.company_timezone !== snapshot.company_timezone ||
      timing.display.timezone !== snapshot.display_timezone ||
      !localInstantMatchesOffset(
        timing.display.local_start,
        timing.start_utc,
        timing.display.start_utc_offset_minutes
      ) ||
      !localInstantMatchesOffset(
        timing.display.local_end_exclusive,
        timing.end_utc_exclusive,
        timing.display.end_utc_offset_minutes
      ) ||
      endAt <= Date.parse(proof.query.from) ||
      startAt >= Date.parse(proof.query.to) ||
      !proof.query.task_statuses.includes(occurrence.task_status) ||
      (proof.query.confirmation_states !== undefined &&
        !proof.query.confirmation_states.includes(
          occurrence.confirmation_state
        )) ||
      occurrence.timing_state !== expectedTimingState ||
      !observedMetadataIsCurrent ||
      !validStart ||
      !validEnd ||
      occurrenceIds.has(occurrence.occurrence_ref.id) ||
      proofSourceIds.has(proofSource?.source_id ?? "") ||
      proofEvidenceIds.has(occurrenceProof?.evidence_id ?? "") ||
      !exactProof
    ) {
      invalid();
    }
    occurrenceIds.add(occurrence.occurrence_ref.id);
    proofSourceIds.add(proofSource.source_id);
    proofEvidenceIds.add(occurrenceProof.evidence_id);
  }
  for (let index = 1; index < snapshot.occurrences.length; index += 1) {
    const previous = snapshot.occurrences[index - 1]!;
    const current = snapshot.occurrences[index]!;
    if (
      previous.schedule.start_utc > current.schedule.start_utc ||
      (previous.schedule.start_utc === current.schedule.start_utc &&
        previous.occurrence_ref.id >= current.occurrence_ref.id)
    ) {
      invalid();
    }
  }
  const last = snapshot.occurrences.at(-1);
  const first = snapshot.occurrences[0];
  if (
    decoded?.capability_id === "list_scheduled_jobs" &&
    first &&
    (first.schedule.start_utc < decoded.start_utc ||
      (first.schedule.start_utc === decoded.start_utc &&
        first.occurrence_ref.id <= decoded.task_id))
  ) {
    invalid();
  }
  if (
    snapshot.next_cursor_claims &&
    (!last ||
      snapshot.next_cursor_claims.start_utc !== last.schedule.start_utc ||
      snapshot.next_cursor_claims.task_id !== last.occurrence_ref.id)
  ) {
    invalid();
  }
}

function staleSource(error: unknown) {
  if (typeof error !== "object" || error === null) return null;
  const value = error as Record<string, unknown>;
  if (
    value.code !== "40001" ||
    value.message !== "agent_operational_read_cursor_stale"
  ) {
    return null;
  }
  let details = value.details;
  if (typeof details === "string") {
    if (details.length > 4_096) return null;
    try {
      details = JSON.parse(details);
    } catch {
      return null;
    }
  }
  const parsed = SourceVersionSchema.safeParse(details);
  return parsed.success ? parsed.data : null;
}

function permissionSource(proof: AuthorizedScheduledJobsRead) {
  return {
    source_domain: "authorization",
    source_type: "actor_permission_snapshot",
    source_id: proof.actorContext.actorUserId,
    version: proof.actorContext.permissionSnapshotRevision,
  } as const;
}

export function createSupabaseScheduledJobsRepository(
  client: ScheduledJobsRpcClient,
  cursorCodec: OperationalReadCursorCodec
): ScheduledJobsRepository {
  if (!client || typeof client.rpc !== "function") {
    throw new TypeError("A scheduled-jobs RPC client is required");
  }
  if (!isTrustedOperationalReadCursorCodec(cursorCodec)) {
    throw new TypeError("A trusted operational-read cursor codec is required");
  }
  const repository = {
    async read(input: {
      readonly authorization: AuthorizedScheduledJobsRead;
      readonly signal?: AbortSignal;
    }): Promise<ScheduledJobsRepositorySnapshot> {
      if (!isAuthorizedScheduledJobsRead(input.authorization)) {
        throw new ScheduledJobsRepositoryError("SCHEDULED_JOBS_INVALID");
      }
      if (input.signal?.aborted) {
        throw new ScheduledJobsRepositoryError("SCHEDULED_JOBS_READ_FAILED");
      }
      const proof = input.authorization;
      const hash = queryHash(proof);
      let decoded: ReturnType<OperationalReadCursorCodec["decode"]> | null =
        null;
      if (proof.query.cursor) {
        try {
          decoded = cursorCodec.decode({
            cursor: proof.query.cursor,
            expected: {
              capabilityId: proof.capabilityId,
              schemaRevision: CONTRACT_VERSION,
              capabilityManifestRevision: proof.capabilityManifestRevision,
              ruleRevisions: SCHEDULE_RULE_REVISIONS,
              actorUserId: proof.actorContext.actorUserId,
              companyId: proof.actorContext.companyId,
              permissionSnapshotRevision:
                proof.actorContext.permissionSnapshotRevision,
              queryHash: hash,
            },
          });
        } catch (error) {
          if (error instanceof OperationalReadCursorPermissionStaleError) {
            throw new ScheduledJobsRepositoryError("SCHEDULED_JOBS_STALE", {
              cause: error,
              currentSourceVersion: permissionSource(proof),
            });
          }
          if (error instanceof OperationalReadCursorError) {
            throw new ScheduledJobsRepositoryError("SCHEDULED_JOBS_INVALID", {
              cause: error,
            });
          }
          throw error;
        }
      }
      const request = client.rpc(RPC_NAME, {
        p_request_id: proof.actorContext.requestId,
        p_actor_user_id: proof.actorContext.actorUserId,
        p_company_id: proof.actorContext.companyId,
        p_permission_snapshot_revision:
          proof.actorContext.permissionSnapshotRevision,
        p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
        p_capability_id: proof.capabilityId,
        p_capability_revision: proof.capabilityRevision,
        p_capability_manifest_revision: proof.capabilityManifestRevision,
        p_required_oauth_scopes: [...proof.requiredOAuthScopes],
        p_calendar_scope: proof.calendarScope,
        p_projects_scope: proof.projectsScope,
        p_tasks_scope: proof.tasksScope,
        p_from: proof.query.from,
        p_to: proof.query.to,
        p_task_statuses: [...proof.query.task_statuses],
        p_confirmation_states: proof.query.confirmation_states
          ? [...proof.query.confirmation_states]
          : null,
        p_display_timezone: proof.query.display_timezone ?? null,
        p_read_as_of: decoded?.read_as_of ?? null,
        p_cursor_source_revision: decoded?.source_revision ?? null,
        p_cursor_start_utc:
          decoded?.capability_id === "list_scheduled_jobs"
            ? decoded.start_utc
            : null,
        p_cursor_task_id:
          decoded?.capability_id === "list_scheduled_jobs"
            ? decoded.task_id
            : null,
        p_limit: proof.query.limit,
      });
      const response =
        input.signal && request.abortSignal
          ? await request.abortSignal(input.signal)
          : await request;
      if (response.error) {
        const currentSourceVersion = staleSource(response.error);
        if (currentSourceVersion) {
          throw new ScheduledJobsRepositoryError("SCHEDULED_JOBS_STALE", {
            cause: response.error,
            currentSourceVersion,
          });
        }
        throw new ScheduledJobsRepositoryError("SCHEDULED_JOBS_READ_FAILED", {
          cause: response.error,
        });
      }
      const parsed = RawSnapshotSchema.safeParse(response.data);
      if (!parsed.success) {
        throw new ScheduledJobsRepositoryError("SCHEDULED_JOBS_INVALID", {
          cause: parsed.error,
        });
      }
      assertSnapshot(parsed.data, proof, decoded);
      const nextClaims = parsed.data.next_cursor_claims;
      const nextCursor = nextClaims
        ? cursorCodec.encode({
            capability_id: proof.capabilityId,
            schema_revision: CONTRACT_VERSION,
            capability_manifest_revision: proof.capabilityManifestRevision,
            rule_revisions: [...SCHEDULE_RULE_REVISIONS],
            actor_user_id: proof.actorContext.actorUserId,
            company_id: proof.actorContext.companyId,
            permission_snapshot_revision:
              proof.actorContext.permissionSnapshotRevision,
            query_hash: hash,
            read_as_of: parsed.data.read_at,
            source_revision: nextClaims.source_revision,
            start_utc: nextClaims.start_utc,
            task_id: nextClaims.task_id,
          })
        : null;
      const {
        next_cursor_claims: _claims,
        has_more,
        ...snapshot
      } = parsed.data;
      const boundaryCursors = parsed.data.occurrences.map((occurrence) =>
        cursorCodec.encode({
          capability_id: proof.capabilityId,
          schema_revision: CONTRACT_VERSION,
          capability_manifest_revision: proof.capabilityManifestRevision,
          rule_revisions: [...SCHEDULE_RULE_REVISIONS],
          actor_user_id: proof.actorContext.actorUserId,
          company_id: proof.actorContext.companyId,
          permission_snapshot_revision:
            proof.actorContext.permissionSnapshotRevision,
          query_hash: hash,
          source_revision: Number(parsed.data.source_fence.version.slice(9)),
          read_as_of: parsed.data.read_at,
          start_utc: occurrence.schedule.start_utc,
          task_id: occurrence.occurrence_ref.id,
        })
      );
      return Object.freeze({
        ...snapshot,
        page: Object.freeze({ next_cursor: nextCursor, has_more }),
        boundary_cursors: Object.freeze(boundaryCursors),
      });
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository) as ScheduledJobsRepository;
}

export function isTrustedScheduledJobsRepository(
  value: unknown
): value is ScheduledJobsRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}

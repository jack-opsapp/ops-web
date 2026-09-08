import "server-only";
import { z } from "zod-v4";
import { assertScheduleRuntimeTimezoneRules, assertScheduleTimezoneParity, scheduleCivilDay, resolveScheduleCivilTime } from "./civil-time";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  SCHEDULE_CHANGE_CAPABILITY_REVISION,
  ScheduleChangeResultSchema,
  type ScheduleChangeResult,
  type PrepareScheduleChangeInput,
} from "@/lib/agent-control-plane/contracts/schedule-change";
import { SCHEDULE_CHANGE_CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";
import { MCP_EXPOSURE_V16 } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";

interface RpcResponse {
  readonly data: unknown;
  readonly error: unknown;
}
interface RpcRequest extends PromiseLike<RpcResponse> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResponse>;
}
export interface ScheduleChangeRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): RpcRequest;
}

const TRUSTED_REPOSITORIES = new WeakSet<object>();

export class ScheduleChangeRepositoryError extends Error {
  readonly code: "CONFLICT" | "NO_CHANGE" | "POLICY" | "STALE" | "UNAVAILABLE";
  constructor(code: ScheduleChangeRepositoryError["code"], cause?: unknown) {
    super(
      code === "CONFLICT"
        ? "The idempotency key belongs to different input"
        : code === "NO_CHANGE"
          ? "The requested values already match this record"
          : code === "POLICY"
            ? "The schedule change policy is missing, conflicting, or invalid"
            : code === "STALE"
              ? "The update evidence or authority changed"
              : "The schedule change proposal is unavailable",
      { cause }
    );
    this.name = "ScheduleChangeRepositoryError";
    this.code = code;
  }
}

function normalizedError(error: unknown): ScheduleChangeRepositoryError {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  if (message === "AGENT_SCHEDULE_CHANGE_NO_CHANGE")
    return new ScheduleChangeRepositoryError("NO_CHANGE", error);
  if (message.startsWith("AGENT_SCHEDULE_CHANGE_IDEMPOTENCY_CONFLICT"))
    return new ScheduleChangeRepositoryError("CONFLICT", error);
  if (message.startsWith("AGENT_SCHEDULE_CHANGE_POLICY_"))
    return new ScheduleChangeRepositoryError("POLICY", error);
  if (
    message.startsWith("AGENT_SCHEDULE_CHANGE_SOURCE_") ||
    message.startsWith("AGENT_SCHEDULE_CHANGE_AUTHORITY_") ||
    message.startsWith("AGENT_SCHEDULE_CHANGE_GRANT_")
  )
    return new ScheduleChangeRepositoryError("STALE", error);
  return new ScheduleChangeRepositoryError("UNAVAILABLE", error);
}

function binding(actor: ActorContext) {
  if (
    actor.auth.channel !== "mcp" ||
    actor.capabilityManifestRevision !==
      SCHEDULE_CHANGE_CAPABILITY_MANIFEST_REVISION
  ) {
    throw new TypeError("Schedule changes require a v22 MCP actor");
  }
  return {
    p_actor_user_id: actor.actorUserId,
    p_company_id: actor.companyId,
    p_oauth_grant_id: actor.auth.oauthGrantId,
    p_oauth_client_id: actor.auth.oauthClientId,
    p_grant_revision: actor.auth.grantRevision,
    p_granted_scope_ceiling: [...actor.auth.scopeCeiling],
    p_permission_snapshot_revision: actor.permissionSnapshotRevision,
    p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
    p_capability_manifest_revision:
      SCHEDULE_CHANGE_CAPABILITY_MANIFEST_REVISION,
    p_exposure_revision: MCP_EXPOSURE_V16.revision,
    p_capability_id: "prepare_schedule_change",
    p_capability_revision: SCHEDULE_CHANGE_CAPABILITY_REVISION,
  } as const;
}

async function execute(request: RpcRequest, signal?: AbortSignal) {
  return signal && request.abortSignal
    ? await request.abortSignal(signal)
    : await request;
}

export interface ScheduleChangeRepository {
  prepare(input: {
    actorContext: ActorContext;
    request: PrepareScheduleChangeInput;
    observedAt: string;
    signal?: AbortSignal;
  }): Promise<ScheduleChangeResult>;
}

// Compare full PostgreSQL microseconds across equivalent ISO offset spellings.
export function scheduleInstantMicros(value: string): bigint {
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new TypeError("Invalid database timestamp");
  return BigInt(Date.parse(match[1] + match[3])) * BigInt(1000) + BigInt((match[2] ?? "").padEnd(6, "0"));
}
function matchesRequest(result: ScheduleChangeResult, request: PrepareScheduleChangeInput): boolean {
  const proposal = result.proposal;
  if (proposal.tasks.length !== request.tasks.length || proposal.reason !== request.reason || proposal.effects.tasks_updated !== request.tasks.length) return false;
  const seen = new Set<string>();
  return proposal.tasks.every(task => {
    const input = request.tasks.find(item => item.task_id === task.task_id);
    if (!input || seen.has(task.task_id)) return false;
    seen.add(task.task_id);
    const { before, after } = task;
    for (const snapshot of [before, after]) {
      if (snapshot.all_day) {
        const firstDay = new Date(snapshot.start_date).toISOString().slice(0, 10);
        const lastDay = new Date(snapshot.end_date).toISOString().slice(0, 10);
        if (resolveScheduleCivilTime(snapshot.local_start, proposal.timezone) !== scheduleCivilDay(firstDay, proposal.timezone).start ||
            resolveScheduleCivilTime(snapshot.local_end_exclusive, proposal.timezone) !== scheduleCivilDay(lastDay, proposal.timezone).end) return false;
      } else {
        assertScheduleTimezoneParity(snapshot.local_start, proposal.timezone, snapshot.start_date);
        assertScheduleTimezoneParity(snapshot.local_end_exclusive, proposal.timezone, snapshot.end_date);
      }
    }
    const civilSpan = (value: typeof before) => Date.parse(value.local_end_exclusive + "Z") - Date.parse(value.local_start + "Z");
    if (civilSpan(before) !== civilSpan(after) || before.local_start.slice(10) !== after.local_start.slice(10)) return false;
    return scheduleInstantMicros(before.updated_at) === scheduleInstantMicros(input.expected_updated_at)
      && before.schedule_version === input.expected_schedule_version
      && after.updated_at === before.updated_at
      && after.schedule_version === before.schedule_version + 1
      && after.local_start.slice(0, 10) === input.destination_date
      && after.all_day === before.all_day && after.duration === before.duration
      && after.start_time === before.start_time && after.end_time === before.end_time
      && after.schedule_confirmed_at === null && after.confirmed_schedule_version === null
      && JSON.stringify(after.team.map(member => member.id).sort()) === JSON.stringify([...input.team_member_ids].sort());
  });
}

export function createScheduleChangeRepository(input: {
  rpc: ScheduleChangeRpcClient["rpc"];
}): ScheduleChangeRepository {
  if (!input || typeof input.rpc !== "function")
    throw new TypeError("A schedule change RPC client is required");
  const repository: ScheduleChangeRepository = {
    async prepare(read) {
      try { assertScheduleRuntimeTimezoneRules(); }
      catch (cause) { throw new ScheduleChangeRepositoryError("POLICY", cause); }
      const inspection = await execute(input.rpc("inspect_agent_schedule_change_as_system", {
        ...binding(read.actorContext), p_request: read.request,
      }), read.signal);
      if (inspection.error) throw normalizedError(inspection.error);
      const proof = z.object({ timezone: z.string().min(1), probes: z.array(z.object({ local: z.string(), instant: z.iso.datetime({ offset: true }) }).strict()).min(1).max(200) }).strict().safeParse(inspection.data);
      if (!proof.success) throw new ScheduleChangeRepositoryError("UNAVAILABLE");
      try {
        for (const probe of proof.data.probes) assertScheduleTimezoneParity(probe.local, proof.data.timezone, probe.instant);
      } catch (cause) { throw new ScheduleChangeRepositoryError("POLICY", cause); }

      const response = await execute(
        input.rpc("prepare_agent_schedule_change_as_system", {
          ...binding(read.actorContext),
          p_request_id: read.actorContext.requestId,
          p_request: read.request,
          p_observed_at: read.observedAt,
          p_timezone_proof: proof.data,
        }),
        read.signal
      );
      if (response.error) throw normalizedError(response.error);
      const parsed = ScheduleChangeResultSchema.safeParse(response.data);
      let requestMatches = false;
      try { if (parsed.success) requestMatches = matchesRequest(parsed.data, read.request); }
      catch (cause) { throw new ScheduleChangeRepositoryError("UNAVAILABLE", cause); }
      if (
        !parsed.success ||
        parsed.data.request_id !== read.actorContext.requestId ||
        parsed.data.proposal.timezone !== proof.data.timezone ||
        !requestMatches
      ) {
        throw new ScheduleChangeRepositoryError("UNAVAILABLE");
      }
      return Object.freeze(parsed.data);
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedScheduleChangeRepository(
  value: unknown
): value is ScheduleChangeRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}

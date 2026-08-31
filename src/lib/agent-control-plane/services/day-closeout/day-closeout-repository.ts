import "server-only";

import { z } from "zod-v4";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { actorForbidden } from "@/lib/agent-control-plane/actor/errors";
import {
  DayCloseoutResultSchema,
  type DayCloseoutResult,
} from "@/lib/agent-control-plane/contracts/day-closeout";
import { IanaTimeZoneSchema } from "@/lib/agent-control-plane/contracts/common";
import { INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";

const INVISIBLE_OFFICE_EXPOSURE_REVISION =
  "2026-08-30.mcp-exposure.v3" as const;
const TRUSTED_REPOSITORIES = new WeakSet<object>();

interface DayCloseoutRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

interface DayCloseoutRpcRequest extends PromiseLike<DayCloseoutRpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<DayCloseoutRpcResult>;
}

export interface DayCloseoutRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): DayCloseoutRpcRequest;
}

const CoverageSchema = z
  .object({
    coverage_state: z.enum(["complete", "unavailable"]),
    total_count: z.number().int().safe().nonnegative(),
    readable_count: z.number().int().safe().nonnegative(),
    unreadable_count: z.number().int().safe().nonnegative(),
    fresh_at: z.iso.datetime({ offset: true }),
    normalization_revision: z.literal("ops.correspondence.normalized-text.v2"),
  })
  .strict()
  .refine(
    (value) =>
      value.total_count === value.readable_count + value.unreadable_count &&
      (value.coverage_state === "complete") === (value.unreadable_count === 0),
    "DAY_CLOSEOUT_CORRESPONDENCE_COVERAGE_INVALID"
  );

export type DayCloseoutCorrespondenceCoverage = z.infer<typeof CoverageSchema>;

const PersistedSchema = z
  .object({
    run_id: z.uuid(),
    action_id: z.uuid().nullable().optional(),
    change_set_id: z.uuid().nullable().optional(),
    result: DayCloseoutResultSchema,
    replayed: z.boolean(),
  })
  .strict();

function mcpBinding(actorContext: ActorContext) {
  if (
    actorContext.auth.channel !== "mcp" ||
    actorContext.capabilityManifestRevision !==
      INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION
  ) {
    throw new TypeError("Day closeout requires an invisible-office MCP actor");
  }
  return {
    p_actor_user_id: actorContext.actorUserId,
    p_company_id: actorContext.companyId,
    p_oauth_grant_id: actorContext.auth.oauthGrantId,
    p_oauth_client_id: actorContext.auth.oauthClientId,
    p_grant_revision: actorContext.auth.grantRevision,
    p_granted_scope_ceiling: [...actorContext.auth.scopeCeiling],
    p_permission_snapshot_revision: actorContext.permissionSnapshotRevision,
    p_exposure_revision: INVISIBLE_OFFICE_EXPOSURE_REVISION,
  } as const;
}

async function call(
  client: DayCloseoutRpcClient,
  functionName: string,
  args: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
  authorityRequestId?: string
): Promise<unknown> {
  const request = client.rpc(functionName, args);
  const response =
    signal && request.abortSignal
      ? await request.abortSignal(signal)
      : await request;
  if (response.error) {
    const error =
      typeof response.error === "object" && response.error !== null
        ? (response.error as Record<string, unknown>)
        : null;
    const code = typeof error?.code === "string" ? error.code : "";
    const message = typeof error?.message === "string" ? error.message : "";
    if (
      authorityRequestId &&
      (code === "42501" ||
        message.startsWith("AGENT_DAY_CLOSEOUT_AUTHORITY") ||
        message.startsWith("AGENT_DAY_CLOSEOUT_GRANT") ||
        message.startsWith("AGENT_DAY_CLOSEOUT_ROUTINE_AUTHORITY"))
    ) {
      throw actorForbidden(
        authorityRequestId,
        "day_closeout_routine_authority_stale"
      );
    }
    throw new Error("Day closeout storage is unavailable");
  }
  return response.data;
}

export interface DayCloseoutRepository {
  resolveTimezone(
    actorContext: ActorContext,
    signal?: AbortSignal
  ): Promise<string>;
  inspectCorrespondence(input: {
    actorContext: ActorContext;
    startAt: string;
    endAt: string;
    signal?: AbortSignal;
  }): Promise<DayCloseoutCorrespondenceCoverage>;
  persist(input: {
    actorContext: ActorContext;
    businessDate: string;
    timezone: string;
    idempotencyKey: string;
    inputHash: string;
    resultBase: Readonly<Record<string, unknown>>;
    signal?: AbortSignal;
  }): Promise<Readonly<{ result: DayCloseoutResult; replayed: boolean }>>;
  persistRoutine(input: {
    actorContext: ActorContext;
    businessDate: string;
    timezone: string;
    idempotencyKey: string;
    inputHash: string;
    resultBase: Readonly<Record<string, unknown>>;
    routineId: string;
    claimToken: string;
    scheduledFor: string;
    scheduleRevision: number;
    signal?: AbortSignal;
  }): Promise<Readonly<{ result: DayCloseoutResult; replayed: boolean }>>;
}

export function createDayCloseoutRepository(
  client: DayCloseoutRpcClient
): DayCloseoutRepository {
  if (!client || typeof client.rpc !== "function") {
    throw new TypeError("A day-closeout RPC client is required");
  }
  const repository: DayCloseoutRepository = {
    async resolveTimezone(actorContext, signal) {
      return IanaTimeZoneSchema.parse(
        await call(
          client,
          "resolve_agent_day_closeout_timezone_as_system",
          mcpBinding(actorContext),
          signal
        )
      );
    },
    async inspectCorrespondence(input) {
      return CoverageSchema.parse(
        await call(
          client,
          "inspect_agent_day_closeout_correspondence_as_system",
          {
            ...mcpBinding(input.actorContext),
            p_start_at: input.startAt,
            p_end_at: input.endAt,
          },
          input.signal
        )
      );
    },
    async persist(input) {
      const parsed = PersistedSchema.parse(
        await call(
          client,
          "persist_agent_day_closeout_as_system",
          {
            ...mcpBinding(input.actorContext),
            p_capability_manifest_revision:
              INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION,
            p_business_date: input.businessDate,
            p_timezone: input.timezone,
            p_idempotency_key: input.idempotencyKey,
            p_input_hash: input.inputHash,
            p_result_base: input.resultBase,
          },
          input.signal
        )
      );
      return Object.freeze({
        result: parsed.result,
        replayed: parsed.replayed,
      });
    },
    async persistRoutine(input) {
      const parsed = PersistedSchema.parse(
        await call(
          client,
          "persist_agent_day_closeout_routine_as_system",
          {
            ...mcpBinding(input.actorContext),
            p_capability_manifest_revision:
              INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION,
            p_business_date: input.businessDate,
            p_timezone: input.timezone,
            p_idempotency_key: input.idempotencyKey,
            p_input_hash: input.inputHash,
            p_result_base: input.resultBase,
            p_routine_id: input.routineId,
            p_claim_token: input.claimToken,
            p_scheduled_for: input.scheduledFor,
            p_schedule_revision: input.scheduleRevision,
          },
          input.signal,
          input.actorContext.requestId
        )
      );
      return Object.freeze({
        result: parsed.result,
        replayed: parsed.replayed,
      });
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedDayCloseoutRepository(
  value: unknown
): value is DayCloseoutRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}

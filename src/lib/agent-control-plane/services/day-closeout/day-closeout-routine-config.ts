import "server-only";

import { z } from "zod-v4";

import { IanaTimeZoneSchema } from "@/lib/agent-control-plane/contracts/common";
import { PostgresUuidSchema } from "@/lib/agent-control-plane/contracts/postgres-uuid";

const LocalTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const NullableTimestampSchema = z.iso.datetime({ offset: true }).nullable();

const RoutineConfigRowSchema = z
  .object({
    grant_id: PostgresUuidSchema,
    client_id: PostgresUuidSchema,
    client_name: z.string().trim().min(1).max(256),
    enabled: z.boolean(),
    local_time: LocalTimeSchema,
    timezone: IanaTimeZoneSchema,
    next_run_at: NullableTimestampSchema,
    last_run_at: NullableTimestampSchema,
    last_success_at: NullableTimestampSchema,
    last_failure_code: z.string().trim().min(1).max(128).nullable(),
    schedule_revision: z.number().int().safe().nonnegative(),
  })
  .strict();

export interface DayCloseoutRoutineConfigRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
}

export interface DayCloseoutRoutineConfig {
  readonly grantId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly enabled: boolean;
  readonly localTime: string;
  readonly timezone: string;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastFailureCode: string | null;
  readonly scheduleRevision: number;
}

export class DayCloseoutRoutineConfigStoreError extends Error {
  readonly kind: "forbidden" | "unavailable";

  constructor(kind: "forbidden" | "unavailable") {
    super("Day-closeout routine configuration is unavailable");
    this.name = "DayCloseoutRoutineConfigStoreError";
    this.kind = kind;
  }
}

function isForbidden(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as Readonly<Record<string, unknown>>;
  return record.code === "42501";
}

async function call(
  client: DayCloseoutRoutineConfigRpcClient,
  functionName: string,
  args: Readonly<Record<string, unknown>>
): Promise<unknown> {
  let result: { readonly data: unknown; readonly error: unknown };
  try {
    result = await client.rpc(functionName, args);
  } catch {
    throw new DayCloseoutRoutineConfigStoreError("unavailable");
  }
  if (result.error != null) {
    throw new DayCloseoutRoutineConfigStoreError(
      isForbidden(result.error) ? "forbidden" : "unavailable"
    );
  }
  return result.data;
}

function mapRow(value: unknown): DayCloseoutRoutineConfig {
  const parsed = RoutineConfigRowSchema.safeParse(value);
  if (!parsed.success) {
    throw new DayCloseoutRoutineConfigStoreError("unavailable");
  }
  const row = parsed.data;
  return Object.freeze({
    grantId: row.grant_id,
    clientId: row.client_id,
    clientName: row.client_name,
    enabled: row.enabled,
    localTime: row.local_time,
    timezone: row.timezone,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastSuccessAt: row.last_success_at,
    lastFailureCode: row.last_failure_code,
    scheduleRevision: row.schedule_revision,
  });
}

export async function listDayCloseoutRoutineConfigs(
  client: DayCloseoutRoutineConfigRpcClient,
  input: { readonly actorUserId: string; readonly companyId: string }
): Promise<readonly DayCloseoutRoutineConfig[]> {
  const data = await call(
    client,
    "list_agent_day_closeout_routine_configs_as_system",
    {
      p_actor_user_id: input.actorUserId,
      p_company_id: input.companyId,
    }
  );
  if (data == null) return Object.freeze([]);
  if (!Array.isArray(data)) {
    throw new DayCloseoutRoutineConfigStoreError("unavailable");
  }
  return Object.freeze(data.map(mapRow));
}

export async function upsertDayCloseoutRoutineConfig(
  client: DayCloseoutRoutineConfigRpcClient,
  input: {
    readonly actorUserId: string;
    readonly companyId: string;
    readonly grantId: string;
    readonly enabled: boolean;
    readonly localTime: string;
  }
): Promise<DayCloseoutRoutineConfig> {
  const data = await call(
    client,
    "upsert_agent_day_closeout_routine_config_as_system",
    {
      p_actor_user_id: input.actorUserId,
      p_company_id: input.companyId,
      p_oauth_grant_id: input.grantId,
      p_enabled: input.enabled,
      p_local_time: input.localTime,
    }
  );
  if (!Array.isArray(data) || data.length !== 1) {
    throw new DayCloseoutRoutineConfigStoreError("unavailable");
  }
  return mapRow(data[0]);
}

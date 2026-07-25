import "server-only";

import {
  CronDatabaseOperationError,
  type CronWorkloadLease,
} from "./cron-workload-control-service";

interface CursorRpcResult {
  data: unknown;
  error: unknown;
}

export interface CronWorkloadCursorClient {
  rpc(
    functionName: string,
    args: Record<string, unknown>
  ): PromiseLike<CursorRpcResult>;
}

export async function readCronWorkloadCursor(
  supabase: CronWorkloadCursorClient,
  workloadKey: string,
  lease: CronWorkloadLease
): Promise<string | null> {
  let result: CursorRpcResult;
  try {
    result = await supabase.rpc(
      "read_cron_workload_cursor_as_system",
      {
        p_workload_key: workloadKey,
        p_owner_token: lease.ownerToken,
        p_fence_token: lease.fenceToken,
        p_global_fence_token: lease.globalFenceToken,
      }
    );
  } catch (cause) {
    throw new CronDatabaseOperationError(
      `cron workload cursor read was unreachable for ${workloadKey}`,
      { cause }
    );
  }
  const { data, error } = result;
  if (error) {
    throw new CronDatabaseOperationError(
      `cron workload cursor read failed for ${workloadKey}`,
      { cause: error }
    );
  }
  if (data !== null && (typeof data !== "string" || data.length > 512)) {
    throw new CronDatabaseOperationError(
      `cron workload cursor read returned invalid data for ${workloadKey}`,
      { cause: new Error("invalid cursor read result") }
    );
  }
  return data;
}

export async function advanceCronWorkloadCursor(
  supabase: CronWorkloadCursorClient,
  workloadKey: string,
  lease: CronWorkloadLease,
  expectedCursor: string | null,
  nextCursor: string | null
): Promise<void> {
  let result: CursorRpcResult;
  try {
    result = await supabase.rpc(
      "advance_cron_workload_cursor_as_system",
      {
        p_workload_key: workloadKey,
        p_owner_token: lease.ownerToken,
        p_fence_token: lease.fenceToken,
        p_global_fence_token: lease.globalFenceToken,
        p_expected_cursor: expectedCursor,
        p_next_cursor: nextCursor,
      }
    );
  } catch (cause) {
    throw new CronDatabaseOperationError(
      `cron workload cursor advance was unreachable for ${workloadKey}`,
      { cause }
    );
  }
  const { data, error } = result;
  if (error) {
    throw new CronDatabaseOperationError(
      `cron workload cursor advance failed for ${workloadKey}`,
      { cause: error }
    );
  }
  if (data !== true) {
    throw new CronDatabaseOperationError(
      `cron workload cursor advance lost its compare-and-swap for ${workloadKey}`,
      { cause: new Error("cursor compare-and-swap failed") }
    );
  }
}

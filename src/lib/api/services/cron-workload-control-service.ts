import "server-only";

import { randomUUID } from "node:crypto";

import {
  CronDatabaseOperationError,
  isDatabasePressureError,
} from "./cron-workload-error-contract";

export {
  CronDatabaseOperationError,
  isDatabasePressureError,
} from "./cron-workload-error-contract";

const ACQUISITION_MAX_ATTEMPTS = 2;
const ACQUISITION_BASE_DELAY_MS = 250;
const DEFAULT_CIRCUIT_OPEN_SECONDS = 300;
const SERVERLESS_MAX_RUNTIME_SECONDS = 300;
const LEASE_CRASH_SAFETY_SECONDS = 60;
const MIN_SERVERLESS_LEASE_SECONDS =
  SERVERLESS_MAX_RUNTIME_SECONDS + LEASE_CRASH_SAFETY_SECONDS;
const LEASE_RENEWAL_MAX_INTERVAL_SECONDS = 60;

type RpcError = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
  status?: number;
  statusCode?: number;
};

type RpcResult = {
  data: unknown;
  error: RpcError | null;
};

export interface CronWorkloadControlClient {
  rpc(
    functionName: string,
    args: Record<string, unknown>
  ): PromiseLike<RpcResult>;
}

export interface CronWorkloadLease {
  ownerToken: string;
  fenceToken: number;
  globalFenceToken: number;
  expiresAt: string;
  signal: AbortSignal;
}

export type CronWorkloadControlResult<T> =
  | { status: "completed"; value: T }
  | {
      status: "skipped";
      reason: "lease_held" | "circuit_open";
    }
  | {
      status: "skipped";
      reason: "control_unavailable";
      error: unknown;
    };

export class CronWorkloadControlCompletionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CronWorkloadControlCompletionError";
  }
}

export class CronWorkloadLeaseLostError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CronWorkloadLeaseLostError";
  }
}

export interface RunWithCronWorkloadControlOptions<T> {
  supabase: CronWorkloadControlClient;
  workloadKey: string;
  leaseSeconds: number;
  circuitOpenSeconds?: number;
  work: (lease: CronWorkloadLease) => Promise<T>;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  ownerToken?: string;
}

type Acquisition =
  | { acquired: true; lease: CronWorkloadLease }
  | { acquired: false; reason: "lease_held" | "circuit_open" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(
  value: Record<string, unknown>,
  key: string
): string | null {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : null;
}

function readPositiveSafeInteger(
  value: Record<string, unknown>,
  key: string
): number | null {
  const candidate = value[key];
  return typeof candidate === "number" &&
    Number.isSafeInteger(candidate) &&
    candidate > 0
    ? candidate
    : null;
}

function parseAcquisition(
  data: unknown,
  ownerToken: string,
  signal: AbortSignal
): Acquisition {
  if (!isRecord(data) || typeof data.acquired !== "boolean") {
    throw new Error("cron workload acquisition returned an invalid result");
  }

  if (!data.acquired) {
    if (data.reason === "lease_held" || data.reason === "circuit_open") {
      return { acquired: false, reason: data.reason };
    }
    throw new Error(
      "cron workload acquisition returned an invalid skip reason"
    );
  }

  const returnedOwner = readString(data, "owner_token");
  const fenceToken = readPositiveSafeInteger(data, "fence_token");
  const globalFenceToken = readPositiveSafeInteger(data, "global_fence_token");
  const expiresAt = readString(data, "expires_at");

  if (
    returnedOwner !== ownerToken ||
    fenceToken === null ||
    globalFenceToken === null ||
    expiresAt === null ||
    Number.isNaN(Date.parse(expiresAt))
  ) {
    throw new Error("cron workload acquisition returned an invalid lease");
  }

  return {
    acquired: true,
    lease: {
      ownerToken,
      fenceToken,
      globalFenceToken,
      expiresAt,
      signal,
    },
  };
}

function boundedJitterDelay(random: () => number): number {
  const sample = Math.max(0, Math.min(1, random()));
  return Math.round(ACQUISITION_BASE_DELAY_MS * (0.5 + sample * 0.5));
}

async function acquireWithOneRetry({
  supabase,
  workloadKey,
  ownerToken,
  leaseSeconds,
  signal,
  sleep,
  random,
}: {
  supabase: CronWorkloadControlClient;
  workloadKey: string;
  ownerToken: string;
  leaseSeconds: number;
  signal: AbortSignal;
  sleep: (milliseconds: number) => Promise<void>;
  random: () => number;
}): Promise<Acquisition | { acquired: false; error: unknown }> {
  let lastError: unknown = new Error(
    "cron workload acquisition did not execute"
  );

  for (let attempt = 1; attempt <= ACQUISITION_MAX_ATTEMPTS; attempt += 1) {
    try {
      const { data, error } = await supabase.rpc(
        "acquire_cron_workload_lease_as_system",
        {
          p_workload_key: workloadKey,
          p_owner_token: ownerToken,
          p_lease_seconds: leaseSeconds,
        }
      );

      if (error) {
        lastError = error;
      } else {
        return parseAcquisition(data, ownerToken, signal);
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < ACQUISITION_MAX_ATTEMPTS) {
      await sleep(boundedJitterDelay(random));
    }
  }

  return { acquired: false, error: lastError };
}

async function renewLease({
  supabase,
  workloadKey,
  lease,
  leaseSeconds,
}: {
  supabase: CronWorkloadControlClient;
  workloadKey: string;
  lease: CronWorkloadLease;
  leaseSeconds: number;
}): Promise<string> {
  let result: RpcResult;
  try {
    result = await supabase.rpc("renew_cron_workload_lease_as_system", {
      p_workload_key: workloadKey,
      p_owner_token: lease.ownerToken,
      p_fence_token: lease.fenceToken,
      p_global_fence_token: lease.globalFenceToken,
      p_lease_seconds: leaseSeconds,
    });
  } catch (cause) {
    throw new CronDatabaseOperationError(
      "cron workload lease renewal RPC was unreachable",
      { cause }
    );
  }

  if (result.error) {
    throw new CronDatabaseOperationError(
      `cron workload lease renewal failed: ${
        result.error.message ?? "unknown error"
      }`,
      { cause: result.error }
    );
  }
  if (!isRecord(result.data) || result.data.renewed !== true) {
    throw new CronWorkloadLeaseLostError(
      "cron workload lease renewal lost its fence"
    );
  }

  const expiresAt = readString(result.data, "expires_at");
  if (expiresAt === null || Number.isNaN(Date.parse(expiresAt))) {
    throw new CronWorkloadLeaseLostError(
      "cron workload lease renewal returned an invalid expiry"
    );
  }
  return expiresAt;
}

function startLeaseWatchdog({
  supabase,
  workloadKey,
  lease,
  leaseSeconds,
  controller,
}: {
  supabase: CronWorkloadControlClient;
  workloadKey: string;
  lease: CronWorkloadLease;
  leaseSeconds: number;
  controller: AbortController;
}): {
  stop: () => Promise<unknown | null>;
} {
  const intervalMilliseconds =
    Math.min(
      LEASE_RENEWAL_MAX_INTERVAL_SECONDS,
      Math.max(15, Math.floor(leaseSeconds / 3))
    ) * 1000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let failure: unknown | null = null;

  const schedule = () => {
    if (stopped || failure) return;
    timer = setTimeout(() => {
      inFlight = renewLease({
        supabase,
        workloadKey,
        lease,
        leaseSeconds,
      })
        .then((expiresAt) => {
          lease.expiresAt = expiresAt;
        })
        .catch((error) => {
          failure = error;
          controller.abort(error);
        })
        .finally(() => {
          inFlight = null;
          schedule();
        });
    }, intervalMilliseconds);
    timer.unref?.();
  };

  schedule();

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (inFlight) await inFlight;
      return failure;
    },
  };
}

async function completeLease({
  supabase,
  workloadKey,
  lease,
  succeeded,
  databasePressure,
  circuitOpenSeconds,
}: {
  supabase: CronWorkloadControlClient;
  workloadKey: string;
  lease: CronWorkloadLease;
  succeeded: boolean;
  databasePressure: boolean;
  circuitOpenSeconds: number;
}): Promise<void> {
  let result: RpcResult;
  try {
    result = await supabase.rpc("complete_cron_workload_lease_as_system", {
      p_workload_key: workloadKey,
      p_owner_token: lease.ownerToken,
      p_fence_token: lease.fenceToken,
      p_global_fence_token: lease.globalFenceToken,
      p_succeeded: succeeded,
      p_database_pressure: databasePressure,
      p_circuit_open_seconds: circuitOpenSeconds,
    });
  } catch (cause) {
    throw new CronWorkloadControlCompletionError(
      "cron workload completion RPC was unreachable",
      { cause }
    );
  }

  if (result.error) {
    throw new CronWorkloadControlCompletionError(
      `cron workload completion failed: ${
        result.error.message ?? "unknown error"
      }`,
      { cause: result.error }
    );
  }
  if (result.data !== true) {
    throw new CronWorkloadControlCompletionError(
      "cron workload completion lost its lease fence"
    );
  }
}

export async function runWithCronWorkloadControl<T>({
  supabase,
  workloadKey,
  leaseSeconds,
  circuitOpenSeconds = DEFAULT_CIRCUIT_OPEN_SECONDS,
  work,
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  random = Math.random,
  ownerToken = randomUUID(),
}: RunWithCronWorkloadControlOptions<T>): Promise<
  CronWorkloadControlResult<T>
> {
  const effectiveLeaseSeconds = Math.max(
    leaseSeconds,
    MIN_SERVERLESS_LEASE_SECONDS
  );
  const leaseController = new AbortController();
  const acquisition = await acquireWithOneRetry({
    supabase,
    workloadKey,
    ownerToken,
    leaseSeconds: effectiveLeaseSeconds,
    signal: leaseController.signal,
    sleep,
    random,
  });

  if (!acquisition.acquired) {
    if ("error" in acquisition) {
      return {
        status: "skipped",
        reason: "control_unavailable",
        error: acquisition.error,
      };
    }
    return {
      status: "skipped",
      reason: acquisition.reason,
    };
  }

  const watchdog = startLeaseWatchdog({
    supabase,
    workloadKey,
    lease: acquisition.lease,
    leaseSeconds: effectiveLeaseSeconds,
    controller: leaseController,
  });

  try {
    const value = await work(acquisition.lease);
    const watchdogFailure = await watchdog.stop();
    if (watchdogFailure) throw watchdogFailure;
    await completeLease({
      supabase,
      workloadKey,
      lease: acquisition.lease,
      succeeded: true,
      databasePressure: false,
      circuitOpenSeconds,
    });
    return { status: "completed", value };
  } catch (error) {
    if (error instanceof CronWorkloadControlCompletionError) {
      throw error;
    }

    await watchdog.stop();
    try {
      await completeLease({
        supabase,
        workloadKey,
        lease: acquisition.lease,
        succeeded: false,
        databasePressure: isDatabasePressureError(error),
        circuitOpenSeconds,
      });
    } catch (completionError) {
      console.error(
        "[cron-workload-control] failed to persist workload failure:",
        completionError
      );
    }
    throw error;
  }
}

import "server-only";

import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod-v4";

import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import { IanaTimeZoneSchema } from "@/lib/agent-control-plane/contracts/common";
import {
  DayCloseoutRoutineAuthorityError,
  isTrustedDayCloseoutRoutineActorResolver,
  type DayCloseoutRoutineActorResolver,
} from "@/lib/agent-control-plane/mcp/actor-reauthorization";
import { INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";
import type { DayCloseoutService } from "./day-closeout-service";

const CLAIM_LIMIT_MAXIMUM = 25;
const LEASE_SECONDS_MINIMUM = 60;
const LEASE_SECONDS_MAXIMUM = 900;
const MAX_EXECUTION_ATTEMPTS = 3;
const MINIMUM_OCCURRENCE_WORK_MS = 30_000;
const FINALIZATION_RESERVE_MS = 30_000;
const MINIMUM_EXECUTION_BUDGET_MS =
  MINIMUM_OCCURRENCE_WORK_MS + FINALIZATION_RESERVE_MS;
const MAXIMUM_EXECUTION_BUDGET_MS = 290_000;
const TRUSTED_REPOSITORIES = new WeakSet<object>();
const TRUSTED_SERVICES = new WeakSet<object>();

const ClaimSchema = z
  .object({
    routine_id: z.uuid(),
    company_id: z.uuid(),
    actor_user_id: z.uuid(),
    oauth_grant_id: z.uuid(),
    oauth_client_id: z.uuid(),
    grant_revision: z.string().min(1).max(256),
    granted_scope_ceiling: z.array(z.string().min(1).max(128)).max(64),
    permission_snapshot_revision: z.string().min(1).max(256),
    capability_manifest_revision: z.literal(
      INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION
    ),
    exposure_revision: z.literal("2026-08-30.mcp-exposure.v3"),
    local_time: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
    timezone: IanaTimeZoneSchema,
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    scheduled_for: z.iso.datetime({ offset: true }),
    schedule_revision: z.number().int().safe().nonnegative(),
    claim_token: z.uuid(),
    claim_expires_at: z.iso.datetime({ offset: true }),
    attempt_number: z.number().int().safe().positive(),
  })
  .strict();

const ClaimListSchema = z.array(ClaimSchema).max(CLAIM_LIMIT_MAXIMUM);
const FinalizationSchema = z
  .object({
    routine_id: z.uuid(),
    outcome: z.enum(["clear", "attention", "partial", "blocked", "failed"]),
    run_id: z.uuid().nullable(),
    failure_id: z.uuid().nullable(),
    retry_scheduled: z.boolean(),
  })
  .strict();

type Claim = z.infer<typeof ClaimSchema>;
type RoutineOutcome = z.infer<typeof FinalizationSchema>["outcome"];

interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

interface RpcRequest extends PromiseLike<RpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResult>;
}

export interface DayCloseoutRoutineRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): RpcRequest;
}

interface FinalizeInput {
  readonly claim: Claim;
  readonly idempotencyKey: string;
  readonly outcome: RoutineOutcome;
  readonly runId: string | null;
  readonly failureCode: string | null;
  readonly signal?: AbortSignal;
}

export interface DayCloseoutRoutineRepository {
  claimDue(input: {
    limit: number;
    leaseSeconds: number;
    signal?: AbortSignal;
  }): Promise<readonly Claim[]>;
  finalize(input: FinalizeInput): Promise<{
    outcome: RoutineOutcome;
    retryScheduled: boolean;
  }>;
}

async function call(
  client: DayCloseoutRoutineRpcClient,
  functionName: string,
  args: Readonly<Record<string, unknown>>,
  signal?: AbortSignal
): Promise<unknown> {
  const request = client.rpc(functionName, args);
  const response =
    signal && request.abortSignal
      ? await request.abortSignal(signal)
      : await request;
  if (response.error) {
    throw new Error("Day-closeout routine storage is unavailable");
  }
  return response.data;
}

export function createDayCloseoutRoutineRepository(
  client: DayCloseoutRoutineRpcClient
): DayCloseoutRoutineRepository {
  if (!client || typeof client.rpc !== "function") {
    throw new TypeError("A day-closeout routine RPC client is required");
  }
  const repository: DayCloseoutRoutineRepository = {
    async claimDue(input) {
      if (
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > CLAIM_LIMIT_MAXIMUM ||
        !Number.isSafeInteger(input.leaseSeconds) ||
        input.leaseSeconds < LEASE_SECONDS_MINIMUM ||
        input.leaseSeconds > LEASE_SECONDS_MAXIMUM
      ) {
        throw new TypeError("Day-closeout routine claim bounds are invalid");
      }
      return Object.freeze(
        ClaimListSchema.parse(
          await call(
            client,
            "claim_agent_day_closeout_routines_as_system",
            {
              p_limit: input.limit,
              p_lease_seconds: input.leaseSeconds,
            },
            input.signal
          )
        )
      );
    },
    async finalize(input) {
      const parsed = FinalizationSchema.parse(
        await call(
          client,
          "finalize_agent_day_closeout_routine_as_system",
          {
            p_routine_id: input.claim.routine_id,
            p_claim_token: input.claim.claim_token,
            p_scheduled_for: input.claim.scheduled_for,
            p_idempotency_key: input.idempotencyKey,
            p_outcome: input.outcome,
            p_run_id: input.runId,
            p_failure_code: input.failureCode,
          },
          input.signal
        )
      );
      return Object.freeze({
        outcome: parsed.outcome,
        retryScheduled: parsed.retry_scheduled,
      });
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export interface DayCloseoutRoutineRunSummary {
  readonly claimed: number;
  readonly prepared: number;
  readonly partial: number;
  readonly blocked: number;
  readonly failed: number;
  readonly retryScheduled: number;
}

export interface DayCloseoutRoutineService {
  runDue(input: {
    limit: number;
    leaseSeconds: number;
    executionBudgetMs: number;
    signal?: AbortSignal;
  }): Promise<DayCloseoutRoutineRunSummary>;
}

function idempotencyKey(claim: Claim): string {
  return `routine:${claim.routine_id}:${claim.schedule_revision}:${new Date(
    claim.scheduled_for
  ).toISOString()}`;
}

function isAuthorityFailure(error: unknown): boolean {
  return (
    error instanceof DayCloseoutRoutineAuthorityError ||
    (error instanceof ActorAccessError && !error.retryable)
  );
}

function combineWithDeadline(
  deadlineAt: number,
  outerSignal: AbortSignal | undefined,
  now: () => number,
  timeoutSignal: (milliseconds: number) => AbortSignal
): { readonly signal: AbortSignal; readonly timeout: AbortSignal } {
  const timeout = timeoutSignal(Math.max(1, Math.ceil(deadlineAt - now())));
  return Object.freeze({
    signal: outerSignal ? AbortSignal.any([outerSignal, timeout]) : timeout,
    timeout,
  });
}

export function createDayCloseoutRoutineService(input: {
  repository: DayCloseoutRoutineRepository;
  dayCloseoutService: Pick<DayCloseoutService, "prepareDayCloseout">;
  actorResolver: DayCloseoutRoutineActorResolver;
  now?: () => number;
  timeoutSignal?: (milliseconds: number) => AbortSignal;
}): DayCloseoutRoutineService {
  if (!TRUSTED_REPOSITORIES.has(input?.repository as object)) {
    throw new TypeError(
      "A trusted day-closeout routine repository is required"
    );
  }
  if (
    !input.dayCloseoutService ||
    typeof input.dayCloseoutService.prepareDayCloseout !== "function" ||
    !isTrustedDayCloseoutRoutineActorResolver(input.actorResolver) ||
    (input.now !== undefined && typeof input.now !== "function") ||
    (input.timeoutSignal !== undefined &&
      typeof input.timeoutSignal !== "function")
  ) {
    throw new TypeError("Day-closeout routine dependencies are required");
  }
  const now = input.now ?? Date.now;
  const timeoutSignal =
    input.timeoutSignal ??
    ((milliseconds: number) => AbortSignal.timeout(milliseconds));

  const service: DayCloseoutRoutineService = {
    async runDue(runInput) {
      if (
        !Number.isSafeInteger(runInput.limit) ||
        runInput.limit < 1 ||
        runInput.limit > CLAIM_LIMIT_MAXIMUM ||
        !Number.isSafeInteger(runInput.leaseSeconds) ||
        runInput.leaseSeconds < LEASE_SECONDS_MINIMUM ||
        runInput.leaseSeconds > LEASE_SECONDS_MAXIMUM ||
        !Number.isSafeInteger(runInput.executionBudgetMs) ||
        runInput.executionBudgetMs < MINIMUM_EXECUTION_BUDGET_MS ||
        runInput.executionBudgetMs > MAXIMUM_EXECUTION_BUDGET_MS
      ) {
        throw new TypeError(
          "Day-closeout routine execution bounds are invalid"
        );
      }
      const deadline = now() + runInput.executionBudgetMs;
      const summary = {
        claimed: 0,
        prepared: 0,
        partial: 0,
        blocked: 0,
        failed: 0,
        retryScheduled: 0,
      };

      const recordFinalization = (finalized: {
        outcome: RoutineOutcome;
        retryScheduled: boolean;
      }) => {
        if (
          finalized.outcome === "clear" ||
          finalized.outcome === "attention"
        ) {
          summary.prepared += 1;
        } else if (finalized.outcome === "partial") {
          summary.prepared += 1;
          summary.partial += 1;
        } else if (finalized.outcome === "blocked") {
          summary.blocked += 1;
        } else if (finalized.retryScheduled) {
          summary.retryScheduled += 1;
        } else {
          summary.failed += 1;
        }
      };

      for (let occurrence = 0; occurrence < runInput.limit; occurrence += 1) {
        if (now() + MINIMUM_EXECUTION_BUDGET_MS > deadline) {
          break;
        }
        const workDeadline = deadline - FINALIZATION_RESERVE_MS;
        const workBoundary = combineWithDeadline(
          workDeadline,
          runInput.signal,
          now,
          timeoutSignal
        );
        const claims = await input.repository.claimDue({
          limit: 1,
          leaseSeconds: runInput.leaseSeconds,
          signal: workBoundary.signal,
        });
        if (claims.length === 0) break;
        const claim = claims[0]!;
        summary.claimed += 1;
        const key = idempotencyKey(claim);
        const finalize = (finalizeInput: Omit<FinalizeInput, "signal">) => {
          const finalizationBoundary = combineWithDeadline(
            deadline,
            runInput.signal,
            now,
            timeoutSignal
          );
          return input.repository.finalize({
            ...finalizeInput,
            signal: finalizationBoundary.signal,
          });
        };
        if (claim.attempt_number > MAX_EXECUTION_ATTEMPTS) {
          recordFinalization(
            await finalize({
              claim,
              idempotencyKey: key,
              outcome: "failed",
              runId: null,
              failureCode: "CLAIM_ATTEMPTS_EXHAUSTED",
            })
          );
          continue;
        }

        let result: Awaited<
          ReturnType<DayCloseoutService["prepareDayCloseout"]>
        >;
        try {
          const actorContext = await input.actorResolver.resolve(
            {
              routineId: claim.routine_id,
              claimToken: claim.claim_token,
              scheduledFor: claim.scheduled_for,
              idempotencyKey: key,
            },
            workBoundary.signal
          );
          result = await input.dayCloseoutService.prepareDayCloseout(
            actorContext,
            {
              business_date: formatInTimeZone(
                new Date(claim.scheduled_for),
                claim.timezone,
                "yyyy-MM-dd"
              ),
              display_timezone: claim.timezone,
              idempotency_key: key,
            },
            {
              signal: workBoundary.signal,
              routine: {
                routineId: claim.routine_id,
                claimToken: claim.claim_token,
                scheduledFor: claim.scheduled_for,
                scheduleRevision: claim.schedule_revision,
              },
            }
          );
        } catch (error) {
          const blocked = isAuthorityFailure(error);
          const budgetExpired = !blocked && workBoundary.timeout.aborted;
          recordFinalization(
            await finalize({
              claim,
              idempotencyKey: key,
              outcome: blocked ? "blocked" : "failed",
              runId: null,
              failureCode: blocked
                ? "AUTHORITY_BLOCKED"
                : budgetExpired
                  ? "ROUTINE_EXECUTION_BUDGET_EXPIRED"
                  : "ROUTINE_EXECUTION_FAILED",
            })
          );
          continue;
        }

        recordFinalization(
          await finalize({
            claim,
            idempotencyKey: key,
            outcome: result.state,
            runId: result.run_id,
            failureCode:
              result.state === "partial" ? "SOURCE_COVERAGE_PARTIAL" : null,
          })
        );
      }
      return Object.freeze(summary);
    },
  };
  TRUSTED_SERVICES.add(service);
  return Object.freeze(service);
}

export function isTrustedDayCloseoutRoutineService(
  value: unknown
): value is DayCloseoutRoutineService {
  return (
    typeof value === "object" && value !== null && TRUSTED_SERVICES.has(value)
  );
}

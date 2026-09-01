import { describe, expect, it, vi } from "vitest";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { StubAuthoritySupabaseRpcClient } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { actorForbidden } from "@/lib/agent-control-plane/actor/errors";
import { createDayCloseoutRoutineActorResolver } from "@/lib/agent-control-plane/mcp/actor-reauthorization";
import {
  DAY_CLOSEOUT_PROMPT_SAFETY_DIRECTIVE,
  type DayCloseoutResult,
} from "@/lib/agent-control-plane/contracts/day-closeout";
import type { DayCloseoutService } from "../day-closeout-service";
import {
  createDayCloseoutRoutineRepository,
  createDayCloseoutRoutineService,
  type DayCloseoutRoutineRpcClient,
} from "../day-closeout-routine-service";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const GRANT_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const ROUTINE_ID = "55555555-5555-4555-8555-555555555555";
const CLAIM_TOKEN = "66666666-6666-4666-8666-666666666666";
const RUN_ID = "77777777-7777-4777-8777-777777777777";
const SCHEDULED_FOR = "2026-08-31T03:00:00.000Z";
const IDEMPOTENCY_KEY =
  "routine:55555555-5555-4555-8555-555555555555:12:2026-08-31T03:00:00.000Z";
const SCOPES = [
  "ops.correspondence.read",
  "ops.financial_documents.read",
  "ops.jobs.read",
  "ops.operations.prepare",
  "ops.operations.read",
  "ops.schedule.read",
  "ops.tasks.read",
] as const;
const PERMISSIONS = [
  "calendar.view",
  "email.view",
  "invoices.view",
  "pipeline.view",
  "projects.view",
  "reports.view",
  "tasks.view",
] as const;

function authority(): ActorAuthoritySnapshot {
  return {
    actorUserId: USER_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: [],
    configuredPermissions: [...PERMISSIONS],
    effectivePermissions: PERMISSIONS.map((permission) => ({
      permission,
      scope: "all",
    })),
    permissionSnapshotRevision: `sha256:${"a".repeat(64)}`,
  };
}

function claim(attemptNumber = 1, actorUserId = USER_ID) {
  return {
    routine_id: ROUTINE_ID,
    company_id: COMPANY_ID,
    actor_user_id: actorUserId,
    oauth_grant_id: GRANT_ID,
    oauth_client_id: CLIENT_ID,
    grant_revision: "b".repeat(32),
    granted_scope_ceiling: [...SCOPES],
    permission_snapshot_revision: `sha256:${"c".repeat(64)}`,
    capability_manifest_revision: "2026-08-30.capability-manifest.v9",
    exposure_revision: "2026-08-30.mcp-exposure.v3",
    local_time: "20:00:00",
    timezone: "America/Vancouver",
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    scheduled_for: SCHEDULED_FOR,
    schedule_revision: 12,
    claim_token: CLAIM_TOKEN,
    claim_expires_at: "2026-08-31T03:10:00.000Z",
    attempt_number: attemptNumber,
  };
}

function clearResult(state: "clear" | "partial" = "clear"): DayCloseoutResult {
  const preparedAt = "2026-08-31T03:00:00.000Z";
  const unavailable = state === "partial";
  return {
    contract_version: "2026-08-07.v1",
    schema_revision: "2026-08-30.v1",
    metric_definition_revision: "day-closeout:2026-08-30.v1",
    run_id: RUN_ID,
    business_date: "2026-08-30",
    timezone: "America/Vancouver",
    prepared_at: preparedAt,
    state,
    components: [
      "tomorrow_readiness",
      "outstanding_money",
      "stalled_pipeline",
      "unresolved_correspondence",
      "work_due",
    ].map((component) => ({
      component,
      state:
        unavailable && component === "unresolved_correspondence"
          ? "not_evaluated"
          : "clear",
      time_window: { start_at: null, end_at_exclusive: preparedAt },
      population_count: 0,
      attention_count:
        unavailable && component === "unresolved_correspondence" ? null : 0,
      coverage:
        unavailable && component === "unresolved_correspondence"
          ? {
              state: "unavailable",
              inspected_count: 0,
              omitted_count: 1,
              missing_reasons: ["unreadable_correspondence"],
              fresh_at: preparedAt,
            }
          : {
              state: "complete",
              inspected_count: 0,
              omitted_count: 0,
              missing_reasons: [],
              fresh_at: preparedAt,
            },
      source_revisions: [],
      evidence_refs: [],
    })) as DayCloseoutResult["components"],
    findings: [],
    outstanding_balances: [],
    communication_briefs: [],
    filing: { kind: "not_required" },
    prompt_safety: DAY_CLOSEOUT_PROMPT_SAFETY_DIRECTIVE,
  };
}

function fixture(input?: {
  attemptNumber?: number;
  claimCount?: number;
  claimedActorUserId?: string;
  assertError?: { code: string; message: string } | null;
  prepareResult?: DayCloseoutResult;
  prepareError?: Error;
  retryScheduled?: boolean;
  finalizedOutcome?: "clear" | "attention" | "partial" | "blocked" | "failed";
  finalizedRunId?: string | null;
  finalizeResponseErrorForOutcome?: string;
  now?: () => number;
  timeoutSignal?: (milliseconds: number) => AbortSignal;
  abortWorkOnPrepare?: AbortController;
}) {
  const calls: Array<{
    functionName: string;
    args: Readonly<Record<string, unknown>>;
  }> = [];
  let claimed = 0;
  const rpc = vi.fn<DayCloseoutRoutineRpcClient["rpc"]>(
    async (functionName, args) => {
      calls.push({ functionName, args });
      if (functionName === "claim_agent_day_closeout_routines_as_system") {
        claimed += 1;
        return {
          data:
            claimed <= (input?.claimCount ?? 1)
              ? [claim(input?.attemptNumber, input?.claimedActorUserId)]
              : [],
          error: null,
        };
      }
      if (
        functionName === "assert_agent_day_closeout_routine_claim_as_system"
      ) {
        return input?.assertError
          ? { data: null, error: input.assertError }
          : {
              data: {
                authorized: true,
                routine_id: ROUTINE_ID,
                scheduled_for: SCHEDULED_FOR,
                actor_user_id: USER_ID,
                company_id: COMPANY_ID,
                oauth_grant_id: GRANT_ID,
                oauth_client_id: CLIENT_ID,
                grant_revision: "b".repeat(32),
                granted_scope_ceiling: [...SCOPES],
                permission_snapshot_revision: `sha256:${"a".repeat(64)}`,
                capability_manifest_revision:
                  "2026-08-30.capability-manifest.v9",
                exposure_revision: "2026-08-30.mcp-exposure.v3",
              },
              error: null,
            };
      }
      if (functionName === "finalize_agent_day_closeout_routine_as_system") {
        if (args.p_outcome === input?.finalizeResponseErrorForOutcome) {
          return {
            data: null,
            error: { code: "08006", message: "response lost" },
          };
        }
        return {
          data: {
            routine_id: ROUTINE_ID,
            outcome: input?.finalizedOutcome ?? args.p_outcome,
            run_id:
              input?.finalizedRunId === undefined
                ? (args.p_run_id ?? null)
                : input.finalizedRunId,
            failure_id: null,
            retry_scheduled: input?.retryScheduled ?? false,
          },
          error: null,
        };
      }
      throw new Error(`unexpected RPC: ${functionName}`);
    }
  );
  const prepareDayCloseout = vi.fn<DayCloseoutService["prepareDayCloseout"]>(
    async () => {
      if (input?.abortWorkOnPrepare) {
        const timeoutError = new DOMException(
          "routine work budget expired",
          "TimeoutError"
        );
        input.abortWorkOnPrepare.abort(timeoutError);
        throw timeoutError;
      }
      if (input?.prepareError) throw input.prepareError;
      return input?.prepareResult ?? clearResult();
    }
  );
  const authorityClient = new StubAuthoritySupabaseRpcClient(authority());
  const service = createDayCloseoutRoutineService({
    repository: createDayCloseoutRoutineRepository({ rpc }),
    dayCloseoutService: { prepareDayCloseout },
    actorResolver: createDayCloseoutRoutineActorResolver({
      rpcClient: { rpc },
      authorityRepository: authorityClient.repository,
      oauthIdentity: {
        issuer: "https://app.opsapp.co",
        audience: "https://app.opsapp.co/api/mcp",
      },
    }),
    now: input?.now,
    timeoutSignal: input?.timeoutSignal,
  });
  return { authorityClient, calls, prepareDayCloseout, rpc, service };
}

describe("day-closeout routine service", () => {
  it("reauthorizes the claimed actor and files a deterministic scheduled run without widening authority", async () => {
    const { calls, prepareDayCloseout, service } = fixture();

    const summary = await service.runDue({
      limit: 5,
      leaseSeconds: 600,
      executionBudgetMs: 240_000,
    });

    expect(summary).toEqual({
      claimed: 1,
      prepared: 1,
      partial: 0,
      blocked: 0,
      failed: 0,
      retryScheduled: 0,
    });
    expect(prepareDayCloseout).toHaveBeenCalledTimes(1);
    const [actorContext, input, options] = prepareDayCloseout.mock.calls[0]!;
    expect(actorContext).toMatchObject({
      actorUserId: USER_ID,
      companyId: COMPANY_ID,
      auth: {
        channel: "mcp",
        oauthGrantId: GRANT_ID,
        oauthClientId: CLIENT_ID,
        grantRevision: "b".repeat(32),
        scopeCeiling: [...SCOPES],
      },
    });
    expect(input).toEqual({
      business_date: "2026-08-30",
      display_timezone: "America/Vancouver",
      idempotency_key: IDEMPOTENCY_KEY,
    });
    expect(options).toMatchObject({
      routine: {
        routineId: ROUTINE_ID,
        claimToken: CLAIM_TOKEN,
        scheduledFor: SCHEDULED_FOR,
        scheduleRevision: 12,
      },
    });
    expect(calls.map(({ functionName }) => functionName)).toEqual([
      "claim_agent_day_closeout_routines_as_system",
      "assert_agent_day_closeout_routine_claim_as_system",
      "finalize_agent_day_closeout_routine_as_system",
      "claim_agent_day_closeout_routines_as_system",
    ]);
    expect(calls[2]!.args).toMatchObject({
      p_routine_id: ROUTINE_ID,
      p_claim_token: CLAIM_TOKEN,
      p_scheduled_for: SCHEDULED_FOR,
      p_idempotency_key: IDEMPOTENCY_KEY,
      p_outcome: "clear",
      p_run_id: RUN_ID,
      p_failure_code: null,
    });
  });

  it("uses the database-authorized binding rather than actor fields in the claim payload", async () => {
    const { prepareDayCloseout, service } = fixture({
      claimedActorUserId: "99999999-9999-4999-8999-999999999999",
    });

    await service.runDue({
      limit: 1,
      leaseSeconds: 600,
      executionBudgetMs: 240_000,
    });

    expect(prepareDayCloseout.mock.calls[0]![0].actorUserId).toBe(USER_ID);
  });

  it("turns current authority loss into a durable blocked outcome before any business read", async () => {
    const { calls, prepareDayCloseout, service } = fixture({
      assertError: {
        code: "42501",
        message: "AGENT_DAY_CLOSEOUT_AUTHORITY_STALE_OR_DENIED",
      },
    });

    const summary = await service.runDue({
      limit: 5,
      leaseSeconds: 600,
      executionBudgetMs: 240_000,
    });

    expect(prepareDayCloseout).not.toHaveBeenCalled();
    expect(summary.blocked).toBe(1);
    expect(calls[2]!.args).toMatchObject({
      p_outcome: "blocked",
      p_run_id: null,
      p_failure_code: "AUTHORITY_BLOCKED",
    });
  });

  it("turns authority loss during the read/persist window into a blocked outcome", async () => {
    const { calls, service } = fixture({
      prepareError: actorForbidden(
        "routine-day-closeout",
        "grant_revoked_during_execution"
      ),
    });

    const summary = await service.runDue({
      limit: 5,
      leaseSeconds: 600,
      executionBudgetMs: 240_000,
    });

    expect(calls[2]!.args).toMatchObject({
      p_outcome: "blocked",
      p_run_id: null,
      p_failure_code: "AUTHORITY_BLOCKED",
    });
    expect(summary).toMatchObject({ blocked: 1, retryScheduled: 0 });
  });

  it("never performs a fourth execution attempt for one scheduled occurrence", async () => {
    const { calls, prepareDayCloseout, service } = fixture({
      attemptNumber: 4,
    });

    const summary = await service.runDue({
      limit: 5,
      leaseSeconds: 600,
      executionBudgetMs: 240_000,
    });

    expect(prepareDayCloseout).not.toHaveBeenCalled();
    expect(
      calls.some(
        ({ functionName }) =>
          functionName === "assert_agent_day_closeout_routine_claim_as_system"
      )
    ).toBe(false);
    expect(calls[1]!.args).toMatchObject({
      p_outcome: "failed",
      p_failure_code: "CLAIM_ATTEMPTS_EXHAUSTED",
    });
    expect(summary.failed).toBe(1);
  });

  it("schedules a bounded retry after a transient execution failure", async () => {
    const { calls, service } = fixture({
      prepareError: new Error("source offline"),
      retryScheduled: true,
    });

    const summary = await service.runDue({
      limit: 5,
      leaseSeconds: 600,
      executionBudgetMs: 240_000,
    });

    expect(calls[2]!.args).toMatchObject({
      p_outcome: "failed",
      p_failure_code: "ROUTINE_EXECUTION_FAILED",
    });
    expect(summary).toMatchObject({ failed: 0, retryScheduled: 1 });
  });

  it("surfaces partial source coverage as a completed but incomplete routine outcome", async () => {
    const { calls, service } = fixture({
      prepareResult: clearResult("partial"),
    });

    const summary = await service.runDue({
      limit: 5,
      leaseSeconds: 600,
      executionBudgetMs: 240_000,
    });

    expect(calls[2]!.args).toMatchObject({
      p_outcome: "partial",
      p_run_id: RUN_ID,
      p_failure_code: "SOURCE_COVERAGE_PARTIAL",
    });
    expect(summary).toMatchObject({ prepared: 1, partial: 1 });
  });

  it("recovers a committed occurrence when persistence succeeds but its response is lost", async () => {
    const { calls, service } = fixture({
      attemptNumber: 3,
      prepareError: new Error("response lost after commit"),
      finalizedOutcome: "clear",
      finalizedRunId: RUN_ID,
    });

    const summary = await service.runDue({
      limit: 5,
      leaseSeconds: 600,
      executionBudgetMs: 240_000,
    });

    expect(calls[2]!.args).toMatchObject({
      p_outcome: "failed",
      p_run_id: null,
      p_failure_code: "ROUTINE_EXECUTION_FAILED",
    });
    expect(summary).toMatchObject({
      prepared: 1,
      failed: 0,
      retryScheduled: 0,
    });
  });

  it("never records a failure when only successful finalization's response is lost", async () => {
    const { calls, service } = fixture({
      finalizeResponseErrorForOutcome: "clear",
    });

    await expect(
      service.runDue({
        limit: 1,
        leaseSeconds: 600,
        executionBudgetMs: 240_000,
      })
    ).rejects.toThrow("Day-closeout routine storage is unavailable");

    expect(
      calls.filter(
        ({ functionName }) =>
          functionName === "finalize_agent_day_closeout_routine_as_system"
      )
    ).toHaveLength(1);
  });

  it("recovers an existing committed occurrence instead of failing a fourth claim", async () => {
    const { prepareDayCloseout, service } = fixture({
      attemptNumber: 4,
      finalizedOutcome: "attention",
      finalizedRunId: RUN_ID,
    });

    const summary = await service.runDue({
      limit: 5,
      leaseSeconds: 600,
      executionBudgetMs: 240_000,
    });

    expect(prepareDayCloseout).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ prepared: 1, failed: 0 });
  });

  it("claims only one occurrence at a time so unstarted work spends no attempts", async () => {
    const { calls, prepareDayCloseout, service } = fixture({ claimCount: 2 });

    const summary = await service.runDue({
      limit: 2,
      leaseSeconds: 600,
      executionBudgetMs: 240_000,
    });

    expect(summary.claimed).toBe(2);
    expect(prepareDayCloseout).toHaveBeenCalledTimes(2);
    const claimCalls = calls.filter(
      ({ functionName }) =>
        functionName === "claim_agent_day_closeout_routines_as_system"
    );
    expect(claimCalls).toHaveLength(2);
    expect(claimCalls.every(({ args }) => args.p_limit === 1)).toBe(true);
  });

  it("does not claim another occurrence without the minimum execution budget", async () => {
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(1);
    const { calls, service } = fixture({ claimCount: 2, now });

    const summary = await service.runDue({
      limit: 2,
      leaseSeconds: 600,
      executionBudgetMs: 60_000,
    });

    expect(summary.claimed).toBe(1);
    expect(
      calls.filter(
        ({ functionName }) =>
          functionName === "claim_agent_day_closeout_routines_as_system"
      )
    ).toHaveLength(1);
  });

  it("aborts slow work before the route ceiling and reserves time to finalize it truthfully", async () => {
    const workDeadline = new AbortController();
    const finalizationDeadline = new AbortController();
    const timeoutSignal = vi
      .fn<(milliseconds: number) => AbortSignal>()
      .mockReturnValueOnce(workDeadline.signal)
      .mockReturnValue(finalizationDeadline.signal);
    const { authorityClient, calls, prepareDayCloseout, service } = fixture({
      abortWorkOnPrepare: workDeadline,
      now: () => 0,
      retryScheduled: true,
      timeoutSignal,
    });

    const summary = await service.runDue({
      limit: 1,
      leaseSeconds: 600,
      executionBudgetMs: 240_000,
    });

    expect(prepareDayCloseout.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
    expect(authorityClient.actorSignals).toEqual([workDeadline.signal]);
    expect(timeoutSignal).toHaveBeenNthCalledWith(1, 210_000);
    expect(timeoutSignal).toHaveBeenNthCalledWith(2, 240_000);
    expect(calls[2]!.args).toMatchObject({
      p_outcome: "failed",
      p_failure_code: "ROUTINE_EXECUTION_BUDGET_EXPIRED",
    });
    expect(summary).toMatchObject({ retryScheduled: 1, failed: 0 });
  });
});

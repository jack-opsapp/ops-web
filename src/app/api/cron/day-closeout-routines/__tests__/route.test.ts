import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { DayCloseoutRoutineService } from "@/lib/agent-control-plane/services/day-closeout/day-closeout-routine-service";
import type { CronWorkloadControlClient } from "@/lib/api/services/cron-workload-control-service";
import {
  handleDayCloseoutRoutineCron,
  type DayCloseoutRoutineCronDependencies,
} from "../route";

function request(secret = "cron-secret") {
  return new Request("https://app.opsapp.co/api/cron/day-closeout-routines", {
    headers: { authorization: `Bearer ${secret}` },
  });
}

function fixture(input?: {
  cronSecret?: string | null;
  enabled?: boolean;
  controlled?: "completed" | "lease_held" | "control_unavailable";
}) {
  const runDue = vi.fn<DayCloseoutRoutineService["runDue"]>(async () => ({
    claimed: 2,
    prepared: 1,
    partial: 0,
    blocked: 1,
    failed: 0,
    retryScheduled: 0,
  }));
  const routineService = { runDue } as DayCloseoutRoutineService;
  const supabase = {
    rpc: vi.fn(),
  } as unknown as CronWorkloadControlClient;
  const runWithControl = vi.fn(async (options) => {
    if (input?.controlled === "lease_held") {
      return { status: "skipped" as const, reason: "lease_held" as const };
    }
    if (input?.controlled === "control_unavailable") {
      return {
        status: "skipped" as const,
        reason: "control_unavailable" as const,
        error: new Error("offline"),
      };
    }
    return {
      status: "completed" as const,
      value: await options.work({
        ownerToken: "owner",
        fenceToken: 1,
        globalFenceToken: 1,
        expiresAt: "2026-08-31T03:10:00.000Z",
        signal: new AbortController().signal,
      }),
    };
  });
  const dependencies: DayCloseoutRoutineCronDependencies = {
    cronSecret:
      input?.cronSecret === undefined ? "cron-secret" : input.cronSecret,
    enabled: input?.enabled ?? true,
    loadRuntime: () => ({ supabase, routineService }),
    runWithControl:
      runWithControl as DayCloseoutRoutineCronDependencies["runWithControl"],
  };
  return { dependencies, runDue, runWithControl, supabase };
}

describe("day-closeout routine cron", () => {
  it("has no registered Vercel schedule before explicit activation", () => {
    expect(
      readFileSync(join(process.cwd(), "vercel.json"), "utf8")
    ).not.toContain("/api/cron/day-closeout-routines");
  });

  it("fails closed when the server cron secret is absent", async () => {
    const { dependencies, runDue, runWithControl } = fixture({
      cronSecret: null,
    });

    const response = await handleDayCloseoutRoutineCron(
      request(),
      dependencies
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: "CRON_SECRET not configured",
    });
    expect(runWithControl).not.toHaveBeenCalled();
    expect(runDue).not.toHaveBeenCalled();
  });

  it("rejects an incorrect bearer before evaluating the activation gate", async () => {
    const { dependencies, runDue, runWithControl } = fixture();

    const response = await handleDayCloseoutRoutineCron(
      request("wrong"),
      dependencies
    );

    expect(response.status).toBe(401);
    expect(runWithControl).not.toHaveBeenCalled();
    expect(runDue).not.toHaveBeenCalled();
  });

  it("stays dormant without acquiring a lease when activation is disabled", async () => {
    const { dependencies, runDue, runWithControl } = fixture({
      enabled: false,
    });

    const response = await handleDayCloseoutRoutineCron(
      request(),
      dependencies
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ran: false,
      reason: "disabled",
    });
    expect(runWithControl).not.toHaveBeenCalled();
    expect(runDue).not.toHaveBeenCalled();
  });

  it("runs one bounded batch under the shared OPS cron lease", async () => {
    const { dependencies, runDue, runWithControl, supabase } = fixture();

    const response = await handleDayCloseoutRoutineCron(
      request(),
      dependencies
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ran: true,
      summary: {
        claimed: 2,
        prepared: 1,
        partial: 0,
        blocked: 1,
        failed: 0,
        retryScheduled: 0,
      },
    });
    expect(runWithControl).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase,
        workloadKey: "agent-day-closeout-routines",
        leaseSeconds: 600,
      })
    );
    expect(runDue).toHaveBeenCalledWith({
      limit: 10,
      leaseSeconds: 600,
      executionBudgetMs: 240_000,
      signal: expect.any(AbortSignal),
    });
  });

  it("treats an existing worker lease as a healthy no-op", async () => {
    const { dependencies, runDue } = fixture({ controlled: "lease_held" });

    const response = await handleDayCloseoutRoutineCron(
      request(),
      dependencies
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ran: false,
      reason: "already_running",
    });
    expect(runDue).not.toHaveBeenCalled();
  });

  it("reports unavailable workload control without running unleased", async () => {
    const { dependencies, runDue } = fixture({
      controlled: "control_unavailable",
    });

    const response = await handleDayCloseoutRoutineCron(
      request(),
      dependencies
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      ran: false,
      reason: "control_unavailable",
    });
    expect(runDue).not.toHaveBeenCalled();
  });
});

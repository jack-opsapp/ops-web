import { NextResponse } from "next/server";

import type { DayCloseoutRoutineService } from "@/lib/agent-control-plane/services/day-closeout/day-closeout-routine-service";
import {
  runWithCronWorkloadControl,
  type CronWorkloadControlClient,
} from "@/lib/api/services/cron-workload-control-service";

export interface DayCloseoutRoutineCronDependencies {
  readonly cronSecret: string | null | undefined;
  readonly enabled: boolean;
  readonly loadRuntime: () => {
    readonly supabase: CronWorkloadControlClient;
    readonly routineService: DayCloseoutRoutineService;
  };
  readonly runWithControl: typeof runWithCronWorkloadControl;
}

export async function handleDayCloseoutRoutineCron(
  request: Request,
  dependencies: DayCloseoutRoutineCronDependencies
): Promise<Response> {
  if (!dependencies.cronSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (
    request.headers.get("authorization") !== `Bearer ${dependencies.cronSecret}`
  ) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  if (!dependencies.enabled) {
    return NextResponse.json({ ok: true, ran: false, reason: "disabled" });
  }

  try {
    const runtime = dependencies.loadRuntime();
    const controlled = await dependencies.runWithControl({
      supabase: runtime.supabase,
      workloadKey: "agent-day-closeout-routines",
      leaseSeconds: 600,
      work: async (lease) => {
        const summary = await runtime.routineService.runDue({
          limit: 10,
          leaseSeconds: 600,
          executionBudgetMs: 240_000,
          signal: lease.signal,
        });
        return NextResponse.json({ ok: true, ran: true, summary });
      },
    });

    if (controlled.status === "completed") return controlled.value;
    const alreadyRunning = controlled.reason === "lease_held";
    return NextResponse.json(
      {
        ok: alreadyRunning,
        ran: false,
        reason: alreadyRunning ? "already_running" : controlled.reason,
      },
      { status: alreadyRunning ? 200 : 503 }
    );
  } catch (error) {
    console.error(
      "[cron/day-closeout-routines]",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      { ok: false, error: "Day closeout routine worker failed" },
      { status: 500 }
    );
  }
}

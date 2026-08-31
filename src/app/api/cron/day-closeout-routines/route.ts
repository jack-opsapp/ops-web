import { NextResponse } from "next/server";

import { getMcpServerRuntime } from "@/lib/agent-control-plane/mcp/runtime";
import { resolveMcpOAuthConfig } from "@/lib/agent-control-plane/mcp/oauth";
import { createDayCloseoutRoutineActorResolver } from "@/lib/agent-control-plane/mcp/actor-reauthorization";
import {
  createDayCloseoutRoutineRepository,
  createDayCloseoutRoutineService,
  type DayCloseoutRoutineService,
} from "@/lib/agent-control-plane/services/day-closeout/day-closeout-routine-service";
import {
  runWithCronWorkloadControl,
  type CronWorkloadControlClient,
} from "@/lib/api/services/cron-workload-control-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const maxDuration = 300;

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

let cachedRoutineService: DayCloseoutRoutineService | null = null;

function loadProductionRuntime() {
  const mcpRuntime = getMcpServerRuntime();
  if (!cachedRoutineService) {
    const oauth = resolveMcpOAuthConfig();
    cachedRoutineService = createDayCloseoutRoutineService({
      repository: createDayCloseoutRoutineRepository(mcpRuntime.rpcClient),
      dayCloseoutService: mcpRuntime.dayCloseout,
      actorResolver: createDayCloseoutRoutineActorResolver({
        rpcClient: mcpRuntime.rpcClient,
        authorityRepository: mcpRuntime.authorityRepository,
        oauthIdentity: { issuer: oauth.issuer, audience: oauth.resource },
      }),
    });
  }
  return {
    supabase: getServiceRoleClient() as CronWorkloadControlClient,
    routineService: cachedRoutineService,
  };
}

export async function GET(request: Request): Promise<Response> {
  return await handleDayCloseoutRoutineCron(request, {
    cronSecret: process.env.CRON_SECRET,
    enabled: process.env.OPS_DAY_CLOSEOUT_ROUTINES_ENABLED === "true",
    loadRuntime: loadProductionRuntime,
    runWithControl: runWithCronWorkloadControl,
  });
}

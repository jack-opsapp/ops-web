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
import { handleDayCloseoutRoutineCron } from "./handler";

export const maxDuration = 300;

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

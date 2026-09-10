import {
  runWithCronWorkloadControl,
  type CronWorkloadControlClient,
} from "@/lib/api/services/cron-workload-control-service";
import { runAdsEngineTick } from "@/lib/ads/engine/worker-runtime";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { handleAdsEngineCron } from "./handler";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return await handleAdsEngineCron(request, {
    run: runAdsEngineTick,
    loadRuntime: () => ({
      supabase: getServiceRoleClient() as CronWorkloadControlClient,
    }),
    runWithControl: runWithCronWorkloadControl,
  });
}

import {
  runWithCronWorkloadControl,
  type CronWorkloadControlClient,
} from "@/lib/api/services/cron-workload-control-service";
import { runCloudEditorial } from "@/lib/social/editorial/runtime";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { handleSocialEditorialCron } from "./handler";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return await handleSocialEditorialCron(request, {
    run: runCloudEditorial,
    loadRuntime: () => ({
      supabase: getServiceRoleClient() as CronWorkloadControlClient,
    }),
    runWithControl: runWithCronWorkloadControl,
  });
}

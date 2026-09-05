import {
  runWithCronWorkloadControl,
  type CronWorkloadControlClient,
} from "@/lib/api/services/cron-workload-control-service";
import { runSocialPublisherBatch } from "@/lib/social/publisher";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { handleSocialPublishCron } from "./handler";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return await handleSocialPublishCron(request, {
    runBatch: (options) => runSocialPublisherBatch(undefined, options),
    loadRuntime: () => ({
      supabase: getServiceRoleClient() as CronWorkloadControlClient,
    }),
    runWithControl: runWithCronWorkloadControl,
  });
}

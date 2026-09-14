import {
  runWithCronWorkloadControl,
  type CronWorkloadControlClient,
} from "@/lib/api/services/cron-workload-control-service";
import { runJournalEditorial } from "@/lib/journal/editorial/runtime";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { handleJournalEditorialCron } from "./handler";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return await handleJournalEditorialCron(request, {
    run: runJournalEditorial,
    loadRuntime: () => ({
      supabase: getServiceRoleClient() as CronWorkloadControlClient,
    }),
    runWithControl: runWithCronWorkloadControl,
  });
}

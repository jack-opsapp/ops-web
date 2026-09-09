import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailWorkRouting } from "./email-work-routing";

/** One transaction owns the durable no-lead decision and its notification. */
export async function persistEmailWorkRouting(input: {
  supabase: SupabaseClient;
  companyId: string;
  connectionId: string;
  activityId: string;
  providerMessageId: string;
  providerThreadId: string;
  routing: Exclude<EmailWorkRouting, { action: "sales" }>;
}): Promise<void> {
  const { data, error } = await input.supabase.rpc(
    "route_email_work_correspondence_as_system",
    {
      p_company_id: input.companyId,
      p_connection_id: input.connectionId,
      p_activity_id: input.activityId,
      p_provider_message_id: input.providerMessageId,
      p_provider_thread_id: input.providerThreadId,
      p_client_id: input.routing.clientId,
      p_project_id: input.routing.projectId,
      p_needs_review: input.routing.action === "review",
    }
  );
  if (error || data !== true) {
    throw new Error(
      `Email work routing did not persist: ${error?.message ?? "missing receipt"}`,
      { cause: error }
    );
  }
}

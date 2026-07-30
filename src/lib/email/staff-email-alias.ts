import type { SupabaseClient } from "@supabase/supabase-js";

import type { StaffAliasCandidate } from "@/lib/email/email-ingestion-routing";

type StaffAliasCandidateRpcClient = {
  rpc(
    name: "record_staff_email_alias_candidate_as_system",
    args: {
      p_company_id: string;
      p_connection_id: string;
      p_user_id: string;
      p_email: string;
      p_provider_thread_id: string;
      p_provider_message_id: string;
      p_evidence: StaffAliasCandidate["evidence"];
    }
  ): Promise<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

export async function persistStaffEmailAliasCandidate(input: {
  supabase: SupabaseClient;
  companyId: string;
  connectionId: string;
  providerThreadId: string;
  providerMessageId: string;
  candidate: StaffAliasCandidate;
}): Promise<string> {
  const { data, error } = await (
    input.supabase as unknown as StaffAliasCandidateRpcClient
  ).rpc("record_staff_email_alias_candidate_as_system", {
    p_company_id: input.companyId,
    p_connection_id: input.connectionId,
    p_user_id: input.candidate.userId,
    p_email: input.candidate.email,
    p_provider_thread_id: input.providerThreadId,
    p_provider_message_id: input.providerMessageId,
    p_evidence: input.candidate.evidence,
  });
  if (error || typeof data !== "string" || !data) {
    throw new Error(
      `Staff alias review persistence failed: ${error?.message ?? "RPC returned no alias id"}`
    );
  }
  return data;
}

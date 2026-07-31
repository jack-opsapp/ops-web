import "server-only";

interface ManualOutboundCycleSupabaseLike {
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): PromiseLike<{
    data?: unknown;
    error?: { message?: string } | null;
  }>;
}

export async function reconcileManualOutboundFollowUpCycle(input: {
  supabase: ManualOutboundCycleSupabaseLike;
  companyId: string;
  opportunityId: string;
  correspondenceEventId: string;
}): Promise<void> {
  const { data, error } = await input.supabase.rpc(
    "reconcile_manual_outbound_follow_up_cycle_as_system",
    {
      p_company_id: input.companyId,
      p_opportunity_id: input.opportunityId,
      p_correspondence_event_id: input.correspondenceEventId,
    }
  );
  if (error) {
    throw new Error(
      `Manual outbound follow-up reconciliation failed: ${
        error.message ?? "unknown error"
      }`
    );
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        correspondence_event_id?: string | null;
        opportunity_id?: string | null;
      }
    | null
    | undefined;
  if (
    !row ||
    row.correspondence_event_id !== input.correspondenceEventId ||
    row.opportunity_id !== input.opportunityId
  ) {
    throw new Error(
      "Manual outbound follow-up reconciliation returned an invalid receipt"
    );
  }
}

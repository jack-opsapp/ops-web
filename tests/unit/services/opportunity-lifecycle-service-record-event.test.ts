/**
 * Unit coverage for OpportunityLifecycleService.recordCorrespondenceEvent after
 * it was routed through the atomic record_opportunity_correspondence_event RPC
 * (2026-07-22 stranded-projection remediation). Verifies the single RPC call
 * carries the TS-side classification, that both the fresh-insert and duplicate
 * paths re-run the idempotent lifecycle side effect with the RPC's event id,
 * and that an opportunity_not_found RPC error maps to missing_opportunity.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { resetStaleMock } = vi.hoisted(() => ({ resetStaleMock: vi.fn() }));

vi.mock("@/lib/api/services/opportunity-lifecycle-action-service", () => ({
  resetStaleLifecycleAfterMeaningfulInbound: resetStaleMock,
}));

import {
  OpportunityLifecycleService,
  type RecordCorrespondenceEventInput,
} from "@/lib/api/services/opportunity-lifecycle-service";

type RpcResult = { data: unknown; error: unknown };

function makeSupabase(rpcResult: RpcResult) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const lifecycleBuilder = {
    select: () => lifecycleBuilder,
    eq: () => lifecycleBuilder,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    upsert: vi.fn().mockResolvedValue({ error: null }),
  };
  const from = vi.fn(() => lifecycleBuilder);
  const supabase = {
    from,
    rpc,
  } as unknown as RecordCorrespondenceEventInput["supabase"];
  return { supabase, rpc };
}

function buildInput(
  supabase: RecordCorrespondenceEventInput["supabase"],
  overrides: Partial<RecordCorrespondenceEventInput> = {}
): RecordCorrespondenceEventInput {
  return {
    supabase,
    companyId: "co-1",
    opportunityId: "opp-1",
    activityId: "act-1",
    connectionId: "conn-1",
    providerThreadId: "thread-123",
    providerMessageId: "msg-123",
    requireProviderMessageId: true,
    direction: "inbound",
    occurredAt: new Date("2026-07-22T10:00:00Z"),
    source: "sync_activity",
    applyOpportunityProjection: true,
    fromEmail: "jane@customer.com",
    fromName: "Jane",
    toEmails: ["ops@myco.com"],
    ccEmails: [],
    subject: "Need a quote",
    bodyText: "Hi, can you quote my deck?",
    connectionEmail: "ops@myco.com",
    companyDomains: ["myco.com"],
    userEmailAddresses: [],
    knownPlatformSenders: [],
    contactEmail: "jane@customer.com",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStaleMock.mockResolvedValue({ applied: true });
});

describe("OpportunityLifecycleService.recordCorrespondenceEvent", () => {
  it("makes one atomic RPC call carrying the TS classification and advances lifecycle state with the returned event id", async () => {
    const { supabase, rpc } = makeSupabase({
      data: [
        {
          created: true,
          event_id: "evt-9",
          correspondence_count: 1,
          inbound_count: 1,
          outbound_count: 0,
          stage: "new_lead",
          stage_manually_set: false,
          assignment_version: 0,
          last_inbound_at: "2026-07-22T10:00:00Z",
          last_outbound_at: null,
          last_message_direction: "in",
        },
      ],
      error: null,
    });

    const result = await OpportunityLifecycleService.recordCorrespondenceEvent(
      buildInput(supabase)
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe("record_opportunity_correspondence_event");
    // The verdict computed in TS is what the RPC persists — inbound from an
    // external sender classifies as a meaningful customer message.
    expect(args).toMatchObject({
      p_company_id: "co-1",
      p_opportunity_id: "opp-1",
      p_direction: "inbound",
      p_party_role: "customer",
      p_is_meaningful: true,
      p_noise_reason: null,
      p_provider_thread_id: "thread-123",
      p_provider_message_id: "msg-123",
      p_apply_opportunity_projection: true,
    });

    expect(result).toEqual({
      created: true,
      classification: expect.objectContaining({
        partyRole: "customer",
        isMeaningful: true,
      }),
    });
    // Side effect ran with the id the RPC returned, not a client-side guess.
    expect(resetStaleMock).toHaveBeenCalledTimes(1);
    expect(resetStaleMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "evt-9", mode: "apply" })
    );
  });

  it("re-runs the lifecycle side effect and reports a duplicate when the RPC dedupes", async () => {
    const { supabase, rpc } = makeSupabase({
      data: [
        {
          created: false,
          event_id: "evt-existing",
          correspondence_count: 3,
          inbound_count: 2,
          outbound_count: 1,
          stage: "quoting",
          stage_manually_set: false,
          assignment_version: 1,
          last_inbound_at: "2026-07-22T10:00:00Z",
          last_outbound_at: "2026-07-21T09:00:00Z",
          last_message_direction: "in",
        },
      ],
      error: null,
    });

    const result = await OpportunityLifecycleService.recordCorrespondenceEvent(
      buildInput(supabase)
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      created: false,
      reason: "duplicate_provider_message_id",
      classification: expect.objectContaining({
        partyRole: "customer",
        isMeaningful: true,
      }),
    });
    // The partial-write repair re-runs against the pre-existing event id.
    expect(resetStaleMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "evt-existing", mode: "apply" })
    );
  });

  it("maps an opportunity_not_found RPC error to missing_opportunity without side effects", async () => {
    const { supabase, rpc } = makeSupabase({
      data: null,
      error: { code: "P0002", message: "opportunity_not_found" },
    });

    const result = await OpportunityLifecycleService.recordCorrespondenceEvent(
      buildInput(supabase)
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ created: false, reason: "missing_opportunity" });
    expect(resetStaleMock).not.toHaveBeenCalled();
  });

  it("throws on any other RPC error (e.g. a provider-identity conflict)", async () => {
    const { supabase } = makeSupabase({
      data: null,
      error: {
        code: "23505",
        message: "correspondence_provider_identity_conflict",
      },
    });

    await expect(
      OpportunityLifecycleService.recordCorrespondenceEvent(buildInput(supabase))
    ).rejects.toThrow(/Correspondence event insert failed/);
    expect(resetStaleMock).not.toHaveBeenCalled();
  });

  it("short-circuits to invalid_provider_ids before calling the RPC", async () => {
    const { supabase, rpc } = makeSupabase({ data: [], error: null });

    const result = await OpportunityLifecycleService.recordCorrespondenceEvent(
      buildInput(supabase, { providerThreadId: "  " })
    );

    expect(result).toEqual({ created: false, reason: "invalid_provider_ids" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("short-circuits to missing_opportunity when no opportunity id is supplied", async () => {
    const { supabase, rpc } = makeSupabase({ data: [], error: null });

    const result = await OpportunityLifecycleService.recordCorrespondenceEvent(
      buildInput(supabase, { opportunityId: null })
    );

    expect(result).toEqual({ created: false, reason: "missing_opportunity" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireSupabase } from "@/lib/supabase/helpers";
import {
  applyLeadDispositionFeedback,
  undoLeadDispositionFeedback,
  LeadDispositionFeedbackError,
} from "@/lib/api/services/lead-disposition-feedback-service";

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
}));

/**
 * PostgREST returns `returns table` RPCs as an ARRAY of rows. The service must
 * normalize `data[0]`; a bare object (defensive) must work too.
 */
const ROW = {
  feedback_id: "fb-1",
  outcome: "discarded",
  prior_stage: "new_lead",
  current_stage: "discarded",
  current_stage_entered_at: "2026-07-29T00:00:00Z",
  current_stage_manually_set: true,
  current_lost_reason: null,
  current_lost_notes: null,
  current_actual_close_date: null,
  lifecycle_changed: true,
  idempotent_replay: false,
};

function rpcMock(result: {
  data: unknown;
  error: null | { message: string; code?: string };
}) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => result);
  vi.mocked(requireSupabase).mockReturnValue({ rpc } as never);
  return rpc;
}

describe("applyLeadDispositionFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps arguments onto the deployed RPC contract", async () => {
    const rpc = rpcMock({ data: [ROW], error: null });

    await applyLeadDispositionFeedback({
      opportunityId: "opp-1",
      reasonCode: "vendor_sales",
      optionalNote: "cold outreach",
      idempotencyKey: "key-abcdef12",
    });

    expect(rpc).toHaveBeenCalledWith("apply_lead_disposition_feedback", {
      p_opportunity_id: "opp-1",
      p_reason_code: "vendor_sales",
      p_optional_note: "cold outreach",
      p_idempotency_key: "key-abcdef12",
    });
  });

  it("sends a null note when none is supplied", async () => {
    const rpc = rpcMock({ data: [ROW], error: null });

    await applyLeadDispositionFeedback({
      opportunityId: "opp-1",
      reasonCode: "legacy_unspecified",
      idempotencyKey: "key-abcdef12",
    });

    expect(rpc.mock.calls[0]![1]).toMatchObject({
      p_reason_code: "legacy_unspecified",
      p_optional_note: null,
    });
  });

  it("normalizes the returned row array into a camelCase result", async () => {
    rpcMock({
      data: [
        {
          ...ROW,
          outcome: "duplicate_review",
          current_stage: "new_lead",
          lifecycle_changed: false,
          idempotent_replay: true,
        },
      ],
      error: null,
    });

    await expect(
      applyLeadDispositionFeedback({
        opportunityId: "opp-1",
        reasonCode: "duplicate",
        idempotencyKey: "key-abcdef12",
      })
    ).resolves.toEqual({
      feedbackId: "fb-1",
      outcome: "duplicate_review",
      priorStage: "new_lead",
      currentStage: "new_lead",
      lifecycleChanged: false,
      idempotentReplay: true,
    });
  });

  it("accepts a bare row object as well as an array", async () => {
    rpcMock({ data: ROW, error: null });

    await expect(
      applyLeadDispositionFeedback({
        opportunityId: "opp-1",
        reasonCode: "spam",
        idempotencyKey: "key-abcdef12",
      })
    ).resolves.toMatchObject({ feedbackId: "fb-1", outcome: "discarded" });
  });

  it("throws `unknown` when the RPC returns no row", async () => {
    rpcMock({ data: [], error: null });

    await expect(
      applyLeadDispositionFeedback({
        opportunityId: "opp-1",
        reasonCode: "spam",
        idempotencyKey: "key-abcdef12",
      })
    ).rejects.toMatchObject({
      name: "LeadDispositionFeedbackError",
      code: "unknown",
    });
  });

  it.each([
    ["opportunity_terminal_or_merged", "terminal_or_merged"],
    ["phase_c_disabled", "phase_c_disabled"],
    ["invalid_phase_c_reason", "invalid_reason"],
    ["invalid_idempotency_key", "invalid_reason"],
    ["feedback_note_too_long", "invalid_reason"],
    ["idempotency_key_reused", "invalid_reason"],
    ["opportunity_access_denied", "access_denied"],
    ["actor_not_found", "access_denied"],
    ["opportunity_not_found", "not_found"],
    ["feedback_not_found", "not_found"],
    ["feedback_undo_conflict", "undo_conflict"],
    ["something entirely unexpected", "unknown"],
  ])("maps the %s server error onto the %s code", async (message, code) => {
    rpcMock({
      data: null,
      error: { message: `Postgres error: ${message} (P0001)` },
    });

    const error = await applyLeadDispositionFeedback({
      opportunityId: "opp-1",
      reasonCode: "spam",
      idempotencyKey: "key-abcdef12",
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(LeadDispositionFeedbackError);
    expect(error).toMatchObject({ code });
    expect((error as Error).message).toContain(message);
  });
});

describe("undoLeadDispositionFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps arguments onto the deployed undo RPC contract", async () => {
    const rpc = rpcMock({
      data: [{ ...ROW, current_stage: "new_lead", lifecycle_changed: true }],
      error: null,
    });

    await expect(
      undoLeadDispositionFeedback({
        feedbackId: "fb-1",
        idempotencyKey: "key-undo-01",
      })
    ).resolves.toMatchObject({
      feedbackId: "fb-1",
      currentStage: "new_lead",
      lifecycleChanged: true,
    });

    expect(rpc).toHaveBeenCalledWith("undo_lead_disposition_feedback", {
      p_feedback_id: "fb-1",
      p_idempotency_key: "key-undo-01",
    });
  });

  it("surfaces a post-discard conflict as `undo_conflict`", async () => {
    rpcMock({
      data: null,
      error: { message: "feedback_undo_conflict", code: "40001" },
    });

    await expect(
      undoLeadDispositionFeedback({
        feedbackId: "fb-1",
        idempotencyKey: "key-undo-01",
      })
    ).rejects.toMatchObject({ code: "undo_conflict" });
  });

  it("throws `unknown` when the undo RPC returns no row", async () => {
    rpcMock({ data: null, error: null });

    await expect(
      undoLeadDispositionFeedback({
        feedbackId: "fb-1",
        idempotencyKey: "key-undo-01",
      })
    ).rejects.toMatchObject({ code: "unknown" });
  });
});

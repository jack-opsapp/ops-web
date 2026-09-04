import { describe, expect, it, vi } from "vitest";

import {
  isLifecycleDecisionReplayConflict,
  loadPhaseCStageDecisionEvidence,
  recordAndApplyPhaseCStageDecision,
} from "@/lib/email/phase-c-lifecycle-decision";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OPPORTUNITY_ID = "22222222-2222-4222-8222-222222222222";
const CONNECTION_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_EVENT_ID = "44444444-4444-4444-8444-444444444444";

describe("Phase C lifecycle decisions", () => {
  it("records the evidence receipt before invoking the guarded stage mutation", async () => {
    const calls: string[] = [];
    const rpc = vi.fn(async (name: string) => {
      calls.push(name);
      if (name === "record_opportunity_lifecycle_decision") {
        return {
          data: { id: "decision-1", status: "proposed" },
          error: null,
        };
      }
      return {
        data: [
          {
            changed: true,
            stage: "negotiation",
            stage_manually_set: false,
            guard_reason: null,
          },
        ],
        error: null,
      };
    });

    const result = await recordAndApplyPhaseCStageDecision({
      supabase: { rpc } as never,
      companyId: COMPANY_ID,
      opportunityId: OPPORTUNITY_ID,
      sourceEventId: SOURCE_EVENT_ID,
      evidenceEventIds: [SOURCE_EVENT_ID],
      evidenceMessageIds: ["1a01fbc3eba7a4fb"],
      proposedStage: "negotiation",
      expectedStage: "quoted",
      expectedAssignmentVersion: 3,
      confidence: 0.8,
      reason: "strict_singleton_model_stage_classification",
    });

    expect(calls).toEqual([
      "record_opportunity_lifecycle_decision",
      "apply_phase_c_opportunity_stage_decision",
    ]);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "record_opportunity_lifecycle_decision",
      expect.objectContaining({
        p_company_id: COMPANY_ID,
        p_opportunity_id: OPPORTUNITY_ID,
        p_source_event_id: SOURCE_EVENT_ID,
        p_decision_kind: "stage",
        p_decision_key: "active_stage",
        p_proposed_stage: "negotiation",
        p_confidence: 0.8,
        p_evidence_event_ids: [SOURCE_EVENT_ID],
        p_evidence_message_ids: ["1a01fbc3eba7a4fb"],
        p_reason: "strict_singleton_model_stage_classification",
        p_status: "proposed",
      })
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "apply_phase_c_opportunity_stage_decision",
      expect.objectContaining({
        p_decision_id: "decision-1",
        p_expected_stage: "quoted",
        p_expected_assignment_version: 3,
      })
    );
    expect(result).toMatchObject({ changed: true, stage: "negotiation" });
  });

  it("never applies when the evidence receipt cannot be persisted", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "decision store unavailable" },
    }));

    await expect(
      recordAndApplyPhaseCStageDecision({
        supabase: { rpc } as never,
        companyId: COMPANY_ID,
        opportunityId: OPPORTUNITY_ID,
        sourceEventId: SOURCE_EVENT_ID,
        evidenceEventIds: [SOURCE_EVENT_ID],
        evidenceMessageIds: ["message-1"],
        proposedStage: "negotiation",
        expectedStage: "quoted",
        expectedAssignmentVersion: 0,
        confidence: 0.8,
        reason: "strict_singleton_model_stage_classification",
      })
    ).rejects.toThrow("decision store unavailable");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("requires the source event to be included in the immutable evidence set", async () => {
    const rpc = vi.fn();
    await expect(
      recordAndApplyPhaseCStageDecision({
        supabase: { rpc } as never,
        companyId: COMPANY_ID,
        opportunityId: OPPORTUNITY_ID,
        sourceEventId: SOURCE_EVENT_ID,
        evidenceEventIds: [],
        evidenceMessageIds: ["message-1"],
        proposedStage: "negotiation",
        expectedStage: "quoted",
        expectedAssignmentVersion: 0,
        confidence: 0.8,
        reason: "strict_singleton_model_stage_classification",
      })
    ).rejects.toThrow("source event");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("loads the exact projected thread evidence and chooses the newest event as the source", async () => {
    const rows = [
      {
        id: SOURCE_EVENT_ID,
        provider_message_id: "message-new",
        occurred_at: "2026-08-20T15:13:00.000Z",
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        provider_message_id: "message-old",
        occurred_at: "2026-08-19T18:00:00.000Z",
      },
    ];
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: async () => ({ data: rows, error: null }),
    };
    const evidence = await loadPhaseCStageDecisionEvidence({
      supabase: { from: vi.fn(() => chain) } as never,
      companyId: COMPANY_ID,
      opportunityId: OPPORTUNITY_ID,
      connectionId: CONNECTION_ID,
      providerThreadIds: ["19edbe2358597058"],
    });

    expect(evidence).toEqual({
      sourceEventId: SOURCE_EVENT_ID,
      evidenceEventIds: [
        SOURCE_EVENT_ID,
        "55555555-5555-4555-8555-555555555555",
      ],
      evidenceMessageIds: ["message-new", "message-old"],
    });
  });

  it("recognises a replay conflict through the wrapper chain", async () => {
    const direct = new Error(
      "Phase C lifecycle decision persistence failed: lifecycle_decision_replay_conflict"
    );
    expect(isLifecycleDecisionReplayConflict(direct)).toBe(true);

    const wrapped = new Error("[sync-engine] accept-to-project conversion failed", {
      cause: direct,
    });
    expect(isLifecycleDecisionReplayConflict(wrapped)).toBe(true);
  });

  it("does not mistake an unrelated persistence failure for a replay conflict", () => {
    expect(
      isLifecycleDecisionReplayConflict(
        new Error(
          "Phase C lifecycle decision persistence failed: invalid_lifecycle_decision"
        )
      )
    ).toBe(false);
    expect(isLifecycleDecisionReplayConflict(null)).toBe(false);
    expect(
      isLifecycleDecisionReplayConflict("lifecycle_decision_replay_conflict")
    ).toBe(false);
  });

  it("terminates on a cyclic cause chain", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b") as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(isLifecycleDecisionReplayConflict(a)).toBe(false);
  });
});

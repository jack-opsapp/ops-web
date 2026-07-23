import { describe, expect, it } from "vitest";
import { applyOpportunityChaseState } from "@/lib/inbox/opportunity-chase-enrichment";

describe("opportunity chase enrichment", () => {
  it("overlays the exact lead reply state without forcing unrelated siblings", () => {
    const threads = [
      { id: "thread-a", opportunityId: "opp-a" },
      { id: "thread-b", opportunityId: "opp-b" },
      { id: "thread-c", opportunityId: "opp-c" },
      { id: "thread-unlinked", opportunityId: null },
    ];

    const enriched = applyOpportunityChaseState(threads, [
      {
        id: "opp-a",
        stage: "quoted",
        last_message_direction: "in",
        last_inbound_at: "2026-07-19T12:00:00.000Z",
        last_outbound_at: null,
        handled_at: null,
        operator_action_required_at: null,
      },
      {
        id: "opp-b",
        stage: "quoted",
        last_message_direction: "in",
        last_inbound_at: "2026-07-19T10:00:00.000Z",
        last_outbound_at: null,
        handled_at: "2026-07-19T11:00:00.000Z",
        operator_action_required_at: null,
      },
      {
        id: "opp-c",
        stage: "quoted",
        last_message_direction: "out",
        last_inbound_at: null,
        last_outbound_at: "2026-07-19T11:00:00.000Z",
        handled_at: null,
        operator_action_required_at: "2026-07-19T12:00:00.000Z",
      },
    ]);

    expect(enriched).toEqual([
      {
        id: "thread-a",
        opportunityId: "opp-a",
        opportunityNeedsReply: true,
      },
      {
        id: "thread-b",
        opportunityId: "opp-b",
        opportunityNeedsReply: false,
      },
      {
        id: "thread-c",
        opportunityId: "opp-c",
        opportunityNeedsReply: true,
      },
      {
        id: "thread-unlinked",
        opportunityId: null,
        opportunityNeedsReply: null,
      },
    ]);
  });

  it("falls back to thread signals when the linked opportunity enrichment is unavailable", () => {
    expect(
      applyOpportunityChaseState(
        [{ id: "thread-a", opportunityId: "opp-hidden" }],
        []
      )
    ).toEqual([
      {
        id: "thread-a",
        opportunityId: "opp-hidden",
        opportunityNeedsReply: null,
      },
    ]);
  });
});

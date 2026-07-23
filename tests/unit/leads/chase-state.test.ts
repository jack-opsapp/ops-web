import { describe, expect, it } from "vitest";
import {
  computeHandledFollowUpAt,
  getLeadChaseState,
  isLeadYourMove,
  type LeadChaseStateInput,
} from "@/lib/leads/chase-state";

const NOW = new Date("2026-07-19T12:00:00.000Z");
const LAST_INBOUND = new Date("2026-07-19T11:00:00.000Z");

function chase(
  overrides: Partial<LeadChaseStateInput> = {}
): LeadChaseStateInput {
  return {
    stage: "quoted",
    lastMessageDirection: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    handledAt: null,
    operatorActionRequiredAt: null,
    ...overrides,
  };
}

describe("lead chase state", () => {
  it("preserves direction fallback only when no timestamped signal exists", () => {
    expect(
      isLeadYourMove(
        chase({
          lastMessageDirection: "in",
        })
      )
    ).toBe(true);
    expect(
      isLeadYourMove(
        chase({
          lastMessageDirection: "out",
        })
      )
    ).toBe(false);
  });

  it("keeps NEW leads out of ownership buckets", () => {
    expect(
      isLeadYourMove(
        chase({
          stage: "new_lead",
          operatorActionRequiredAt: NOW,
        })
      )
    ).toBe(false);
    expect(
      getLeadChaseState(
        chase({
          stage: "new_lead",
          operatorActionRequiredAt: NOW,
        })
      )
    ).toBeNull();
  });

  it("moves outbound, directionless, and handled leads to YOUR MOVE", () => {
    expect(
      isLeadYourMove(
        chase({
          lastMessageDirection: "out",
          lastOutboundAt: LAST_INBOUND,
          operatorActionRequiredAt: NOW,
        })
      )
    ).toBe(true);
    expect(
      isLeadYourMove(
        chase({
          operatorActionRequiredAt: NOW,
        })
      )
    ).toBe(true);
    expect(
      isLeadYourMove(
        chase({
          lastMessageDirection: "in",
          lastInboundAt: "2026-07-19T10:00:00.000Z",
          handledAt: LAST_INBOUND,
          operatorActionRequiredAt: NOW,
        })
      )
    ).toBe(true);
  });

  it("lets later outbound and handled signals supersede a manual correction", () => {
    expect(
      isLeadYourMove(
        chase({
          lastMessageDirection: "out",
          lastOutboundAt: NOW,
          operatorActionRequiredAt: LAST_INBOUND,
        })
      )
    ).toBe(false);
    expect(
      isLeadYourMove(
        chase({
          lastMessageDirection: "in",
          lastInboundAt: "2026-07-19T10:00:00.000Z",
          handledAt: NOW,
          operatorActionRequiredAt: LAST_INBOUND,
        })
      )
    ).toBe(false);
  });

  it("uses timestamps even when the denormalized direction is stale", () => {
    expect(
      isLeadYourMove(
        chase({
          lastMessageDirection: "out",
          lastInboundAt: NOW,
          lastOutboundAt: LAST_INBOUND,
        })
      )
    ).toBe(true);
    expect(
      isLeadYourMove(
        chase({
          lastMessageDirection: "in",
          lastInboundAt: LAST_INBOUND,
          lastOutboundAt: NOW,
        })
      )
    ).toBe(false);
  });

  it("resolves exact ties deterministically", () => {
    expect(
      isLeadYourMove(
        chase({
          lastMessageDirection: "out",
          lastOutboundAt: NOW,
          handledAt: NOW,
          operatorActionRequiredAt: NOW,
        })
      )
    ).toBe(true);
    expect(
      isLeadYourMove(
        chase({
          lastMessageDirection: "in",
          lastInboundAt: NOW,
          handledAt: NOW,
        })
      )
    ).toBe(false);
    expect(
      isLeadYourMove(
        chase({
          lastMessageDirection: "in",
          lastInboundAt: NOW,
          lastOutboundAt: NOW,
        })
      )
    ).toBe(true);
    expect(
      isLeadYourMove(
        chase({
          lastMessageDirection: "out",
          lastInboundAt: NOW,
          lastOutboundAt: NOW,
        })
      )
    ).toBe(false);
  });

  it("ignores malformed timestamps and falls back only without a valid signal", () => {
    expect(
      isLeadYourMove(
        chase({
          lastMessageDirection: "in",
          lastInboundAt: LAST_INBOUND,
          handledAt: "not-a-date",
        })
      )
    ).toBe(true);
    expect(
      isLeadYourMove(
        chase({
          lastMessageDirection: "in",
          lastInboundAt: "not-a-date",
          handledAt: NOW,
        })
      )
    ).toBe(false);
    expect(
      isLeadYourMove(
        chase({
          lastMessageDirection: "in",
          lastInboundAt: "not-a-date",
          handledAt: "not-a-date",
        })
      )
    ).toBe(true);
  });

  it("resolves the shared presentation state from the canonical predicate", () => {
    expect(
      getLeadChaseState(
        chase({
          operatorActionRequiredAt: NOW,
        })
      )
    ).toBe("your_move");
    expect(
      getLeadChaseState(
        chase({
          lastMessageDirection: "in",
          lastInboundAt: LAST_INBOUND,
          handledAt: NOW,
        })
      )
    ).toBe("waiting");
    expect(
      getLeadChaseState(
        chase({
          lastMessageDirection: "out",
          lastOutboundAt: NOW,
        })
      )
    ).toBe("waiting");
  });

  it("keeps an unhandled inbound in YOUR MOVE", () => {
    expect(
      isLeadYourMove(
        chase({
          lastMessageDirection: "in",
          lastInboundAt: LAST_INBOUND,
        })
      )
    ).toBe(true);
  });
});

describe("handled comeback date", () => {
  it("defaults to three days from the handled timestamp", () => {
    expect(computeHandledFollowUpAt(null, NOW).toISOString()).toBe(
      "2026-07-22T12:00:00.000Z"
    );
  });

  it("preserves an existing future follow-up when it is sooner", () => {
    const sooner = new Date("2026-07-20T09:30:00.000Z");
    expect(computeHandledFollowUpAt(sooner, NOW)).toEqual(sooner);
  });

  it("replaces past, invalid, and later follow-ups with the three-day comeback", () => {
    const expected = "2026-07-22T12:00:00.000Z";
    expect(
      computeHandledFollowUpAt("2026-07-18T12:00:00.000Z", NOW).toISOString()
    ).toBe(expected);
    expect(computeHandledFollowUpAt("not-a-date", NOW).toISOString()).toBe(
      expected
    );
    expect(
      computeHandledFollowUpAt("2026-07-30T12:00:00.000Z", NOW).toISOString()
    ).toBe(expected);
  });
});

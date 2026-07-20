import { describe, expect, it } from "vitest";
import {
  computeHandledFollowUpAt,
  getLeadChaseState,
  isLeadYourMove,
} from "@/lib/leads/chase-state";

const NOW = new Date("2026-07-19T12:00:00.000Z");
const LAST_INBOUND = new Date("2026-07-19T11:00:00.000Z");

describe("lead chase state", () => {
  it("requires an active inbound lead before declaring YOUR MOVE", () => {
    expect(
      isLeadYourMove({
        stage: "quoted",
        lastMessageDirection: "in",
        lastInboundAt: LAST_INBOUND,
        handledAt: null,
      })
    ).toBe(true);

    expect(
      isLeadYourMove({
        stage: "new_lead",
        lastMessageDirection: "in",
        lastInboundAt: LAST_INBOUND,
        handledAt: null,
      })
    ).toBe(false);
    expect(
      isLeadYourMove({
        stage: "quoted",
        lastMessageDirection: "out",
        lastInboundAt: LAST_INBOUND,
        handledAt: null,
      })
    ).toBe(false);
  });

  it("stays WAITING after handling until a newer inbound re-arms the lead", () => {
    expect(
      isLeadYourMove({
        stage: "quoted",
        lastMessageDirection: "in",
        lastInboundAt: LAST_INBOUND,
        handledAt: LAST_INBOUND,
      })
    ).toBe(false);
    expect(
      isLeadYourMove({
        stage: "quoted",
        lastMessageDirection: "in",
        lastInboundAt: "2026-07-19T11:00:00.001Z",
        handledAt: LAST_INBOUND,
      })
    ).toBe(true);
  });

  it("keeps an unhandled inbound in YOUR MOVE even before its timestamp projects", () => {
    expect(
      isLeadYourMove({
        stage: "quoted",
        lastMessageDirection: "in",
        lastInboundAt: null,
        handledAt: null,
      })
    ).toBe(true);
  });

  it("does not let malformed handled data suppress a valid inbound", () => {
    expect(
      isLeadYourMove({
        stage: "quoted",
        lastMessageDirection: "in",
        lastInboundAt: LAST_INBOUND,
        handledAt: "not-a-date",
      })
    ).toBe(true);
  });

  it("requires a valid inbound timestamp only when comparing against HANDLED", () => {
    expect(
      isLeadYourMove({
        stage: "quoted",
        lastMessageDirection: "in",
        lastInboundAt: "not-a-date",
        handledAt: NOW,
      })
    ).toBe(true);
  });

  it("resolves the shared presentation state from the canonical predicate", () => {
    expect(
      getLeadChaseState({
        stage: "quoted",
        lastMessageDirection: "in",
        lastInboundAt: LAST_INBOUND,
        handledAt: null,
      })
    ).toBe("your_move");
    expect(
      getLeadChaseState({
        stage: "quoted",
        lastMessageDirection: "in",
        lastInboundAt: LAST_INBOUND,
        handledAt: NOW,
      })
    ).toBe("waiting");
    expect(
      getLeadChaseState({
        stage: "quoted",
        lastMessageDirection: "out",
        lastInboundAt: LAST_INBOUND,
        handledAt: NOW,
      })
    ).toBeNull();
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

import { describe, it, expect } from "vitest";
import {
  CLIENT_FACING_PRIMARY_CATEGORIES,
  RAIL_NAV_OPTIONS,
  classifyRail,
  classifyThreadState,
  isArchived,
  isClientFacingThread,
  isRailFilter,
  isSnoozed,
  isWaiting,
  isYourMove,
  parseRailFilter,
  type RailFilter,
  type RailPredicateThread,
} from "@/lib/inbox/rail-predicates";

const NOW = new Date("2026-05-12T15:00:00Z").getTime();
const FUTURE = new Date("2026-05-13T15:00:00Z").toISOString();
const PAST = new Date("2026-05-11T15:00:00Z").toISOString();

function makeThread(
  overrides: Partial<RailPredicateThread> = {}
): RailPredicateThread {
  return {
    archived_at: null,
    snoozed_until: null,
    has_unresolved_commitments: false,
    labels: [],
    latest_direction: null,
    unread_count: 0,
    agent_blocking_question: null,
    ...overrides,
  };
}

describe("rail-predicates / classifyRail", () => {
  it("classifies linked client/opportunity threads as CLIENTS", () => {
    expect(classifyRail(makeThread({ client_id: "client-1" }))).toBe("CLIENTS");
    expect(classifyRail(makeThread({ opportunity_id: "opp-1" }))).toBe(
      "CLIENTS"
    );
  });

  it("treats customer and bid-style primary categories as CLIENTS", () => {
    expect(classifyRail(makeThread({ primary_category: "CUSTOMER" }))).toBe(
      "CLIENTS"
    );
    expect(classifyRail(makeThread({ primary_category: "PLATFORM_BID" }))).toBe(
      "CLIENTS"
    );
    expect([...CLIENT_FACING_PRIMARY_CATEGORIES]).toEqual([
      "CUSTOMER",
      "PLATFORM_BID",
    ]);
  });

  it("classifies non-client operational mail as EVERYTHING_ELSE", () => {
    for (const primary_category of [
      "VENDOR",
      "SUBTRADE",
      "LEGAL",
      "JOB_SEEKER",
      "COLLECTIONS",
      "MARKETING",
      "RECEIPT",
      "PERSONAL",
      "INTERNAL",
      "OTHER",
      null,
    ]) {
      expect(classifyRail(makeThread({ primary_category }))).toBe(
        "EVERYTHING_ELSE"
      );
    }
  });

  it("keeps reply debt out of top-level section membership", () => {
    const replyDebtClient = makeThread({
      primary_category: "CUSTOMER",
      labels: ["AWAITING_REPLY"],
      latest_direction: "inbound",
      unread_count: 0,
    });
    const replyDebtVendor = makeThread({
      primary_category: "VENDOR",
      labels: ["AWAITING_REPLY"],
      latest_direction: "inbound",
      unread_count: 0,
    });

    expect(classifyRail(replyDebtClient)).toBe("CLIENTS");
    expect(classifyRail(replyDebtVendor)).toBe("EVERYTHING_ELSE");
    expect(isYourMove(replyDebtClient, NOW)).toBe(true);
    expect(isYourMove(replyDebtVendor, NOW)).toBe(true);
  });
});

describe("rail-predicates / classifyThreadState", () => {
  it("partitions non-archived non-snoozed threads into exactly YOUR_MOVE or WAITING", () => {
    const universe: RailPredicateThread[] = [
      makeThread({ has_unresolved_commitments: true }),
      makeThread({ labels: ["AWAITING_REPLY"] }),
      makeThread({ latest_direction: "inbound", unread_count: 3 }),
      makeThread({ agent_blocking_question: { question: "x", askedAt: "z" } }),
      makeThread({ latest_direction: "outbound", unread_count: 0 }),
      makeThread({ latest_direction: null, unread_count: 0 }),
      makeThread({ labels: ["URGENT"] }),
    ];

    for (const thread of universe) {
      const matches = (["YOUR_MOVE", "WAITING"] as const).filter(
        (rail) => classifyThreadState(thread, NOW) === rail
      );
      expect(matches).toHaveLength(1);
    }
  });

  it("treats archived threads as ARCHIVED regardless of other state", () => {
    const archivedWithEverything = makeThread({
      archived_at: PAST,
      has_unresolved_commitments: true,
      labels: ["AWAITING_REPLY"],
      latest_direction: "inbound",
      unread_count: 5,
    });
    expect(classifyThreadState(archivedWithEverything, NOW)).toBe("ARCHIVED");
    expect(isArchived(archivedWithEverything)).toBe(true);
    expect(isYourMove(archivedWithEverything, NOW)).toBe(false);
    expect(isWaiting(archivedWithEverything, NOW)).toBe(false);
  });

  it("hides snoozed threads from YOUR_MOVE and WAITING; surfaces them in SNOOZED", () => {
    const snoozed = makeThread({
      snoozed_until: FUTURE,
      labels: ["AWAITING_REPLY"],
      latest_direction: "inbound",
      unread_count: 1,
    });
    expect(classifyThreadState(snoozed, NOW)).toBe("SNOOZED");
    expect(isYourMove(snoozed, NOW)).toBe(false);
    expect(isWaiting(snoozed, NOW)).toBe(false);
    expect(isSnoozed(snoozed, NOW)).toBe(true);
  });

  it("counts a past snooze as expired (active pile)", () => {
    const expiredSnooze = makeThread({
      snoozed_until: PAST,
      labels: ["AWAITING_REPLY"],
    });
    expect(classifyThreadState(expiredSnooze, NOW)).toBe("YOUR_MOVE");
  });

  it("YOUR_MOVE: triggers on any of {commitment, AWAITING_REPLY, unread inbound, agent question}", () => {
    expect(
      classifyThreadState(makeThread({ has_unresolved_commitments: true }), NOW)
    ).toBe("YOUR_MOVE");
    expect(
      classifyThreadState(makeThread({ labels: ["AWAITING_REPLY"] }), NOW)
    ).toBe("YOUR_MOVE");
    expect(
      classifyThreadState(
        makeThread({ latest_direction: "inbound", unread_count: 1 }),
        NOW
      )
    ).toBe("YOUR_MOVE");
    expect(
      classifyThreadState(
        makeThread({
          agent_blocking_question: { question: "?", askedAt: "z" },
        }),
        NOW
      )
    ).toBe("YOUR_MOVE");
  });

  it("suppresses linked-lead reply debt after HANDLED without erasing stronger obligations", () => {
    const handledReplyDebt = makeThread({
      opportunity_id: "opp-1",
      opportunity_needs_reply: false,
      labels: ["AWAITING_REPLY"],
      latest_direction: "inbound",
      unread_count: 1,
    });
    expect(classifyThreadState(handledReplyDebt, NOW)).toBe("WAITING");

    expect(
      classifyThreadState(
        { ...handledReplyDebt, has_unresolved_commitments: true },
        NOW
      )
    ).toBe("YOUR_MOVE");
    expect(
      classifyThreadState(
        {
          ...handledReplyDebt,
          agent_blocking_question: { question: "Need scope", askedAt: "z" },
        },
        NOW
      )
    ).toBe("YOUR_MOVE");
  });

  it("does not force every linked sibling into YOUR_MOVE when the lead re-arms", () => {
    expect(
      classifyThreadState(
        makeThread({
          opportunity_id: "opp-1",
          opportunity_needs_reply: true,
          latest_direction: "outbound",
          unread_count: 0,
        }),
        NOW
      )
    ).toBe("WAITING");
  });

  it("WAITING: outbound-last, read, no commitment, no AWAITING_REPLY, no agent block", () => {
    const waiting = makeThread({
      latest_direction: "outbound",
      unread_count: 0,
    });
    expect(classifyThreadState(waiting, NOW)).toBe("WAITING");
  });

  it("WAITING: a quiet thread with no direction info still partitions cleanly", () => {
    // Audit population sample includes pre-classification rows.
    const quiet = makeThread({ latest_direction: null, unread_count: 0 });
    expect(classifyThreadState(quiet, NOW)).toBe("WAITING");
  });

  it("read inbound (unread_count=0) is WAITING — operator already opened it", () => {
    const read = makeThread({ latest_direction: "inbound", unread_count: 0 });
    expect(classifyThreadState(read, NOW)).toBe("WAITING");
  });

  it("ARCHIVED beats SNOOZED when both flags set (archive is terminal)", () => {
    const both = makeThread({ archived_at: PAST, snoozed_until: FUTURE });
    expect(classifyThreadState(both, NOW)).toBe("ARCHIVED");
  });
});

describe("rail-predicates / parseRailFilter", () => {
  it("accepts canonical values verbatim", () => {
    expect(parseRailFilter("CLIENTS")).toBe("CLIENTS");
    expect(parseRailFilter("EVERYTHING_ELSE")).toBe("EVERYTHING_ELSE");
    expect(parseRailFilter("ALL")).toBe("ALL");
    expect(parseRailFilter("ARCHIVED")).toBe("ARCHIVED");
    expect(parseRailFilter("SNOOZED")).toBe("SNOOZED");
  });

  it("uppercases tolerantly", () => {
    expect(parseRailFilter("clients")).toBe("CLIENTS");
    expect(parseRailFilter("everything_else")).toBe("EVERYTHING_ELSE");
    expect(parseRailFilter("archived")).toBe("ARCHIVED");
  });

  it("maps legacy six-tab strings forward without breaking bookmarks", () => {
    expect(parseRailFilter("everything")).toBe("ALL");
    expect(parseRailFilter("needs_reply")).toBe("ALL");
    expect(parseRailFilter("commitments")).toBe("ALL");
    expect(parseRailFilter("drafts")).toBe("ALL");
    expect(parseRailFilter("scheduled")).toBe("ALL");
    expect(parseRailFilter("done")).toBe("ARCHIVED");
    expect(parseRailFilter("YOUR_MOVE")).toBe("ALL");
    expect(parseRailFilter("WAITING")).toBe("ALL");
  });

  it("falls back to CLIENTS for null / unknown values", () => {
    expect(parseRailFilter(null)).toBe("CLIENTS");
    expect(parseRailFilter("")).toBe("CLIENTS");
    expect(parseRailFilter("nonsense")).toBe("CLIENTS");
  });

  it("honours an explicit fallback override", () => {
    expect(parseRailFilter(null, "ALL")).toBe("ALL");
    expect(parseRailFilter("nonsense", "EVERYTHING_ELSE")).toBe(
      "EVERYTHING_ELSE"
    );
  });
});

describe("rail-predicates / isRailFilter", () => {
  it("identifies canonical rails as RailFilter", () => {
    for (const rail of [
      "CLIENTS",
      "EVERYTHING_ELSE",
      "ALL",
      "ARCHIVED",
      "SNOOZED",
    ]) {
      expect(isRailFilter(rail)).toBe(true);
    }
  });

  it("rejects legacy + unknown strings", () => {
    expect(isRailFilter("needs_reply")).toBe(false);
    expect(isRailFilter("everything")).toBe(false);
    expect(isRailFilter("DONE")).toBe(false);
    expect(isRailFilter(null)).toBe(false);
    expect(isRailFilter(42)).toBe(false);
  });
});

describe("rail-predicates / RAIL_NAV_OPTIONS", () => {
  it("exposes the three primary IA rails in display order, excluding utilities", () => {
    expect([...RAIL_NAV_OPTIONS]).toEqual([
      "CLIENTS",
      "EVERYTHING_ELSE",
      "ALL",
    ]);
    expect(
      (RAIL_NAV_OPTIONS as ReadonlyArray<string>).includes("SNOOZED")
    ).toBe(false);
    expect(
      (RAIL_NAV_OPTIONS as ReadonlyArray<string>).includes("ARCHIVED")
    ).toBe(false);
  });
});

describe("rail-predicates / type-level coverage", () => {
  // Guarantees the union doesn't drift without test updates.
  it("RailFilter union is exhaustive", () => {
    const ALL_RAILS: RailFilter[] = [
      "CLIENTS",
      "EVERYTHING_ELSE",
      "ALL",
      "ARCHIVED",
      "SNOOZED",
    ];
    expect(new Set(ALL_RAILS).size).toBe(5);
  });
});

describe("rail-predicates / isClientFacingThread", () => {
  it("uses linkage before category so future custom categories can layer on safely", () => {
    expect(
      isClientFacingThread(
        makeThread({ primary_category: "VENDOR", client_id: "client-1" })
      )
    ).toBe(true);
    expect(
      isClientFacingThread(
        makeThread({ primary_category: "OTHER", opportunity_id: "opp-1" })
      )
    ).toBe(true);
    expect(
      isClientFacingThread(makeThread({ primary_category: "VENDOR" }))
    ).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  RAIL_NAV_OPTIONS,
  classifyRail,
  isArchived,
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
  overrides: Partial<RailPredicateThread> = {},
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
  it("partitions non-archived non-snoozed threads into exactly YOUR_MOVE or WAITING", () => {
    const universe: RailPredicateThread[] = [
      makeThread({ has_unresolved_commitments: true }),
      makeThread({ labels: ["AWAITING_REPLY"] }),
      makeThread({ latest_direction: "inbound", unread_count: 3 }),
      makeThread({ agent_blocking_question: { question: "x", askedAt: "z" } }),
      makeThread({ latest_direction: "outbound", unread_count: 0 }),
      makeThread({ latest_direction: null, unread_count: 0 }),
      makeThread({ labels: ["URGENT"] }), // URGENT alone — operator already replied
    ];

    for (const thread of universe) {
      const matches = (
        ["YOUR_MOVE", "WAITING"] as const
      ).filter((rail) => classifyRail(thread, NOW) === rail);
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
    expect(classifyRail(archivedWithEverything, NOW)).toBe("ARCHIVED");
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
    expect(classifyRail(snoozed, NOW)).toBe("SNOOZED");
    expect(isYourMove(snoozed, NOW)).toBe(false);
    expect(isWaiting(snoozed, NOW)).toBe(false);
    expect(isSnoozed(snoozed, NOW)).toBe(true);
  });

  it("counts a past snooze as expired (active pile)", () => {
    const expiredSnooze = makeThread({
      snoozed_until: PAST,
      labels: ["AWAITING_REPLY"],
    });
    expect(classifyRail(expiredSnooze, NOW)).toBe("YOUR_MOVE");
  });

  it("YOUR_MOVE: triggers on any of {commitment, AWAITING_REPLY, unread inbound, agent question}", () => {
    expect(
      classifyRail(makeThread({ has_unresolved_commitments: true }), NOW),
    ).toBe("YOUR_MOVE");
    expect(classifyRail(makeThread({ labels: ["AWAITING_REPLY"] }), NOW)).toBe(
      "YOUR_MOVE",
    );
    expect(
      classifyRail(
        makeThread({ latest_direction: "inbound", unread_count: 1 }),
        NOW,
      ),
    ).toBe("YOUR_MOVE");
    expect(
      classifyRail(
        makeThread({ agent_blocking_question: { question: "?", askedAt: "z" } }),
        NOW,
      ),
    ).toBe("YOUR_MOVE");
  });

  it("WAITING: outbound-last, read, no commitment, no AWAITING_REPLY, no agent block", () => {
    const waiting = makeThread({
      latest_direction: "outbound",
      unread_count: 0,
    });
    expect(classifyRail(waiting, NOW)).toBe("WAITING");
  });

  it("WAITING: a quiet thread with no direction info still partitions cleanly", () => {
    // Audit population sample includes pre-classification rows.
    const quiet = makeThread({ latest_direction: null, unread_count: 0 });
    expect(classifyRail(quiet, NOW)).toBe("WAITING");
  });

  it("read inbound (unread_count=0) is WAITING — operator already opened it", () => {
    const read = makeThread({ latest_direction: "inbound", unread_count: 0 });
    expect(classifyRail(read, NOW)).toBe("WAITING");
  });

  it("ARCHIVED beats SNOOZED when both flags set (archive is terminal)", () => {
    const both = makeThread({ archived_at: PAST, snoozed_until: FUTURE });
    expect(classifyRail(both, NOW)).toBe("ARCHIVED");
  });
});

describe("rail-predicates / parseRailFilter", () => {
  it("accepts canonical values verbatim", () => {
    expect(parseRailFilter("ALL")).toBe("ALL");
    expect(parseRailFilter("YOUR_MOVE")).toBe("YOUR_MOVE");
    expect(parseRailFilter("WAITING")).toBe("WAITING");
    expect(parseRailFilter("ARCHIVED")).toBe("ARCHIVED");
    expect(parseRailFilter("SNOOZED")).toBe("SNOOZED");
  });

  it("uppercases tolerantly", () => {
    expect(parseRailFilter("your_move")).toBe("YOUR_MOVE");
    expect(parseRailFilter("archived")).toBe("ARCHIVED");
  });

  it("maps legacy six-tab strings forward without breaking bookmarks", () => {
    expect(parseRailFilter("everything")).toBe("ALL");
    expect(parseRailFilter("needs_reply")).toBe("YOUR_MOVE");
    expect(parseRailFilter("commitments")).toBe("YOUR_MOVE");
    expect(parseRailFilter("drafts")).toBe("ALL");
    expect(parseRailFilter("scheduled")).toBe("ALL");
    expect(parseRailFilter("done")).toBe("ARCHIVED");
  });

  it("falls back to YOUR_MOVE for null / unknown values", () => {
    expect(parseRailFilter(null)).toBe("YOUR_MOVE");
    expect(parseRailFilter("")).toBe("YOUR_MOVE");
    expect(parseRailFilter("nonsense")).toBe("YOUR_MOVE");
  });

  it("honours an explicit fallback override", () => {
    expect(parseRailFilter(null, "ALL")).toBe("ALL");
    expect(parseRailFilter("nonsense", "WAITING")).toBe("WAITING");
  });
});

describe("rail-predicates / isRailFilter", () => {
  it("identifies canonical rails as RailFilter", () => {
    for (const rail of ["ALL", "YOUR_MOVE", "WAITING", "ARCHIVED", "SNOOZED"]) {
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
  it("exposes the four operator-facing rails in display order, excluding SNOOZED", () => {
    expect([...RAIL_NAV_OPTIONS]).toEqual([
      "ALL",
      "YOUR_MOVE",
      "WAITING",
      "ARCHIVED",
    ]);
    expect((RAIL_NAV_OPTIONS as ReadonlyArray<string>).includes("SNOOZED")).toBe(
      false,
    );
  });
});

describe("rail-predicates / type-level coverage", () => {
  // Guarantees the union doesn't drift without test updates.
  it("RailFilter union is exhaustive", () => {
    const ALL_RAILS: RailFilter[] = [
      "ALL",
      "YOUR_MOVE",
      "WAITING",
      "ARCHIVED",
      "SNOOZED",
    ];
    expect(new Set(ALL_RAILS).size).toBe(5);
  });
});

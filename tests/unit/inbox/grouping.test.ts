import { describe, it, expect } from "vitest";
import {
  groupThreads,
  GROUP_ORDER,
  type GroupKey,
  type ThreadForGrouping,
} from "@/lib/inbox/grouping";

const NOW = new Date("2026-05-06T15:00:00Z").getTime();

const makeThread = (
  id: string,
  overrides: Partial<ThreadForGrouping> = {},
): ThreadForGrouping => ({
  id,
  ts: NOW,
  labels: [],
  agent: { needsInput: false },
  phaseC: "none",
  closed: false,
  ...overrides,
});

describe("groupThreads", () => {
  it("places agent-blocked threads in NEEDS_YOUR_INPUT", () => {
    const t = makeThread("a", { agent: { needsInput: true } });
    const groups = groupThreads([t], NOW);
    expect(groups.get("NEEDS_YOUR_INPUT")).toEqual([t]);
  });

  it("places URGENT-labelled threads in URGENT", () => {
    const t = makeThread("b", { labels: ["URGENT"] });
    const groups = groupThreads([t], NOW);
    expect(groups.get("URGENT")).toEqual([t]);
  });

  it("buckets by recency: today vs this week vs earlier", () => {
    const today = makeThread("t", { ts: NOW - 1000 * 60 * 60 * 2 }); // 2h ago
    const thisWeek = makeThread("w", { ts: NOW - 1000 * 60 * 60 * 24 * 3 }); // 3d ago
    const earlier = makeThread("e", { ts: NOW - 1000 * 60 * 60 * 24 * 30 }); // 30d ago
    const groups = groupThreads([today, thisWeek, earlier], NOW);
    expect(groups.get("TODAY")?.[0].id).toBe("t");
    expect(groups.get("THIS_WEEK")?.[0].id).toBe("w");
    expect(groups.get("EARLIER")?.[0].id).toBe("e");
  });

  it("orders groups: needs-input → urgent → today → this-week → earlier", () => {
    const keys = Array.from(groupThreads([], NOW).keys()) as GroupKey[];
    expect(keys).toEqual(GROUP_ORDER);
    expect(GROUP_ORDER).toEqual([
      "NEEDS_YOUR_INPUT",
      "URGENT",
      "TODAY",
      "THIS_WEEK",
      "EARLIER",
    ]);
  });

  it("auto-sent threads are suppressed from default groupings", () => {
    const t = makeThread("x", { phaseC: "auto_sent" });
    const groups = groupThreads([t], NOW);
    expect([...groups.values()].flat()).toEqual([]);
  });

  it("closed threads are excluded by default", () => {
    const t = makeThread("c", { closed: true });
    const groups = groupThreads([t], NOW);
    expect([...groups.values()].flat()).toEqual([]);
  });

  it("needs-input takes precedence over URGENT label", () => {
    const t = makeThread("p", {
      agent: { needsInput: true },
      labels: ["URGENT"],
    });
    const groups = groupThreads([t], NOW);
    expect(groups.get("NEEDS_YOUR_INPUT")).toEqual([t]);
    expect(groups.get("URGENT") ?? []).toEqual([]);
  });

  it("orders threads within a group newest-first", () => {
    const a = makeThread("a", { ts: NOW - 1000 * 60 * 60 * 1 });
    const b = makeThread("b", { ts: NOW - 1000 * 60 * 60 * 5 });
    const c = makeThread("c", { ts: NOW - 1000 * 60 * 30 });
    const groups = groupThreads([a, b, c], NOW);
    expect(groups.get("TODAY")?.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });
});

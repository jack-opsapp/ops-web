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
  unread: false,
  draftKind: null,
  ...overrides,
});

describe("groupThreads", () => {
  it("places agent-blocked threads in NEEDS_INPUT", () => {
    const t = makeThread("a", { agent: { needsInput: true } });
    const groups = groupThreads([t], NOW);
    expect(groups.get("NEEDS_INPUT")).toEqual([t]);
  });

  it("places unread threads in NEEDS_REPLY", () => {
    const t = makeThread("b", { unread: true });
    const groups = groupThreads([t], NOW);
    expect(groups.get("NEEDS_REPLY")).toEqual([t]);
  });

  it("places ai-drafted threads in DRAFTS_READY (overrides unread)", () => {
    const t = makeThread("d", { phaseC: "ai_drafted", unread: true });
    const groups = groupThreads([t], NOW);
    expect(groups.get("DRAFTS_READY")).toEqual([t]);
  });

  it("places user-drafted threads in DRAFTS_READY", () => {
    const t = makeThread("u", { draftKind: "user" });
    const groups = groupThreads([t], NOW);
    expect(groups.get("DRAFTS_READY")).toEqual([t]);
  });

  it("buckets non-unread reads: recent → AWAITING_THEM, old → LATER", () => {
    const recent = makeThread("r", { ts: NOW - 1000 * 60 * 60 * 24 * 3 }); // 3d ago
    const old = makeThread("o", { ts: NOW - 1000 * 60 * 60 * 24 * 30 }); // 30d ago
    const groups = groupThreads([recent, old], NOW);
    expect(groups.get("AWAITING_THEM")?.[0].id).toBe("r");
    expect(groups.get("LATER")?.[0].id).toBe("o");
  });

  it("orders groups: needs-input → needs-reply → drafts-ready → awaiting-them → later", () => {
    const keys = Array.from(groupThreads([], NOW).keys()) as GroupKey[];
    expect(keys).toEqual(GROUP_ORDER);
    expect(GROUP_ORDER).toEqual([
      "NEEDS_INPUT",
      "NEEDS_REPLY",
      "DRAFTS_READY",
      "AWAITING_THEM",
      "LATER",
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

  it("needs-input takes precedence over unread", () => {
    const t = makeThread("p", {
      agent: { needsInput: true },
      unread: true,
    });
    const groups = groupThreads([t], NOW);
    expect(groups.get("NEEDS_INPUT")).toEqual([t]);
    expect(groups.get("NEEDS_REPLY") ?? []).toEqual([]);
  });

  it("orders threads within a group newest-first", () => {
    const a = makeThread("a", {
      unread: true,
      ts: NOW - 1000 * 60 * 60 * 1,
    });
    const b = makeThread("b", {
      unread: true,
      ts: NOW - 1000 * 60 * 60 * 5,
    });
    const c = makeThread("c", {
      unread: true,
      ts: NOW - 1000 * 60 * 30,
    });
    const groups = groupThreads([a, b, c], NOW);
    expect(groups.get("NEEDS_REPLY")?.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });
});

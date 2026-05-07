import { describe, it, expect } from "vitest";
import {
  getNextPrevThreadIds,
  flattenGroupedIds,
} from "@/components/ops/inbox/use-thread-keyboard";

describe("getNextPrevThreadIds", () => {
  it("returns null for empty list", () => {
    expect(getNextPrevThreadIds([], "x")).toEqual({ prevId: null, nextId: null });
  });

  it("returns null prev/next when current is null", () => {
    expect(getNextPrevThreadIds(["a", "b"], null)).toEqual({
      prevId: null,
      nextId: null,
    });
  });

  it("returns null prev/next when current isn't in list", () => {
    expect(getNextPrevThreadIds(["a", "b"], "x")).toEqual({
      prevId: null,
      nextId: null,
    });
  });

  it("returns prev/next around current", () => {
    expect(getNextPrevThreadIds(["a", "b", "c", "d"], "b")).toEqual({
      prevId: "a",
      nextId: "c",
    });
  });

  it("clamps at edges", () => {
    expect(getNextPrevThreadIds(["a", "b", "c"], "a")).toEqual({
      prevId: null,
      nextId: "b",
    });
    expect(getNextPrevThreadIds(["a", "b", "c"], "c")).toEqual({
      prevId: "b",
      nextId: null,
    });
  });
});

describe("flattenGroupedIds", () => {
  it("walks groups in the provided order, concatenating items", () => {
    const groups = new Map<string, { id: string }[]>([
      ["NEEDS_YOUR_INPUT", [{ id: "n1" }]],
      ["URGENT", []],
      ["TODAY", [{ id: "t1" }, { id: "t2" }]],
      ["EARLIER", [{ id: "e1" }]],
    ]);
    expect(
      flattenGroupedIds(
        ["NEEDS_YOUR_INPUT", "URGENT", "TODAY", "THIS_WEEK", "EARLIER"],
        groups,
      ),
    ).toEqual(["n1", "t1", "t2", "e1"]);
  });

  it("returns empty when no groups have items", () => {
    expect(flattenGroupedIds(["A", "B"], new Map())).toEqual([]);
  });
});

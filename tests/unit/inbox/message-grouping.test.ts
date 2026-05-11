import { describe, it, expect } from "vitest";
import {
  annotateMessages,
  type MessageForGrouping,
} from "@/lib/inbox/message-grouping";

const RUN_GAP_MS = 5 * 60 * 1000;

const make = (
  id: string,
  authorId: string,
  ts: string,
  source: MessageForGrouping["source"] = "human",
): MessageForGrouping => ({ id, authorId, ts: Date.parse(ts), source });

describe("annotateMessages", () => {
  it("returns empty array for empty input", () => {
    expect(annotateMessages([])).toEqual([]);
  });

  it("marks single message as both first and last of its run", () => {
    const a = make("a", "u1", "2026-05-06T10:00:00Z");
    const out = annotateMessages([a]);
    expect(out).toHaveLength(1);
    expect(out[0].isFirstOfRun).toBe(true);
    expect(out[0].isLastOfRun).toBe(true);
    expect(out[0].dayBoundary).toBe(true);
  });

  it("groups consecutive same-author messages within 5 minutes into one run", () => {
    const a = make("a", "u1", "2026-05-06T10:00:00Z");
    const b = make("b", "u1", "2026-05-06T10:01:30Z");
    const c = make("c", "u1", "2026-05-06T10:04:00Z");
    const out = annotateMessages([a, b, c]);
    expect(out[0].isFirstOfRun).toBe(true);
    expect(out[0].isLastOfRun).toBe(false);
    expect(out[1].isFirstOfRun).toBe(false);
    expect(out[1].isLastOfRun).toBe(false);
    expect(out[2].isFirstOfRun).toBe(false);
    expect(out[2].isLastOfRun).toBe(true);
  });

  it("breaks the run when same author exceeds the 5-minute gap", () => {
    const a = make("a", "u1", "2026-05-06T10:00:00Z");
    const b = make("b", "u1", "2026-05-06T10:00:00Z");
    const c = make(
      "c",
      "u1",
      new Date(Date.parse("2026-05-06T10:00:00Z") + RUN_GAP_MS + 1).toISOString(),
    );
    const out = annotateMessages([a, b, c]);
    expect(out[1].isLastOfRun).toBe(true);
    expect(out[2].isFirstOfRun).toBe(true);
  });

  it("breaks the run on author change", () => {
    const a = make("a", "u1", "2026-05-06T10:00:00Z");
    const b = make("b", "u2", "2026-05-06T10:01:00Z");
    const out = annotateMessages([a, b]);
    expect(out[0].isLastOfRun).toBe(true);
    expect(out[1].isFirstOfRun).toBe(true);
  });

  it("flags day boundary on first message of a new calendar day", () => {
    const a = make("a", "u1", "2026-05-06T22:00:00Z");
    const b = make("b", "u1", "2026-05-07T01:00:00Z");
    const out = annotateMessages([a, b]);
    expect(out[0].dayBoundary).toBe(true);
    expect(out[1].dayBoundary).toBe(true);
  });

  it("treats AI-source as a distinct author run from the same authorId", () => {
    const a = make("a", "u1", "2026-05-06T10:00:00Z", "human");
    const b = make("b", "u1", "2026-05-06T10:01:00Z", "ai");
    const out = annotateMessages([a, b]);
    expect(out[0].isLastOfRun).toBe(true);
    expect(out[1].isFirstOfRun).toBe(true);
  });
});

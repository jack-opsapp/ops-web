import { describe, expect, it } from "vitest";
import {
  EMAIL_SYNC_AI_STAGE_RESERVE_MS,
  EMAIL_SYNC_DEADLINE_SAFETY_MARGIN_MS,
  EMAIL_SYNC_MAX_RUNTIME_MS,
  EMAIL_SYNC_MIN_CONNECTION_BUDGET_MS,
  EMAIL_SYNC_PHASE_FLOOR_MS,
  EMAIL_SYNC_POST_LOOP_RESERVE_MS,
  createInvocationDeadline,
} from "@/lib/api/services/invocation-deadline";

const STARTED_AT = 1_800_000_000_000;

describe("invocation deadline", () => {
  it("reserves the safety margin out of the platform runtime", () => {
    const deadline = createInvocationDeadline({
      maxRuntimeMs: 300_000,
      safetyMarginMs: 45_000,
      startedAtMs: STARTED_AT,
    });

    expect(deadline.deadlineAt).toBe(STARTED_AT + 255_000);
  });

  it("clamps remaining time at zero once the deadline has passed", () => {
    const deadline = createInvocationDeadline({
      maxRuntimeMs: 300_000,
      safetyMarginMs: 45_000,
      startedAtMs: STARTED_AT,
    });

    expect(deadline.remainingMs(STARTED_AT)).toBe(255_000);
    expect(deadline.remainingMs(STARTED_AT + 100_000)).toBe(155_000);
    expect(deadline.remainingMs(STARTED_AT + 255_000)).toBe(0);
    expect(deadline.remainingMs(STARTED_AT + 900_000)).toBe(0);
  });

  it("treats exactly-the-reserve as expired and one millisecond more as live", () => {
    const deadline = createInvocationDeadline({
      maxRuntimeMs: 300_000,
      safetyMarginMs: 45_000,
      startedAtMs: STARTED_AT,
    });
    // deadlineAt is STARTED_AT + 255_000; with a 90s reserve the boundary sits
    // at STARTED_AT + 165_000.
    expect(deadline.expired(90_000, STARTED_AT + 164_999)).toBe(false);
    expect(deadline.expired(90_000, STARTED_AT + 165_000)).toBe(true);
    expect(deadline.expired(90_000, STARTED_AT + 165_001)).toBe(true);
  });

  it("defaults the reserve to zero", () => {
    const deadline = createInvocationDeadline({
      maxRuntimeMs: 300_000,
      safetyMarginMs: 45_000,
      startedAtMs: STARTED_AT,
    });

    expect(deadline.expired(undefined, STARTED_AT + 254_999)).toBe(false);
    expect(deadline.expired(undefined, STARTED_AT + 255_000)).toBe(true);
  });

  it("rejects configurations that cannot leave any working time", () => {
    for (const input of [
      { maxRuntimeMs: 300_000, safetyMarginMs: 300_000 },
      { maxRuntimeMs: 300_000, safetyMarginMs: 400_000 },
      { maxRuntimeMs: 0, safetyMarginMs: 0 },
      { maxRuntimeMs: -1, safetyMarginMs: 0 },
      { maxRuntimeMs: 300_000, safetyMarginMs: -1 },
      { maxRuntimeMs: Number.NaN, safetyMarginMs: 45_000 },
      { maxRuntimeMs: 300_000, safetyMarginMs: Number.NaN },
      { maxRuntimeMs: Number.POSITIVE_INFINITY, safetyMarginMs: 45_000 },
    ]) {
      expect(() => createInvocationDeadline(input)).toThrow(
        /invocation deadline configuration is invalid/
      );
    }
  });

  it("orders the email-sync reserves so each stage protects the next", () => {
    // The margin must outlast the checkpoint + lease + response work; every
    // stage reserve must fit inside the working window it guards.
    expect(EMAIL_SYNC_DEADLINE_SAFETY_MARGIN_MS).toBeLessThan(
      EMAIL_SYNC_MAX_RUNTIME_MS
    );
    expect(EMAIL_SYNC_POST_LOOP_RESERVE_MS).toBeGreaterThan(
      EMAIL_SYNC_AI_STAGE_RESERVE_MS
    );
    expect(EMAIL_SYNC_AI_STAGE_RESERVE_MS).toBeGreaterThan(
      EMAIL_SYNC_PHASE_FLOOR_MS
    );
    expect(EMAIL_SYNC_MIN_CONNECTION_BUDGET_MS).toBeGreaterThan(
      EMAIL_SYNC_PHASE_FLOOR_MS
    );
    expect(
      EMAIL_SYNC_MAX_RUNTIME_MS - EMAIL_SYNC_DEADLINE_SAFETY_MARGIN_MS
    ).toBeGreaterThan(EMAIL_SYNC_POST_LOOP_RESERVE_MS);
  });
});

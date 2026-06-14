import { describe, it, expect } from "vitest";
import { isHeldByOther, buildSessionId, type LockState } from "./session-lock";

const now = Date.parse("2026-06-13T12:00:00Z");
const mine = "cw_mine";

describe("isHeldByOther", () => {
  it("free when no lock row exists", () => {
    expect(isHeldByOther(null, mine, now)).toBe(false);
  });
  it("free when the lock is mine", () => {
    const lock: LockState = { sessionId: mine, heartbeatAt: now - 1000 };
    expect(isHeldByOther(lock, mine, now)).toBe(false);
  });
  it("held when another live session owns it", () => {
    const lock: LockState = { sessionId: "cw_other", heartbeatAt: now - 5000 };
    expect(isHeldByOther(lock, mine, now)).toBe(true);
  });
  it("free when another session's lock is stale (>120s heartbeat)", () => {
    const lock: LockState = { sessionId: "cw_other", heartbeatAt: now - 121_000 };
    expect(isHeldByOther(lock, mine, now)).toBe(false);
  });
});

describe("buildSessionId", () => {
  it("mints distinct cw_-prefixed ids", () => {
    const a = buildSessionId();
    const b = buildSessionId();
    expect(a).toMatch(/^cw_/);
    expect(b).toMatch(/^cw_/);
    expect(a).not.toBe(b);
  });
});

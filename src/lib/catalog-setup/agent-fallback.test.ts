import { describe, it, expect } from "vitest";
import { commitsHeld, resolveDriver } from "./agent-fallback";

describe("resolveDriver", () => {
  it("uses the agent when online + enabled + no error", () => {
    expect(resolveDriver({ online: true, agentEnabled: true, agentErrored: false })).toBe(
      "agent",
    );
  });
  it("falls back to guided when offline", () => {
    expect(resolveDriver({ online: false, agentEnabled: true, agentErrored: false })).toBe(
      "guided",
    );
  });
  it("falls back to guided when the agent is disabled (the current state)", () => {
    expect(resolveDriver({ online: true, agentEnabled: false, agentErrored: false })).toBe(
      "guided",
    );
  });
  it("falls back to guided after an agent error mid-session", () => {
    expect(resolveDriver({ online: true, agentEnabled: true, agentErrored: true })).toBe(
      "guided",
    );
  });
});

describe("commitsHeld", () => {
  it("holds commits while offline", () => {
    expect(commitsHeld(false)).toBe(true);
    expect(commitsHeld(true)).toBe(false);
  });
});

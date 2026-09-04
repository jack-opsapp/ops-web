import { describe, expect, it } from "vitest";
import {
  getFullHeightMode,
  getPermissionForPath,
  getEntryForPath,
} from "../route-registry";

describe("route registry — agent queue", () => {
  it("renders the queue full-bleed, like every other register surface", () => {
    expect(getFullHeightMode("/agent/queue")).toBe("bleed");
  });

  it("gates the queue and its umbrella on agent.review", () => {
    expect(getPermissionForPath("/agent/queue")).toBe("agent.review");
    expect(getPermissionForPath("/agent")).toBe("agent.review");
  });

  it("keeps the auto-send acceptance on inbox.send", () => {
    expect(getEntryForPath("/agent/auto-send")?.permission).toBe("inbox.send");
  });
});

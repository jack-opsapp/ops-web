import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, PERMISSION_CATEGORIES } from "../permissions";

describe("permission catalog — agent.review", () => {
  it("registers agent.review with the all scope only", () => {
    expect(ALL_PERMISSIONS).toContain("agent.review");
    const admin = PERMISSION_CATEGORIES.find((c) => c.id === "admin");
    const mod = admin?.modules.find((m) => m.id === "agent");
    expect(mod?.editorMode).toBe("action");
    expect(mod?.actions).toEqual([
      { id: "agent.review", label: "Review agent proposals", scopes: ["all"] },
    ]);
  });
});

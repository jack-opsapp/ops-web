import { describe, it, expect } from "vitest";
import config from "../../../tailwind.config";

describe("inbox surface tokens", () => {
  it("exposes inbox-scoped surface tokens", () => {
    const colors = config.theme?.extend?.colors as Record<string, unknown>;
    expect(colors.inbox).toEqual({
      bg: "#0E0F12",
      "bg-deep": "#08090B",
      panel: "#16181C",
      elev: "#1A1D22",
    });
  });
});

import { describe, it, expect } from "vitest";
import config from "../../../tailwind.config";

describe("agent palette tokens", () => {
  it("exposes the full agent scale on tailwind theme", () => {
    const colors = config.theme?.extend?.colors as Record<string, unknown>;
    expect(colors.agent).toEqual({
      DEFAULT: "#8A7FB8",
      hi: "#B5ABDC",
      text: "#C9C0E6",
      text2: "#A39CC9",
      border: "rgba(138, 127, 184, 0.18)",
      "border-hi": "rgba(138, 127, 184, 0.36)",
      bg: "rgba(138, 127, 184, 0.04)",
      "bg-hi": "rgba(138, 127, 184, 0.10)",
    });
  });
});

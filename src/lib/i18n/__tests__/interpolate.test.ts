import { describe, it, expect } from "vitest";
import { interpolate } from "../interpolate";

describe("interpolate", () => {
  it("substitutes a single placeholder", () => {
    expect(interpolate("Hello {{name}}", { name: "Jack" })).toBe("Hello Jack");
  });

  it("substitutes multiple placeholders", () => {
    expect(
      interpolate("{{a}} and {{b}}", { a: "one", b: "two" })
    ).toBe("one and two");
  });

  it("coerces numbers to strings", () => {
    expect(interpolate("Count: {{n}}", { n: 5 })).toBe("Count: 5");
  });

  it("leaves the placeholder literal when key is missing", () => {
    expect(interpolate("Hello {{name}}", {})).toBe("Hello {{name}}");
  });

  it("returns the template unchanged when there are no placeholders", () => {
    expect(interpolate("plain string", { x: "y" })).toBe("plain string");
  });
});

import { describe, expect, it } from "vitest";

import { escapeIlikeLiteral } from "@/lib/supabase/ilike-literal";

describe("escapeIlikeLiteral", () => {
  it.each([
    ["underscore", "18_Cedar Road", "18\\_Cedar Road"],
    ["percent", "100% Bay Street", "100\\% Bay Street"],
    ["backslash", "42\\Harbour Road", "42\\\\Harbour Road"],
  ])(
    "escapes an address %s so an ilike filter stays literal",
    (_kind, value, expected) => {
      expect(escapeIlikeLiteral(value)).toBe(expected);
    }
  );

  it("escapes adjacent wildcard characters without changing the address text", () => {
    expect(escapeIlikeLiteral("Unit_100% \\ Bay Road")).toBe(
      "Unit\\_100\\% \\\\ Bay Road"
    );
  });
});

import { describe, expect, it } from "vitest";
import { tierLabel } from "../format";

describe("tierLabel (project-detail tabs)", () => {
  it("renders the SPEC-0N designation for v2 slugs", () => {
    expect(tierLabel("spec01")).toBe("SPEC-01");
    expect(tierLabel("spec03")).toBe("SPEC-03");
  });
});

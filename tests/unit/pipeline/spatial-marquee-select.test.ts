import { describe, expect, it } from "vitest";
import {
  getMarqueeSelectedOpportunityIds,
  isCardInMarquee,
} from "@/app/(dashboard)/pipeline/_components/spatial-marquee-select";

describe("spatial marquee selection", () => {
  it("selects cards by layout position intersection", () => {
    const selected = getMarqueeSelectedOpportunityIds(
      [
        { opportunityId: "opp-layout-hit", x: 100, y: 100 },
        { opportunityId: "opp-layout-miss", x: 500, y: 500 },
      ],
      200,
      44,
      { x: 80, y: 90 },
      { x: 160, y: 130 }
    );

    expect(selected).toEqual(["opp-layout-hit"]);
  });

  it("handles reverse marquee drag direction", () => {
    expect(
      isCardInMarquee(
        120,
        120,
        200,
        44,
        { x: 220, y: 180 },
        { x: 100, y: 100 }
      )
    ).toBe(true);
  });
});

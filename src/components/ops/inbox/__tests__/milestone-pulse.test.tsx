import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MilestonePulse } from "../milestone-pulse";
import {
  inboxRailVariants,
  composerBodyFadeVariants,
  milestonePulseVariants,
  milestonePulseReducedVariants,
} from "@/lib/utils/motion";

describe("inbox motion variants", () => {
  it("inboxRailVariants: open width 360 / 0.18s ease", () => {
    expect(inboxRailVariants.open).toMatchObject({ width: 360, opacity: 1 });
    expect(inboxRailVariants.closed).toMatchObject({ width: 0, opacity: 0 });
  });

  it("composerBodyFadeVariants: opacity-only 0.12s", () => {
    expect(composerBodyFadeVariants.hidden).toMatchObject({ opacity: 0 });
    expect(composerBodyFadeVariants.visible).toMatchObject({ opacity: 1 });
  });

  it("milestonePulseVariants: 0 → 4px olive ring → 0", () => {
    expect(milestonePulseVariants.initial).toMatchObject({
      boxShadow: "0 0 0 0 rgba(157, 181, 130, 0)",
    });
    const pulse = milestonePulseVariants.pulse as { boxShadow: string[] };
    expect(pulse.boxShadow).toHaveLength(3);
    expect(pulse.boxShadow[1]).toContain("0 0 0 4px");
    expect(pulse.boxShadow[1]).toContain("0.55");
  });

  it("milestonePulseReducedVariants: opacity-only flash", () => {
    const pulse = milestonePulseReducedVariants.pulse as { opacity: number[] };
    expect(pulse.opacity).toEqual([1, 0.85, 1]);
  });
});

describe("<MilestonePulse>", () => {
  it("renders the wrapped children", () => {
    render(
      <MilestonePulse trigger="Done">
        <span data-testid="child">target</span>
      </MilestonePulse>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});

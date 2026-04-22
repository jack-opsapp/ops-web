/**
 * Unit tests for IndicatorCard.
 *
 * Covers label rendering, status dot, value formatting (count vs percent),
 * WoW delta sign + color (positive/negative/zero), and sparkline rendering.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IndicatorCard } from "@/components/pmf/indicator-card";
import type { IndicatorState } from "@/lib/pmf/types";

function makeState(overrides: Partial<IndicatorState> = {}): IndicatorState {
  return {
    status: "green",
    value: 42,
    delta_wow: 0,
    sparkline: [1, 2, 3, 4, 5],
    label: "PROSPECTS ADDED",
    unit: "count",
    ...overrides,
  };
}

describe("IndicatorCard", () => {
  it("renders the label from state", () => {
    render(<IndicatorCard state={makeState({ label: "TIER A QUALIFIED" })} />);
    expect(screen.getByText("TIER A QUALIFIED")).toBeInTheDocument();
  });

  it("renders the status dot via role=img with the status label", () => {
    render(<IndicatorCard state={makeState({ status: "amber" })} />);
    expect(screen.getByRole("img", { name: /status amber/i })).toBeInTheDocument();
  });

  it("formats value as integer with thousand separators when unit is count", () => {
    render(<IndicatorCard state={makeState({ value: 1234, unit: "count" })} />);
    expect(screen.getByText("1,234")).toBeInTheDocument();
  });

  it("formats value as percent (fmtPct) when unit is percent", () => {
    render(<IndicatorCard state={makeState({ value: 0.05, unit: "percent" })} />);
    // fmtPct(0.05) -> "5.0%"
    expect(screen.getByText("5.0%")).toBeInTheDocument();
  });

  it("shows ↑ in olive class when delta_wow is positive", () => {
    render(<IndicatorCard state={makeState({ delta_wow: 7 })} />);
    const delta = screen.getByText(/↑\s*7\s*WOW/);
    expect(delta).toBeInTheDocument();
    expect(delta.className).toContain("text-[color:var(--olive)]");
  });

  it("shows ↓ in rose class when delta_wow is negative", () => {
    render(<IndicatorCard state={makeState({ delta_wow: -3 })} />);
    const delta = screen.getByText(/↓\s*3\s*WOW/);
    expect(delta).toBeInTheDocument();
    expect(delta.className).toContain("text-[color:var(--rose)]");
  });

  it("shows — in text-3 class when delta_wow is zero", () => {
    render(<IndicatorCard state={makeState({ delta_wow: 0 })} />);
    const delta = screen.getByText(/—\s*0\s*WOW/);
    expect(delta).toBeInTheDocument();
    expect(delta.className).toContain("text-[color:var(--text-3)]");
  });

  it("renders sparkline svg with the configured 120x20 dimensions", () => {
    const { container } = render(
      <IndicatorCard state={makeState({ sparkline: [1, 2, 3, 4, 5] })} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("120");
    expect(svg?.getAttribute("height")).toBe("20");
    // Path renders with M ... L ... commands when data has >1 point
    expect(svg?.querySelector("path")?.getAttribute("d")).toMatch(/^M/);
  });

  it("formats percent delta with fmtPct when unit is percent", () => {
    render(
      <IndicatorCard
        state={makeState({ value: 0.12, delta_wow: 0.034, unit: "percent" })}
      />,
    );
    // fmtPct(0.034) -> "3.4%"
    expect(screen.getByText(/↑\s*3\.4%\s*WOW/)).toBeInTheDocument();
  });
});

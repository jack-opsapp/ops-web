/**
 * Unit tests for MarkerCard.
 *
 * Covers label rendering, status text, percentage math (incl. zero-target
 * and clamp-to-100), the asCurrency variant, and optional detail line.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkerCard } from "@/components/pmf/marker-card";
import type { MarkerState } from "@/lib/pmf/types";

function makeState(overrides: Partial<MarkerState> = {}): MarkerState {
  return {
    status: "green",
    value: 8,
    target: 10,
    label: "TIER A ENGAGEMENTS",
    ...overrides,
  };
}

describe("MarkerCard", () => {
  it("renders the label from state", () => {
    render(<MarkerCard state={makeState({ label: "RETAINED BASE SAAS" })} />);
    expect(screen.getByText("RETAINED BASE SAAS")).toBeInTheDocument();
  });

  it("status text matches state.status uppercased and includes pct", () => {
    render(<MarkerCard state={makeState({ status: "amber", value: 8, target: 10 })} />);
    // status footer: "[AMBER · 80% OF TARGET]" — brackets are separate
    // spans, so text content should contain the AMBER · 80% portion
    expect(screen.getByText(/AMBER\s*·\s*80% OF TARGET/i)).toBeInTheDocument();
  });

  it("computes pct as 80 when value=8 and target=10", () => {
    render(<MarkerCard state={makeState({ value: 8, target: 10 })} />);
    expect(screen.getByText(/80% OF TARGET/i)).toBeInTheDocument();
  });

  it("clamps pct to 100 when value exceeds target", () => {
    render(<MarkerCard state={makeState({ value: 15, target: 10 })} />);
    expect(screen.getByText(/100% OF TARGET/i)).toBeInTheDocument();
  });

  it("returns 0% when target is 0 (avoids divide-by-zero)", () => {
    render(<MarkerCard state={makeState({ value: 5, target: 0 })} />);
    expect(screen.getByText(/0% OF TARGET/i)).toBeInTheDocument();
  });

  it("renders fmtUsd of value*100 and target*100 when asCurrency is true", () => {
    render(
      <MarkerCard
        state={makeState({ value: 7500, target: 15000, label: "CAC FROM $15K SPEND" })}
        asCurrency
      />,
    );
    // fmtUsd takes cents; with value=7500 we render fmtUsd(750000) = "$7,500"
    // and target fmtUsd(1500000) = "$15,000"
    expect(screen.getByText(/\$7,500/)).toBeInTheDocument();
    expect(screen.getByText(/\$15,000/)).toBeInTheDocument();
  });

  it("renders state.detail line when present", () => {
    render(
      <MarkerCard
        state={makeState({ detail: "3 paid attributed" })}
      />,
    );
    expect(screen.getByText("3 paid attributed")).toBeInTheDocument();
  });
});

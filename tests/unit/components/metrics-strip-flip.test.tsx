import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MetricsStrip, type MetricCell } from "@/components/ui/metrics-strip";

// The ONE metric interaction: a cell with a `breakdown` flips to reveal the
// formula behind the number. A cell without one is a static readout — no button
// semantics, no navigation. (WEB POLISH — metrics flip restoration.)
describe("MetricsStrip — click-to-flip", () => {
  it("a cell with a breakdown is a flip button that reveals the formula", () => {
    const metrics: MetricCell[] = [
      { label: "WIN RATE", value: "80%", breakdown: "12 won ÷ 15 decided" },
    ];
    render(<MetricsStrip metrics={metrics} />);

    const btn = screen.getByRole("button", { name: /WIN RATE.*Show formula/i });
    expect(btn).toHaveAttribute("aria-pressed", "false");

    // The formula is authored on the back face.
    expect(screen.getByText("12 won ÷ 15 decided")).toBeInTheDocument();

    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("a cell without a breakdown is a static group, never a button", () => {
    const metrics: MetricCell[] = [{ label: "NEW", value: "7" }];
    render(<MetricsStrip metrics={metrics} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("group", { name: /NEW/i })).toBeInTheDocument();
  });
});

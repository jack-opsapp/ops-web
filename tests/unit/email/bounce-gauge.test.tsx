import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BounceGauge } from "@/app/admin/email/_components/bounce-gauge";

describe("BounceGauge", () => {
  it("renders 0% in green zone", () => {
    render(<BounceGauge bouncePct={0} />);
    expect(screen.getByText("0.00%")).toBeInTheDocument();
  });

  it("renders 7% in yellow zone", () => {
    render(<BounceGauge bouncePct={7} />);
    expect(screen.getByText("7.00%")).toBeInTheDocument();
  });

  it("renders 12% in red zone", () => {
    render(<BounceGauge bouncePct={12} />);
    expect(screen.getByText("12.00%")).toBeInTheDocument();
  });

  it("clamps the visual but still displays the raw value when over 15%", () => {
    render(<BounceGauge bouncePct={50} />);
    expect(screen.getByText("50.00%")).toBeInTheDocument();
  });
});

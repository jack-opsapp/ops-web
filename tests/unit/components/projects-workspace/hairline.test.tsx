import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { Hairline } from "@/components/ops/projects/workspace/atoms/hairline";

// `Hairline` — 1px separator. Horizontal or vertical, dashed or solid. The
// workspace uses dashed hairlines under `// SECTION` titles and solid
// hairlines between rows; one component covers both. Decorative — exposes
// `role="separator"` for AT. Border colour traces to the `glass-border`
// design-system tokens (`var(--glass-border*)` under the hood).

describe("<Hairline>", () => {
  it("renders as div with role=separator", () => {
    render(<Hairline />);
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("defaults to horizontal solid", () => {
    render(<Hairline data-testid="line" />);
    const el = screen.getByTestId("line");
    expect(el).toHaveClass("w-full");
    expect(el).toHaveClass("h-px");
    expect(el).toHaveClass("border-t");
    expect(el).toHaveClass("border-solid");
  });

  it("renders vertical when orientation=vertical", () => {
    render(<Hairline data-testid="line" orientation="vertical" />);
    const el = screen.getByTestId("line");
    expect(el).toHaveClass("h-full");
    expect(el).toHaveClass("w-px");
    expect(el).toHaveClass("border-l");
  });

  it("renders dashed when variant=dashed", () => {
    render(<Hairline data-testid="line" variant="dashed" />);
    expect(screen.getByTestId("line")).toHaveClass("border-dashed");
  });

  it("uses glass-border token by default (subtle, no hex literal)", () => {
    render(<Hairline data-testid="line" />);
    expect(screen.getByTestId("line")).toHaveClass("border-glass-border");
  });

  it("uses glass-border-medium when emphasis=medium", () => {
    render(<Hairline data-testid="line" emphasis="medium" />);
    expect(screen.getByTestId("line")).toHaveClass("border-glass-border-medium");
  });

  it("uses glass-border-strong when emphasis=strong", () => {
    render(<Hairline data-testid="line" emphasis="strong" />);
    expect(screen.getByTestId("line")).toHaveClass("border-glass-border-strong");
  });

  it("merges additional className", () => {
    render(<Hairline data-testid="line" className="my-2" />);
    expect(screen.getByTestId("line")).toHaveClass("my-2");
    expect(screen.getByTestId("line")).toHaveClass("border-t");
  });
});

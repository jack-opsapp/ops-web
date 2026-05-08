import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { FieldRow } from "@/components/ops/projects/workspace/atoms/field-row";

// `FieldRow` — horizontal layout for a row of Field cells. Token-based gap;
// optional column-template via `columns` prop for proportional widths
// (e.g. ["1fr", "auto"]).

describe("<FieldRow>", () => {
  it("renders as a div with grid layout when columns prop is provided", () => {
    render(
      <FieldRow data-testid="row" columns={["1fr", "1fr"]}>
        <span>a</span>
        <span>b</span>
      </FieldRow>,
    );
    const el = screen.getByTestId("row");
    expect(el.tagName).toBe("DIV");
    expect(el).toHaveClass("grid");
    expect(el.style.gridTemplateColumns).toBe("1fr 1fr");
  });

  it("renders as flex when columns is not provided", () => {
    render(<FieldRow data-testid="row" />);
    const el = screen.getByTestId("row");
    expect(el).toHaveClass("flex");
    expect(el).not.toHaveClass("grid");
  });

  it("defaults to gap=2 (16px)", () => {
    render(<FieldRow data-testid="row" />);
    expect(screen.getByTestId("row")).toHaveClass("gap-2");
  });

  it.each([
    [0.5, "gap-0.5"],
    [1, "gap-1"],
    [1.5, "gap-1.5"],
    [2, "gap-2"],
    [3, "gap-3"],
  ] as const)("gap=%s applies %s", (gap, expectedClass) => {
    render(<FieldRow data-testid="row" gap={gap} />);
    expect(screen.getByTestId("row")).toHaveClass(expectedClass);
  });

  it("merges additional className", () => {
    render(<FieldRow data-testid="row" className="my-2" />);
    expect(screen.getByTestId("row")).toHaveClass("my-2");
  });

  it("forwards children", () => {
    render(
      <FieldRow data-testid="row">
        <span data-testid="cell">x</span>
      </FieldRow>,
    );
    expect(screen.getByTestId("cell")).toBeInTheDocument();
  });
});

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { Inline } from "@/components/ops/projects/workspace/atoms/inline";

// `Inline` — horizontal flex row layout primitive. Token-based gap from the
// 8-pt spacing scale, plus alignment + justify props for toolbar / metadata
// strip layouts.

describe("<Inline>", () => {
  it("renders as a div with flex-row", () => {
    render(<Inline data-testid="inline" />);
    const el = screen.getByTestId("inline");
    expect(el.tagName).toBe("DIV");
    expect(el).toHaveClass("flex");
    expect(el).toHaveClass("flex-row");
  });

  it("defaults to gap=1 (8px) and items-center", () => {
    render(<Inline data-testid="inline" />);
    const el = screen.getByTestId("inline");
    expect(el).toHaveClass("gap-1");
    expect(el).toHaveClass("items-center");
  });

  it.each([
    [0, "gap-0"],
    [0.5, "gap-0.5"],
    [1, "gap-1"],
    [1.5, "gap-1.5"],
    [2, "gap-2"],
    [3, "gap-3"],
    [4, "gap-4"],
  ] as const)("gap=%s applies token class %s", (gap, expectedClass) => {
    render(<Inline data-testid="inline" gap={gap} />);
    expect(screen.getByTestId("inline")).toHaveClass(expectedClass);
  });

  it.each([
    ["start", "items-start"],
    ["center", "items-center"],
    ["end", "items-end"],
    ["baseline", "items-baseline"],
  ] as const)("align=%s applies items class %s", (align, expectedClass) => {
    render(<Inline data-testid="inline" align={align} />);
    expect(screen.getByTestId("inline")).toHaveClass(expectedClass);
  });

  it.each([
    ["start", "justify-start"],
    ["center", "justify-center"],
    ["end", "justify-end"],
    ["between", "justify-between"],
  ] as const)("justify=%s applies justify class %s", (justify, expectedClass) => {
    render(<Inline data-testid="inline" justify={justify} />);
    expect(screen.getByTestId("inline")).toHaveClass(expectedClass);
  });

  it("wraps when wrap=true", () => {
    render(<Inline data-testid="inline" wrap />);
    expect(screen.getByTestId("inline")).toHaveClass("flex-wrap");
  });

  it("merges additional className", () => {
    render(<Inline data-testid="inline" className="border-t" />);
    expect(screen.getByTestId("inline")).toHaveClass("border-t");
    expect(screen.getByTestId("inline")).toHaveClass("flex-row");
  });
});

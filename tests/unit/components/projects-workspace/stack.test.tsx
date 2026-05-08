import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { Stack } from "@/components/ops/projects/workspace/atoms/stack";

// `Stack` — vertical flex column layout primitive. Token-based gap from the
// 8-pt spacing scale. Optional cross-axis alignment. Used by every workspace
// tab body to lay rows out top-to-bottom.

describe("<Stack>", () => {
  it("renders as a div with flex-col", () => {
    render(
      <Stack data-testid="stack">
        <span>a</span>
      </Stack>,
    );
    const el = screen.getByTestId("stack");
    expect(el.tagName).toBe("DIV");
    expect(el).toHaveClass("flex");
    expect(el).toHaveClass("flex-col");
  });

  it("defaults to gap=2 (16px Tailwind token)", () => {
    render(<Stack data-testid="stack" />);
    expect(screen.getByTestId("stack")).toHaveClass("gap-2");
  });

  it.each([
    [0, "gap-0"],
    [0.5, "gap-0.5"],
    [1, "gap-1"],
    [1.5, "gap-1.5"],
    [2, "gap-2"],
    [3, "gap-3"],
    [4, "gap-4"],
    [6, "gap-6"],
  ] as const)("gap=%s applies token class %s", (gap, expectedClass) => {
    render(<Stack data-testid="stack" gap={gap} />);
    expect(screen.getByTestId("stack")).toHaveClass(expectedClass);
  });

  it.each([
    ["start", "items-start"],
    ["center", "items-center"],
    ["end", "items-end"],
    ["stretch", "items-stretch"],
  ] as const)("align=%s applies items class %s", (align, expectedClass) => {
    render(<Stack data-testid="stack" align={align} />);
    expect(screen.getByTestId("stack")).toHaveClass(expectedClass);
  });

  it("merges additional className", () => {
    render(<Stack data-testid="stack" className="border" />);
    expect(screen.getByTestId("stack")).toHaveClass("border");
    expect(screen.getByTestId("stack")).toHaveClass("flex-col");
  });

  it("forwards children", () => {
    render(
      <Stack data-testid="stack">
        <span data-testid="child" />
      </Stack>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});

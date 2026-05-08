import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { Chip } from "@/components/ops/projects/workspace/atoms/chip";

// `Chip` — small pill / tag with neutral or earth-tone variants. Generic;
// independent of any entity status (the dashboard's WidgetStatusBadge stays
// for status-driven cases). Used by the workspace for tags, counts, modes,
// inline labels.

describe("<Chip>", () => {
  it("renders as a span by default", () => {
    render(<Chip>4 OPEN</Chip>);
    expect(screen.getByText("4 OPEN").tagName).toBe("SPAN");
  });

  it("uses font-mono uppercase voice", () => {
    render(<Chip>X</Chip>);
    const el = screen.getByText("X");
    expect(el).toHaveClass("font-mono");
    expect(el).toHaveClass("uppercase");
  });

  it("uses rounded-chip (4px brand chip radius)", () => {
    render(<Chip>X</Chip>);
    expect(screen.getByText("X")).toHaveClass("rounded-chip");
  });

  it.each([
    ["neutral", "text-text-2", "border-glass-border"],
    ["accent", "text-ops-accent", "border-[var(--ops-accent-line)]"],
    ["olive", "text-[var(--olive)]", "border-[var(--olive-line)]"],
    ["tan", "text-[var(--tan)]", "border-[var(--tan-line)]"],
    ["rose", "text-[var(--rose)]", "border-[var(--rose-line)]"],
  ] as const)("variant=%s applies text=%s border=%s", (variant, text, border) => {
    render(<Chip variant={variant}>X</Chip>);
    const el = screen.getByText("X");
    expect(el).toHaveClass(text);
    expect(el).toHaveClass(border);
  });

  it.each([
    ["sm", "text-[9px]"],
    ["md", "text-[10px]"],
  ] as const)("size=%s applies %s text size", (size, expectedClass) => {
    render(<Chip size={size}>X</Chip>);
    expect(screen.getByText("X")).toHaveClass(expectedClass);
  });

  it("merges additional className", () => {
    render(<Chip className="ml-1">X</Chip>);
    expect(screen.getByText("X")).toHaveClass("ml-1");
    expect(screen.getByText("X")).toHaveClass("font-mono");
  });

  it("forwards data attributes", () => {
    render(<Chip data-status="active">X</Chip>);
    expect(screen.getByText("X")).toHaveAttribute("data-status", "active");
  });
});

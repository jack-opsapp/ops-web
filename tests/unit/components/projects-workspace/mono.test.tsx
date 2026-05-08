import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { Mono } from "@/components/ops/projects/workspace/atoms/mono";

// `Mono` is the workspace's tactical-voice text primitive: JetBrains Mono,
// uppercase, tracked-out. It encapsulates the `// SLASHES`, `[brackets]`,
// `SYS ::` recipe so callers stop respelling it inline. Tests assert the
// font-family / size / colour all trace to design-system tokens — not hex
// literals or arbitrary px values.

describe("<Mono>", () => {
  it("renders children inside a span", () => {
    render(<Mono>// OPERATOR</Mono>);
    expect(screen.getByText("// OPERATOR").tagName).toBe("SPAN");
  });

  it("uses font-mono Tailwind token (JetBrains Mono)", () => {
    render(<Mono>NUMERICAL</Mono>);
    expect(screen.getByText("NUMERICAL")).toHaveClass("font-mono");
  });

  it("renders as uppercase with tracked-out letter-spacing by default", () => {
    render(<Mono>tactical</Mono>);
    const el = screen.getByText("tactical");
    expect(el).toHaveClass("uppercase");
    expect(el).toHaveClass("tracking-[0.18em]");
  });

  it("defaults to text-3 (--text-3 token, neutral muted) when no color prop", () => {
    render(<Mono>METADATA</Mono>);
    expect(screen.getByText("METADATA")).toHaveClass("text-text-3");
  });

  it.each([
    ["text", "text-text"],
    ["text-2", "text-text-2"],
    ["text-3", "text-text-3"],
    ["mute", "text-text-mute"],
    ["accent", "text-ops-accent"],
    ["olive", "text-[var(--olive)]"],
    ["tan", "text-[var(--tan)]"],
    ["rose", "text-[var(--rose)]"],
  ] as const)("color=%s applies token class %s", (color, expectedClass) => {
    render(<Mono color={color}>X</Mono>);
    expect(screen.getByText("X")).toHaveClass(expectedClass);
  });

  it.each([
    [9, "text-[9px]"],
    [10, "text-[10px]"],
    [11, "text-[11px]"],
    [12, "text-[12px]"],
    [13, "text-[13px]"],
  ] as const)("size=%s applies size token %s", (size, expectedClass) => {
    render(<Mono size={size}>X</Mono>);
    expect(screen.getByText("X")).toHaveClass(expectedClass);
  });

  it("preserves case when caseSensitive prop is set", () => {
    render(<Mono caseSensitive>SemVer 1.2.3</Mono>);
    const el = screen.getByText("SemVer 1.2.3");
    expect(el).not.toHaveClass("uppercase");
  });

  it("merges additional className", () => {
    render(<Mono className="ml-2">X</Mono>);
    expect(screen.getByText("X")).toHaveClass("ml-2");
    expect(screen.getByText("X")).toHaveClass("font-mono");
  });

  it("forwards aria-label and other span attributes", () => {
    render(
      <Mono aria-label="System ready">
        SYS :: READY
      </Mono>
    );
    expect(screen.getByLabelText("System ready")).toBeInTheDocument();
  });
});

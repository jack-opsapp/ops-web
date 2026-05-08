import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { Body } from "@/components/ops/projects/workspace/atoms/body";

// `Body` — workspace body voice. Mohave, sentence case (no forced uppercase).
// Sized 12 / 14 / 16 / 18; coloured along the spec-v2 text ladder + accent
// + earth tones. Complements Mono (tactical micro-labels) and Cake (display).

describe("<Body>", () => {
  it("renders children inside a span by default", () => {
    render(<Body>Plain text</Body>);
    expect(screen.getByText("Plain text").tagName).toBe("SPAN");
  });

  it("renders as a paragraph when as=p", () => {
    render(<Body as="p">A paragraph</Body>);
    expect(screen.getByText("A paragraph").tagName).toBe("P");
  });

  it("uses font-mohave token", () => {
    render(<Body>X</Body>);
    expect(screen.getByText("X")).toHaveClass("font-mohave");
  });

  it("does not force uppercase (sentence case stays sentence case)", () => {
    render(<Body>Sentence Case</Body>);
    expect(screen.getByText("Sentence Case")).not.toHaveClass("uppercase");
  });

  it("defaults to text-text-2 (read-content tier)", () => {
    render(<Body>X</Body>);
    expect(screen.getByText("X")).toHaveClass("text-text-2");
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
    render(<Body color={color}>X</Body>);
    expect(screen.getByText("X")).toHaveClass(expectedClass);
  });

  it.each([
    [12, "text-[12px]"],
    [14, "text-[14px]"],
    [16, "text-[16px]"],
    [18, "text-[18px]"],
  ] as const)("size=%s applies size token %s", (size, expectedClass) => {
    render(<Body size={size}>X</Body>);
    expect(screen.getByText("X")).toHaveClass(expectedClass);
  });

  it("merges additional className", () => {
    render(<Body className="ml-2">X</Body>);
    expect(screen.getByText("X")).toHaveClass("ml-2");
    expect(screen.getByText("X")).toHaveClass("font-mohave");
  });
});

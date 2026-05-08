import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { Cake } from "@/components/ops/projects/workspace/atoms/cake";

// `Cake` — heavy uppercase display voice. Cake Mono Light (weight 300 only).
// Used for page titles, section headers, card titles. Tests pin the
// font-cakemono token, font-light weight, uppercase, and the spec-v2
// text-ladder colour mappings.

describe("<Cake>", () => {
  it("renders children inside a span", () => {
    render(<Cake>Project Workspace</Cake>);
    expect(screen.getByText("Project Workspace").tagName).toBe("SPAN");
  });

  it("uses font-cakemono token (Cake Mono via Adobe Typekit)", () => {
    render(<Cake>HEADING</Cake>);
    expect(screen.getByText("HEADING")).toHaveClass("font-cakemono");
  });

  it("renders uppercase by default", () => {
    render(<Cake>workspace</Cake>);
    expect(screen.getByText("workspace")).toHaveClass("uppercase");
  });

  it("uses font-light weight 300 by default — never Regular or Bold", () => {
    render(<Cake>HEAD</Cake>);
    expect(screen.getByText("HEAD")).toHaveClass("font-light");
  });

  it("defaults to text-text (top of ladder) when no color prop", () => {
    render(<Cake>TITLE</Cake>);
    expect(screen.getByText("TITLE")).toHaveClass("text-text");
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
    render(<Cake color={color}>X</Cake>);
    expect(screen.getByText("X")).toHaveClass(expectedClass);
  });

  it.each([
    [18, "text-[18px]"],
    [22, "text-[22px]"],
    [28, "text-[28px]"],
    [32, "text-[32px]"],
    [48, "text-[48px]"],
    [64, "text-[64px]"],
  ] as const)("size=%s applies size token %s", (size, expectedClass) => {
    render(<Cake size={size}>X</Cake>);
    expect(screen.getByText("X")).toHaveClass(expectedClass);
  });

  it("merges additional className", () => {
    render(<Cake className="ml-2">TITLE</Cake>);
    expect(screen.getByText("TITLE")).toHaveClass("ml-2");
    expect(screen.getByText("TITLE")).toHaveClass("font-cakemono");
  });

  it("forwards aria attributes", () => {
    render(<Cake aria-level={1} role="heading">TITLE</Cake>);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});

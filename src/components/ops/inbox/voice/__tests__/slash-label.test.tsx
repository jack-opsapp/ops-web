// src/components/ops/inbox/voice/__tests__/slash-label.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SlashLabel } from "../slash-label";

describe("<SlashLabel>", () => {
  it("renders Cake Mono Light uppercase tracking-0.18em", () => {
    render(<SlashLabel label="// INBOX" />);
    const el = screen.getByText("// INBOX");
    expect(el).toHaveClass("font-cakemono");
    expect(el).toHaveClass("font-light");
    expect(el).toHaveClass("uppercase");
    expect(el).toHaveClass("tracking-[0.18em]");
  });
  it("uses agent tone when provided", () => {
    render(<SlashLabel label="// SUMMARY" tone="agent" />);
    expect(screen.getByText("// SUMMARY")).toHaveClass("text-agent-hi");
  });
  it("md size for modal titles", () => {
    render(<SlashLabel label="// ARCHIVE" size="md" />);
    expect(screen.getByText("// ARCHIVE")).toHaveClass("text-[13px]");
  });
});

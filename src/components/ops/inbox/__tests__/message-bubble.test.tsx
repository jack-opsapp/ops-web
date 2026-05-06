import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MessageBubble } from "../message-bubble";

describe("<MessageBubble>", () => {
  it("renders the body text", () => {
    render(
      <MessageBubble
        direction="inbound"
        body="Got it — the second-floor unit is OK."
        isLastOfRun
      />,
    );
    expect(screen.getByText(/second-floor unit/)).toBeInTheDocument();
  });

  it("inbound bubbles left-align with panel background", () => {
    render(<MessageBubble direction="inbound" body="hi" isLastOfRun />);
    const bubble = screen.getByTestId("message-bubble");
    expect(bubble.className).toMatch(/bg-inbox-panel/);
    expect(bubble.parentElement?.className).toMatch(/justify-start/);
  });

  it("outbound bubbles right-align with accent tint", () => {
    render(<MessageBubble direction="outbound" body="hi" isLastOfRun />);
    const bubble = screen.getByTestId("message-bubble");
    expect(bubble.className).toMatch(/bg-ops-accent\//);
    expect(bubble.parentElement?.className).toMatch(/justify-end/);
  });

  it("AI-drafted bubbles use lavender background and 'sent by Claude' meta", () => {
    render(
      <MessageBubble
        direction="outbound"
        body="hi"
        source="ai"
        isLastOfRun
      />,
    );
    const bubble = screen.getByTestId("message-bubble");
    expect(bubble.className).toMatch(/bg-agent-bg-hi/);
    expect(screen.getByText(/sent by Claude/i)).toBeInTheDocument();
  });

  it("collapses gap when not last of run (no tail meta)", () => {
    render(
      <MessageBubble
        direction="inbound"
        body="hi"
        isLastOfRun={false}
        timestamp="14:01"
      />,
    );
    expect(screen.queryByText(/14:01/)).not.toBeInTheDocument();
  });

  it("renders timestamp when last of run", () => {
    render(
      <MessageBubble
        direction="inbound"
        body="hi"
        isLastOfRun
        timestamp="14:05"
      />,
    );
    expect(screen.getByText(/14:05/)).toBeInTheDocument();
  });
});

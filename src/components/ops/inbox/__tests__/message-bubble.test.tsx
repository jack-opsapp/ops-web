import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MessageBubble } from "../message-bubble";

describe("<MessageBubble>", () => {
  it("renders the body text", () => {
    render(
      <MessageBubble
        direction="inbound"
        body="Got it — the second-floor unit is OK."
        senderName="Jeanne"
        timestamp="14:05"
      />,
    );
    expect(screen.getByText(/second-floor unit/)).toBeInTheDocument();
  });

  it("inbound bubbles use the panel background", () => {
    render(
      <MessageBubble
        direction="inbound"
        body="hi"
        senderName="Jeanne"
      />,
    );
    const bubble = screen.getByTestId("message-bubble");
    expect(bubble.className).toMatch(/bg-inbox-panel/);
  });

  it("outbound human bubbles use accent tint", () => {
    render(
      <MessageBubble
        direction="outbound"
        body="hi"
        senderName="Jackson"
      />,
    );
    const bubble = screen.getByTestId("message-bubble");
    expect(bubble.className).toMatch(/bg-ops-accent\//);
  });

  it("AI-drafted (outbound + source ai) bubbles use lavender + 'Claude' meta", () => {
    render(
      <MessageBubble
        direction="outbound"
        body="hi"
        source="ai"
        senderName="Claude"
      />,
    );
    const bubble = screen.getByTestId("message-bubble");
    expect(bubble.className).toMatch(/bg-agent\//);
    expect(screen.getByText(/Claude/i)).toBeInTheDocument();
  });

  it("renders the sender name and timestamp in the meta row", () => {
    render(
      <MessageBubble
        direction="inbound"
        body="hi"
        senderName="Jeanne"
        timestamp="14:05"
      />,
    );
    expect(screen.getByText("Jeanne")).toBeInTheDocument();
    expect(screen.getByText("14:05")).toBeInTheDocument();
  });

  it("renders the avatar with monogram derived from sender name", () => {
    const { container } = render(
      <MessageBubble
        direction="inbound"
        body="hi"
        senderName="Jeanne Calloway"
      />,
    );
    expect(container.textContent).toContain("JC");
  });
});

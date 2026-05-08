import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

  // ── DIFF toggle (Phase F2) ─────────────────────────────────────────────

  it("does NOT render a DIFF toggle when source is not 'ai'", () => {
    render(
      <MessageBubble
        direction="outbound"
        body="edited body text"
        senderName="Jackson"
        originalAiBody="original draft text"
      />,
    );
    expect(screen.queryByTestId("diff-toggle")).not.toBeInTheDocument();
  });

  it("does NOT render a DIFF toggle when originalAiBody is not provided", () => {
    render(
      <MessageBubble
        direction="outbound"
        body="hello"
        source="ai"
        senderName="Claude"
      />,
    );
    expect(screen.queryByTestId("diff-toggle")).not.toBeInTheDocument();
  });

  it("does NOT render a DIFF toggle when originalAiBody === body (no edit)", () => {
    render(
      <MessageBubble
        direction="outbound"
        body="same content"
        source="ai"
        senderName="Claude"
        originalAiBody="same content"
      />,
    );
    expect(screen.queryByTestId("diff-toggle")).not.toBeInTheDocument();
  });

  it("renders a DIFF toggle when AI + originalAiBody differs from body", () => {
    render(
      <MessageBubble
        direction="outbound"
        body="Hi Jeanne — sounds good."
        source="ai"
        senderName="Claude"
        originalAiBody="Hello Jeanne — sounds great."
      />,
    );
    const toggle = screen.getByTestId("diff-toggle");
    expect(toggle).toBeInTheDocument();
    expect(toggle.textContent).toMatch(/DIFF/);
    expect(toggle.textContent).not.toMatch(/HIDE DIFF/);
  });

  it("clicking the DIFF toggle expands the diff toolbar with provenance", () => {
    render(
      <MessageBubble
        direction="outbound"
        body="Hi Jeanne — sounds good."
        source="ai"
        senderName="Claude"
        originalAiBody="Hello Jeanne — sounds great."
        operatorName="JACKSON"
        editedAgo="23S AGO"
      />,
    );

    fireEvent.click(screen.getByTestId("diff-toggle"));

    expect(screen.getByTestId("diff-header")).toHaveTextContent(/SHOWING DIFF/);
    const provenance = screen.getByTestId("diff-provenance");
    expect(provenance).toHaveTextContent(/CLAUDE/);
    expect(provenance).toHaveTextContent(/JACKSON/);
    expect(provenance).toHaveTextContent(/23S AGO/);
  });

  it("expanded state changes button label to HIDE DIFF", () => {
    render(
      <MessageBubble
        direction="outbound"
        body="Hi Jeanne"
        source="ai"
        senderName="Claude"
        originalAiBody="Hello Jeanne"
      />,
    );

    fireEvent.click(screen.getByTestId("diff-toggle"));
    const toggle = screen.getByTestId("diff-toggle");
    expect(toggle.textContent).toMatch(/HIDE DIFF/);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("expanded state: bubble has border-dashed", () => {
    render(
      <MessageBubble
        direction="outbound"
        body="Hi Jeanne"
        source="ai"
        senderName="Claude"
        originalAiBody="Hello Jeanne"
      />,
    );

    fireEvent.click(screen.getByTestId("diff-toggle"));
    const bubble = screen.getByTestId("message-bubble");
    expect(bubble.className).toMatch(/border-dashed/);
  });

  it("expanded state: deleted text rendered with line-through (in <del>)", () => {
    render(
      <MessageBubble
        direction="outbound"
        body="Hi Jeanne"
        source="ai"
        senderName="Claude"
        originalAiBody="Hello Jeanne"
      />,
    );

    fireEvent.click(screen.getByTestId("diff-toggle"));
    const removed = screen.getAllByTestId("diff-removed");
    expect(removed.length).toBeGreaterThan(0);
    // <del> tag with line-through styling
    expect(removed[0].tagName.toLowerCase()).toBe("del");
    expect(removed[0].className).toMatch(/line-through/);
    expect(removed[0].className).toMatch(/text-text-mute/);
  });

  it("expanded state: inserted text rendered with lavender bg highlight", () => {
    render(
      <MessageBubble
        direction="outbound"
        body="Hi Jeanne"
        source="ai"
        senderName="Claude"
        originalAiBody="Hello Jeanne"
      />,
    );

    fireEvent.click(screen.getByTestId("diff-toggle"));
    const added = screen.getAllByTestId("diff-added");
    expect(added.length).toBeGreaterThan(0);
    expect(added[0].tagName.toLowerCase()).toBe("ins");
    // bg-agent/[0.10] is the lavender highlight
    expect(added[0].className).toMatch(/bg-agent\/\[0\.10\]/);
    // Inserted text should be white (text-text), NOT lavender
    expect(added[0].className).toMatch(/text-text(?!-)/);
  });

  it("clicking HIDE DIFF returns to collapsed state", () => {
    render(
      <MessageBubble
        direction="outbound"
        body="Hi Jeanne"
        source="ai"
        senderName="Claude"
        originalAiBody="Hello Jeanne"
      />,
    );

    const toggle = screen.getByTestId("diff-toggle");
    fireEvent.click(toggle);
    expect(toggle.textContent).toMatch(/HIDE DIFF/);

    fireEvent.click(toggle);
    expect(toggle.textContent).toMatch(/DIFF/);
    expect(toggle.textContent).not.toMatch(/HIDE DIFF/);
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Bubble border should no longer be dashed
    const bubble = screen.getByTestId("message-bubble");
    expect(bubble.className).not.toMatch(/border-dashed/);
  });

  it("interpolates editedAgo and operatorName into the toolbar", () => {
    render(
      <MessageBubble
        direction="outbound"
        body="Hi Jeanne"
        source="ai"
        senderName="Claude"
        originalAiBody="Hello Jeanne"
        operatorName="MAYA"
        editedAgo="2M AGO"
      />,
    );

    fireEvent.click(screen.getByTestId("diff-toggle"));
    const provenance = screen.getByTestId("diff-provenance");
    expect(provenance.textContent).toMatch(/MAYA/);
    expect(provenance.textContent).toMatch(/2M AGO/);
  });
});

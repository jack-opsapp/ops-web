import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("AI-drafted (outbound + source ai) bubbles use lavender + 'Phase C' meta", () => {
    render(
      <MessageBubble
        direction="outbound"
        body="hi"
        source="ai"
        senderName="Phase C"
      />,
    );
    const bubble = screen.getByTestId("message-bubble");
    expect(bubble.className).toMatch(/bg-agent\//);
    expect(screen.getByText(/Phase C/i)).toBeInTheDocument();
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
        senderName="Phase C"
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
        senderName="Phase C"
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
        senderName="Phase C"
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
        senderName="Phase C"
        originalAiBody="Hello Jeanne — sounds great."
        operatorName="JACKSON"
        editedAgo="23S AGO"
      />,
    );

    fireEvent.click(screen.getByTestId("diff-toggle"));

    expect(screen.getByTestId("diff-header")).toHaveTextContent(/SHOWING DIFF/);
    const provenance = screen.getByTestId("diff-provenance");
    expect(provenance).toHaveTextContent(/PHASE C/);
    expect(provenance).toHaveTextContent(/JACKSON/);
    expect(provenance).toHaveTextContent(/23S AGO/);
  });

  it("expanded state changes button label to HIDE DIFF", () => {
    render(
      <MessageBubble
        direction="outbound"
        body="Hi Jeanne"
        source="ai"
        senderName="Phase C"
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
        senderName="Phase C"
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
        senderName="Phase C"
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
        senderName="Phase C"
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
        senderName="Phase C"
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
        senderName="Phase C"
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

  // ── File attachment rows (Phase F4) ────────────────────────────────────

  it("does NOT render file rows when attachments is undefined", () => {
    render(
      <MessageBubble
        direction="inbound"
        body="hi"
        senderName="Jeanne"
      />,
    );
    expect(screen.queryByTestId("bubble-attachments")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bubble-file-count")).not.toBeInTheDocument();
  });

  it("does NOT render file rows when attachments is empty", () => {
    render(
      <MessageBubble
        direction="inbound"
        body="hi"
        senderName="Jeanne"
        attachments={[]}
      />,
    );
    expect(screen.queryByTestId("bubble-attachments")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bubble-file-count")).not.toBeInTheDocument();
  });

  it("renders one row per attachment with filename and size", () => {
    render(
      <MessageBubble
        direction="inbound"
        body="hi"
        senderName="Jeanne"
        attachments={[
          { id: "a", filename: "scope_v3.pdf", size: "2.4 MB" },
          { id: "b", filename: "site_plan.dwg", size: "184 KB" },
        ]}
      />,
    );

    const rows = screen.getAllByTestId("bubble-attachment-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("scope_v3.pdf");
    expect(rows[0]).toHaveTextContent("2.4 MB");
    expect(rows[1]).toHaveTextContent("site_plan.dwg");
    expect(rows[1]).toHaveTextContent("184 KB");
  });

  it("filename column has the uppercase class so mixed-case names render upper", () => {
    render(
      <MessageBubble
        direction="inbound"
        body="hi"
        senderName="Jeanne"
        attachments={[
          { id: "a", filename: "Scope_v3.pdf", size: "2.4 MB" },
        ]}
      />,
    );

    const filenameSpan = screen.getByText("Scope_v3.pdf");
    expect(filenameSpan.className).toMatch(/uppercase/);
  });

  it("each file row contains a Paperclip lucide icon", () => {
    const { container } = render(
      <MessageBubble
        direction="inbound"
        body="hi"
        senderName="Jeanne"
        attachments={[
          { id: "a", filename: "scope_v3.pdf", size: "2.4 MB" },
          { id: "b", filename: "site_plan.dwg", size: "184 KB" },
        ]}
      />,
    );

    // Lucide Paperclip renders as <svg class="lucide lucide-paperclip ...">
    const paperclips = container.querySelectorAll("svg.lucide-paperclip");
    // One per row (two rows here). The legacy attachmentName icon is not rendered.
    expect(paperclips.length).toBeGreaterThanOrEqual(2);
  });

  it("when onClick is provided the row is a button and fires the callback", () => {
    const handleClick = vi.fn();
    render(
      <MessageBubble
        direction="inbound"
        body="hi"
        senderName="Jeanne"
        attachments={[
          {
            id: "a",
            filename: "scope_v3.pdf",
            size: "2.4 MB",
            onClick: handleClick,
          },
        ]}
      />,
    );

    const row = screen.getByTestId("bubble-attachment-row");
    expect(row.tagName.toLowerCase()).toBe("button");
    expect(row).toHaveAttribute("type", "button");
    fireEvent.click(row);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("when onClick is absent the row is NOT a button", () => {
    render(
      <MessageBubble
        direction="inbound"
        body="hi"
        senderName="Jeanne"
        attachments={[
          { id: "a", filename: "scope_v3.pdf", size: "2.4 MB" },
        ]}
      />,
    );

    const row = screen.getByTestId("bubble-attachment-row");
    expect(row.tagName.toLowerCase()).toBe("div");
    // No button role for this filename
    expect(
      screen.queryByRole("button", { name: /scope_v3\.pdf/i }),
    ).toBeNull();
  });

  it("meta line appends '· N FILES' when multiple attachments are present", () => {
    render(
      <MessageBubble
        direction="inbound"
        body="hi"
        senderName="Jeanne"
        timestamp="14:05"
        attachments={[
          { id: "a", filename: "scope_v3.pdf", size: "2.4 MB" },
          { id: "b", filename: "site_plan.dwg", size: "184 KB" },
        ]}
      />,
    );

    const fileCount = screen.getByTestId("bubble-file-count");
    expect(fileCount).toHaveTextContent("2 FILES");
  });

  it("meta line uses singular '1 FILE' when exactly one attachment", () => {
    render(
      <MessageBubble
        direction="inbound"
        body="hi"
        senderName="Jeanne"
        timestamp="14:05"
        attachments={[
          { id: "a", filename: "scope_v3.pdf", size: "2.4 MB" },
        ]}
      />,
    );

    const fileCount = screen.getByTestId("bubble-file-count");
    expect(fileCount).toHaveTextContent("1 FILE");
    expect(fileCount.textContent).not.toMatch(/FILES/);
  });

  it("body text still renders normally below the file rows", () => {
    render(
      <MessageBubble
        direction="inbound"
        body="Got it — second-floor unit is OK."
        senderName="Jeanne"
        attachments={[
          { id: "a", filename: "scope_v3.pdf", size: "2.4 MB" },
        ]}
      />,
    );

    expect(screen.getByText(/second-floor unit/)).toBeInTheDocument();
    expect(screen.getByTestId("bubble-attachments")).toBeInTheDocument();
  });

  it("F4 + F2 interaction: DIFF toggle and file rows both render together", () => {
    render(
      <MessageBubble
        direction="outbound"
        body="Hi Jeanne — sounds good."
        source="ai"
        senderName="Phase C"
        originalAiBody="Hello Jeanne — sounds great."
        attachments={[
          { id: "a", filename: "scope_v3.pdf", size: "2.4 MB" },
        ]}
      />,
    );

    // Both surfaces present.
    expect(screen.getByTestId("diff-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("bubble-attachments")).toBeInTheDocument();
    expect(screen.getByTestId("bubble-file-count")).toHaveTextContent(
      "1 FILE",
    );

    // Diff still functional with attachments present.
    fireEvent.click(screen.getByTestId("diff-toggle"));
    expect(screen.getByTestId("diff-header")).toBeInTheDocument();
    // File rows persist while diff is open.
    expect(screen.getByTestId("bubble-attachments")).toBeInTheDocument();
  });
});

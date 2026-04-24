import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EdgeTab } from "@/components/ui/edge-tab";

const renderBell = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" data-testid="bell-glyph" />
);

describe("<EdgeTab>", () => {
  it("renders with wordmark and aria-label when closed", () => {
    render(
      <EdgeTab
        id="test"
        open={false}
        onToggle={() => {}}
        wordmark="NOTIFICATIONS"
        ariaLabel="Toggle test tab"
        tooltipTitle="Test"
        renderGlyph={renderBell}
      />,
    );
    const tab = screen.getByRole("button", { name: /toggle test tab/i });
    expect(tab).toBeInTheDocument();
    expect(tab).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("NOTIFICATIONS")).toBeInTheDocument();
  });

  it("shows 'CLOSE' wordmark when open", () => {
    render(
      <EdgeTab
        id="test"
        open={true}
        onToggle={() => {}}
        wordmark="NOTIFICATIONS"
        wordmarkOpen="CLOSE"
        ariaLabel="Close test tab"
        tooltipTitle="Test"
        renderGlyph={renderBell}
      />,
    );
    const tab = screen.getByRole("button", { name: /close test tab/i });
    expect(tab).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("CLOSE")).toBeInTheDocument();
  });

  it("shows count badge when closed and count > 0", () => {
    render(
      <EdgeTab
        id="test"
        open={false}
        onToggle={() => {}}
        count={14}
        wordmark="NOTIFICATIONS"
        ariaLabel="x"
        tooltipTitle="x"
        renderGlyph={renderBell}
      />,
    );
    expect(screen.getByText("14")).toBeInTheDocument();
  });

  it("hides count badge when open", () => {
    render(
      <EdgeTab
        id="test"
        open={true}
        onToggle={() => {}}
        count={14}
        wordmark="NOTIFICATIONS"
        wordmarkOpen="CLOSE"
        ariaLabel="x"
        tooltipTitle="x"
        renderGlyph={renderBell}
      />,
    );
    expect(screen.queryByText("14")).not.toBeInTheDocument();
  });

  it("hides count badge when count is 0", () => {
    render(
      <EdgeTab
        id="test"
        open={false}
        onToggle={() => {}}
        count={0}
        wordmark="NOTIFICATIONS"
        ariaLabel="x"
        tooltipTitle="x"
        renderGlyph={renderBell}
      />,
    );
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("fires onToggle when clicked", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <EdgeTab
        id="test"
        open={false}
        onToggle={onToggle}
        wordmark="NOTIFICATIONS"
        ariaLabel="Toggle"
        tooltipTitle="Test"
        renderGlyph={renderBell}
      />,
    );
    await user.click(screen.getByRole("button", { name: /toggle/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("fires onToggle on Enter keypress", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <EdgeTab
        id="test"
        open={false}
        onToggle={onToggle}
        wordmark="NOTIFICATIONS"
        ariaLabel="Toggle"
        tooltipTitle="Test"
        renderGlyph={renderBell}
      />,
    );
    const tab = screen.getByRole("button", { name: /toggle/i });
    tab.focus();
    await user.keyboard("{Enter}");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("fires onToggle on Space keypress", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <EdgeTab
        id="test"
        open={false}
        onToggle={onToggle}
        wordmark="NOTIFICATIONS"
        ariaLabel="Toggle"
        tooltipTitle="Test"
        renderGlyph={renderBell}
      />,
    );
    const tab = screen.getByRole("button", { name: /toggle/i });
    tab.focus();
    await user.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows hover tooltip when closed and hovered", async () => {
    const user = userEvent.setup();
    render(
      <EdgeTab
        id="test"
        open={false}
        onToggle={() => {}}
        wordmark="NOTIFICATIONS"
        ariaLabel="Toggle"
        tooltipTitle="Test tooltip"
        shortcut="N"
        renderGlyph={renderBell}
      />,
    );
    await user.hover(screen.getByRole("button"));
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByText("Test tooltip")).toBeInTheDocument();
    expect(screen.getByText("N")).toBeInTheDocument();
  });

  it("hides tooltip when open", async () => {
    const user = userEvent.setup();
    render(
      <EdgeTab
        id="test"
        open={true}
        onToggle={() => {}}
        wordmark="NOTIFICATIONS"
        wordmarkOpen="CLOSE"
        ariaLabel="Close"
        tooltipTitle="Test tooltip"
        renderGlyph={renderBell}
      />,
    );
    await user.hover(screen.getByRole("button"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

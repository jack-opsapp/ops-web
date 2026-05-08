import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ThreadDetail } from "../thread-detail";

const baseProps = {
  subject: "RFQ — kitchen remodel",
  category: { label: "CLIENT", dotClassName: "bg-text-2" },
  senderName: "Calloway HVAC",
  messageCount: 4,
  onPrev: vi.fn(),
  onNext: vi.fn(),
  onArchive: vi.fn(),
  onSnooze: vi.fn(),
  onRecategorize: vi.fn(),
  onMore: vi.fn(),
};

describe("<ThreadDetail>", () => {
  it("renders the thread subject as the header title (not the sender)", () => {
    render(
      <ThreadDetail {...baseProps}>
        <div>messages</div>
      </ThreadDetail>,
    );
    expect(screen.getByText("RFQ — kitchen remodel")).toBeInTheDocument();
  });

  it("meta strip surfaces category label, sender, and message count", () => {
    render(
      <ThreadDetail {...baseProps}>
        <div />
      </ThreadDetail>,
    );
    expect(screen.getByText("CLIENT")).toBeInTheDocument();
    expect(screen.getByText("Calloway HVAC")).toBeInTheDocument();
    expect(screen.getByText("4 messages")).toBeInTheDocument();
  });

  it("renders the canonical four-button action cluster", () => {
    render(
      <ThreadDetail {...baseProps}>
        <div />
      </ThreadDetail>,
    );
    expect(screen.getByRole("button", { name: /archive/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /snooze/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /recategorize/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /more actions/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /toggle context/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /open client/i }),
    ).not.toBeInTheDocument();
  });

  it("J advances next, K retreats prev (case-insensitive); ignores when typing in input", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(
      <ThreadDetail {...baseProps} onPrev={onPrev} onNext={onNext}>
        <div />
        <input data-testid="input" />
      </ThreadDetail>,
    );
    fireEvent.keyDown(window, { key: "j" });
    expect(onNext).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "k" });
    expect(onPrev).toHaveBeenCalledTimes(1);

    const input = screen.getByTestId("input") as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: "j" });
    fireEvent.keyDown(input, { key: "k" });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("clicking the archive button calls onArchive", () => {
    const onArchive = vi.fn();
    render(
      <ThreadDetail {...baseProps} onArchive={onArchive}>
        <div />
      </ThreadDetail>,
    );
    screen.getByRole("button", { name: /archive/i }).click();
    expect(onArchive).toHaveBeenCalled();
  });

  it("renders children in the body", () => {
    render(
      <ThreadDetail {...baseProps}>
        <div data-testid="messages">Body</div>
      </ThreadDetail>,
    );
    expect(screen.getByTestId("messages")).toBeInTheDocument();
  });
});

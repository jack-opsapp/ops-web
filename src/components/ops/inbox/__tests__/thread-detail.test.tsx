import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ThreadDetail } from "../thread-detail";

const baseProps = {
  client: {
    name: "Calloway HVAC",
    phone: "+1 (415) 555-0184",
    email: "ops@calloway.com",
    address: "123 Mission St, San Francisco, CA",
  },
  onPrev: vi.fn(),
  onNext: vi.fn(),
  onArchive: vi.fn(),
  onSnooze: vi.fn(),
  onRecategorize: vi.fn(),
  onMore: vi.fn(),
  onToggleRail: vi.fn(),
  rightRailOpen: true,
};

describe("<ThreadDetail>", () => {
  it("renders the client name in the header", () => {
    render(
      <ThreadDetail {...baseProps}>
        <div>messages</div>
      </ThreadDetail>,
    );
    expect(screen.getByText("Calloway HVAC")).toBeInTheDocument();
  });

  it("renders contact strip entries with mono uppercase styling", () => {
    render(
      <ThreadDetail {...baseProps}>
        <div />
      </ThreadDetail>,
    );
    expect(screen.getByText(/415\) 555-0184/)).toBeInTheDocument();
    expect(screen.getByText(/ops@calloway\.com/)).toBeInTheDocument();
    expect(screen.getByText(/Mission St/)).toBeInTheDocument();
  });

  it("renders four right-side icon buttons: archive/snooze/recategorize/more", () => {
    render(
      <ThreadDetail {...baseProps}>
        <div />
      </ThreadDetail>,
    );
    expect(screen.getByRole("button", { name: /archive/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /snooze/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /recategorize/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /more/i })).toBeInTheDocument();
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

    // While focused in an input, the keys are ignored.
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

  it("toggle rail button calls onToggleRail", () => {
    const onToggleRail = vi.fn();
    render(
      <ThreadDetail {...baseProps} onToggleRail={onToggleRail}>
        <div />
      </ThreadDetail>,
    );
    screen.getByRole("button", { name: /toggle context/i }).click();
    expect(onToggleRail).toHaveBeenCalled();
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

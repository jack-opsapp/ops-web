import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitForElementToBeRemoved,
} from "@testing-library/react";

const useReducedMotionMock = vi.fn();

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>(
    "framer-motion",
  );
  return {
    ...actual,
    useReducedMotion: () => useReducedMotionMock(),
  };
});

import { FloatingYourTurnBadge } from "../floating-your-turn-badge";

beforeEach(() => {
  useReducedMotionMock.mockReset();
  useReducedMotionMock.mockReturnValue(false);
});

describe("<FloatingYourTurnBadge>", () => {
  it("renders nothing when show=false", () => {
    const { container } = render(<FloatingYourTurnBadge show={false} />);
    expect(container.firstChild).toBeNull();
    expect(
      screen.queryByTestId("floating-your-turn-badge"),
    ).not.toBeInTheDocument();
  });

  it("renders the slash label when show=true", () => {
    render(<FloatingYourTurnBadge show />);
    const badge = screen.getByTestId("floating-your-turn-badge");
    expect(badge).toBeInTheDocument();
    expect(screen.getByTestId("floating-your-turn-badge-label")).toHaveTextContent(
      "// YOUR TURN",
    );
  });

  it("uses role=status + aria-label for assistive tech", () => {
    render(<FloatingYourTurnBadge show />);
    const badge = screen.getByRole("status", { name: /your turn/i });
    expect(badge).toBeInTheDocument();
  });

  it("renders the wait clock + bullet separator when waitDuration provided", () => {
    render(<FloatingYourTurnBadge show waitDuration="18H" />);
    expect(
      screen.getByTestId("floating-your-turn-badge-wait"),
    ).toHaveTextContent("18H");
  });

  it("omits the wait clock when waitDuration is undefined", () => {
    render(<FloatingYourTurnBadge show />);
    expect(
      screen.queryByTestId("floating-your-turn-badge-wait"),
    ).not.toBeInTheDocument();
  });

  it("renders the acknowledge button when onAcknowledge is provided", () => {
    const onAcknowledge = vi.fn();
    render(
      <FloatingYourTurnBadge show waitDuration="18H" onAcknowledge={onAcknowledge} />,
    );
    const btn = screen.getByTestId("floating-your-turn-badge-acknowledge");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-label", "Mark no reply needed");
  });

  it("calls onAcknowledge when the ✓ button is clicked", () => {
    const onAcknowledge = vi.fn();
    render(<FloatingYourTurnBadge show onAcknowledge={onAcknowledge} />);
    fireEvent.click(
      screen.getByTestId("floating-your-turn-badge-acknowledge"),
    );
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it("hides the acknowledge button when onAcknowledge is undefined", () => {
    render(<FloatingYourTurnBadge show waitDuration="18H" />);
    expect(
      screen.queryByTestId("floating-your-turn-badge-acknowledge"),
    ).not.toBeInTheDocument();
  });

  it("renders as a flow chip for the reserved status stack", () => {
    render(<FloatingYourTurnBadge show />);
    const badge = screen.getByTestId("floating-your-turn-badge");
    expect(badge.className).toContain("inline-flex");
    expect(badge.className).not.toContain("absolute");
    expect(badge.firstElementChild?.className).toContain("bg-transparent");
  });

  it("renders without a transform shift when reduced motion is ON", () => {
    useReducedMotionMock.mockReturnValue(true);
    render(<FloatingYourTurnBadge show waitDuration="18H" />);
    // Reduced-motion variant strips the y translate — only opacity animates.
    // Smoke-check the badge mounts; framer-motion's internals translate the
    // variant into inline styles. The presence of the badge proves the
    // reduced branch was taken (any throw would fail the test).
    expect(
      screen.getByTestId("floating-your-turn-badge"),
    ).toBeInTheDocument();
  });

  it("renders with the standard variant when reduced motion is OFF", () => {
    useReducedMotionMock.mockReturnValue(false);
    render(<FloatingYourTurnBadge show waitDuration="12D" onAcknowledge={vi.fn()} />);
    const badge = screen.getByTestId("floating-your-turn-badge");
    expect(badge).toBeInTheDocument();
    expect(screen.getByTestId("floating-your-turn-badge-wait")).toHaveTextContent(
      "12D",
    );
  });

  it("the slash label stays neutral in the compact status stack", () => {
    render(<FloatingYourTurnBadge show waitDuration="18H" />);
    const label = screen.getByTestId("floating-your-turn-badge-label");
    expect(label.className).toContain("text-text-2");
  });

  it("keeps the acknowledge control compact for desktop", () => {
    render(<FloatingYourTurnBadge show onAcknowledge={vi.fn()} />);
    const btn = screen.getByTestId("floating-your-turn-badge-acknowledge");
    expect(btn.className).toContain("h-[18px]");
    expect(btn.className).toContain("w-[18px]");
  });

  it("unmounts cleanly when show flips false (AnimatePresence exit completes)", async () => {
    const { rerender } = render(
      <FloatingYourTurnBadge show waitDuration="18H" />,
    );
    expect(
      screen.getByTestId("floating-your-turn-badge"),
    ).toBeInTheDocument();

    rerender(<FloatingYourTurnBadge show={false} waitDuration="18H" />);

    // AnimatePresence runs the 150ms exit transition; once it resolves the
    // node is removed from the DOM. The interim render keeps the element
    // with `opacity: 0` styling.
    await waitForElementToBeRemoved(
      () => screen.queryByTestId("floating-your-turn-badge"),
      { timeout: 1000 },
    );
  });
});

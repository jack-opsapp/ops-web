import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  UndoToastHost,
  enqueueUndoToast,
  dismissUndoToast,
} from "../undo-toast";

describe("<UndoToastHost> + enqueueUndoToast", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the SYS :: prefix message body when a toast is enqueued", () => {
    render(<UndoToastHost />);
    act(() => {
      enqueueUndoToast({
        message: "SYS :: THREAD ARCHIVED",
        onUndo: vi.fn(),
      });
    });
    expect(screen.getByText(/SYS :: THREAD ARCHIVED/)).toBeInTheDocument();
  });

  it("renders the UNDO button with the inline [Z] keyhint", () => {
    render(<UndoToastHost />);
    act(() => {
      enqueueUndoToast({
        message: "SYS :: THREAD ARCHIVED",
        onUndo: vi.fn(),
      });
    });
    // The verb sits inside a button; the [Z] hint is rendered as inline kbd.
    expect(screen.getByRole("button")).toHaveTextContent(/UNDO/);
    expect(screen.getByText("[Z]")).toBeInTheDocument();
  });

  it("clicking the UNDO button fires the onUndo callback", () => {
    const onUndo = vi.fn();
    render(<UndoToastHost />);
    act(() => {
      enqueueUndoToast({ message: "SYS :: THREAD ARCHIVED", onUndo });
    });
    fireEvent.click(screen.getByRole("button"));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("auto-dismisses after the default 5000ms duration", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    render(<UndoToastHost />);
    act(() => {
      enqueueUndoToast({
        message: "SYS :: THREAD ARCHIVED",
        onUndo: vi.fn(),
        onExpire,
      });
    });
    expect(screen.getByText(/SYS :: THREAD ARCHIVED/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    // Still visible just before the threshold.
    expect(screen.queryByText(/SYS :: THREAD ARCHIVED/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("bare-Z keydown triggers onUndo on the most recent toast", () => {
    const onUndo = vi.fn();
    render(<UndoToastHost />);
    act(() => {
      enqueueUndoToast({ message: "SYS :: THREAD ARCHIVED", onUndo });
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z" }));
    });
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("Cmd+Z does NOT trigger onUndo (modifier excluded)", () => {
    const onUndo = vi.fn();
    render(<UndoToastHost />);
    act(() => {
      enqueueUndoToast({ message: "SYS :: THREAD ARCHIVED", onUndo });
    });
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", metaKey: true }),
      );
    });
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("Ctrl+Z does NOT trigger onUndo (modifier excluded)", () => {
    const onUndo = vi.fn();
    render(<UndoToastHost />);
    act(() => {
      enqueueUndoToast({ message: "SYS :: THREAD ARCHIVED", onUndo });
    });
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
      );
    });
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("ignores bare-Z keydown when focus is in an input", () => {
    const onUndo = vi.fn();
    render(<UndoToastHost />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    act(() => {
      enqueueUndoToast({ message: "SYS :: THREAD ARCHIVED", onUndo });
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", bubbles: true }),
      );
    });
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("caps the visible stack at 3 toasts (oldest dropped silently)", () => {
    render(<UndoToastHost />);
    act(() => {
      enqueueUndoToast({ message: "SYS :: ONE", onUndo: vi.fn() });
      enqueueUndoToast({ message: "SYS :: TWO", onUndo: vi.fn() });
      enqueueUndoToast({ message: "SYS :: THREE", onUndo: vi.fn() });
      enqueueUndoToast({ message: "SYS :: FOUR", onUndo: vi.fn() });
    });
    // ONE is dropped, TWO/THREE/FOUR remain.
    expect(screen.queryByText(/SYS :: ONE/)).toBeNull();
    expect(screen.getByText(/SYS :: TWO/)).toBeInTheDocument();
    expect(screen.getByText(/SYS :: THREE/)).toBeInTheDocument();
    expect(screen.getByText(/SYS :: FOUR/)).toBeInTheDocument();
  });

  it("renders the optional detail subline when supplied", () => {
    render(<UndoToastHost />);
    act(() => {
      enqueueUndoToast({
        message: "SYS :: MOVED TO LEAD",
        detail: "[—] phase c will learn from this correction.",
        onUndo: vi.fn(),
      });
    });
    expect(
      screen.getByText(/phase c will learn from this correction/i),
    ).toBeInTheDocument();
  });

  it("dismissUndoToast removes a toast without firing onUndo", () => {
    const onUndo = vi.fn();
    render(<UndoToastHost />);
    let id = "";
    act(() => {
      id = enqueueUndoToast({
        message: "SYS :: THREAD ARCHIVED",
        onUndo,
      });
    });
    act(() => {
      dismissUndoToast(id);
    });
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("toast row carries role=status and aria-live=polite", () => {
    render(<UndoToastHost />);
    act(() => {
      enqueueUndoToast({ message: "SYS :: THREAD ARCHIVED", onUndo: vi.fn() });
    });
    const row = screen.getByRole("status");
    expect(row).toHaveAttribute("aria-live", "polite");
  });
});

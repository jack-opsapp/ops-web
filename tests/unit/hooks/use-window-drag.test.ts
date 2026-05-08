import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useWindowDrag } from "@/components/ops/projects/workspace/shell/use-window-drag";

// `useWindowDrag` — pointer-down → pointermove → pointerup drag handler
// for the workspace window. Pointer-down captures the current cursor
// offset relative to the window position, attaches pointermove +
// pointerup listeners on `window`, and emits position updates through
// onChange. pointerup detaches the listeners so the hook is leak-free.
//
// Buttons / inputs / explicit `[data-no-drag]` ancestors short-circuit
// the drag (the title bar dispatches its own onPointerDown — the
// workspace window owns the drag handler; the title bar is just the
// affordance).

interface PointerEventLike {
  clientX: number;
  clientY: number;
  target?: EventTarget | null;
}

function dispatchWindowPointerEvent(type: "pointermove" | "pointerup", { clientX, clientY }: PointerEventLike) {
  // jsdom 25 doesn't expose PointerEvent globally — synthesise via a
  // MouseEvent and add the bare clientX/clientY values the hook reads.
  const ev = new MouseEvent(type, { bubbles: true });
  Object.defineProperty(ev, "clientX", { value: clientX });
  Object.defineProperty(ev, "clientY", { value: clientY });
  window.dispatchEvent(ev);
}

describe("useWindowDrag", () => {
  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onChange = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits new positions while pointer moves after pointer-down", () => {
    const { result } = renderHook(() =>
      useWindowDrag({ position: { x: 100, y: 50 }, onChange }),
    );

    // Pointer-down at (200, 80). Offset from the window origin is
    // (200 - 100, 80 - 50) = (100, 30). Subsequent move to (240, 100)
    // should snap the window to (240 - 100, 100 - 30) = (140, 70).
    const target = document.createElement("div");
    act(() => {
      result.current.onPointerDown({
        clientX: 200,
        clientY: 80,
        target,
        preventDefault: () => {},
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });

    act(() => {
      dispatchWindowPointerEvent("pointermove", { clientX: 240, clientY: 100 });
    });

    expect(onChange).toHaveBeenCalledWith({ x: 140, y: 70 });
  });

  it("clamps position so the window never escapes the viewport top/left", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });

    const { result } = renderHook(() =>
      useWindowDrag({ position: { x: 100, y: 50 }, onChange }),
    );

    const target = document.createElement("div");
    act(() => {
      result.current.onPointerDown({
        clientX: 100,
        clientY: 50,
        target,
        preventDefault: () => {},
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });

    // Drag toward (-500, -500). Offset is (0, 0) so the proposed new
    // position is (-500, -500). The hook should clamp x and y to >= 0.
    act(() => {
      dispatchWindowPointerEvent("pointermove", { clientX: -500, clientY: -500 });
    });
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.x).toBeGreaterThanOrEqual(0);
    expect(last.y).toBeGreaterThanOrEqual(0);
  });

  it("detaches listeners on pointer-up (no leak)", () => {
    const { result } = renderHook(() =>
      useWindowDrag({ position: { x: 100, y: 50 }, onChange }),
    );

    const target = document.createElement("div");
    act(() => {
      result.current.onPointerDown({
        clientX: 200,
        clientY: 80,
        target,
        preventDefault: () => {},
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });

    act(() => {
      dispatchWindowPointerEvent("pointerup", { clientX: 200, clientY: 80 });
    });

    // After pointer-up, further pointermove events must not call
    // onChange. Capture the count, dispatch a move, recheck.
    const count = onChange.mock.calls.length;
    act(() => {
      dispatchWindowPointerEvent("pointermove", { clientX: 999, clientY: 999 });
    });
    expect(onChange.mock.calls.length).toBe(count);
  });

  it("does NOT initiate drag when target is inside [data-no-drag]", () => {
    const { result } = renderHook(() =>
      useWindowDrag({ position: { x: 100, y: 50 }, onChange }),
    );

    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-no-drag", "");
    const inner = document.createElement("button");
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);

    act(() => {
      result.current.onPointerDown({
        clientX: 200,
        clientY: 80,
        target: inner,
        preventDefault: () => {},
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });

    act(() => {
      dispatchWindowPointerEvent("pointermove", { clientX: 240, clientY: 100 });
    });

    expect(onChange).not.toHaveBeenCalled();
    document.body.removeChild(wrapper);
  });

  it("does NOT initiate drag when target is a button (interactive)", () => {
    const { result } = renderHook(() =>
      useWindowDrag({ position: { x: 100, y: 50 }, onChange }),
    );

    const button = document.createElement("button");
    document.body.appendChild(button);

    act(() => {
      result.current.onPointerDown({
        clientX: 200,
        clientY: 80,
        target: button,
        preventDefault: () => {},
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });

    act(() => {
      dispatchWindowPointerEvent("pointermove", { clientX: 240, clientY: 100 });
    });

    expect(onChange).not.toHaveBeenCalled();
    document.body.removeChild(button);
  });

  it("isDragging flag toggles true during drag and false after pointer-up", () => {
    const { result } = renderHook(() =>
      useWindowDrag({ position: { x: 100, y: 50 }, onChange }),
    );

    expect(result.current.isDragging).toBe(false);

    const target = document.createElement("div");
    act(() => {
      result.current.onPointerDown({
        clientX: 200,
        clientY: 80,
        target,
        preventDefault: () => {},
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });
    expect(result.current.isDragging).toBe(true);

    act(() => {
      dispatchWindowPointerEvent("pointerup", { clientX: 200, clientY: 80 });
    });
    expect(result.current.isDragging).toBe(false);
  });
});

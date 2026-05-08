/**
 * useWindowDrag — pointer-down → pointermove → pointerup window drag.
 *
 * Smoke coverage to exercise the public surface:
 *   - returns isDragging + onPointerDown
 *   - pointer-down on a forbidden target (button) short-circuits
 *   - pointer-down on a normal target enters drag, attaches listeners,
 *     and emits position updates clamped to viewport bounds
 *   - pointer-up tears listeners down so the hook is leak-free
 *
 * The hook is intentionally light — drag math + clamping live here, but
 * the integration with the window component is covered by the larger
 * project-workspace-window test. This file just guards the surface.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWindowDrag } from "@/components/ops/projects/workspace/shell/use-window-drag";

beforeEach(() => {
  // Pin viewport size so clamp math is deterministic.
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 720,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makePointerDown(target: Element, clientX: number, clientY: number) {
  return {
    target,
    clientX,
    clientY,
    preventDefault: vi.fn(),
  } as unknown as React.PointerEvent<HTMLDivElement>;
}

describe("useWindowDrag", () => {
  it("exposes isDragging + onPointerDown", () => {
    const { result } = renderHook(() =>
      useWindowDrag({
        position: { x: 100, y: 100 },
        onChange: vi.fn(),
      }),
    );
    expect(result.current.isDragging).toBe(false);
    expect(typeof result.current.onPointerDown).toBe("function");
  });

  it("short-circuits when the pointer-down target is a button", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useWindowDrag({ position: { x: 100, y: 100 }, onChange }),
    );

    const button = document.createElement("button");
    document.body.appendChild(button);

    act(() => {
      result.current.onPointerDown(makePointerDown(button, 50, 50));
    });

    expect(result.current.isDragging).toBe(false);
    expect(onChange).not.toHaveBeenCalled();

    document.body.removeChild(button);
  });

  it("short-circuits when canDrag returns false", () => {
    const onChange = vi.fn();
    const canDrag = vi.fn(() => false);
    const { result } = renderHook(() =>
      useWindowDrag({ position: { x: 100, y: 100 }, onChange, canDrag }),
    );

    const div = document.createElement("div");
    document.body.appendChild(div);

    act(() => {
      result.current.onPointerDown(makePointerDown(div, 50, 50));
    });

    expect(canDrag).toHaveBeenCalled();
    expect(result.current.isDragging).toBe(false);
    expect(onChange).not.toHaveBeenCalled();

    document.body.removeChild(div);
  });

  it("enters drag, emits position updates on pointermove, then tears down on pointerup", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useWindowDrag({ position: { x: 100, y: 100 }, onChange }),
    );

    const div = document.createElement("div");
    document.body.appendChild(div);

    // Down at cursor=(150, 150), window pos=(100, 100) → offset=(50, 50)
    act(() => {
      result.current.onPointerDown(makePointerDown(div, 150, 150));
    });

    expect(result.current.isDragging).toBe(true);

    // Move cursor to (200, 220) → next position = cursor - offset = (150, 170)
    act(() => {
      window.dispatchEvent(
        new MouseEvent("pointermove", { clientX: 200, clientY: 220 }),
      );
    });
    expect(onChange).toHaveBeenCalledWith({ x: 150, y: 170 });

    // Pointer up — listener should be removed and isDragging should clear.
    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
    expect(result.current.isDragging).toBe(false);

    // Subsequent moves should be ignored — the listener is gone.
    onChange.mockClear();
    act(() => {
      window.dispatchEvent(
        new MouseEvent("pointermove", { clientX: 999, clientY: 999 }),
      );
    });
    expect(onChange).not.toHaveBeenCalled();

    document.body.removeChild(div);
  });

  it("clamps proposed position to upper-left viewport bounds", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useWindowDrag({ position: { x: 100, y: 100 }, onChange }),
    );

    const div = document.createElement("div");
    document.body.appendChild(div);

    act(() => {
      result.current.onPointerDown(makePointerDown(div, 150, 150));
    });

    // Drag far past upper-left → x/y clamped to >= 0.
    act(() => {
      window.dispatchEvent(
        new MouseEvent("pointermove", { clientX: -500, clientY: -500 }),
      );
    });
    expect(onChange).toHaveBeenCalledWith({ x: 0, y: 0 });

    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
    document.body.removeChild(div);
  });
});

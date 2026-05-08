/**
 * useWindowResize — 8-handle window resize.
 *
 * Smoke coverage:
 *   - returns isResizing + beginResize
 *   - east resize grows width without moving x
 *   - west resize grows width AND offsets x by -dx so the right edge
 *     stays anchored
 *   - south resize grows height without moving y
 *   - north resize grows height AND offsets y so the bottom edge stays
 *     anchored
 *   - corner resize handles both axes simultaneously
 *   - min-size clamp pins width / height and recomputes the anchored
 *     position so the opposite edge stays put
 *   - pointer-up tears down listeners (no leak across resizes)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWindowResize } from "@/components/ops/projects/workspace/shell/use-window-resize";

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 720 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makePointerDown(clientX: number, clientY: number) {
  return {
    clientX,
    clientY,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.PointerEvent<HTMLDivElement>;
}

const BASE = {
  position: { x: 200, y: 100 },
  size: { width: 600, height: 400 },
  minSize: { width: 320, height: 240 },
};

describe("useWindowResize", () => {
  it("exposes isResizing + beginResize", () => {
    const { result } = renderHook(() =>
      useWindowResize({ ...BASE, onChange: vi.fn() }),
    );
    expect(result.current.isResizing).toBe(false);
    expect(typeof result.current.beginResize).toBe("function");
  });

  it("east edge: grows width by +dx, leaves position alone", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useWindowResize({ ...BASE, onChange }),
    );

    act(() => {
      result.current.beginResize("e", makePointerDown(800, 300));
    });
    expect(result.current.isResizing).toBe(true);

    act(() => {
      window.dispatchEvent(
        new MouseEvent("pointermove", { clientX: 850, clientY: 300 }),
      );
    });

    expect(onChange).toHaveBeenLastCalledWith({
      position: { x: 200, y: 100 },
      size: { width: 650, height: 400 },
    });

    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
    expect(result.current.isResizing).toBe(false);
  });

  it("west edge: grows width by -dx AND offsets x to anchor the east edge", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useWindowResize({ ...BASE, onChange }),
    );

    act(() => {
      result.current.beginResize("w", makePointerDown(200, 300));
    });

    // Drag 50px left → width grows by 50, x shifts -50.
    act(() => {
      window.dispatchEvent(
        new MouseEvent("pointermove", { clientX: 150, clientY: 300 }),
      );
    });

    expect(onChange).toHaveBeenLastCalledWith({
      position: { x: 150, y: 100 },
      size: { width: 650, height: 400 },
    });

    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
  });

  it("south edge: grows height, leaves y alone", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useWindowResize({ ...BASE, onChange }),
    );

    act(() => {
      result.current.beginResize("s", makePointerDown(400, 500));
    });

    act(() => {
      window.dispatchEvent(
        new MouseEvent("pointermove", { clientX: 400, clientY: 600 }),
      );
    });

    expect(onChange).toHaveBeenLastCalledWith({
      position: { x: 200, y: 100 },
      size: { width: 600, height: 500 },
    });

    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
  });

  it("north edge: grows height AND offsets y to anchor the south edge", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useWindowResize({ ...BASE, onChange }),
    );

    act(() => {
      result.current.beginResize("n", makePointerDown(400, 100));
    });

    // Drag 60px up → height grows by 60, y shifts -60.
    act(() => {
      window.dispatchEvent(
        new MouseEvent("pointermove", { clientX: 400, clientY: 40 }),
      );
    });

    expect(onChange).toHaveBeenLastCalledWith({
      position: { x: 200, y: 40 },
      size: { width: 600, height: 460 },
    });

    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
  });

  it("ne corner: combines north + east axis math", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useWindowResize({ ...BASE, onChange }),
    );

    act(() => {
      result.current.beginResize("ne", makePointerDown(800, 100));
    });

    // Drag right 30, up 20 → width +30, height +20, y -20.
    act(() => {
      window.dispatchEvent(
        new MouseEvent("pointermove", { clientX: 830, clientY: 80 }),
      );
    });

    expect(onChange).toHaveBeenLastCalledWith({
      position: { x: 200, y: 80 },
      size: { width: 630, height: 420 },
    });

    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
  });

  it("clamps width to minSize and pins x when dragging the west edge past the min", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useWindowResize({ ...BASE, onChange }),
    );

    act(() => {
      result.current.beginResize("w", makePointerDown(200, 300));
    });

    // Drag 400px right — proposed width = 600 - 400 = 200, clamped to min 320.
    // Anchor right edge: x = 200 + (600 - 320) = 480.
    act(() => {
      window.dispatchEvent(
        new MouseEvent("pointermove", { clientX: 600, clientY: 300 }),
      );
    });

    expect(onChange).toHaveBeenLastCalledWith({
      position: { x: 480, y: 100 },
      size: { width: 320, height: 400 },
    });

    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
  });

  it("does not emit further updates after pointerup", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useWindowResize({ ...BASE, onChange }),
    );

    act(() => {
      result.current.beginResize("e", makePointerDown(800, 300));
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });

    onChange.mockClear();
    act(() => {
      window.dispatchEvent(
        new MouseEvent("pointermove", { clientX: 999, clientY: 999 }),
      );
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});

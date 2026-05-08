import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  useWindowResize,
  type ResizeDirection,
} from "@/components/ops/projects/workspace/shell/use-window-resize";

// `useWindowResize` — 8-handle window resize. The hook returns a
// `beginResize(direction)` factory; the shell mounts ResizeHandle
// components on every edge + corner, each calling beginResize on
// pointer-down. Pointer-move grows/shrinks the window in the direction's
// axis. Pointer-up detaches listeners.
//
// Min size 480x360 (the workspace shell will pass 780x600 — Phase 7).
// Test ALL 8 directions to catch off-by-one axis flips.

function dispatchMove(clientX: number, clientY: number) {
  const ev = new MouseEvent("pointermove", { bubbles: true });
  Object.defineProperty(ev, "clientX", { value: clientX });
  Object.defineProperty(ev, "clientY", { value: clientY });
  window.dispatchEvent(ev);
}
function dispatchUp(clientX = 0, clientY = 0) {
  const ev = new MouseEvent("pointerup", { bubbles: true });
  Object.defineProperty(ev, "clientX", { value: clientX });
  Object.defineProperty(ev, "clientY", { value: clientY });
  window.dispatchEvent(ev);
}

interface SizePosState {
  position: { x: number; y: number };
  size: { width: number; height: number };
}

const INITIAL: SizePosState = {
  position: { x: 200, y: 150 },
  size: { width: 800, height: 600 },
};

const MIN = { width: 480, height: 360 };

function setupHook() {
  const onChange = vi.fn();
  const result = renderHook(() =>
    useWindowResize({
      position: INITIAL.position,
      size: INITIAL.size,
      minSize: MIN,
      onChange,
    }),
  );
  return { result, onChange };
}

function startResize(
  result: ReturnType<typeof setupHook>["result"],
  dir: ResizeDirection,
  clientX: number,
  clientY: number,
) {
  act(() => {
    result.result.current.beginResize(dir, {
      clientX,
      clientY,
      preventDefault: () => {},
      stopPropagation: () => {},
    } as unknown as React.PointerEvent<HTMLDivElement>);
  });
}

describe("useWindowResize", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1920 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1080 });
  });

  // ─── East — width grows, position unchanged ───────────────────────────
  it("east: width grows when cursor drags right", () => {
    const { result, onChange } = setupHook();
    startResize(result, "e", 1000, 400);
    act(() => dispatchMove(1100, 400));
    expect(onChange).toHaveBeenCalledWith({
      position: INITIAL.position,
      size: { width: 900, height: 600 },
    });
    act(() => dispatchUp());
  });

  // ─── South — height grows, position unchanged ─────────────────────────
  it("south: height grows when cursor drags down", () => {
    const { result, onChange } = setupHook();
    startResize(result, "s", 600, 750);
    act(() => dispatchMove(600, 850));
    expect(onChange).toHaveBeenCalledWith({
      position: INITIAL.position,
      size: { width: 800, height: 700 },
    });
    act(() => dispatchUp());
  });

  // ─── West — width grows, position.x shifts left ───────────────────────
  it("west: width grows AND x shifts left when cursor drags left", () => {
    const { result, onChange } = setupHook();
    startResize(result, "w", 200, 400);
    act(() => dispatchMove(100, 400));
    // Dragging 100px left grows width by 100, shifts x by -100.
    expect(onChange).toHaveBeenCalledWith({
      position: { x: 100, y: 150 },
      size: { width: 900, height: 600 },
    });
    act(() => dispatchUp());
  });

  // ─── North — height grows, position.y shifts up ───────────────────────
  it("north: height grows AND y shifts up when cursor drags up", () => {
    const { result, onChange } = setupHook();
    startResize(result, "n", 600, 150);
    act(() => dispatchMove(600, 50));
    expect(onChange).toHaveBeenCalledWith({
      position: { x: 200, y: 50 },
      size: { width: 800, height: 700 },
    });
    act(() => dispatchUp());
  });

  // ─── SE corner — width AND height grow ────────────────────────────────
  it("se: width AND height grow when cursor drags down-right", () => {
    const { result, onChange } = setupHook();
    startResize(result, "se", 1000, 750);
    act(() => dispatchMove(1100, 850));
    expect(onChange).toHaveBeenCalledWith({
      position: INITIAL.position,
      size: { width: 900, height: 700 },
    });
    act(() => dispatchUp());
  });

  // ─── NW corner — width + height grow, both x AND y shift ──────────────
  it("nw: width + height grow AND x + y shift when cursor drags up-left", () => {
    const { result, onChange } = setupHook();
    startResize(result, "nw", 200, 150);
    act(() => dispatchMove(100, 50));
    expect(onChange).toHaveBeenCalledWith({
      position: { x: 100, y: 50 },
      size: { width: 900, height: 700 },
    });
    act(() => dispatchUp());
  });

  // ─── NE corner — width grows, y shifts ────────────────────────────────
  it("ne: width grows + y shifts when cursor drags up-right", () => {
    const { result, onChange } = setupHook();
    startResize(result, "ne", 1000, 150);
    act(() => dispatchMove(1100, 50));
    expect(onChange).toHaveBeenCalledWith({
      position: { x: 200, y: 50 },
      size: { width: 900, height: 700 },
    });
    act(() => dispatchUp());
  });

  // ─── SW corner — height grows, x shifts ───────────────────────────────
  it("sw: height grows + x shifts when cursor drags down-left", () => {
    const { result, onChange } = setupHook();
    startResize(result, "sw", 200, 750);
    act(() => dispatchMove(100, 850));
    expect(onChange).toHaveBeenCalledWith({
      position: { x: 100, y: 150 },
      size: { width: 900, height: 700 },
    });
    act(() => dispatchUp());
  });

  // ─── Min size enforcement ─────────────────────────────────────────────
  it("clamps width to min when cursor over-shrinks east edge", () => {
    const { result, onChange } = setupHook();
    startResize(result, "e", 1000, 400);
    // Drag far left — would shrink width to ~50px without clamp.
    act(() => dispatchMove(250, 400));
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.size.width).toBe(MIN.width);
    act(() => dispatchUp());
  });

  it("clamps height to min when cursor over-shrinks south edge", () => {
    const { result, onChange } = setupHook();
    startResize(result, "s", 600, 750);
    act(() => dispatchMove(600, 200));
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.size.height).toBe(MIN.height);
    act(() => dispatchUp());
  });

  it("when west clamps width to min, x is pinned (does not over-shift)", () => {
    const { result, onChange } = setupHook();
    startResize(result, "w", 200, 400);
    // Drag 9999px right — would shrink width past min and over-shift x.
    act(() => dispatchMove(9999, 400));
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.size.width).toBe(MIN.width);
    // The right edge stays anchored. position.x = original.x + (original.width - MIN.width)
    // = 200 + (800 - 480) = 520.
    expect(last.position.x).toBe(520);
    act(() => dispatchUp());
  });

  // ─── Cleanup ──────────────────────────────────────────────────────────
  it("detaches listeners on pointer-up (no leak)", () => {
    const { result, onChange } = setupHook();
    startResize(result, "e", 1000, 400);
    act(() => dispatchMove(1100, 400));
    expect(onChange).toHaveBeenCalledTimes(1);
    act(() => dispatchUp());
    act(() => dispatchMove(1500, 400));
    // Total calls unchanged after pointer-up.
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

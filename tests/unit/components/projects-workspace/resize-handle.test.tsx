import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  ResizeHandle,
  type ResizeHandleProps,
} from "@/components/ops/projects/workspace/shell/resize-handle";

// `ResizeHandle` — invisible 8-direction grab patch on every edge and
// corner of the workspace window. Each handle's only responsibility is
// to call `onPointerDown(direction, event)` so the parent's
// useWindowResize hook can take over. Cursor + size + position are all
// owned here.

const ALL: ResizeHandleProps["direction"][] = [
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
];

const CURSOR_BY_DIR: Record<ResizeHandleProps["direction"], string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

describe("<ResizeHandle>", () => {
  it.each(ALL)("renders an absolutely-positioned handle for direction=%s", (dir) => {
    render(<ResizeHandle direction={dir} onPointerDown={() => {}} />);
    const el = screen.getByTestId(`resize-handle-${dir}`);
    expect(el).toHaveClass("absolute");
  });

  it.each(ALL)("uses the right cursor for direction=%s", (dir) => {
    render(<ResizeHandle direction={dir} onPointerDown={() => {}} />);
    const el = screen.getByTestId(`resize-handle-${dir}`);
    expect(el.className).toContain(CURSOR_BY_DIR[dir]);
  });

  it("calls onPointerDown(direction, event) when fired", () => {
    const onPointerDown = vi.fn();
    render(<ResizeHandle direction="se" onPointerDown={onPointerDown} />);
    fireEvent.pointerDown(screen.getByTestId("resize-handle-se"), {
      clientX: 10,
      clientY: 20,
    });
    expect(onPointerDown).toHaveBeenCalledOnce();
    expect(onPointerDown).toHaveBeenCalledWith("se", expect.any(Object));
  });

  it("renders the corner handles bigger than the edge handles (corner = 12px)", () => {
    render(<ResizeHandle direction="se" onPointerDown={() => {}} />);
    const corner = screen.getByTestId("resize-handle-se");
    expect(corner.className).toContain("w-[12px]");
    expect(corner.className).toContain("h-[12px]");
  });

  it("edge handles are 6px on the resize axis (n/s have h-[6px], e/w have w-[6px])", () => {
    render(<ResizeHandle direction="n" onPointerDown={() => {}} />);
    expect(screen.getByTestId("resize-handle-n").className).toContain("h-[6px]");
    render(<ResizeHandle direction="e" onPointerDown={() => {}} />);
    expect(screen.getByTestId("resize-handle-e").className).toContain("w-[6px]");
  });
});

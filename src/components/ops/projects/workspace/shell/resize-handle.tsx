"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import type { ResizeDirection } from "./use-window-resize";

// `ResizeHandle` — invisible 8-direction grab patch positioned over an
// edge or corner of the workspace window. The handle's only job is to
// call `onPointerDown(direction, event)` so the parent's
// useWindowResize hook can take over. Cursor + size + position styles
// live here so the shell composer doesn't need to know about resize
// geometry.
//
// Geometry per the handoff:
//   - Edges: 6px wide on the resize axis, full length on the other axis
//   - Corners: 12px x 12px square, sitting on top of the edge handles

export interface ResizeHandleProps {
  direction: ResizeDirection;
  onPointerDown: (
    direction: ResizeDirection,
    e: React.PointerEvent<HTMLDivElement>,
  ) => void;
  className?: string;
}

const POSITION_BY_DIR: Record<ResizeDirection, string> = {
  // Edges — full length on the non-resize axis, 6px on the resize axis.
  n: "top-0 left-[12px] right-[12px] h-[6px]",
  s: "bottom-0 left-[12px] right-[12px] h-[6px]",
  e: "top-[12px] right-0 bottom-[12px] w-[6px]",
  w: "top-[12px] left-0 bottom-[12px] w-[6px]",
  // Corners — 12x12 squares stacked above the edges so the corner cursor
  // wins when the user is in the overlap region.
  ne: "top-0 right-0 w-[12px] h-[12px]",
  nw: "top-0 left-0 w-[12px] h-[12px]",
  se: "bottom-0 right-0 w-[12px] h-[12px]",
  sw: "bottom-0 left-0 w-[12px] h-[12px]",
};

const CURSOR_BY_DIR: Record<ResizeDirection, string> = {
  n: "cursor-ns-resize",
  s: "cursor-ns-resize",
  e: "cursor-ew-resize",
  w: "cursor-ew-resize",
  ne: "cursor-nesw-resize",
  sw: "cursor-nesw-resize",
  nw: "cursor-nwse-resize",
  se: "cursor-nwse-resize",
};

// Z-index hierarchy: corners > edges so the corner cursor (and its
// handler) wins when the user is in the corner overlap region.
const Z_BY_DIR: Record<ResizeDirection, number> = {
  n: 1,
  s: 1,
  e: 1,
  w: 1,
  ne: 2,
  nw: 2,
  se: 2,
  sw: 2,
};

export function ResizeHandle({
  direction,
  onPointerDown,
  className,
}: ResizeHandleProps) {
  return (
    <div
      data-testid={`resize-handle-${direction}`}
      data-no-drag
      onPointerDown={(e) => onPointerDown(direction, e)}
      style={{ zIndex: Z_BY_DIR[direction] }}
      className={cn(
        "absolute select-none",
        POSITION_BY_DIR[direction],
        CURSOR_BY_DIR[direction],
        className,
      )}
      aria-hidden
    />
  );
}

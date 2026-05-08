"use client";

import * as React from "react";

// `useWindowResize` — 8-handle resize.
//
// The hook returns a `beginResize(direction, e)` factory which the
// shell's ResizeHandle components call on pointer-down. Pointer-move
// translates into width/height delta + position offset depending on
// which edge or corner is being dragged. Pointer-up detaches listeners
// so the hook doesn't leak.
//
// Min size is enforced by clamping the proposed width/height to >= min;
// when the west or north edge clamps, position is pinned to the
// computed (origin + originalSize - minSize) so the opposite edge
// stays anchored — pulling left past the limit doesn't push the right
// edge off the screen.

export type ResizeDirection =
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";

interface UseWindowResizeOpts {
  position: { x: number; y: number };
  size: { width: number; height: number };
  minSize: { width: number; height: number };
  onChange: (next: {
    position: { x: number; y: number };
    size: { width: number; height: number };
  }) => void;
}

interface UseWindowResizeReturn {
  isResizing: boolean;
  beginResize: (
    direction: ResizeDirection,
    e: React.PointerEvent<HTMLDivElement>,
  ) => void;
}

export function useWindowResize({
  position,
  size,
  minSize,
  onChange,
}: UseWindowResizeOpts): UseWindowResizeReturn {
  const [isResizing, setIsResizing] = React.useState(false);

  // Refs so the move/up listeners read live values without re-attaching.
  const positionRef = React.useRef(position);
  positionRef.current = position;
  const sizeRef = React.useRef(size);
  sizeRef.current = size;
  const minRef = React.useRef(minSize);
  minRef.current = minSize;
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const beginResize = React.useCallback(
    (direction: ResizeDirection, e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      // Snapshot the starting cursor + window state. Every move
      // computes against this anchor so the math is absolute, not
      // incremental — no drift from accumulated rounding errors.
      const startCursor = { x: e.clientX, y: e.clientY };
      const startPos = { ...positionRef.current };
      const startSize = { ...sizeRef.current };
      const min = minRef.current;

      setIsResizing(true);

      const onMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startCursor.x;
        const dy = moveEvent.clientY - startCursor.y;

        // Default = no change; each direction adjusts the relevant axes.
        let nextX = startPos.x;
        let nextY = startPos.y;
        let nextW = startSize.width;
        let nextH = startSize.height;

        // ── Horizontal axis ─────────────────────────────────────────
        if (direction.includes("e")) {
          nextW = Math.max(min.width, startSize.width + dx);
        } else if (direction.includes("w")) {
          // Width grows by -dx when dragging left (-100 → +100 width).
          const proposedW = startSize.width - dx;
          nextW = Math.max(min.width, proposedW);
          // When clamping, anchor the right edge — pin x to
          // (origin + originalWidth - clampedWidth).
          nextX = startPos.x + (startSize.width - nextW);
        }

        // ── Vertical axis ───────────────────────────────────────────
        if (direction.includes("s")) {
          nextH = Math.max(min.height, startSize.height + dy);
        } else if (direction.includes("n")) {
          const proposedH = startSize.height - dy;
          nextH = Math.max(min.height, proposedH);
          nextY = startPos.y + (startSize.height - nextH);
        }

        onChangeRef.current({
          position: { x: nextX, y: nextY },
          size: { width: nextW, height: nextH },
        });
      };

      const onUp = () => {
        setIsResizing(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [],
  );

  return { isResizing, beginResize };
}

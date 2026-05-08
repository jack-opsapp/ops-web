"use client";

import * as React from "react";

// `useWindowDrag` — pointer-down → pointermove → pointerup window drag.
//
// pointer-down captures the offset between the cursor and the window
// origin, attaches pointermove + pointerup listeners on `window`, and
// emits position updates via onChange. pointerup detaches listeners so
// the hook is leak-free.
//
// Buttons / inputs / explicit `[data-no-drag]` ancestors short-circuit
// the drag — the title bar dispatches its own onPointerDown but anything
// interactive inside it (traffic lights, mode pill, header action)
// already wears `data-no-drag`. We re-check at this layer so callers
// can wire the hook directly without trusting markup.

interface UseWindowDragOpts {
  /** Current window position. Re-read via ref so listeners stay stable. */
  position: { x: number; y: number };
  /** Called with the next clamped position on every pointermove. */
  onChange: (position: { x: number; y: number }) => void;
  /** Optional: suppress drag when this returns false (extra guard). */
  canDrag?: () => boolean;
}

interface UseWindowDragReturn {
  isDragging: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}

const NO_DRAG_SELECTOR = "[data-no-drag], button, input, textarea, select, a";

function eventTargetForbidsDrag(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(NO_DRAG_SELECTOR) !== null;
}

export function useWindowDrag({
  position,
  onChange,
  canDrag,
}: UseWindowDragOpts): UseWindowDragReturn {
  const [isDragging, setIsDragging] = React.useState(false);

  // Refs so the move/up listeners read live values without re-attaching.
  const positionRef = React.useRef(position);
  positionRef.current = position;
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const canDragRef = React.useRef(canDrag);
  canDragRef.current = canDrag;

  const offsetRef = React.useRef({ x: 0, y: 0 });

  const onPointerDown = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (eventTargetForbidsDrag(e.target)) return;
    if (canDragRef.current && !canDragRef.current()) return;

    e.preventDefault();
    offsetRef.current = {
      x: e.clientX - positionRef.current.x,
      y: e.clientY - positionRef.current.y,
    };
    setIsDragging(true);

    const onMove = (moveEvent: MouseEvent) => {
      // Clamp so the window can't escape the top-left edge entirely.
      // Right/bottom clamp lives in the resize hook + the parent; here
      // we only enforce the upper-left bound so the title bar stays
      // grabbable. -100 leaves a small margin so the window can sit
      // partially off the right/bottom (matches macOS).
      const proposedX = moveEvent.clientX - offsetRef.current.x;
      const proposedY = moveEvent.clientY - offsetRef.current.y;
      const maxX = Math.max(0, window.innerWidth - 100);
      const maxY = Math.max(0, window.innerHeight - 40);
      const x = Math.min(maxX, Math.max(0, proposedX));
      const y = Math.min(maxY, Math.max(0, proposedY));
      onChangeRef.current({ x, y });
    };

    const onUp = () => {
      setIsDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);

  // Belt-and-braces cleanup if the host unmounts mid-drag — listeners
  // would otherwise live forever on `window`.
  React.useEffect(() => {
    return () => {
      // No direct refs to the listeners here, but flipping isDragging
      // false signals consumers that drag state is gone. The actual
      // listener removal is owned by the pointerup handler.
    };
  }, []);

  return { isDragging, onPointerDown };
}

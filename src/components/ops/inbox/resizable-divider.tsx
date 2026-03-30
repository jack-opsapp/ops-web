"use client";

import { useCallback, useRef } from "react";

interface ResizableDividerProps {
  onResize: (deltaX: number) => void;
  onResizeEnd: () => void;
}

export function ResizableDivider({ onResize, onResizeEnd }: ResizableDividerProps) {
  const startXRef = useRef(0);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      const handleMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - startXRef.current;
        startXRef.current = moveEvent.clientX;
        onResize(delta);
      };

      const handleUp = () => {
        target.removeEventListener("pointermove", handleMove);
        target.removeEventListener("pointerup", handleUp);
        onResizeEnd();
      };

      target.addEventListener("pointermove", handleMove);
      target.addEventListener("pointerup", handleUp);
    },
    [onResize, onResizeEnd]
  );

  return (
    <div
      onPointerDown={handlePointerDown}
      className="w-[4px] cursor-col-resize relative shrink-0 group"
    >
      {/* Visible grab indicator */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[2px] h-[32px] rounded-full bg-[rgba(255,255,255,0.08)] group-hover:bg-[rgba(255,255,255,0.15)] transition-colors" />
    </div>
  );
}

"use client";

import { useCallback, useRef, useState, type MouseEvent } from "react";
import { Minus, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useWindowStore, type FloatingWindowState } from "@/stores/window-store";

interface FloatingWindowProps {
  window: FloatingWindowState;
  children: React.ReactNode;
}

export function FloatingWindow({ window: win, children }: FloatingWindowProps) {
  const { closeWindow, minimizeWindow, focusWindow, updatePosition } =
    useWindowStore();
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      // Only drag from the title bar area
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      focusWindow(win.id);
      setIsDragging(true);
      dragOffset.current = {
        x: e.clientX - win.position.x,
        y: e.clientY - win.position.y,
      };

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        const newX = Math.max(
          0,
          Math.min(
            moveEvent.clientX - dragOffset.current.x,
            globalThis.innerWidth - 100
          )
        );
        const newY = Math.max(
          0,
          Math.min(
            moveEvent.clientY - dragOffset.current.y,
            globalThis.innerHeight - 40
          )
        );
        updatePosition(win.id, { x: newX, y: newY });
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [win.id, win.position, focusWindow, updatePosition]
  );

  if (win.isMinimized) return null;

  return (
    <div
      className={cn(
        "fixed bg-[rgba(13,13,13,0.95)] backdrop-blur-xl",
        "border border-[rgba(255,255,255,0.2)] rounded-lg shadow-floating",
        "flex flex-col overflow-hidden",
        isDragging && "select-none"
      )}
      style={{
        left: win.position.x,
        top: win.position.y,
        width: win.size.width,
        height: win.size.height,
        zIndex: win.zIndex,
      }}
      onMouseDown={() => focusWindow(win.id)}
    >
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-1.5 py-1 border-b border-[rgba(255,255,255,0.1)] cursor-move shrink-0"
        onMouseDown={handleMouseDown}
      >
        <h3 className="font-mohave text-body-sm text-text-primary uppercase tracking-wider truncate">
          {win.title}
        </h3>
        <div className="flex items-center gap-[2px] shrink-0">
          <button
            onClick={() => minimizeWindow(win.id)}
            className="w-[24px] h-[24px] rounded flex items-center justify-center text-text-tertiary hover:text-text-secondary hover:bg-[rgba(255,255,255,0.06)] transition-colors"
            title="Minimize"
          >
            <Minus className="w-[14px] h-[14px]" />
          </button>
          <button
            onClick={() => closeWindow(win.id)}
            className="w-[24px] h-[24px] rounded flex items-center justify-center text-text-tertiary hover:text-ops-error hover:bg-ops-error-muted transition-colors"
            title="Close"
          >
            <X className="w-[14px] h-[14px]" />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-2">{children}</div>
    </div>
  );
}

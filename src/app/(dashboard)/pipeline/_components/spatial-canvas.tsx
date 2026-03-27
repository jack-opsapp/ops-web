"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  useSpatialCanvasStore,
  ZOOM_STEP,
  MIN_ZOOM,
  MAX_ZOOM,
} from "./spatial-canvas-store";

interface SpatialCanvasProps {
  children: ReactNode;
  canvasWidth: number;
  canvasHeight: number;
  onCanvasContextMenu?: (e: React.MouseEvent) => void;
  onMarqueeEnd?: (start: { x: number; y: number }, end: { x: number; y: number }) => void;
}

export function SpatialCanvas({
  children,
  canvasWidth,
  canvasHeight,
  onCanvasContextMenu,
  onMarqueeEnd,
}: SpatialCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const interactionMode = useRef<"idle" | "pan" | "marquee">("idle");
  const lastPointer = useRef({ x: 0, y: 0 });

  const viewportX = useSpatialCanvasStore((s) => s.viewportX);
  const viewportY = useSpatialCanvasStore((s) => s.viewportY);
  const zoom = useSpatialCanvasStore((s) => s.zoom);
  const setViewport = useSpatialCanvasStore((s) => s.setViewport);
  const zoomBy = useSpatialCanvasStore((s) => s.zoomBy);
  const setCanvasDimensions = useSpatialCanvasStore((s) => s.setCanvasDimensions);
  const hideContextMenu = useSpatialCanvasStore((s) => s.hideContextMenu);
  const clearSelection = useSpatialCanvasStore((s) => s.clearSelection);
  const startMarquee = useSpatialCanvasStore((s) => s.startMarquee);
  const updateMarquee = useSpatialCanvasStore((s) => s.updateMarquee);
  const endMarquee = useSpatialCanvasStore((s) => s.endMarquee);

  // Sync canvas dimensions from layout engine
  useEffect(() => {
    setCanvasDimensions(canvasWidth, canvasHeight);
  }, [canvasWidth, canvasHeight, setCanvasDimensions]);

  // ── Wheel → ALWAYS zoom (no modifier needed) ──
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Trackpad pinch sends ctrlKey with small deltaY — use higher sensitivity
      // Mouse wheel sends larger deltaY without ctrlKey — use lower sensitivity
      const sensitivity = e.ctrlKey ? 0.01 : 0.005;
      const delta = -e.deltaY * sensitivity;
      const centerX = e.clientX - rect.left;
      const centerY = e.clientY - rect.top;
      zoomBy(delta, centerX, centerY);
    },
    [zoomBy]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // Convert screen coords to canvas coords
  const screenToCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const state = useSpatialCanvasStore.getState();
      return {
        x: (clientX - rect.left - state.viewportX) / state.zoom,
        y: (clientY - rect.top - state.viewportY) / state.zoom,
      };
    },
    []
  );

  // Check if the click target is on a card (has data-spatial-card ancestor)
  const isCardTarget = useCallback((target: EventTarget | null): boolean => {
    let el = target as HTMLElement | null;
    while (el && el !== containerRef.current) {
      if (el.hasAttribute("data-spatial-card")) return true;
      el = el.parentElement;
    }
    return false;
  }, []);

  // ── Pointer handlers ──
  // Left-click-drag on empty canvas = pan
  // Shift + left-click-drag on empty canvas = marquee select
  // Middle-click-drag = pan
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Middle mouse → always pan
      if (e.button === 1) {
        e.preventDefault();
        interactionMode.current = "pan";
        lastPointer.current = { x: e.clientX, y: e.clientY };
        containerRef.current?.setPointerCapture(e.pointerId);
        return;
      }

      // Left click on empty canvas (not on a card)
      if (e.button === 0 && !isCardTarget(e.target)) {
        e.preventDefault();
        containerRef.current?.setPointerCapture(e.pointerId);

        if (e.shiftKey) {
          // Shift + drag = marquee select
          interactionMode.current = "marquee";
          const canvasPos = screenToCanvas(e.clientX, e.clientY);
          startMarquee(canvasPos);
        } else {
          // Plain drag = pan
          interactionMode.current = "pan";
          lastPointer.current = { x: e.clientX, y: e.clientY };
        }
      }
    },
    [startMarquee, screenToCanvas, isCardTarget]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (interactionMode.current === "pan") {
        const dx = e.clientX - lastPointer.current.x;
        const dy = e.clientY - lastPointer.current.y;
        lastPointer.current = { x: e.clientX, y: e.clientY };
        const state = useSpatialCanvasStore.getState();
        setViewport(state.viewportX + dx, state.viewportY + dy);
      } else if (interactionMode.current === "marquee") {
        const canvasPos = screenToCanvas(e.clientX, e.clientY);
        updateMarquee(canvasPos);
      }
    },
    [setViewport, updateMarquee, screenToCanvas]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (interactionMode.current === "pan") {
        interactionMode.current = "idle";
        containerRef.current?.releasePointerCapture(e.pointerId);
      } else if (interactionMode.current === "marquee") {
        interactionMode.current = "idle";
        const state = useSpatialCanvasStore.getState();
        if (state.marqueeStart && state.marqueeEnd && onMarqueeEnd) {
          onMarqueeEnd(state.marqueeStart, state.marqueeEnd);
        }
        endMarquee();
        containerRef.current?.releasePointerCapture(e.pointerId);
      }
    },
    [endMarquee, onMarqueeEnd]
  );

  // ── Click on empty canvas → clear selection ──
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isCardTarget(e.target)) {
        clearSelection();
        hideContextMenu();
      }
    },
    [clearSelection, hideContextMenu, isCardTarget]
  );

  return (
    <div
      ref={containerRef}
      data-spatial-canvas
      className="relative w-full h-full overflow-hidden bg-[#0A0A0A] select-none"
      style={{ touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleCanvasClick}
      onContextMenu={(e) => {
        if (onCanvasContextMenu && !isCardTarget(e.target)) {
          e.preventDefault();
          onCanvasContextMenu(e);
        }
      }}
    >
      <div
        style={{
          transform: `translate(${viewportX}px, ${viewportY}px) scale(${zoom})`,
          transformOrigin: "0 0",
          width: canvasWidth,
          height: canvasHeight,
          transition: "width 0.3s cubic-bezier(0.22, 1, 0.36, 1), height 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        className="relative"
      >
        {/* Background dot grid */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <pattern
            id="spatial-grid"
            x="0"
            y="0"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="12" cy="12" r="0.7" fill="rgba(255,255,255,0.06)" />
          </pattern>
          <rect width="100%" height="100%" fill="url(#spatial-grid)" />
        </svg>

        {/* Canvas content */}
        {children}
      </div>
    </div>
  );
}

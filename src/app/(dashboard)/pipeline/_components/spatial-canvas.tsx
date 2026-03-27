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
  const isPanning = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });

  const viewportX = useSpatialCanvasStore((s) => s.viewportX);
  const viewportY = useSpatialCanvasStore((s) => s.viewportY);
  const zoom = useSpatialCanvasStore((s) => s.zoom);
  const setViewport = useSpatialCanvasStore((s) => s.setViewport);
  const zoomBy = useSpatialCanvasStore((s) => s.zoomBy);
  const setCanvasDimensions = useSpatialCanvasStore(
    (s) => s.setCanvasDimensions
  );
  const hideContextMenu = useSpatialCanvasStore((s) => s.hideContextMenu);
  const clearSelection = useSpatialCanvasStore((s) => s.clearSelection);

  // Sync canvas dimensions from layout engine
  useEffect(() => {
    setCanvasDimensions(canvasWidth, canvasHeight);
  }, [canvasWidth, canvasHeight, setCanvasDimensions]);

  // ── Wheel → zoom ──
  // Read latest viewport from store to avoid stale closures during rapid scroll
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      if (e.ctrlKey || e.metaKey) {
        const delta = -e.deltaY * 0.01;
        const centerX = e.clientX - rect.left;
        const centerY = e.clientY - rect.top;
        zoomBy(delta, centerX, centerY);
      } else {
        const state = useSpatialCanvasStore.getState();
        const newX = state.viewportX - e.deltaX;
        const newY = state.viewportY - e.deltaY;
        setViewport(newX, newY);
      }
    },
    [zoomBy, setViewport]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const startMarquee = useSpatialCanvasStore((s) => s.startMarquee);
  const updateMarquee = useSpatialCanvasStore((s) => s.updateMarquee);
  const endMarquee = useSpatialCanvasStore((s) => s.endMarquee);
  const isMarqueeActive = useRef(false);

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

  // ── Pointer handlers: middle-click → pan, left-click on empty → marquee ──
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 1) {
        // Middle mouse → pan
        e.preventDefault();
        isPanning.current = true;
        lastPointer.current = { x: e.clientX, y: e.clientY };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } else if (
        e.button === 0 &&
        (e.target === containerRef.current ||
          (e.target as HTMLElement).tagName === "rect" ||
          (e.target as HTMLElement).tagName === "svg")
      ) {
        // Left-click on empty canvas → start marquee
        const canvasPos = screenToCanvas(e.clientX, e.clientY);
        isMarqueeActive.current = true;
        startMarquee(canvasPos);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
    },
    [startMarquee, screenToCanvas]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isPanning.current) {
        const dx = e.clientX - lastPointer.current.x;
        const dy = e.clientY - lastPointer.current.y;
        lastPointer.current = { x: e.clientX, y: e.clientY };
        const state = useSpatialCanvasStore.getState();
        setViewport(state.viewportX + dx, state.viewportY + dy);
      } else if (isMarqueeActive.current) {
        const canvasPos = screenToCanvas(e.clientX, e.clientY);
        updateMarquee(canvasPos);
      }
    },
    [setViewport, updateMarquee, screenToCanvas]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (isPanning.current) {
        isPanning.current = false;
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } else if (isMarqueeActive.current) {
        isMarqueeActive.current = false;
        const state = useSpatialCanvasStore.getState();
        if (state.marqueeStart && state.marqueeEnd && onMarqueeEnd) {
          onMarqueeEnd(state.marqueeStart, state.marqueeEnd);
        }
        endMarquee();
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      }
    },
    [endMarquee, onMarqueeEnd]
  );

  // ── Click on empty canvas → clear selection ──
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      // Only if click was directly on the canvas (not a child)
      if (e.target === e.currentTarget) {
        clearSelection();
        hideContextMenu();
      }
    },
    [clearSelection, hideContextMenu]
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-[#0A0A0A] cursor-grab active:cursor-grabbing"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleCanvasClick}
      onContextMenu={(e) => {
        // Fire canvas context menu if the click was on the container or its direct bg, not on a card
        if (onCanvasContextMenu && (e.target === containerRef.current || (e.target as HTMLElement).tagName === "rect")) {
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

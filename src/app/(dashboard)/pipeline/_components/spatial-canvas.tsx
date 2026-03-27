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
}

export function SpatialCanvas({
  children,
  canvasWidth,
  canvasHeight,
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
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Trackpad pinch-to-zoom sends ctrlKey with wheel
      if (e.ctrlKey || e.metaKey) {
        const delta = -e.deltaY * 0.01;
        const centerX = e.clientX - rect.left;
        const centerY = e.clientY - rect.top;
        zoomBy(delta, centerX, centerY);
      } else {
        // Regular scroll → pan
        const newX = viewportX - e.deltaX;
        const newY = viewportY - e.deltaY;
        setViewport(newX, newY);
      }
    },
    [viewportX, viewportY, zoomBy, setViewport]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // ── Middle-click / space+drag → pan ──
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Middle mouse button or space-held (handled via data attribute)
      if (e.button === 1) {
        e.preventDefault();
        isPanning.current = true;
        lastPointer.current = { x: e.clientX, y: e.clientY };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanning.current) return;
      const dx = e.clientX - lastPointer.current.x;
      const dy = e.clientY - lastPointer.current.y;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      setViewport(viewportX + dx, viewportY + dy);
    },
    [viewportX, viewportY, setViewport]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (isPanning.current) {
        isPanning.current = false;
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      }
    },
    []
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

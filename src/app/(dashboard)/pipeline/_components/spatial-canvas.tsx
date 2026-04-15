"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
  onMarqueeUpdate?: (start: { x: number; y: number }, end: { x: number; y: number }) => void;
  onMarqueeEnd?: (start: { x: number; y: number }, end: { x: number; y: number }) => void;
}

export function SpatialCanvas({
  children,
  canvasWidth,
  canvasHeight,
  onCanvasContextMenu,
  onMarqueeUpdate,
  onMarqueeEnd,
}: SpatialCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const interactionMode = useRef<"idle" | "pan" | "marquee">("idle");
  const didMarquee = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const [cursor, setCursor] = useState<"default" | "grabbing" | "crosshair">("default");

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
      const sensitivity = e.ctrlKey ? 0.005 : 0.002;
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
  // Middle-click-drag = pan (scroll wheel press)
  // Left-click-drag on empty canvas = marquee select
  // Left-click on card = handled by dnd-kit (drag items)
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Middle mouse → pan
      if (e.button === 1) {
        e.preventDefault();
        interactionMode.current = "pan";
        setCursor("grabbing");
        lastPointer.current = { x: e.clientX, y: e.clientY };
        containerRef.current?.setPointerCapture(e.pointerId);
        return;
      }

      // Left click on empty canvas (not on a card) → marquee select
      if (e.button === 0 && !isCardTarget(e.target)) {
        e.preventDefault();
        containerRef.current?.setPointerCapture(e.pointerId);
        interactionMode.current = "marquee";
        setCursor("crosshair");
        const canvasPos = screenToCanvas(e.clientX, e.clientY);
        startMarquee(canvasPos);
      }
    },
    [startMarquee, screenToCanvas, isCardTarget]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (interactionMode.current === "pan") {
        // Dismiss context menu on pan
        const state = useSpatialCanvasStore.getState();
        if (state.contextMenu) hideContextMenu();

        const dx = e.clientX - lastPointer.current.x;
        const dy = e.clientY - lastPointer.current.y;
        lastPointer.current = { x: e.clientX, y: e.clientY };

        // Clamp pan so content stays partially visible
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          const maxPanRight = rect.width * 0.5;
          const maxPanDown = rect.height * 0.5;
          const scaledW = state.canvasWidth * state.zoom;
          const scaledH = state.canvasHeight * state.zoom;
          const newX = Math.max(-scaledW + rect.width * 0.5, Math.min(maxPanRight, state.viewportX + dx));
          const newY = Math.max(-scaledH + rect.height * 0.5, Math.min(maxPanDown, state.viewportY + dy));
          setViewport(newX, newY);
        } else {
          setViewport(state.viewportX + dx, state.viewportY + dy);
        }
      } else if (interactionMode.current === "marquee") {
        const canvasPos = screenToCanvas(e.clientX, e.clientY);
        updateMarquee(canvasPos);
        const state = useSpatialCanvasStore.getState();
        if (state.marqueeStart && onMarqueeUpdate) {
          onMarqueeUpdate(state.marqueeStart, canvasPos);
        }
      }
    },
    [setViewport, updateMarquee, screenToCanvas, hideContextMenu, onMarqueeUpdate]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (interactionMode.current === "pan") {
        interactionMode.current = "idle";
        setCursor("default");
        containerRef.current?.releasePointerCapture(e.pointerId);
      } else if (interactionMode.current === "marquee") {
        interactionMode.current = "idle";
        setCursor("default");
        const state = useSpatialCanvasStore.getState();
        const hadMarquee =
          state.marqueeStart &&
          state.marqueeEnd &&
          (Math.abs(state.marqueeEnd.x - state.marqueeStart.x) >= 4 ||
            Math.abs(state.marqueeEnd.y - state.marqueeStart.y) >= 4);
        if (hadMarquee && onMarqueeEnd) {
          onMarqueeEnd(state.marqueeStart!, state.marqueeEnd!);
          didMarquee.current = true;
        }
        endMarquee();
        containerRef.current?.releasePointerCapture(e.pointerId);
      }
    },
    [endMarquee, onMarqueeEnd]
  );

  // ── Click on empty canvas → clear selection (skip if marquee just ended) ──
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (didMarquee.current) {
        didMarquee.current = false;
        return;
      }
      if (!isCardTarget(e.target)) {
        clearSelection();
        hideContextMenu();
      }
    },
    [clearSelection, hideContextMenu, isCardTarget]
  );

  // ── Escape key handler ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        const state = useSpatialCanvasStore.getState();
        if (state.isMarqueeActive) {
          endMarquee();
        } else if (state.contextMenu) {
          hideContextMenu();
        } else if (state.selectedCardIds.size > 0) {
          clearSelection();
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [endMarquee, hideContextMenu, clearSelection]);

  return (
    <div
      ref={containerRef}
      data-spatial-canvas
      className="relative w-full h-full overflow-hidden bg-background select-none"
      style={{ touchAction: "none", cursor }}
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
        className="relative select-none"
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

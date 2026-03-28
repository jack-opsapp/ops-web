"use client";

import { useEffect, useRef, useCallback, memo } from "react";
import { useDetailPopoverStore } from "./detail-popover-store";
import { useSpatialCanvasStore, CARD_WIDTH, CARD_HEIGHT } from "./spatial-canvas-store";

interface DetailPopoverTetherProps {
  /** Map of opportunity ID -> canvas-space position, from the layout engine */
  cardPositions: Map<string, { x: number; y: number }>;
}

/**
 * Convert a card's canvas-space position to screen-space.
 * The spatial canvas DOM structure is:
 *   [data-spatial-canvas] container
 *     -> inner div with transform: translate(viewportX, viewportY) scale(zoom)
 *
 * Screen position = containerOffset + viewportOffset + (canvasPos * zoom)
 */
function cardToScreen(
  canvasX: number,
  canvasY: number,
  viewportX: number,
  viewportY: number,
  zoom: number,
  containerRect: DOMRect
): { x: number; y: number } {
  return {
    x: containerRect.left + viewportX + canvasX * zoom,
    y: containerRect.top + viewportY + canvasY * zoom,
  };
}

export const DetailPopoverTether = memo(function DetailPopoverTether({
  cardPositions,
}: DetailPopoverTetherProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const animFrameRef = useRef<number>(0);

  const updateLines = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const popovers = useDetailPopoverStore.getState().popovers;
    const { viewportX, viewportY, zoom } = useSpatialCanvasStore.getState();

    const container = document.querySelector("[data-spatial-canvas]");
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    // Build line data
    const lines: Array<{
      x1: number; y1: number;
      x2: number; y2: number;
      color: string;
    }> = [];

    for (const [oppId, popover] of popovers.entries()) {
      if (popover.isMinimized) continue;

      const cardPos = cardPositions.get(oppId);
      if (!cardPos) continue;

      // Card right-center in screen-space
      const cardRightCenter = cardToScreen(
        cardPos.x + CARD_WIDTH,
        cardPos.y + CARD_HEIGHT / 2,
        viewportX, viewportY, zoom, containerRect
      );

      // Popover left-center in screen-space
      const popoverLeftCenter = {
        x: popover.position.x,
        y: popover.position.y + popover.size.height / 2,
      };

      let x1 = cardRightCenter.x;
      let y1 = cardRightCenter.y;
      let x2 = popoverLeftCenter.x;
      let y2 = popoverLeftCenter.y;

      // If popover is to the left of card, flip anchor points
      if (popover.position.x < cardRightCenter.x - 20) {
        const cardLeftCenter = cardToScreen(
          cardPos.x,
          cardPos.y + CARD_HEIGHT / 2,
          viewportX, viewportY, zoom, containerRect
        );
        x1 = cardLeftCenter.x;
        y1 = cardLeftCenter.y;
        x2 = popover.position.x + popover.size.width;
        y2 = popover.position.y + popover.size.height / 2;
      }

      lines.push({ x1, y1, x2, y2, color: popover.stageColor ?? "#597794" });
    }

    // Update SVG DOM directly for performance (avoid React re-renders during rAF)
    const existingLines = svg.querySelectorAll("line");
    const existingCircles = svg.querySelectorAll("circle");

    // Remove excess elements
    while (existingLines.length > lines.length) {
      existingLines[existingLines.length - 1].remove();
      existingCircles[existingCircles.length - 1]?.remove();
    }

    // Create or update elements
    for (let i = 0; i < lines.length; i++) {
      const { x1, y1, x2, y2, color } = lines[i];
      // Convert hex color to rgba for stroke/fill with opacity
      const strokeColor = `${color}59`; // ~35% opacity
      const fillColor = `${color}80`; // ~50% opacity

      let line = existingLines[i];
      if (!line) {
        line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("stroke-width", "1.5");
        line.setAttribute("stroke-dasharray", "4,3");
        svg.appendChild(line);
      }
      line.setAttribute("stroke", strokeColor);
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));

      let circle = existingCircles[i];
      if (!circle) {
        circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("r", "3");
        svg.appendChild(circle);
      }
      circle.setAttribute("fill", fillColor);
      circle.setAttribute("cx", String(x1));
      circle.setAttribute("cy", String(y1));
    }
  }, [cardPositions]);

  // rAF loop for smooth tether updates during pan/zoom/drag
  useEffect(() => {
    let running = true;

    const loop = () => {
      if (!running) return;
      updateLines();
      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [updateLines]);

  const hasPopovers = useDetailPopoverStore((s) => s.popovers.size > 0);
  if (!hasPopovers) return null;

  return (
    <svg
      ref={svgRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 1900 }}
      aria-hidden="true"
    />
  );
});

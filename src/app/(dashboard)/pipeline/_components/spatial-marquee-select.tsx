"use client";

import { useSpatialCanvasStore } from "./spatial-canvas-store";

// ── Types ──

interface SpatialMarqueeSelectProps {
  // Canvas space coordinates are managed by the store
}

// ── Component ──

export function SpatialMarqueeSelect(_props: SpatialMarqueeSelectProps) {
  const isActive = useSpatialCanvasStore((s) => s.isMarqueeActive);
  const start = useSpatialCanvasStore((s) => s.marqueeStart);
  const end = useSpatialCanvasStore((s) => s.marqueeEnd);

  if (!isActive || !start || !end) return null;

  // Calculate rect bounds (handle negative width/height from drag direction)
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  // Don't render if too small (prevents accidental clicks)
  if (width < 4 && height < 4) return null;

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: x,
        top: y,
        width,
        height,
        border: "1px solid rgba(89, 119, 148, 0.5)",
        background: "rgba(89, 119, 148, 0.08)",
        borderRadius: 2,
        zIndex: 100,
      }}
    />
  );
}

// ── Utility: check if a card rect intersects the marquee rect ──

export function isCardInMarquee(
  cardX: number,
  cardY: number,
  cardWidth: number,
  cardHeight: number,
  marqueeStart: { x: number; y: number },
  marqueeEnd: { x: number; y: number }
): boolean {
  const mx = Math.min(marqueeStart.x, marqueeEnd.x);
  const my = Math.min(marqueeStart.y, marqueeEnd.y);
  const mw = Math.abs(marqueeEnd.x - marqueeStart.x);
  const mh = Math.abs(marqueeEnd.y - marqueeStart.y);

  // AABB intersection test
  return (
    cardX < mx + mw &&
    cardX + cardWidth > mx &&
    cardY < my + mh &&
    cardY + cardHeight > my
  );
}

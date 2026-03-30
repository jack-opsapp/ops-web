"use client";

import { useRef, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils/cn";

// ── WidgetTooltip ──
// Renders via portal to document.body so it escapes overflow-hidden containers.
// x/y are element-relative coordinates. anchorRef converts them to viewport position.

interface WidgetTooltipProps {
  visible: boolean;
  /** X coordinate relative to anchorRef element */
  x: number;
  /** Y coordinate relative to anchorRef element */
  y: number;
  /** Container element ref — x/y are offsets within this element */
  anchorRef?: React.RefObject<HTMLElement | null>;
  anchor?: "above" | "below";
  children: ReactNode;
}

export function WidgetTooltip({
  visible,
  x,
  y,
  anchorRef,
  anchor = "above",
  children,
}: WidgetTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [resolvedAnchor, setResolvedAnchor] = useState(anchor);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  // Flip anchor if tooltip would overflow viewport
  useEffect(() => {
    if (!visible || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (anchor === "above" && rect.top < 8) {
      setResolvedAnchor("below");
    } else if (anchor === "below" && rect.bottom > window.innerHeight - 8) {
      setResolvedAnchor("above");
    } else {
      setResolvedAnchor(anchor);
    }
  }, [visible, x, y, anchor]);

  if (!visible || !portalTarget) return null;

  // Convert element-relative coords to viewport coords
  let viewportX = x;
  let viewportY = y;
  if (anchorRef?.current) {
    const rect = anchorRef.current.getBoundingClientRect();
    viewportX = rect.left + x;
    viewportY = rect.top + y;
  }

  const tooltip = (
    <div
      ref={ref}
      className={cn(
        "fixed z-[10000] pointer-events-none max-w-[220px]",
        "rounded-md px-[10px] py-[6px]",
        "transition-opacity duration-150",
        visible ? "opacity-100" : "opacity-0",
      )}
      style={{
        left: `${viewportX}px`,
        top: resolvedAnchor === "above" ? `${viewportY - 8}px` : `${viewportY + 8}px`,
        transform: "translateX(-50%) translateY(-100%)",
        background: "rgba(10, 10, 10, 0.90)",
        backdropFilter: "blur(20px) saturate(1.2)",
        WebkitBackdropFilter: "blur(20px) saturate(1.2)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
      }}
    >
      {children}
    </div>
  );

  return createPortal(tooltip, portalTarget);
}

// ── TooltipRow ──
// Reusable content row for tooltip label + value alignment.

export function TooltipRow({
  label,
  value,
  color,
  delta,
}: {
  label: string;
  value: string;
  color?: string;
  delta?: { value: string; direction: "up" | "down" | "neutral" };
}) {
  return (
    <div className="flex items-center justify-between gap-3 min-w-[120px]">
      <div className="flex items-center gap-1">
        {color && <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ backgroundColor: color }} />}
        <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider whitespace-nowrap">{label}</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="font-mono text-[11px] text-text-primary font-medium">{value}</span>
        {delta && (
          <span className={cn(
            "font-mono text-[9px]",
            delta.direction === "up" && "text-status-success",
            delta.direction === "down" && "text-ops-error",
            delta.direction === "neutral" && "text-text-tertiary"
          )}>
            {delta.direction === "up" ? "+" : delta.direction === "down" ? "-" : ""}{delta.value}
          </span>
        )}
      </div>
    </div>
  );
}

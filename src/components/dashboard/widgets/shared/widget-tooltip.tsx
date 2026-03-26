"use client";

import { useRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";

interface WidgetTooltipProps {
  visible: boolean;
  x: number;
  y: number;
  anchor?: "above" | "below";
  children: React.ReactNode;
}

export function WidgetTooltip({ visible, x, y, anchor = "above", children }: WidgetTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    if (!ref.current || !visible) return;
    const rect = ref.current.getBoundingClientRect();
    // Flip below if tooltip would overflow top of viewport
    setFlipped(anchor === "above" && rect.top < 8);
  }, [visible, y, anchor]);

  const resolvedAnchor = flipped ? "below" : anchor;

  return (
    <div
      ref={ref}
      className={cn(
        "absolute z-[1000] pointer-events-none max-w-[200px] px-2 py-1.5 rounded-sm",
        "bg-[rgba(10,10,10,0.85)] backdrop-blur-[12px] border border-[rgba(255,255,255,0.12)]",
        "transition-all duration-150",
        visible
          ? "opacity-100 translate-y-0"
          : resolvedAnchor === "above"
            ? "opacity-0 translate-y-1"
            : "opacity-0 -translate-y-1"
      )}
      style={{
        left: `${x}px`,
        top: resolvedAnchor === "above" ? `${y - 8}px` : undefined,
        bottom: resolvedAnchor === "below" ? `calc(100% - ${y}px + 8px)` : undefined,
        transform: `translateX(-50%)${visible ? "" : ` translateY(${resolvedAnchor === "above" ? "4px" : "-4px"})`}`,
      }}
    >
      {children}
    </div>
  );
}

/** Standard tooltip content row */
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

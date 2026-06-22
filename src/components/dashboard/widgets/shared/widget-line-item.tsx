"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { WidgetStatusBadge } from "./widget-status-badge";
import { widgetLineItemStyle } from "./widget-motion";
import { useReducedMotion } from "./use-reduced-motion";

// ── Types ────────────────────────────────────────────────────────────

interface LineItemIndicator {
  type: "bar" | "dot" | "icon" | "avatar";
  /** CSS color value (e.g. WT.accent) or Tailwind bg class */
  color: string;
  icon?: LucideIcon;
  initials?: string;
  /** Label shown when bar expands on hover (e.g., "In Progress", "90+") */
  label?: string;
}

interface WidgetLineItemProps {
  /** Left-side visual indicator */
  indicator?: LineItemIndicator;
  /** Primary text (truncated) */
  primary: string;
  /** Secondary text below primary — string renders as truncated kosugi text, ReactNode renders as-is */
  secondary?: string | ReactNode;
  /** Right-side metric — string renders as mono text, ReactNode renders as-is */
  metric?: string | ReactNode;
  /** Slot for WidgetInlineAction or custom action buttons */
  action?: ReactNode;
  /** Renders a WidgetStatusBadge */
  badge?: {
    status: string;
    entity: "invoice" | "estimate" | "opportunity" | "task" | "project";
  };
  /** Click handler — adds cursor-pointer and hover state when present */
  onClick?: (e?: React.MouseEvent) => void;
  /** Item index for staggered entrance animation */
  index?: number;
  /** Intersection-based visibility for entrance animation */
  isVisible?: boolean;
  /** Reduced motion preference (deprecated — component now reads its own) */
  reducedMotion?: boolean | null;
  className?: string;
}

// ── Component ────────────────────────────────────────────────────────

export function WidgetLineItem({
  indicator,
  primary,
  secondary,
  metric,
  action,
  badge,
  onClick,
  index,
  isVisible,
  reducedMotion: reducedMotionProp,
  className,
}: WidgetLineItemProps) {
  const hasAnimation = index !== undefined && isVisible !== undefined;
  const [isHovered, setIsHovered] = useState(false);
  const reducedMotion = useReducedMotion();

  return (
    <div
      className={cn(
        "flex items-center gap-1 px-1 py-[3px] rounded-sm transition-colors",
        onClick && "cursor-pointer hover:bg-surface-hover",
        className
      )}
      style={
        hasAnimation
          ? widgetLineItemStyle(index, isVisible, reducedMotionProp ?? reducedMotion ?? null)
          : undefined
      }
      onClick={(e: React.MouseEvent) => onClick?.(e)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Indicator */}
      {indicator && (
        <LineItemIndicatorEl
          indicator={indicator}
          isHovered={isHovered}
          reducedMotion={reducedMotion}
        />
      )}

      {/* Text content */}
      <div className="flex-1 min-w-0">
        <p className="font-mohave text-caption-sm text-text truncate">
          {primary}
        </p>
        {secondary && (
          typeof secondary === "string" ? (
            <span className="font-mono text-micro text-text-mute truncate block">
              {secondary}
            </span>
          ) : (
            <div className="truncate block">{secondary}</div>
          )
        )}
      </div>

      {/* Metric */}
      {metric &&
        (typeof metric === "string" ? (
          <span className="font-mono text-micro text-text-2 shrink-0 ml-1">
            {metric}
          </span>
        ) : (
          <div className="shrink-0 ml-1">{metric}</div>
        ))}

      {/* Status badge */}
      {badge && (
        <WidgetStatusBadge status={badge.status} entity={badge.entity} />
      )}

      {/* Action slot */}
      {action && <div className="shrink-0 ml-0.5">{action}</div>}
    </div>
  );
}

// ── Indicator Renderer ───────────────────────────────────────────────

function LineItemIndicatorEl({
  indicator,
  isHovered,
  reducedMotion,
}: {
  indicator: LineItemIndicator;
  isHovered: boolean;
  reducedMotion: boolean | null;
}) {
  const Icon = indicator.icon;
  const hasLabel = indicator.type === "bar" && !!indicator.label;
  const showLabel = hasLabel && isHovered;

  switch (indicator.type) {
    case "bar":
      return (
        <div
          className="shrink-0 flex items-center self-stretch overflow-hidden rounded-sm"
          style={{
            transition: reducedMotion
              ? "none"
              : "max-width 250ms cubic-bezier(0.22, 1, 0.36, 1), background-color 250ms cubic-bezier(0.22, 1, 0.36, 1), border-color 250ms cubic-bezier(0.22, 1, 0.36, 1)",
            maxWidth: showLabel ? "100px" : "3px",
            minWidth: "3px",
            width: showLabel ? "auto" : "3px",
            backgroundColor: showLabel
              ? `color-mix(in srgb, ${indicator.color} 15%, transparent)`
              : indicator.color,
            border: showLabel
              ? `1px solid color-mix(in srgb, ${indicator.color} 30%, transparent)`
              : `1px solid transparent`,
          }}
        >
          <span
            className="font-mono uppercase tracking-normal whitespace-nowrap px-1 py-[1px]"
            style={{
              fontSize: "9px",
              lineHeight: "1.3",
              color: indicator.color,
              opacity: showLabel ? 1 : 0,
              transition: reducedMotion ? "none" : "opacity 150ms ease 100ms",
            }}
          >
            {indicator.label}
          </span>
        </div>
      );
    case "dot":
      // Dot is deprecated — render as a thin bar for consistency
      return (
        <div
          className="w-[3px] rounded-full shrink-0 self-stretch"
          style={{ backgroundColor: indicator.color, minHeight: "16px" }}
        />
      );
    case "icon":
      return Icon ? (
        <Icon
          className="w-[14px] h-[14px] shrink-0"
          style={{ color: indicator.color }}
        />
      ) : null;
    case "avatar":
      return (
        <div className="w-[20px] h-[20px] rounded-full shrink-0 bg-fill-neutral-dim flex items-center justify-center">
          <span className="font-mono text-micro text-text-3 uppercase">
            {indicator.initials}
          </span>
        </div>
      );
  }
}

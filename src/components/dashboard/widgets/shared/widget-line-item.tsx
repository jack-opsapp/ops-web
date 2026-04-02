"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { WidgetStatusBadge } from "./widget-status-badge";
import { widgetLineItemStyle } from "./widget-motion";

// ── Types ────────────────────────────────────────────────────────────

interface LineItemIndicator {
  type: "bar" | "dot" | "icon" | "avatar";
  /** CSS color value (e.g. WT.accent) or Tailwind bg class */
  color: string;
  icon?: LucideIcon;
  initials?: string;
}

interface WidgetLineItemProps {
  /** Left-side visual indicator */
  indicator?: LineItemIndicator;
  /** Primary text (truncated) */
  primary: string;
  /** Secondary text below primary (truncated) */
  secondary?: string;
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
  onClick?: () => void;
  /** Item index for staggered entrance animation */
  index?: number;
  /** Intersection-based visibility for entrance animation */
  isVisible?: boolean;
  /** Reduced motion preference */
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
  reducedMotion,
  className,
}: WidgetLineItemProps) {
  const hasAnimation = index !== undefined && isVisible !== undefined;

  return (
    <div
      className={cn(
        "flex items-center gap-1 px-1 py-[3px] rounded-sm transition-colors",
        onClick && "cursor-pointer hover:bg-[rgba(255,255,255,0.04)]",
        className
      )}
      style={
        hasAnimation
          ? widgetLineItemStyle(index, isVisible, reducedMotion ?? null)
          : undefined
      }
      onClick={onClick}
    >
      {/* Indicator */}
      {indicator && <LineItemIndicatorEl indicator={indicator} />}

      {/* Text content */}
      <div className="flex-1 min-w-0">
        <p className="font-mohave text-caption-sm text-text-primary truncate">
          {primary}
        </p>
        {secondary && (
          <span className="font-kosugi text-micro-sm text-text-disabled truncate block">
            {secondary}
          </span>
        )}
      </div>

      {/* Metric */}
      {metric &&
        (typeof metric === "string" ? (
          <span className="font-mono text-micro-sm text-text-secondary shrink-0 ml-1">
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
}: {
  indicator: LineItemIndicator;
}) {
  const Icon = indicator.icon;

  switch (indicator.type) {
    case "bar":
      return (
        <div
          className="w-[3px] rounded-full shrink-0"
          style={{ backgroundColor: indicator.color, height: "16px" }}
        />
      );
    case "dot":
      return (
        <span
          className="w-[6px] h-[6px] rounded-full shrink-0"
          style={{ backgroundColor: indicator.color }}
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
        <div className="w-[20px] h-[20px] rounded-full shrink-0 bg-background-elevated flex items-center justify-center">
          <span className="font-kosugi text-[8px] text-text-tertiary uppercase">
            {indicator.initials}
          </span>
        </div>
      );
  }
}

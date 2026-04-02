"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useReducedMotion } from "./use-reduced-motion";
import { WIDGET_EASE_CSS, WIDGET_DURATION_FAST } from "./widget-motion";

interface WidgetEmptyStateProps {
  icon?: LucideIcon;
  message: string;
  cta?: { label: string; onClick: () => void };
  className?: string;
}

export function WidgetEmptyState({
  icon: Icon,
  message,
  cta,
  className,
}: WidgetEmptyStateProps) {
  const reducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-3 gap-1",
        className
      )}
      style={{
        opacity: mounted ? 1 : 0,
        transition: reducedMotion
          ? "none"
          : `opacity ${WIDGET_DURATION_FAST}ms ${WIDGET_EASE_CSS}`,
      }}
    >
      {Icon && <Icon className="w-2 h-2 text-text-disabled" />}
      <span className="font-mohave text-caption-sm text-text-disabled text-center">
        {message}
      </span>
      {cta && (
        <button
          onClick={cta.onClick}
          className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary hover:text-text-secondary transition-colors mt-0.5"
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}

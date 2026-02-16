import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface LiveIndicatorProps {
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

const LiveIndicator = React.forwardRef<HTMLDivElement, LiveIndicatorProps>(
  ({ label, size = "md", className }, ref) => (
    <div ref={ref} className={cn("inline-flex items-center gap-0.5", className)}>
      <span
        className={cn(
          "rounded-full bg-status-success animate-pulse-live",
          size === "sm" ? "h-[6px] w-[6px]" : "h-1 w-1"
        )}
        aria-hidden="true"
      />
      {label && (
        <span
          className={cn(
            "font-mohave uppercase tracking-wider text-status-success",
            size === "sm" ? "text-caption-sm" : "text-caption"
          )}
        >
          {label}
        </span>
      )}
      {!label && <span className="sr-only">Live</span>}
    </div>
  )
);
LiveIndicator.displayName = "LiveIndicator";

export { LiveIndicator };

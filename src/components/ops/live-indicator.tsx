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
          "rounded-full bg-[#6B8F71] animate-pulse-live",
          size === "sm" ? "h-[4px] w-[4px]" : "h-[6px] w-[6px]"
        )}
        aria-hidden="true"
      />
      {label && (
        <span
          className={cn(
            "font-mohave uppercase tracking-wider text-[#5C6070]",
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

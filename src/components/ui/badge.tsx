import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const badgeVariants = cva(
  [
    "inline-flex items-center gap-0.5",
    "px-1.5 py-[3px] rounded-sm",
    "font-mohave font-medium text-status uppercase tracking-wider",
    "whitespace-nowrap no-select",
  ],
  {
    variants: {
      variant: {
        // Project / Task statuses
        rfq: "bg-status-rfq/20 text-status-rfq border border-status-rfq/30",
        estimated: "bg-status-estimated/20 text-status-estimated border border-status-estimated/30",
        accepted: "bg-status-accepted/20 text-status-accepted border border-status-accepted/30",
        "in-progress":
          "bg-status-in-progress/20 text-status-in-progress border border-status-in-progress/30",
        completed: "bg-status-completed/20 text-status-completed border border-status-completed/30",
        closed: "bg-status-closed/20 text-status-closed border border-status-closed/30",
        archived: "bg-status-archived/20 text-status-archived border border-status-archived/30",
        booked: "bg-status-booked/20 text-status-booked border border-status-booked/30",
        cancelled: "bg-status-cancelled/20 text-status-cancelled border border-status-cancelled/30",
        // Semantic
        success: "bg-status-success/20 text-status-success border border-status-success/30",
        warning: "bg-status-warning/20 text-status-warning border border-status-warning/30",
        error: "bg-ops-error-muted text-ops-error border border-ops-error/30",
        info: "bg-ops-accent-muted text-ops-accent border border-ops-accent/30",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  pulse?: boolean;
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, pulse = false, children, ...props }, ref) => {
    const showPulse = pulse;

    return (
      <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props}>
        {showPulse && (
          <span
            className="h-[6px] w-[6px] rounded-full bg-current animate-pulse-live shrink-0"
            aria-hidden="true"
          />
        )}
        {children}
      </span>
    );
  }
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };

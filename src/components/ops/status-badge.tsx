import * as React from "react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";

// Must match API status values exactly
export type ProjectStatus =
  | "rfq"
  | "estimated"
  | "accepted"
  | "in-progress"
  | "completed"
  | "closed"
  | "archived";

export type TaskStatus =
  | "booked"
  | "in-progress"
  | "completed"
  | "cancelled";

type StatusType = ProjectStatus | TaskStatus;

const STATUS_LABELS: Record<StatusType, string> = {
  rfq: "RFQ",
  estimated: "Estimated",
  accepted: "Accepted",
  "in-progress": "In Progress",
  completed: "Completed",
  closed: "Closed",
  archived: "Archived",
  booked: "Booked",
  cancelled: "Cancelled",
};

const STATUS_VARIANT_MAP: Record<StatusType, BadgeProps["variant"]> = {
  rfq: "rfq",
  estimated: "estimated",
  accepted: "accepted",
  "in-progress": "in-progress",
  completed: "completed",
  closed: "closed",
  archived: "archived",
  booked: "booked",
  cancelled: "cancelled",
};

export interface StatusBadgeProps extends Omit<BadgeProps, "variant"> {
  status: StatusType;
  label?: string;
}

const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ status, label, className, ...props }, ref) => {
    const variant = STATUS_VARIANT_MAP[status] ?? "info";
    const displayLabel = label ?? STATUS_LABELS[status] ?? status;

    return (
      <Badge ref={ref} variant={variant} className={cn(className)} {...props}>
        {displayLabel}
      </Badge>
    );
  }
);
StatusBadge.displayName = "StatusBadge";

export { StatusBadge };

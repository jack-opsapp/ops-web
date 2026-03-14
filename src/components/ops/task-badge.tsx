import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface TaskBadgeProps {
  name: string;
  color: string;
  size?: "sm" | "md" | "lg";
  faded?: boolean;
  className?: string;
}

const SIZE_STYLES = {
  sm: {
    fontSize: "10px",
    padding: "3px 5px",
    borderRadius: "2px",
    letterSpacing: "0.2px",
  },
  md: {
    fontSize: "11px",
    padding: "5px 8px",
    borderRadius: "3px",
    letterSpacing: "0.3px",
  },
  lg: {
    fontSize: "12px",
    padding: "5px 10px",
    borderRadius: "4px",
    letterSpacing: "0.5px",
  },
} as const;

const TaskBadge = React.forwardRef<HTMLSpanElement, TaskBadgeProps>(
  ({ name, color, size = "md", faded = false, className }, ref) => {
    const sizeStyle = SIZE_STYLES[size];

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center font-kosugi uppercase whitespace-nowrap",
          faded && "opacity-40",
          className
        )}
        style={{
          fontSize: sizeStyle.fontSize,
          padding: sizeStyle.padding,
          borderRadius: sizeStyle.borderRadius,
          letterSpacing: sizeStyle.letterSpacing,
          backgroundColor: `${color}1F`,
          border: `1px solid ${color}`,
          color,
        }}
      >
        {name}
      </span>
    );
  }
);
TaskBadge.displayName = "TaskBadge";

function UnscheduledBadge({ size = "sm" }: { size?: TaskBadgeProps["size"] }) {
  return <TaskBadge name="Unscheduled" color="#C4A868" size={size} />;
}
UnscheduledBadge.displayName = "UnscheduledBadge";

function UnassignedBadge({ size = "sm" }: { size?: TaskBadgeProps["size"] }) {
  return <TaskBadge name="Unassigned" color="#B58289" size={size} />;
}
UnassignedBadge.displayName = "UnassignedBadge";

export { TaskBadge, UnscheduledBadge, UnassignedBadge };

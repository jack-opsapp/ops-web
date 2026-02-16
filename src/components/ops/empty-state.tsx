import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { Button, type ButtonProps } from "@/components/ui/button";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: ButtonProps["variant"];
  };
  className?: string;
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ icon, title, description, action, className }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center justify-center gap-2 py-6 px-3",
        "text-center",
        className
      )}
    >
      {icon && (
        <div className="text-text-disabled" aria-hidden="true">
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        <h3 className="font-mohave text-body-lg text-text-secondary">{title}</h3>
        {description && (
          <p className="font-mohave text-body-sm text-text-tertiary max-w-[360px]">
            {description}
          </p>
        )}
      </div>
      {action && (
        <Button
          variant={action.variant ?? "default"}
          size="sm"
          onClick={action.onClick}
          className="mt-1"
        >
          {action.label}
        </Button>
      )}
    </div>
  )
);
EmptyState.displayName = "EmptyState";

export { EmptyState };

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface InfoRowProps {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  action?: React.ReactNode;
  mono?: boolean;
  className?: string;
}

const InfoRow = React.forwardRef<HTMLDivElement, InfoRowProps>(
  ({ icon, label, value, action, mono = false, className }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex items-center gap-1.5 py-1.5",
        "border-b border-border-subtle last:border-0",
        className
      )}
    >
      {icon && (
        <div className="shrink-0 text-text-tertiary" aria-hidden="true">
          {icon}
        </div>
      )}
      <span className="shrink-0 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest min-w-[100px]">
        {label}
      </span>
      <span
        className={cn(
          "flex-1 text-body-sm text-text-primary truncate",
          mono ? "font-mono text-data-sm" : "font-mohave"
        )}
      >
        {value}
      </span>
      {action && <div className="shrink-0 ml-auto">{action}</div>}
    </div>
  )
);
InfoRow.displayName = "InfoRow";

export { InfoRow };

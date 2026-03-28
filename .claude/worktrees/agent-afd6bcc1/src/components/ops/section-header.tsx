import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { Badge } from "@/components/ui/badge";

export interface SectionHeaderProps {
  title: string;
  count?: number;
  action?: React.ReactNode;
  className?: string;
}

const SectionHeader = React.forwardRef<HTMLDivElement, SectionHeaderProps>(
  ({ title, count, action, className }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center justify-between gap-1 py-1", className)}
    >
      <div className="flex items-center gap-1">
        <h2 className="font-kosugi text-caption-bold text-text-secondary uppercase tracking-widest">
          {title}
        </h2>
        {count !== undefined && (
          <Badge variant="info" className="text-[10px] px-[6px] py-[1px]">
            {count}
          </Badge>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
);
SectionHeader.displayName = "SectionHeader";

export { SectionHeader };

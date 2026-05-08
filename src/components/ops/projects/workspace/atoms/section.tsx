import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { Mono } from "./mono";
import { Hairline } from "./hairline";

// `Section` — `// TITLE` slash-prefix header + dashed hairline.
// Standardises the workspace's section-title voice — the slashes are
// dimmed (text-mute) so the title body itself is the focal point.
//
// Optional `rightSlot` for inline actions (e.g. an EDIT chip, expand
// chevron). When provided, the title row becomes a flex row with the
// title on the left and the slot on the right.

export interface SectionProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: string;
  rightSlot?: React.ReactNode;
  children?: React.ReactNode;
}

export const Section = React.forwardRef<HTMLElement, SectionProps>(
  ({ title, rightSlot, children, className, ...props }, ref) => (
    <section ref={ref} className={cn("flex flex-col gap-1.5", className)} {...props}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1">
          <Mono color="mute" size={11}>{"//"}</Mono>
          <Mono color="text-3" size={11}>
            {title}
          </Mono>
        </span>
        {rightSlot}
      </div>
      <Hairline variant="dashed" />
      {children}
    </section>
  ),
);
Section.displayName = "Section";

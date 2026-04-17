import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface OpsMarkProps extends React.SVGProps<SVGSVGElement> {
  /** Accessible label. Defaults to "OPS". Pass "" to mark decorative. */
  title?: string;
  /** Tailwind or style-based sizing. Component defaults to 1em (inherits font-size). */
  className?: string;
}

/**
 * OPS brand mark (two interlocking chamfered brackets).
 * Uses `fill="currentColor"` so color inherits from CSS color.
 * Natural aspect ratio ~0.59:1 (portrait). Size with width/height or className.
 */
export const OpsMark = React.forwardRef<SVGSVGElement, OpsMarkProps>(
  ({ title = "OPS", className, ...props }, ref) => {
    const labelId = React.useId();
    const isDecorative = title === "";
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="775 477 850 1440"
        fill="currentColor"
        role={isDecorative ? undefined : "img"}
        aria-label={isDecorative ? undefined : title}
        aria-labelledby={isDecorative ? undefined : labelId}
        aria-hidden={isDecorative ? true : undefined}
        focusable="false"
        className={cn("inline-block", className)}
        {...props}
      >
        {!isDecorative && <title id={labelId}>{title}</title>}
        <path d="M1624.48,1228.51v-563.59s-375.6-187.86-375.6-187.86h0l-281.73,140.87.16.08,469.34,234.72v469.62s.07.04.07.04l187.78-93.89Z" />
        <path d="M1432.95,1775.53l.03-.02v-.08l-469.49-234.8-.13-469.56-187.37,93.85-.15.08-.33,563.39.15.08,375.54,187.82.1.06,281.64-140.81Z" />
      </svg>
    );
  }
);
OpsMark.displayName = "OpsMark";

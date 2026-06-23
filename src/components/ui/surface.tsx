import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const surfaceVariants = cva("relative transition-all duration-150", {
  variants: {
    variant: {
      default: "glass-surface",
      dense: "glass-dense",
      inset: [
        "rounded",
        "bg-[rgba(255,255,255,0.04)]",
        "border border-[rgba(255,255,255,0.10)]",
      ],
      ghost: "bg-transparent",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export interface SurfaceProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof surfaceVariants> {}

const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(surfaceVariants({ variant }), className)}
      {...props}
    />
  )
);
Surface.displayName = "Surface";

export { Surface, surfaceVariants };

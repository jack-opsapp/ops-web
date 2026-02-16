import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1",
    "font-mohave text-button uppercase whitespace-nowrap",
    "rounded-[5px] transition-all duration-150",
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[rgba(255,255,255,0.2)]",
    "disabled:pointer-events-none disabled:opacity-40",
    "no-select cursor-pointer",
    "active:scale-[0.98]",
  ],
  {
    variants: {
      variant: {
        default: [
          "bg-[rgba(255,255,255,0.07)] text-text-primary border border-[rgba(255,255,255,0.2)]",
          "hover:bg-[rgba(255,255,255,0.12)]",
        ],
        primary: [
          "bg-ops-accent text-white border border-ops-accent",
          "hover:bg-ops-accent-hover",
        ],
        accent: [
          "bg-ops-amber text-text-inverse border border-ops-amber",
          "hover:bg-ops-amber-hover",
        ],
        secondary: [
          "bg-transparent text-text-secondary border border-[rgba(255,255,255,0.4)]",
          "hover:bg-[rgba(255,255,255,0.05)] hover:text-text-primary",
        ],
        destructive: [
          "bg-ops-error text-white border border-ops-error",
          "hover:bg-ops-error-hover",
        ],
        ghost: [
          "bg-transparent text-text-secondary",
          "hover:bg-[rgba(255,255,255,0.05)] hover:text-text-primary",
        ],
        link: [
          "bg-transparent text-ops-accent underline-offset-4",
          "hover:underline hover:text-ops-accent-hover",
          "p-0 h-auto active:scale-100",
        ],
      },
      size: {
        default: "h-7 px-3 py-1.5",
        sm: "h-[40px] px-2 py-1 text-button-sm",
        lg: "h-8 px-4 py-2 text-body-lg",
        icon: "h-7 w-7 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
            <span className="sr-only">Loading</span>
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };

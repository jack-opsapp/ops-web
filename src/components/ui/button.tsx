import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1",
    // DESIGN.md §9: button label = Cake Mono 300, 14px, uppercase — at every
    // size. Heights vary; the label voice does not.
    "font-cakemono font-light text-[14px] uppercase whitespace-nowrap",
    "rounded-[5px] transition-all duration-150",
    "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
    "disabled:pointer-events-none disabled:opacity-40",
    "no-select cursor-pointer",
    "active:scale-[0.98]",
  ],
  {
    variants: {
      variant: {
        default: [
          "bg-[rgba(255,255,255,0.07)] text-text-2 border border-[rgba(255,255,255,0.10)]",
          "hover:bg-[rgba(255,255,255,0.12)] hover:text-text",
        ],
        primary: [
          "bg-ops-accent text-black border border-ops-accent",
          "hover:bg-ops-accent-hover",
        ],
        accent: [
          "bg-ops-amber text-text-inverse border border-ops-amber",
          "hover:bg-ops-amber-hover",
        ],
        secondary: [
          "bg-transparent text-text-2 border border-[rgba(255,255,255,0.10)]",
          "hover:bg-[rgba(255,255,255,0.05)] hover:border-[rgba(255,255,255,0.18)] hover:text-text",
        ],
        destructive: [
          "bg-[rgba(181,130,137,0.12)] text-[#B58289] border border-[rgba(181,130,137,0.28)]",
          "hover:bg-[rgba(181,130,137,0.18)]",
        ],
        ghost: [
          "bg-transparent text-text-2",
          "hover:bg-[rgba(255,255,255,0.05)] hover:text-text",
        ],
        link: [
          "bg-transparent text-text-2 underline-offset-4",
          "hover:underline hover:text-text",
          "p-0 h-auto active:scale-100",
        ],
      },
      size: {
        // DESIGN.md spec: buttons are min-height 36px / padding 9px 16px / radius 5px.
        // `default` is the spec value (h-9 = 36px, px-4 = 16px). `sm`/`lg` are
        // unspecified-but-coherent derivations on a 32/36/40 ladder — never the
        // 44px touch-target value (OPS-Web is mouse-driven; there is no touch here).
        default: "h-9 px-4",
        sm: "h-8 px-3",
        lg: "h-10 px-5",
        icon: "h-9 w-9 p-0",
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
            <Loader2 className="h-[18px] w-[18px] animate-spin motion-reduce:animate-none" aria-hidden="true" />
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

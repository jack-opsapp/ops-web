import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const cardVariants = cva("rounded-lg border p-2 transition-all duration-150", {
  variants: {
    variant: {
      default: "bg-background-card border-border",
      dark: "border-border bg-[rgba(13,13,13,0.8)]",
      elevated: "bg-background-card border-border-medium shadow-elevated",
      interactive: [
        "bg-background-card border-border cursor-pointer",
        "hover:border-ops-accent hover:shadow-glow-accent",
        "active:scale-[0.99]",
      ],
      accent: "bg-background-card border-border border-l-4 border-l-ops-accent",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  withGrid?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, withGrid = false, style, ...props }, ref) => {
    const gridStyle: React.CSSProperties | undefined = withGrid
      ? {
          ...style,
          backgroundImage: [
            "linear-gradient(rgba(65, 115, 148, 0.03) 1px, transparent 1px)",
            "linear-gradient(90deg, rgba(65, 115, 148, 0.03) 1px, transparent 1px)",
          ].join(", "),
          backgroundSize: "24px 24px",
        }
      : style;

    return (
      <div
        ref={ref}
        className={cn(cardVariants({ variant }), className)}
        style={gridStyle}
        {...props}
      />
    );
  }
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-0.5 pb-2", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("font-mohave text-card-title text-text-primary", className)}
      {...props}
    />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("font-mohave text-card-body text-text-secondary", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("py-0.5", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center pt-2", className)} {...props} />
  )
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, cardVariants };

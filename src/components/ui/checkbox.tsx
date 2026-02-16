import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer h-[18px] w-[18px] shrink-0",
      "rounded-sm border border-border-medium",
      "bg-background-input",
      "transition-all duration-150",
      "hover:border-ops-accent hover:shadow-glow-accent",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
      "disabled:cursor-not-allowed disabled:opacity-40",
      "data-[state=checked]:bg-ops-accent data-[state=checked]:border-ops-accent data-[state=checked]:text-white",
      "cursor-pointer",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn("flex items-center justify-center text-current")}>
      <Check className="h-[14px] w-[14px]" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };

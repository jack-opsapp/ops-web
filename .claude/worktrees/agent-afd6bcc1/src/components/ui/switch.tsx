import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils/cn";

const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    className={cn(
      "peer inline-flex h-[24px] w-[44px] shrink-0 cursor-pointer items-center",
      "rounded-full border-2 border-transparent",
      "transition-colors duration-150",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-40",
      "data-[state=checked]:bg-ops-accent data-[state=checked]:shadow-glow-accent",
      "data-[state=unchecked]:bg-background-elevated",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-[20px] w-[20px] rounded-full",
        "bg-text-primary shadow-card",
        "transition-transform duration-150",
        "data-[state=checked]:translate-x-[20px] data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };

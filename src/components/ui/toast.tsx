"use client";

import { Toaster as Sonner, toast } from "sonner";
import { cn } from "@/lib/utils/cn";

type ToasterProps = React.ComponentProps<typeof Sonner>;

function Toaster({ className, ...props }: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      className={cn("toaster group", className)}
      toastOptions={{
        classNames: {
          toast: cn(
            "group toast",
            "bg-background-panel border border-border rounded shadow-floating",
            "font-mohave text-body-sm text-text-primary",
            "p-2 gap-1"
          ),
          title: "text-text-primary font-mohave text-body-sm font-medium",
          description: "text-text-secondary font-mohave text-caption-sm",
          actionButton: cn(
            "bg-ops-accent text-white font-mohave text-caption-sm",
            "rounded px-1.5 py-[4px]",
            "hover:bg-ops-accent-hover"
          ),
          cancelButton: cn(
            "bg-transparent text-text-secondary font-mohave text-caption-sm",
            "rounded px-1.5 py-[4px]",
            "hover:text-text-primary hover:bg-background-elevated"
          ),
          closeButton: "text-text-tertiary hover:text-text-primary",
          success: "border-status-success/30 shadow-[0_0_12px_rgba(74,222,128,0.15)]",
          error: "border-ops-error/30 shadow-glow-error",
          info: "border-ops-accent/30 shadow-glow-accent",
          warning: "border-ops-amber/30 shadow-glow-amber",
        },
      }}
      {...props}
    />
  );
}

export { Toaster, toast };

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
            "glass-dense",
            "font-mohave text-body-sm text-text",
            "p-2 gap-1"
          ),
          title: "text-text font-mohave text-body-sm font-medium",
          description: "text-text-2 font-mohave text-caption-sm",
          actionButton: cn(
            "bg-ops-accent text-white font-mohave text-caption-sm",
            "rounded px-1.5 py-[4px]",
            "hover:bg-ops-accent-hover"
          ),
          cancelButton: cn(
            "bg-transparent text-text-2 font-mohave text-caption-sm",
            "rounded px-1.5 py-[4px]",
            "hover:text-text hover:bg-fill-neutral-dim"
          ),
          closeButton: "text-text-3 hover:text-text",
          success: "border-status-success/30",
          error: "border-ops-error/30",
          info: "border-ops-accent/30",
          warning: "border-ops-amber/30",
        },
      }}
      {...props}
    />
  );
}

export { Toaster, toast };

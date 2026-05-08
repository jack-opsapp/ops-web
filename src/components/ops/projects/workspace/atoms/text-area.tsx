import * as React from "react";
import { cn } from "@/lib/utils/cn";

// `TextArea` — workspace-specific multi-line input. Same philosophy as
// `TextInput`: pure presentation, Field-aware via `aria-invalid`. Min-height
// 80px (suitable for short notes); callers pass `className="min-h-[Npx]"`
// or set `rows` to override.

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        // base
        "w-full min-h-[80px] px-2 py-1.5 resize-y",
        "font-mohave text-[14px] leading-[1.5] text-text",
        "bg-[rgba(255,255,255,0.04)]",
        "rounded-[5px] border border-glass-border",
        // motion
        "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
        // states
        "placeholder:text-text-mute",
        "hover:border-glass-border-medium",
        "focus:outline-none focus:border-glass-border-strong",
        "disabled:cursor-not-allowed disabled:opacity-40",
        "aria-[invalid=true]:border-[var(--rose-line)]",
        "aria-[invalid=true]:focus:border-[var(--rose)]",
        className,
      )}
      {...props}
    />
  ),
);
TextArea.displayName = "TextArea";

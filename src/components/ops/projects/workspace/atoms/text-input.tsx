import * as React from "react";
import { cn } from "@/lib/utils/cn";

// `TextInput` — workspace-specific text input.
//
// Why not reuse `<Input>` from `src/components/ui/input.tsx`?
// The existing Input bundles its own label, error, and helper text and
// renders at min-h-56px — too tall for the workspace and double-labels
// when wrapped in `<Field>`. This atom is pure presentation: the bare
// styled `<input>`. Field owns label + hint + error + aria wiring.

export type TextInputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type ?? "text"}
      className={cn(
        // base — 36px is the app-wide input floor (DESIGN.md § Inputs); the
        // repo spacing scale is doubled, so h-8 rendered a 64px slab.
        "w-full min-h-[36px] px-2",
        "font-mohave text-[14px] leading-[1.4] text-text",
        "bg-[var(--surface-input)]",
        "rounded border border-glass-border",
        // motion
        "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
        // states
        "placeholder:text-text-mute",
        "hover:border-glass-border-medium",
        "focus:outline-none focus:border-glass-border-strong",
        "disabled:cursor-not-allowed disabled:opacity-40",
        // error state via aria-invalid (Field sets this when error is present)
        "aria-[invalid=true]:border-[var(--rose-line)]",
        "aria-[invalid=true]:focus:border-[var(--rose)]",
        className,
      )}
      {...props}
    />
  ),
);
TextInput.displayName = "TextInput";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

// `Btn` — workspace-scoped button.
//
// Why not reuse `<Button>` from `src/components/ui/button.tsx`?
// The brand spec v2 mandates the primary CTA is **outlined at rest with
// `text-ops-accent border-ops-accent`, fills to `bg-ops-accent text-black`
// on hover**. The existing `<Button>` keeps `bg-ops-accent` filled at rest
// (and is depended on across dozens of dashboard surfaces). Building a
// workspace-scoped `Btn` lets the workspace honour the spec without
// disturbing existing consumers. Documented in the atom mapping doc.
//
// Variants:
//   primary      — outlined accent, fills on hover (the default CTA voice)
//   secondary    — neutral hairline border + text-2 (cancel / dismiss)
//   ghost        — no border, transparent bg, text-2 (footer chrome)
//   destructive  — rose tone with rose-line border (delete / archive)

export type BtnVariant = "primary" | "secondary" | "ghost" | "destructive";
export type BtnSize = "sm" | "md" | "lg";

export interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
}

const VARIANT_CLASS: Record<BtnVariant, string> = {
  primary: cn(
    "bg-transparent text-ops-accent border border-ops-accent",
    "hover:bg-ops-accent hover:text-black",
  ),
  secondary: cn(
    "bg-transparent text-text-2 border border-glass-border",
    "hover:bg-[var(--surface-input)] hover:text-text",
  ),
  ghost: cn(
    "bg-transparent text-text-2 border border-transparent",
    "hover:bg-[var(--surface-input)] hover:text-text",
  ),
  destructive: cn(
    "bg-transparent text-[var(--rose)] border border-[var(--rose-line)]",
    "hover:bg-[var(--rose-soft)]",
  ),
};

const SIZE_CLASS: Record<BtnSize, string> = {
  sm: "h-7 px-2 text-[12px]",
  md: "h-8 px-3 text-[14px]",
  lg: "h-10 px-4 text-[16px]",
};

export const Btn = React.forwardRef<HTMLButtonElement, BtnProps>(
  ({ variant = "primary", size = "md", className, type, ...props }, ref) => (
    <button
      ref={ref}
      // Avoid implicit `type="submit"` inside forms — workspace `Btn` is a
      // generic action; callers can opt in with `type="submit"` explicitly.
      type={type ?? "button"}
      className={cn(
        "inline-flex items-center justify-center gap-1",
        "font-mohave uppercase tracking-[0.06em] whitespace-nowrap",
        "rounded transition-all duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        "disabled:pointer-events-none disabled:opacity-40",
        "active:scale-[0.98] cursor-pointer select-none",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    />
  ),
);
Btn.displayName = "Btn";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

// `IconBtn` — small square icon-only button. Smaller and lighter-chrome
// than the existing `<Button size="icon">` (h-7 w-7 with full Button chrome).
// Three sizes: xs=24, sm=28 (default), md=32. Two variants: default
// (text-3 → text-2 on hover) and destructive (rose tint).
//
// Always require `aria-label` because the icon child is presentational.

export type IconBtnVariant = "default" | "destructive";
export type IconBtnSize = "xs" | "sm" | "md";

export interface IconBtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconBtnVariant;
  size?: IconBtnSize;
  /** Required for AT — the icon child is presentational. */
  "aria-label": string;
}

const VARIANT_CLASS: Record<IconBtnVariant, string> = {
  default: cn(
    "bg-transparent text-text-3 border border-transparent",
    "hover:bg-[var(--surface-input)] hover:text-text-2",
  ),
  destructive: cn(
    "bg-transparent text-[var(--rose)] border border-transparent",
    "hover:bg-[var(--rose-soft)]",
  ),
};

const SIZE_CLASS: Record<IconBtnSize, string> = {
  xs: "h-6 w-6 [&_svg]:w-3.5 [&_svg]:h-3.5",
  sm: "h-7 w-7 [&_svg]:w-4 [&_svg]:h-4",
  md: "h-8 w-8 [&_svg]:w-[18px] [&_svg]:h-[18px]",
};

export const IconBtn = React.forwardRef<HTMLButtonElement, IconBtnProps>(
  ({ variant = "default", size = "sm", className, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(
        "inline-flex items-center justify-center shrink-0",
        "rounded-[5px] transition-all duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        "disabled:pointer-events-none disabled:opacity-40",
        "active:scale-[0.95] cursor-pointer",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    />
  ),
);
IconBtn.displayName = "IconBtn";

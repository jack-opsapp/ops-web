"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type StateTagTone =
  | "accent"
  | "rose"
  | "olive"
  | "tan"
  | "lavender"
  | "neutral";

export type StateTagVariant = "bare" | "outline" | "solid";

export interface StateTagProps {
  tone: StateTagTone;
  variant?: StateTagVariant;
  /** First content slot — typically the lead label (e.g. "YOURS", "+38D"). */
  prefix?: string;
  /** Second content slot — typically the trailing label after a bullet (e.g. "WAITING", "18H"). */
  value?: string;
  /** Wraps the whole content in `[...]` brackets. Used for inline metadata pills. */
  bracketed?: boolean;
  /**
   * When set, an `×` button is revealed inline on hover/focus of the tag's
   * parent group. The button receives `currentColor` so it matches the tag
   * tone (steel-blue on YOURS, etc.). Pointer events are stopped so the
   * tag's parent row click handler doesn't fire as a side-effect.
   *
   * The parent element must carry the `group` Tailwind class (or its own
   * named group via `group/dismiss`) so the reveal works — without it the
   * `×` stays hidden.
   *
   * `dismissLabel` is the a11y label and `title` for the button; default is
   * "Dismiss" so callers can pick a more specific verb ("Mark no reply
   * needed", "Clear AWAITING_REPLY").
   */
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
}

const TONE_TEXT: Record<StateTagTone, string> = {
  accent: "text-ops-accent",
  rose: "text-rose",
  olive: "text-olive",
  tan: "text-tan",
  lavender: "text-agent-hi",
  neutral: "text-text-2",
};

const TONE_BG: Record<StateTagTone, string> = {
  accent: "bg-ops-accent/[0.10]",
  rose: "bg-rose/[0.10]",
  olive: "bg-olive/[0.10]",
  tan: "bg-tan/[0.10]",
  lavender: "bg-agent/[0.10]",
  neutral: "bg-surface-input",
};

const TONE_BORDER: Record<StateTagTone, string> = {
  accent: "border-ops-accent/[0.30]",
  rose: "border-rose/[0.30]",
  olive: "border-olive/[0.30]",
  tan: "border-tan/[0.30]",
  lavender: "border-agent-border-hi",
  neutral: "border-line",
};

export function StateTag({
  tone,
  variant = "bare",
  prefix,
  value,
  bracketed,
  onDismiss,
  dismissLabel = "Dismiss",
  className,
}: StateTagProps) {
  const inner =
    prefix && value
      ? `${prefix} · ${value}`
      : prefix ?? value ?? "";
  const display = bracketed ? `[${inner}]` : inner;

  const variantClasses =
    variant === "solid"
      ? cn(TONE_TEXT[tone], TONE_BG[tone], "border", TONE_BORDER[tone], "px-[5px] py-[1px] rounded-chip")
      : variant === "outline"
        ? cn(TONE_TEXT[tone], "border", TONE_BORDER[tone], "px-[5px] py-[1px] rounded-chip")
        : TONE_TEXT[tone];

  if (!onDismiss) {
    return (
      <span
        className={cn(
          "font-mono uppercase tracking-[0.10em] text-[11px]",
          variantClasses,
          className,
        )}
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {display}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono uppercase tracking-[0.10em] text-[11px]",
        variantClasses,
        className,
      )}
      style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
    >
      <span>{display}</span>
      <button
        type="button"
        onClick={(e) => {
          // Stop the parent row's click handler from firing — dismissing the
          // chip must not also navigate into the thread.
          e.preventDefault();
          e.stopPropagation();
          onDismiss();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label={dismissLabel}
        title={dismissLabel}
        className={cn(
          // Hidden by default, revealed when the parent .group is hovered or
          // when the button itself is keyboard-focused.
          "opacity-0 transition-opacity duration-150",
          "group-hover:opacity-100 focus-visible:opacity-100 focus:opacity-100",
          // Inherits currentColor → tag tone (accent on YOURS, rose on
          // OVERDUE, etc.). Hover bumps to text to flag the action.
          "pointer-events-auto inline-flex h-3.5 w-3.5 items-center justify-center rounded-[2px]",
          "hover:bg-[currentColor]/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current",
        )}
      >
        <X aria-hidden className="h-3 w-3" strokeWidth={1.75} />
      </button>
    </span>
  );
}

import { cn } from "@/lib/utils/cn";

export type StateTagTone =
  | "accent"
  | "rose"
  | "olive"
  | "tan"
  | "lavender"
  | "neutral";

export type StateTagVariant = "bare" | "outline" | "solid";

interface StateTagProps {
  tone: StateTagTone;
  variant?: StateTagVariant;
  /** First content slot — typically the lead label (e.g. "YOURS", "+38D"). */
  prefix?: string;
  /** Second content slot — typically the trailing label after a bullet (e.g. "WAITING", "18H"). */
  value?: string;
  /** Wraps the whole content in `[...]` brackets. Used for inline metadata pills. */
  bracketed?: boolean;
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
  neutral: "bg-[rgba(255,255,255,0.04)]",
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

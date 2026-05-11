// src/components/ops/inbox/voice/slash-label.tsx
import { cn } from "@/lib/utils/cn";

interface SlashLabelProps {
  /** The label content (e.g. "// INBOX", "// YOUR MOVE :: 2 OVERDUE", "// SUMMARY"). */
  label: string;
  /**
   * Tone color — defaults to "text-2".
   *
   * Mapping:
   *   text-2  → text-text-2   (primary label)
   *   text-3  → text-text-3   (secondary label)
   *   text-mute → text-text-mute (decorative, separators)
   *   agent   → text-agent-hi  (AI / lavender)
   *   accent  → text-ops-accent (steel-blue — YOURS state)
   *   olive   → text-olive     (healthy / positive state)
   */
  tone?: "text-2" | "text-3" | "text-mute" | "agent" | "accent" | "olive";
  /**
   * Size:
   *   sm (11px) — panel titles, group dividers, band headers (default)
   *   md (13px) — modal titles, larger emphasis contexts
   */
  size?: "sm" | "md";
  className?: string;
}

const TONE_CLASS: Record<NonNullable<SlashLabelProps["tone"]>, string> = {
  "text-2": "text-text-2",
  "text-3": "text-text-3",
  "text-mute": "text-text-mute",
  agent: "text-agent-hi",
  accent: "text-ops-accent",
  olive: "text-olive",
};

/**
 * `<SlashLabel>` — Cake Mono Light uppercase tactical label.
 *
 * Used for every `// HEADER`, panel title, group divider, and band label
 * across the inbox. § 3 brand spec: Cake Mono Light, uppercase, tracking-0.18em, 11px.
 */
export function SlashLabel({
  label,
  tone = "text-2",
  size = "sm",
  className,
}: SlashLabelProps) {
  return (
    <span
      className={cn(
        "font-cakemono font-light uppercase leading-none tracking-[0.18em]",
        size === "sm" ? "text-[11px]" : "text-[13px]",
        TONE_CLASS[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}

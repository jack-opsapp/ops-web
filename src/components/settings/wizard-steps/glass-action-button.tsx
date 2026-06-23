"use client";

import { useState, type ReactNode } from "react";
import { KeyHint } from "@/components/ui/key-hint";

interface GlassActionButtonProps {
  /** Key binding label shown in brackets (e.g. "1", "2", "3") */
  keyLabel: string;
  /** Main button copy */
  label: ReactNode;
  /** True when keyboard navigation has this button selected */
  highlighted: boolean;
  onClick: () => void;
  /** Tailwind layout classes (flex-1, flex-shrink-0, px-*, etc.) */
  className?: string;
}

/**
 * Floating glass action button used across the import wizard's carousel
 * steps (triage, consolidate). Each instance carries its own dense-glass
 * backdrop so the chip sits on top of scrolling content without bleeding
 * text through. Hover and keyboard-selection states share the same
 * emphasized look; resting state is a quiet glass pill.
 *
 * These chips are a row of equal-weight decision actions (won / lost /
 * active / discard, save / merge / discard) — no single one is THE primary
 * CTA, so emphasis is carried by the neutral border + text ladder, never by
 * the steel-blue accent. Depth is borders-only: the dense-glass `::before`
 * supplies the 1px inset top-edge highlight; there is no outer glow.
 */
export function GlassActionButton({
  keyLabel,
  label,
  highlighted,
  onClick,
  className = "",
}: GlassActionButtonProps) {
  const [hovered, setHovered] = useState(false);
  const active = hovered || highlighted;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`glass-dense py-1.5 px-3 font-mono text-micro tracking-[0.1em] uppercase inline-flex items-center justify-center gap-2 transition-[border-color,color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        active
          ? "border-border-strong text-text"
          : "border-border text-text-3"
      } ${className}`}
      style={{
        borderRadius: 4,
        transform: active ? "translateY(-0.5px)" : "translateY(0)",
      }}
    >
      <KeyHint keys={keyLabel} variant="inline" />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

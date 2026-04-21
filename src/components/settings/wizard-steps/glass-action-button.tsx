"use client";

import { useState, type ReactNode } from "react";
import { KeyHint } from "@/components/ui/key-hint";

interface GlassActionButtonProps {
  /** Key binding label shown in brackets (e.g. "1", "2", "3") */
  keyLabel: string;
  /** Main button copy */
  label: ReactNode;
  /** Accent color driving border, text, and highlight tint (e.g. "#6F94B0") */
  accentColor: string;
  /** True when keyboard navigation has this button selected */
  highlighted: boolean;
  onClick: () => void;
  /** Tailwind layout classes (flex-1, flex-shrink-0, px-*, etc.) */
  className?: string;
}

/**
 * Floating glass action button used across the import wizard's carousel
 * steps (triage, consolidate). Each instance renders its own backdrop blur
 * so the chip sits on top of scrolling content without bleeding text
 * through. Hover and keyboard-selection states share the same emphasized
 * look; resting state is a softly tinted glass pill.
 */
export function GlassActionButton({
  keyLabel,
  label,
  accentColor,
  highlighted,
  onClick,
  className = "",
}: GlassActionButtonProps) {
  const [hovered, setHovered] = useState(false);
  const active = hovered || highlighted;

  const accentBorder = hexToRgba(accentColor, active ? 1 : 0.35);
  const accentTint = hexToRgba(accentColor, active ? 0.14 : 0);
  const accentGlow = hexToRgba(accentColor, active ? 0.25 : 0);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`py-1.5 px-3 font-mono text-micro tracking-[0.1em] uppercase inline-flex items-center justify-center gap-2 transition-[background,border-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${className}`}
      style={{
        borderRadius: 4,
        border: `1px solid ${accentBorder}`,
        color: accentColor,
        // Resting glass: translucent dark base. Active: same base + accent tint
        // layered on top so the colour reads without losing the frost.
        background: active
          ? `linear-gradient(${accentTint}, ${accentTint}), rgba(14, 14, 16, 0.55)`
          : "rgba(14, 14, 16, 0.5)",
        backdropFilter: "blur(24px) saturate(1.5)",
        WebkitBackdropFilter: "blur(24px) saturate(1.5)",
        // Inset highlight gives the glass a top edge; outer glow appears only
        // on active/hover for a subtle lift without violating the design
        // system's "borders only, no shadows on dark bg" rule for resting state.
        boxShadow: active
          ? `inset 0 1px 0 rgba(255, 255, 255, 0.09), 0 0 0 1px ${accentGlow}, 0 6px 18px -8px ${accentGlow}`
          : "inset 0 1px 0 rgba(255, 255, 255, 0.05)",
        transform: active ? "translateY(-0.5px)" : "translateY(0)",
      }}
    >
      <KeyHint keys={keyLabel} variant="inline" />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

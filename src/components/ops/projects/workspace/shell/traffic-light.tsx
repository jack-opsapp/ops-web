import * as React from "react";
import { cn } from "@/lib/utils/cn";

// `TrafficLight` — Mac-style window control. The chrome stays MONOCHROME
// at rest (white-alpha bg + border) so the workspace title bar reads
// quiet, then tints to the canonical macOS hue + reveals the glyph on
// hover. The hue values are fixed by Apple, not brand tokens — they live
// as `--macos-traffic-*` CSS variables in `globals.css` so this file
// stays hex-free (CLAUDE.md "no hex literals" applies absolutely).

export type TrafficLightTone = "close" | "minimize" | "maximize";

const TONE_HOVER_BG: Record<TrafficLightTone, string> = {
  close: "hover:bg-[var(--macos-traffic-close)]",
  minimize: "hover:bg-[var(--macos-traffic-minimize)]",
  maximize: "hover:bg-[var(--macos-traffic-maximize)]",
};

const TONE_LABEL: Record<TrafficLightTone, string> = {
  close: "Close",
  minimize: "Minimize",
  maximize: "Maximize",
};

export interface TrafficLightProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  tone: TrafficLightTone;
  /** Optional accessible label override (defaults to tone name). */
  label?: string;
}

// Glyphs are 6×6 in a 7×7 viewbox so they sit centred inside the 11px
// dot with a 1.5px stroke. Stroke is currentColor over a black-alpha tone
// so it reads as the matte etching macOS uses.
function ToneGlyph({ tone }: { tone: TrafficLightTone }) {
  const common = {
    width: 7,
    height: 7,
    viewBox: "0 0 7 7",
    strokeWidth: 1,
    stroke: "var(--scrim-edge-stroke)",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
    "aria-hidden": true,
    className: "opacity-0 group-hover:opacity-100 transition-opacity duration-[120ms]",
  };
  if (tone === "close") {
    return (
      <svg {...common}>
        <path d="M2 2 L5 5 M5 2 L2 5" />
      </svg>
    );
  }
  if (tone === "minimize") {
    return (
      <svg {...common}>
        <path d="M1.5 3.5 L5.5 3.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M2 2 L2 5 L5 5 M5 5 L2 2" />
    </svg>
  );
}

export const TrafficLight = React.forwardRef<HTMLButtonElement, TrafficLightProps>(
  ({ tone, label, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label ?? TONE_LABEL[tone]}
      // `group` lets the glyph (a child SVG) react to hover on the
      // wrapper button — necessary because the glyph is opacity-0 by
      // default and reveals via group-hover, the macOS pattern.
      className={cn(
        "group inline-flex items-center justify-center",
        "w-[11px] h-[11px] rounded-full",
        // Rest tone — monochrome (per design spec). Border alpha matches
        // the inner shadow Apple uses on the resting dots.
        "bg-[var(--glass-border-active)] border-[0.5px] border-[var(--line)]",
        // Hover — tint to the canonical macOS hue + tighten the border.
        TONE_HOVER_BG[tone],
        // Hover border darkens (--scrim-overlay, consolidated 0.30 → 0.32).
        "hover:border-[var(--scrim-overlay)]",
        // Spec: 120ms colour transition. Background + border only — no
        // transform (the dots don't grow on hover).
        "transition-colors duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
        // Focus ring lives outside the dot so it doesn't fight the tint.
        "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        "cursor-pointer",
        className,
      )}
      {...props}
    >
      <ToneGlyph tone={tone} />
    </button>
  ),
);
TrafficLight.displayName = "TrafficLight";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

// `TrafficLight` — Mac-style window control. The chrome stays MONOCHROME
// at rest (white-alpha bg + border) so the workspace title bar reads
// quiet, then tints to the canonical macOS hue + reveals the glyph on
// hover. Tone hex values are a deliberate exception to the no-hex rule:
// they are the macOS system colours and have to match Apple's exact
// values for the chrome to feel like a Mac window — they aren't brand
// colours and don't belong in `globals.css`.

export type TrafficLightTone = "close" | "minimize" | "maximize";

const TONE_HOVER_BG: Record<TrafficLightTone, string> = {
  // macOS canonical traffic-light colours — fixed by Apple, not brand tokens.
  close: "hover:bg-[#FF5F57]",
  minimize: "hover:bg-[#FEBC2E]",
  maximize: "hover:bg-[#28C840]",
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
    stroke: "rgba(0,0,0,0.55)",
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
        "bg-[rgba(255,255,255,0.18)] border-[0.5px] border-[rgba(255,255,255,0.10)]",
        // Hover — tint to the canonical macOS hue + tighten the border.
        TONE_HOVER_BG[tone],
        "hover:border-[rgba(0,0,0,0.30)]",
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

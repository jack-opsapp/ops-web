"use client";

/**
 * OPS Logo Loader — chevron-split + OPS wordmark typing animation.
 *
 * Ported from ops-design-system-v2/project/logo-loader.jsx with these strict
 * rules preserved:
 *   - X-translation only (no rotation, no Y translation)
 *   - Single ease curve [0.22, 1, 0.36, 1] (EASE_SMOOTH per OPS-Web spec v2)
 *   - No spring / bounce
 *   - Chevrons clip the wordmark via SVG mask, not opacity fades
 *
 * Reduced-motion fallback: static centered horizontal lockup with a 600ms
 * opacity fade-in. Same emotional beat (Entry / Arrival), different motion.
 */

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { OpsLockup } from "@/components/brand/ops-lockup";
import { cn } from "@/lib/utils/cn";

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

// Path data — extracted from ops-design-system-v2/project/logo-loader.jsx so
// the chevrons can be animated independently. The "OPS" letter glyphs are
// reused via OpsLockup's horizontal variant (same viewBox math) for the
// gap-clipped wordmark layer.
const CHEV_UPPER =
  "M826.84,778.71v-350.91l-233.86-116.97-175.42,87.71.1.05,292.23,146.15v292.4l116.92-58.46Z";
const CHEV_LOWER =
  "M707.58,1119.3v-.06l-292.32-146.2-.08-292.37-116.75,58.48-.2,350.79.09.05,233.89,116.97,175.37-87.66Z";
const OPS_O =
  "M1129.61,931.61v-344.67c0-69.09,41-97.18,110.84-97.18h74.4c69.84,0,110.84,28.09,110.84,97.18v344.67c0,69.09-41,97.18-110.84,97.18h-74.4c-69.84,0-110.84-28.09-110.84-97.18ZM1308.78,974.13c44.03,0,55.42-13.67,55.42-56.18v-317.34c0-42.51-11.39-56.18-55.42-56.18h-62.25c-44.03,0-55.42,13.67-55.42,56.18v317.34c0,42.51,11.39,56.18,55.42,56.18h62.25Z";
const OPS_P =
  "M1503.12,494.32h164.74c70.6,0,110.84,28.09,110.84,97.18v129.06c0,69.09-40.24,97.18-110.84,97.18h-103.25v208.02h-61.49V494.32ZM1663.31,763.83c40.24,0,54.66-15.18,54.66-53.9v-107.8c0-38.72-14.42-53.9-54.66-53.9h-98.69v215.61h98.69Z";
const OPS_S =
  "M1820.46,931.61v-70.6h61.49v56.94c0,42.51,11.39,56.18,55.42,56.18h53.14c44.03,0,55.42-13.67,55.42-56.18v-33.4c0-27.33-9.11-41.75-27.33-55.42l-139.69-94.9c-33.4-22.02-50.87-48.59-50.87-95.66v-51.62c0-69.09,40.24-97.18,110.84-97.18h51.62c69.85,0,110.84,28.09,110.84,97.18v70.6h-61.49v-56.94c0-42.51-11.39-56.18-55.42-56.18h-39.48c-44.03,0-56.18,13.67-56.18,56.18v31.13c0,27.33,9.11,41.76,28.09,54.66l138.93,94.9c33.4,22.78,51.62,49.35,51.62,96.42v53.9c0,69.09-41,97.18-110.84,97.18h-65.29c-69.85,0-110.84-28.09-110.84-97.18Z";

const CHEV_CX = 562.2;
const CHEV_CY = 802;
const OPEN_GAP = 820;

// Cycle timing (matches the v2 LOADER_DEFAULTS for `mode: "OPS"`).
const TOTAL_CYCLE = 4.2;
const HOLD_IN = 0.35;
const SEP_END = 1.1;
const HOLD_OUT = 3.2;
const COL_END = 3.95;

// Keyframe times normalised against TOTAL_CYCLE so they map cleanly to
// Framer Motion's `times` array.
const SEP_KEYFRAMES = [0, HOLD_IN / TOTAL_CYCLE, SEP_END / TOTAL_CYCLE, HOLD_OUT / TOTAL_CYCLE, COL_END / TOTAL_CYCLE, 1];
const SEP_VALUES = [0, 0, 1, 1, 0, 0];

// Per-letter visibility timing — staggered so OPS appears one glyph at a time
// during and after the chevron split. Values are seconds-from-start.
const LETTER_TIMES = [HOLD_IN + 0.5, HOLD_IN + 0.6, HOLD_IN + 0.7];

interface LogoLoaderProps {
  /** Diameter of the logo (CSS, e.g. "120px" or "min(40vw, 240px)"). */
  size?: number | string;
  /** Background fill — defaults to transparent so the loader inherits the page canvas. */
  background?: string;
  /** Foreground stroke colour. Defaults to spec v2 text-primary `#EDEDED`. */
  color?: string;
  /** Loop the cycle continuously (default) or play once. */
  loop?: boolean;
  className?: string;
  /** Override the cycle duration in seconds. */
  duration?: number;
}

export const LogoLoader: React.FC<LogoLoaderProps> = ({
  size = 200,
  background = "transparent",
  color = "#EDEDED",
  loop = true,
  className,
  duration = TOTAL_CYCLE,
}) => {
  const reduced = useReducedMotion();

  if (reduced) {
    return (
      <div
        className={cn("inline-flex items-center justify-center", className)}
        style={{ background, width: size, height: size }}
      >
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, ease: EASE_SMOOTH }}
          style={{ color, display: "inline-flex" }}
        >
          <OpsLockup
            orientation="horizontal"
            title=""
            style={{ height: "1em", width: "auto", color }}
          />
        </motion.span>
      </div>
    );
  }

  // Padded viewBox so the chevrons can translate by OPEN_GAP on each side
  // without clipping at the SVG edges.
  const VB_PAD = 1100;
  const VB_W = 2405.66 + VB_PAD * 2;
  const vbX = CHEV_CX - 2405.66 / 2 - VB_PAD;

  const repeatProps = loop
    ? { repeat: Infinity, repeatType: "loop" as const }
    : {};

  return (
    <div
      className={cn("inline-flex items-center justify-center", className)}
      style={{ background, width: size, height: size }}
    >
      <svg
        viewBox={`${vbX} 0 ${VB_W} 1511.21`}
        width="100%"
        height="100%"
        style={{ overflow: "visible", color }}
        role="img"
        aria-label="OPS"
      >
        <defs>
          {/* Clip the wordmark to the gap that opens between the chevrons.
              The rect grows from CHEV_CX outwards in both directions as the
              chevrons separate, so the OPS letters become visible "through"
              the gap. */}
          <motion.clipPath id="ops-loader-gap-clip">
            <motion.rect
              y={-200}
              height={1511.21 + 400}
              animate={{
                x: SEP_VALUES.map((s) => CHEV_CX - OPEN_GAP * s),
                width: SEP_VALUES.map((s) => 2 * OPEN_GAP * s),
              }}
              transition={{
                duration,
                ease: EASE_SMOOTH,
                times: SEP_KEYFRAMES,
                ...repeatProps,
              }}
            />
          </motion.clipPath>
        </defs>

        {/* Wordmark layer — clipped to the opening gap so the letters appear
            to be revealed by the chevrons sliding apart. */}
        <g clipPath="url(#ops-loader-gap-clip)" fill="currentColor">
          <motion.path
            d={OPS_O}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0, 1, 1, 1, 1] }}
            transition={{
              duration,
              ease: EASE_SMOOTH,
              times: [0, LETTER_TIMES[0] / duration, LETTER_TIMES[0] / duration + 0.001, 1, 1, 1],
              ...repeatProps,
            }}
          />
          <motion.path
            d={OPS_P}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0, 1, 1, 1, 1] }}
            transition={{
              duration,
              ease: EASE_SMOOTH,
              times: [0, LETTER_TIMES[1] / duration, LETTER_TIMES[1] / duration + 0.001, 1, 1, 1],
              ...repeatProps,
            }}
          />
          <motion.path
            d={OPS_S}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0, 1, 1, 1, 1] }}
            transition={{
              duration,
              ease: EASE_SMOOTH,
              times: [0, LETTER_TIMES[2] / duration, LETTER_TIMES[2] / duration + 0.001, 1, 1, 1],
              ...repeatProps,
            }}
          />
        </g>

        {/* Upper chevron — translates RIGHT (+X) when separating. */}
        <motion.path
          d={CHEV_UPPER}
          fill="currentColor"
          animate={{ x: SEP_VALUES.map((s) => OPEN_GAP * s) }}
          transition={{
            duration,
            ease: EASE_SMOOTH,
            times: SEP_KEYFRAMES,
            ...repeatProps,
          }}
        />

        {/* Lower chevron — translates LEFT (−X) when separating. */}
        <motion.path
          d={CHEV_LOWER}
          fill="currentColor"
          animate={{ x: SEP_VALUES.map((s) => -OPEN_GAP * s) }}
          transition={{
            duration,
            ease: EASE_SMOOTH,
            times: SEP_KEYFRAMES,
            ...repeatProps,
          }}
        />
      </svg>
    </div>
  );
};

LogoLoader.displayName = "LogoLoader";

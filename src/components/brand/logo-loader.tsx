"use client";

/**
 * OPS Logo Loader — verbatim embed of the canonical v2 design-system loader.
 *
 * The animation source lives at:
 *   /Users/jacksonsweet/Projects/OPS/ops-design-system-v2/project/logo-loader.jsx
 * and its companion runtime at .../animations.jsx. Both files are copied
 * unchanged into `public/v2-loader/` and rendered inside an iframe so we
 * never re-implement or drift from the design-system source.
 *
 * To update: re-copy the v2 files into public/v2-loader/. Do not edit the
 * copies in place.
 *
 * Reduced-motion fallback: skips the iframe, shows a static centered
 * horizontal lockup with a 600ms opacity fade-in. Same Entry / Arrival
 * emotional beat, different motion. Verified accessible.
 */

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { OpsLockup } from "@/components/brand/ops-lockup";
import { cn } from "@/lib/utils/cn";

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

interface LogoLoaderProps {
  /** Diameter of the loader (CSS size). Defaults to 200px. */
  size?: number | string;
  /** Override the chevron + text colour. Falls back to the v2 default `#EDEDED`. */
  color?: string;
  /** Mode: "OPS" (default, animated mark) or "LONG" (typed wordmark). */
  mode?: "OPS" | "LONG";
  className?: string;
}

export const LogoLoader: React.FC<LogoLoaderProps> = ({
  size = 200,
  color,
  mode = "OPS",
  className,
}) => {
  const reduced = useReducedMotion();

  if (reduced) {
    return (
      <div
        className={cn("inline-flex items-center justify-center", className)}
        style={{ width: size, height: size }}
      >
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, ease: EASE_SMOOTH }}
          style={{ color: color ?? "#EDEDED", display: "inline-flex" }}
        >
          <OpsLockup
            orientation="horizontal"
            title=""
            style={{ height: "1em", width: "auto", color: "currentColor" }}
          />
        </motion.span>
      </div>
    );
  }

  // Build the iframe URL. Pass mode + colour overrides as query params; the
  // entry HTML reads them off `location.search`.
  const params = new URLSearchParams({ mode });
  if (color) params.set("chevronColor", color);
  const src = `/v2-loader/index.html?${params.toString()}`;

  // Track iframe readiness — Babel + React CDN bootstraps inside the iframe
  // can take 1-2s before LogoLoaderScene mounts. Until `onLoad` fires we
  // paint the static lockup behind the iframe so the slot is never blank
  // (the original bug — blank area while the iframe was loading or when its
  // CDN scripts were blocked / failed silently).
  const [iframeReady, setIframeReady] = React.useState(false);

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      {/* Static fallback skeleton — visible until the iframe reports load.
          Mirrors the reduced-motion path so users see the brand even before
          the animated mark boots. */}
      <motion.span
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: iframeReady ? 0 : 1 }}
        transition={{ duration: 0.3, ease: EASE_SMOOTH }}
        style={{
          position: "absolute",
          inset: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: color ?? "#EDEDED",
          pointerEvents: "none",
        }}
      >
        <OpsLockup
          orientation="horizontal"
          title=""
          style={{ height: "1em", width: "auto", color: "currentColor" }}
        />
      </motion.span>
      <iframe
        src={src}
        title="OPS"
        onLoad={() => setIframeReady(true)}
        style={{
          width: "100%",
          height: "100%",
          border: 0,
          background: "transparent",
          position: "relative",
        }}
        // Sandbox: allow-scripts to run React/Babel, allow-same-origin so
        // Babel can fetch the .jsx source files from /v2-loader/. Without
        // allow-same-origin the inline `<script type="text/babel" src=...>`
        // tags fail silently and the iframe renders blank.
        sandbox="allow-scripts allow-same-origin"
        // The iframe IS the loading affordance — do NOT lazy-load. Lazy
        // mode delays src fetch until the iframe enters the viewport, which
        // for a centered loading screen means it never renders the loop
        // until the user scrolls. (Loading-screen containers have no scroll
        // and the iframe was already in view, but Safari occasionally read
        // the lazy hint as "defer indefinitely" in this configuration —
        // dropping the hint guarantees an immediate fetch.)
      />
    </div>
  );
};

LogoLoader.displayName = "LogoLoader";

"use client";

/**
 * EdgeTab — fixed-height right-rail instrument (WEB OVERHAUL P2 rebuild).
 *
 * Hover: glass brightens + tooltip. That is all hover does — the previous
 * hover-grow + sibling-push choreography (geometry registry and all) was
 * removed as an approved design decision (P2 shell design spec §4.4).
 * Open: the tab slides left in lockstep with its 360px drawer; the drawer
 * covers sibling tabs (z: rest 1540 < drawer 1550 < active tab 1560).
 */

import { useState } from "react";
import { useReducedMotion } from "framer-motion";
import type { EdgeTabProps, EdgeTabAccent } from "./edge-tab.types";
import {
  EDGE_TAB_GAP,
  EDGE_TAB_WIDTH,
  EDGE_RAIL_BOTTOM,
  EDGE_RAIL_TOP,
  EDGE_Z_TAB_ACTIVE,
  EDGE_Z_TAB_REST,
  getEdgeRailTopStyle,
} from "./edge-rail-layout";

const DEFAULT_HEIGHT = 140;
const DEFAULT_DRAWER_WIDTH = 360;
const EASE_SMOOTH_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";

// Monochrome by default; rose/tan only when the state carries the matching
// semantic meaning. Steel blue never appears on rail chrome (DESIGN.md §3).
const ACCENT_VAR: Record<EdgeTabAccent, string> = {
  critical: "var(--rose)",
  attn: "var(--tan)",
  ambient: "var(--text-mute)",
};

// State-driven glaze laid over the base glass fill — picks up the hue tied
// to the tab's semantic state without breaking the dense-glass blur.
// Earth-tone softs only. (Bug 82cc08e5.)
const TINT_VAR: Record<NonNullable<EdgeTabProps["tint"]>, string | null> = {
  neutral: null,
  rose: "var(--rose-soft)",
  tan: "var(--tan-soft)",
};

export function EdgeTab({
  id,
  open,
  onToggle,
  count,
  accent = "ambient",
  height = DEFAULT_HEIGHT,
  drawerWidth = DEFAULT_DRAWER_WIDTH,
  railTop = EDGE_RAIL_TOP,
  railBottom = EDGE_RAIL_BOTTOM,
  stackOffset = 0,
  fill = "var(--glass-dense)",
  tint = "neutral",
  wordmark,
  wordmarkOpen = "CLOSE",
  renderGlyph,
  openGlyphRotation = 45,
  ariaLabel,
  shortcut,
  tooltipTitle,
}: EdgeTabProps) {
  const [hovered, setHovered] = useState(false);
  const reducedMotion = useReducedMotion();

  // Right-edge offset when open — tracks the drawer's actual rendered
  // width, NOT the requested drawerWidth: on narrow viewports the drawer
  // clamps to calc(100vw - 36px) (bug edfdd057), and a static offset would
  // push the tab off-screen.
  const drawerRightOpen = `min(${drawerWidth}px, calc(100vw - ${
    EDGE_TAB_WIDTH + EDGE_TAB_GAP
  }px))`;

  return (
    <div
      data-edge-tab-anchor={id}
      style={{
        position: "absolute",
        top: railTop,
        bottom: railBottom,
        right: 0,
        width: 0,
        pointerEvents: "none",
        zIndex: open ? EDGE_Z_TAB_ACTIVE : EDGE_Z_TAB_REST,
      }}
    >
      <div
        role="button"
        tabIndex={0}
        data-edge-tab={id}
        data-edge-tab-open={open ? "true" : "false"}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        style={{
          position: "absolute",
          top: getEdgeRailTopStyle(height, stackOffset),
          right: open ? drawerRightOpen : 0,
          width: EDGE_TAB_WIDTH,
          height,
          maxHeight: `calc(100vh - ${railTop + railBottom}px)`,
          boxSizing: "border-box",
          background: hovered && !open ? "rgba(28, 30, 34, 0.85)" : fill,
          backdropFilter: "blur(28px) saturate(1.3)",
          WebkitBackdropFilter: "blur(28px) saturate(1.3)",
          border: "1px solid var(--glass-border)",
          // Square inner edge against the viewport or drawer, restrained
          // radius on the exposed edge.
          borderTopLeftRadius: 6,
          borderBottomLeftRadius: 6,
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          cursor: "pointer",
          pointerEvents: "auto",
          color: "var(--text)",
          // 200ms = --d-panel; the tab slides in lockstep with its drawer.
          transition: reducedMotion
            ? "opacity 150ms linear"
            : `right 200ms ${EASE_SMOOTH_CSS}, background-color 150ms ${EASE_SMOOTH_CSS}`,
          outline: "none",
        }}
      >
        {/* State-driven tint glaze — under the glyph + wordmark, tracking
            the rounded outer edge. "neutral" renders nothing. */}
        {TINT_VAR[tint] && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              borderTopLeftRadius: 6,
              borderBottomLeftRadius: 6,
              background: TINT_VAR[tint] as string,
              pointerEvents: "none",
              transition: reducedMotion
                ? "none"
                : `background 200ms ${EASE_SMOOTH_CSS}, opacity 200ms ${EASE_SMOOTH_CSS}`,
            }}
          />
        )}

        {/* Left accent stripe — inset from the rounded edge. */}
        <span
          aria-hidden
          data-edge-tab-accent
          style={{
            position: "absolute",
            left: 0,
            top: 8,
            bottom: 8,
            width: 2,
            background: ACCENT_VAR[accent],
            transition: reducedMotion
              ? "none"
              : `background 150ms ${EASE_SMOOTH_CSS}`,
          }}
        />

        {/* Glyph — upright at rest; rotates on open (+ → ×) unless the
            consumer swaps glyphs and passes openGlyphRotation={0}. */}
        <span
          aria-hidden
          style={{
            color: "var(--text)",
            display: "inline-flex",
            transform: `rotate(${open ? openGlyphRotation : 0}deg)`,
            transition: reducedMotion
              ? "none"
              : `transform 200ms ${EASE_SMOOTH_CSS}`,
            position: "relative",
          }}
        >
          {renderGlyph(open)}
          {!open && count != null && count > 0 && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: -4,
                right: -5,
                width: 6,
                height: 6,
                background: ACCENT_VAR[accent],
              }}
            />
          )}
        </span>

        {/* Count badge — closed state only */}
        {!open && count != null && count > 0 && (
          <span
            aria-hidden
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text)",
              fontFeatureSettings: '"tnum" 1, "zero" 1',
              lineHeight: 1,
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
            }}
          >
            {count}
          </span>
        )}

        {/* Vertical wordmark */}
        <span
          aria-hidden
          style={{
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            fontFamily: "var(--font-cakemono)",
            fontWeight: 300,
            fontSize: 11,
            color: "var(--text-2)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {open ? wordmarkOpen : wordmark}
        </span>

        {/* Hover tooltip — closed state only. Clamped so it never bleeds
            past the viewport on narrow screens (bug edfdd057). */}
        {hovered && !open && (
          <div
            role="tooltip"
            style={{
              position: "absolute",
              right: "calc(100% + 8px)",
              top: "50%",
              transform: "translateY(-50%)",
              background: "var(--glass-dense)",
              backdropFilter: "blur(28px) saturate(1.3)",
              WebkitBackdropFilter: "blur(28px) saturate(1.3)",
              border: "1px solid var(--glass-border)",
              borderRadius: 4,
              padding: "6px 10px",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              display: "flex",
              alignItems: "center",
              gap: 10,
              maxWidth: `calc(100vw - ${EDGE_TAB_WIDTH + 24}px)`,
              overflow: "hidden",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mohave)",
                fontSize: 14,
                color: "var(--text)",
              }}
            >
              {tooltipTitle}
            </span>
            {shortcut && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--text-2)",
                  padding: "2px 5px",
                  minWidth: 14,
                  textAlign: "center",
                  border: "1px solid var(--line)",
                  borderRadius: 3,
                  background: "rgba(255,255,255,0.06)",
                }}
              >
                {shortcut}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

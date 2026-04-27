"use client";

import { useState } from "react";
import { useReducedMotion } from "framer-motion";
import type { EdgeTabProps, EdgeTabAccent } from "./edge-tab.types";

const TAB_WIDTH = 28;
const DEFAULT_REST_HEIGHT = 180;
const DEFAULT_DRAWER_WIDTH = 360;
const DEFAULT_RAIL_TOP = 72;
const DEFAULT_RAIL_BOTTOM = 16;
const EASE_SMOOTH_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";

const ACCENT_VAR: Record<EdgeTabAccent, string> = {
  critical: "var(--rose)",
  attn: "var(--tan)",
  accent: "var(--ops-accent)",
  ambient: "var(--text-mute)",
};

export function EdgeTab({
  id,
  open,
  onToggle,
  count,
  accent = "accent",
  restHeight = DEFAULT_REST_HEIGHT,
  drawerWidth = DEFAULT_DRAWER_WIDTH,
  railTop = DEFAULT_RAIL_TOP,
  railBottom = DEFAULT_RAIL_BOTTOM,
  stackOffset = 0,
  fill = "var(--glass)",
  canHoverExpand = true,
  wordmark,
  wordmarkOpen = "CLOSE",
  renderGlyph,
  closedGlyphRotation = 0,
  openGlyphRotation = 45,
  ariaLabel,
  shortcut,
  tooltipTitle,
}: EdgeTabProps) {
  const [hovered, setHovered] = useState(false);
  const reducedMotion = useReducedMotion();

  const expanded = open || (hovered && canHoverExpand);

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
        zIndex: 1550,
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
          top: expanded
            ? 0
            : `calc(50% + ${stackOffset - restHeight / 2}px)`,
          right: open ? drawerWidth : 0,
          width: TAB_WIDTH,
          height: expanded ? "100%" : restHeight,
          boxSizing: "border-box",
          background: fill,
          backdropFilter: "blur(28px) saturate(1.3)",
          WebkitBackdropFilter: "blur(28px) saturate(1.3)",
          border: "1px solid var(--glass-border)",
          // Tab shape: outer (left) edge is fully rounded so the curve is
          // tangent to the screen edge — the tab reads as "hiding" at the
          // page edge. Inner (right) side stays square against the viewport.
          // Radius = TAB_WIDTH / 2 yields a half-pill profile.
          borderTopLeftRadius: TAB_WIDTH / 2,
          borderBottomLeftRadius: TAB_WIDTH / 2,
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
          transition: reducedMotion
            ? "opacity 150ms linear"
            : `top 260ms ${EASE_SMOOTH_CSS}, height 260ms ${EASE_SMOOTH_CSS}, right 260ms ${EASE_SMOOTH_CSS}, background-color 180ms ${EASE_SMOOTH_CSS}`,
          outline: "none",
        }}
      >
        {/* Left accent stripe — top/bottom inset by half the tab width so the
            stripe stays inside the rounded outer edge (corners curl in by
            TAB_WIDTH/2 due to the half-pill profile). Data attribute for
            focus-visible brighten in global CSS. */}
        <span
          aria-hidden
          data-edge-tab-accent
          style={{
            position: "absolute",
            left: 0,
            top: TAB_WIDTH / 2,
            bottom: TAB_WIDTH / 2,
            width: 2,
            background: ACCENT_VAR[accent],
            transition: reducedMotion ? "none" : `background 180ms ${EASE_SMOOTH_CSS}`,
          }}
        />

        {/* Glyph — rotates 45° on open */}
        <span
          aria-hidden
          style={{
            color: "var(--text)",
            display: "inline-flex",
            transform: `rotate(${open ? openGlyphRotation : closedGlyphRotation}deg)`,
            transition: reducedMotion ? "none" : `transform 260ms ${EASE_SMOOTH_CSS}`,
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
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            color: "var(--text-2)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {open ? wordmarkOpen : wordmark}
        </span>

        {/* Hover tooltip — closed state only */}
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
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 5,
              padding: "6px 10px",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ fontFamily: "var(--font-mohave)", fontSize: 13, color: "var(--text)" }}>
              {tooltipTitle}
            </span>
            {shortcut && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  color: "var(--text-2)",
                  padding: "2px 5px",
                  minWidth: 14,
                  textAlign: "center",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 3,
                  background: "rgba(255,255,255,0.04)",
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

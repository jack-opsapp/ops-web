"use client";

import { useEffect, useState } from "react";
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
  expandedHeight,
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

  // Live viewport height — drives the rail-height clamp so the expanded tab
  // never grows beyond the visible rail on shorter screens (13" laptops in
  // particular tend to land below 720px). SSR-safe default 0 means "no clamp"
  // until first client measurement.
  const [viewportH, setViewportH] = useState<number>(() =>
    typeof window === "undefined" ? 0 : window.innerHeight
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setViewportH(window.innerHeight);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Maximum tab height we'll allow. The wrapper occupies the rail bounded by
  // railTop / railBottom from the viewport, so the rail height is
  // `vh - railTop - railBottom`. We never let the tab exceed that.
  const railHeight = viewportH > 0 ? viewportH - railTop - railBottom : null;
  const clampToRail = (h: number): number => {
    if (railHeight == null || railHeight <= 0) return h;
    return Math.min(h, railHeight);
  };

  const expanded = open || (hovered && canHoverExpand);

  // ─── Tab vertical positioning ──────────────────────────────────────────────
  //
  // Two stacked tabs share the right rail, separated by an 8px gap and offset
  // from the rail's vertical midpoint via `stackOffset` (negative = above
  // center, positive = below).
  //
  // Rest center: `50% + stackOffset`.
  // Rest top:    `50% + stackOffset - restHeight/2`.
  // Rest bottom: `50% + stackOffset + restHeight/2`.
  //
  // Behavior (bug dd5659ed / 85da1e52):
  //
  //   OPEN with expandedHeight  → centered on `stackOffset`, height
  //     `expandedHeight`. Aligns with a panel-anchored drawer (which is
  //     also centered on `stackOffset`). The active drawer covers the
  //     sibling-tab area anyway, so crossing the rail midpoint here is
  //     fine.
  //
  //   OPEN without expandedHeight → fill the entire rail (legacy behavior
  //     for full-rail drawers like Notifications).
  //
  //   HOVER with expandedHeight → grow ONLY toward the rail extremity (away
  //     from the rail midpoint), capping at `expandedHeight`. This stops
  //     the tab from bursting across the midpoint and covering the sibling
  //     tab while no drawer is yet open. The drawer hasn't mounted, so we
  //     don't need to align with it perfectly.
  //
  //   HOVER without expandedHeight → stay at rest height. Better than
  //     bursting full-rail and covering the sibling tab.

  // Fit-to-rail helpers. Once we know rail height, recompute every
  // expanded-state tabTop using the clamped tabHeight (instead of the raw
  // requested height). This keeps the expanded tab anchored to the same
  // visual edge it was supposed to anchor to (drawer center / sibling-tab
  // boundary) but never extends beyond the rail on short viewports.
  let tabTop: string;
  let tabHeight: string | number;
  if (!expanded) {
    tabTop = `calc(50% + ${stackOffset - restHeight / 2}px)`;
    tabHeight = restHeight;
  } else if (open && typeof expandedHeight === "number") {
    // Open + panel clamp → align with the panel-anchored drawer.
    const h = clampToRail(expandedHeight);
    tabTop = `calc(50% + ${stackOffset - h / 2}px)`;
    tabHeight = h;
  } else if (open) {
    // Open + no clamp → legacy full-rail expansion. railHeight already
    // matches wrapper height, so "100%" stays correct here.
    tabTop = "0";
    tabHeight = "100%";
  } else if (typeof expandedHeight === "number") {
    // Hover only → grow outward from the near edge, never crossing the
    // rail midpoint into the sibling tab's half. Clamp height to rail so
    // short viewports don't push the tab past the rail's far edge.
    const h = clampToRail(expandedHeight);
    if (stackOffset >= 0) {
      // Below center: anchor TOP edge of rest position, grow down.
      tabTop = `calc(50% + ${stackOffset - restHeight / 2}px)`;
    } else {
      // Above center: anchor BOTTOM edge of rest position, grow up.
      tabTop = `calc(50% + ${stackOffset + restHeight / 2 - h}px)`;
    }
    tabHeight = h;
  } else {
    // Hover only without `expandedHeight` → stay at rest.
    tabTop = `calc(50% + ${stackOffset - restHeight / 2}px)`;
    tabHeight = restHeight;
  }

  // Final safety: cap absolute placement so the tab never spills below the
  // rail bottom (or above the rail top) on any viewport. Apply only when
  // we've measured the viewport (railHeight known) AND tabTop is a calc()
  // we can parse — the legacy "0" / "100%" full-rail expansion already
  // fits by construction.
  let tabTopCap: number | undefined;
  if (railHeight != null && typeof tabHeight === "number") {
    const offsetMatch =
      typeof tabTop === "string"
        ? tabTop.match(/^calc\(50%\s*\+\s*(-?\d+(?:\.\d+)?)px\)$/)
        : null;
    if (offsetMatch) {
      const offset = parseFloat(offsetMatch[1]);
      const rawTop = railHeight / 2 + offset;
      const maxTop = railHeight - tabHeight;
      const clampedTop = Math.max(0, Math.min(rawTop, maxTop));
      tabTopCap = clampedTop;
    }
  }

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
          top: tabTopCap != null ? `${tabTopCap}px` : tabTop,
          right: open ? drawerWidth : 0,
          width: TAB_WIDTH,
          height: tabHeight,
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

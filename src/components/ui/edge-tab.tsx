"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import type { EdgeTabProps, EdgeTabAccent } from "./edge-tab.types";
import { useEdgeTabStore } from "@/stores/edge-tab-store";
import { useSidebarStore } from "@/stores/sidebar-store";

// Touch-friendly width on phones (≥44px tap target per WCAG 2.5.5);
// compact width on desktop to preserve rail aesthetic. Switch via the
// EDGE_TAB_MOBILE_BREAKPOINT match. Kept in sync with the wordmark
// font size — both bump on mobile so the rail stays legible.
const TAB_WIDTH_DESKTOP = 28;
const TAB_WIDTH_MOBILE = 44;
const WORDMARK_FONT_DESKTOP = 11;
const WORDMARK_FONT_MOBILE = 12;
const EDGE_TAB_MOBILE_BREAKPOINT = "(max-width: 767px)";

function useEdgeTabMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(EDGE_TAB_MOBILE_BREAKPOINT);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}
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

// Optional state-driven glaze laid over the base glass `fill`. Picks up the
// hue tied to the tab's current semantic state without breaking the dense-
// glass blur. (See bug 82cc08e5.) Values mirror `--rose-soft` and
// `--ops-accent-soft` from globals.css — a 0.12-alpha veil over the glass.
const TINT_VAR: Record<NonNullable<EdgeTabProps["tint"]>, string | null> = {
  neutral: null,
  rose: "var(--rose-soft)",
  accent: "var(--ops-accent-soft)",
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
  tint = "neutral",
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
  const isMobile = useEdgeTabMobile();
  const TAB_WIDTH = isMobile ? TAB_WIDTH_MOBILE : TAB_WIDTH_DESKTOP;
  const wordmarkFontSize = isMobile ? WORDMARK_FONT_MOBILE : WORDMARK_FONT_DESKTOP;
  // Hide the right-edge rail entirely while the mobile sidebar drawer is
  // open — they share the same z-band and competing layers create
  // ambiguous touch targets on phones. (Bug 637c9aef.)
  const sidebarMobileOpen = useSidebarStore((s) => s.isMobileOpen);
  const hiddenForSidebar = isMobile && sidebarMobileOpen;

  // ─── Sibling-push translation (bug 85da1e52) ──────────────────────────────
  //
  // When another tab in the rail is hovered and expanding, this tab
  // translates AWAY from it so the rail never visually overlaps. The
  // direction is data-driven from each tab's stackOffset, registered in
  // the edge-tab store at mount time:
  //
  //   sibling sits BELOW me (sibling.stackOffset > my.stackOffset)
  //     → I translate UP by sibling.expansionDelta
  //   sibling sits ABOVE me (sibling.stackOffset < my.stackOffset)
  //     → I translate DOWN by sibling.expansionDelta
  //
  // Magnitude: `expandedHeight - restHeight` of the sibling. For tabs that
  // expand to fill the rail (no `expandedHeight`), sibling's pre-registered
  // expansionDelta carries an 80px fallback so the visual cue still fires.
  // Reduced-motion users get no translation.
  const setStoreHovered = useEdgeTabStore((s) => s.setHovered);
  const registerGeometry = useEdgeTabStore((s) => s.registerGeometry);
  const unregisterGeometry = useEdgeTabStore((s) => s.unregisterGeometry);
  const siblingHoveredId = useEdgeTabStore((s) =>
    s.hoveredTab !== null && s.hoveredTab !== id ? s.hoveredTab : null,
  );
  const siblingGeometry = useEdgeTabStore((s) =>
    siblingHoveredId ? s.geometry[siblingHoveredId] ?? null : null,
  );
  const anotherTabActive = useEdgeTabStore(
    (s) => s.activeTab !== null && s.activeTab !== id,
  );

  const myExpansionDelta =
    typeof expandedHeight === "number"
      ? Math.max(expandedHeight - restHeight, 0)
      : 80;

  useEffect(() => {
    registerGeometry(id, {
      stackOffset,
      expansionDelta: myExpansionDelta,
    });
    return () => unregisterGeometry(id);
  }, [id, stackOffset, myExpansionDelta, registerGeometry, unregisterGeometry]);

  let siblingPushPx = 0;
  if (siblingGeometry && !open && !anotherTabActive) {
    const sign = siblingGeometry.stackOffset > stackOffset ? -1 : +1;
    siblingPushPx = sign * siblingGeometry.expansionDelta;
  }

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

  let tabTop: string;
  let tabHeight: string | number;
  if (!expanded) {
    tabTop = `calc(50% + ${stackOffset - restHeight / 2}px)`;
    tabHeight = restHeight;
  } else if (open && typeof expandedHeight === "number") {
    // Open + panel clamp → align with the panel-anchored drawer.
    tabTop = `calc(50% + ${stackOffset - expandedHeight / 2}px)`;
    tabHeight = expandedHeight;
  } else if (open) {
    // Open + no clamp → legacy full-rail expansion.
    tabTop = "0";
    tabHeight = "100%";
  } else if (typeof expandedHeight === "number") {
    // Hover only → grow outward from the near edge, never crossing the
    // rail midpoint into the sibling tab's half.
    if (stackOffset >= 0) {
      // Below center: anchor TOP edge of rest position, grow down.
      tabTop = `calc(50% + ${stackOffset - restHeight / 2}px)`;
    } else {
      // Above center: anchor BOTTOM edge of rest position, grow up.
      tabTop = `calc(50% + ${stackOffset + restHeight / 2 - expandedHeight}px)`;
    }
    tabHeight = expandedHeight;
  } else {
    // Hover only without `expandedHeight` → stay at rest.
    tabTop = `calc(50% + ${stackOffset - restHeight / 2}px)`;
    tabHeight = restHeight;
  }

  // Right-edge offset for the tab when open — must track the drawer's
  // actual rendered width, NOT the requested `drawerWidth`. On narrow
  // viewports the drawer clamps to `calc(100vw - 36px)` (bug edfdd057), so
  // a static `right: drawerWidth` would push the tab off-screen. Use the
  // same min() clamp so the tab + drawer stay flush regardless of viewport.
  const drawerRightOpen = `min(${drawerWidth}px, calc(100vw - ${TAB_WIDTH + 8}px))`;

  if (hiddenForSidebar) {
    return null;
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
        onMouseEnter={() => {
          setHovered(true);
          setStoreHovered(id);
        }}
        onMouseLeave={() => {
          setHovered(false);
          setStoreHovered(null);
        }}
        onFocus={() => {
          setHovered(true);
          setStoreHovered(id);
        }}
        onBlur={() => {
          setHovered(false);
          setStoreHovered(null);
        }}
        style={{
          position: "absolute",
          top: tabTop,
          right: open ? drawerRightOpen : 0,
          width: TAB_WIDTH,
          height: tabHeight,
          maxHeight: `calc(100vh - ${railTop + railBottom}px)`,
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
          transform: reducedMotion
            ? undefined
            : `translateY(${siblingPushPx}px)`,
          transition: reducedMotion
            ? "opacity 150ms linear"
            : `top 260ms ${EASE_SMOOTH_CSS}, height 260ms ${EASE_SMOOTH_CSS}, right 260ms ${EASE_SMOOTH_CSS}, transform 260ms ${EASE_SMOOTH_CSS}, background-color 180ms ${EASE_SMOOTH_CSS}`,
          outline: "none",
        }}
      >
        {/* State-driven tint glaze — rendered as a positioned absolute layer
            underneath the glyph + wordmark so the tab picks up a hue tied to
            its semantic state without breaking the glass blur. Default
            ("neutral") renders nothing. Inherits the tab's rounded outer
            edge so the glaze tracks the half-pill profile. (Bug 82cc08e5.) */}
        {TINT_VAR[tint] && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              borderTopLeftRadius: TAB_WIDTH / 2,
              borderBottomLeftRadius: TAB_WIDTH / 2,
              background: TINT_VAR[tint] as string,
              pointerEvents: "none",
              transition: reducedMotion
                ? "none"
                : `background 220ms ${EASE_SMOOTH_CSS}, opacity 220ms ${EASE_SMOOTH_CSS}`,
            }}
          />
        )}

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
            fontSize: wordmarkFontSize,
            color: "var(--text-2)",
            letterSpacing: "0.18em",
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
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 5,
              padding: "6px 10px",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              display: "flex",
              alignItems: "center",
              gap: 10,
              maxWidth: `calc(100vw - ${TAB_WIDTH + 24}px)`,
              overflow: "hidden",
            }}
          >
            <span style={{ fontFamily: "var(--font-mohave)", fontSize: 13, color: "var(--text)" }}>
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

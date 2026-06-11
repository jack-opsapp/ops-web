// src/components/ui/edge-tab.types.ts
import { type ReactNode } from "react";

export type EdgeTabAccent = "critical" | "attn" | "accent" | "ambient";

/**
 * Edge-tab prop surface (WEB OVERHAUL P2).
 *
 * Tabs are FIXED-HEIGHT instruments: hover brightens the glass and shows
 * the tooltip — nothing grows, nothing pushes a sibling. Opening slides
 * the tab left in lockstep with its drawer; the open drawer covers the
 * sibling tabs (z: rest tabs 1540 < drawers 1550 < active tab 1560).
 *
 * The previous hover-grow + sibling-push system (expandedHeight /
 * hoverHeight / canHoverExpand + the geometry registry) was removed as a
 * deliberate design decision — see
 * docs/specs/2026-06-11-web-overhaul-p2-shell-design.md §4.4.
 */
export interface EdgeTabProps {
  /** Unique id for the mutual-exclusion registry. e.g. "notifications". */
  id: string;

  /** Current open state (controlled). */
  open: boolean;

  /** Toggle handler — called on click or Enter/Space keypress. */
  onToggle: () => void;

  /** Count shown as vertical mono badge when closed. 0/undefined hides it. */
  count?: number;

  /** Tone of the left accent stripe. Default "accent" (steel-blue). */
  accent?: EdgeTabAccent;

  /** Fixed tab height in px. Default 140. */
  height?: number;

  /** Drawer width in px — the tab slides this far left when open. Default 360. */
  drawerWidth?: number;

  /** Rail inset from the viewport top. Default 72 (56px topbar + 16px gap). */
  railTop?: number;

  /** Rail inset from the viewport bottom. Default 16. */
  railBottom?: number;

  /** Offset of the tab's vertical center from the rail midpoint, in px
   *  (negative = above). See EDGE_RAIL_STACK for the stack math. */
  stackOffset?: number;

  /** Background fill. Default "var(--glass-dense)". */
  fill?: string;

  /**
   * Optional state-driven tint laid OVER the base `fill` — a 0.12-alpha
   * glaze that keeps the dense-glass blur intact while the tab picks up a
   * hue matching its semantic state.
   *
   *   "neutral" → no tint (default)
   *   "rose"    → critical/attention notifications outstanding
   *   "accent"  → primary CTA / pending review queued
   *
   * The accent stripe still carries the strong signal — the tint is an
   * ambient cue, not a replacement. (Bug 82cc08e5.)
   */
  tint?: "neutral" | "rose" | "accent";

  /** Wordmark text (vertical). Rendered uppercase, Cake Mono 300. */
  wordmark: string;

  /** Wordmark shown when open. Default "CLOSE". */
  wordmarkOpen?: string;

  /** Icon glyph renderer — receives open state, returns an SVG node. */
  renderGlyph: (open: boolean) => ReactNode;

  /** Rotation (deg) applied to the glyph wrapper when open. Default 45
   *  (turns + into ×). Consumers that swap glyphs can pass 0. */
  openGlyphRotation?: number;

  /** Accessible label for the tab button. */
  ariaLabel: string;

  /** Keyboard shortcut shown in the hover tooltip (e.g. "N", "Q", "`"). */
  shortcut?: string;

  /** Human-readable title in the hover tooltip. */
  tooltipTitle: string;
}

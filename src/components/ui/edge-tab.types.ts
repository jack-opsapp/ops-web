// src/components/ui/edge-tab.types.ts
import { type ReactNode } from "react";

export type EdgeTabAccent = "critical" | "attn" | "accent" | "ambient";

export interface EdgeTabProps {
  /** Unique id for mutual-exclusion registry. Examples: "notifications", "fab". */
  id: string;

  /** Current open state (controlled). */
  open: boolean;

  /** Toggle handler — called on click or Enter/Space keypress. */
  onToggle: () => void;

  /** Count shown as vertical mono badge when closed. Pass 0 or undefined to hide. */
  count?: number;

  /** Tone of the left accent stripe. Default "accent" (steel-blue). */
  accent?: EdgeTabAccent;

  /** Rest height in px. Default 180. FAB uses 132 for its shorter wordmark. */
  restHeight?: number;

  /** Drawer width in px — the tab slides this far when opening. Default 360. */
  drawerWidth?: number;

  /** Vertical offset from drawer area top. Default 72 (below 56px topbar + 16px gap). */
  railTop?: number;

  /** Vertical offset from drawer area bottom. Default 16. */
  railBottom?: number;

  /**
   * Offset applied to the rest-state vertical center, in px. Used by stacked
   * tabs to sit above or below the drawer-area midpoint while keeping the gap
   * between them centered on that midpoint. See plan §Task 24 for stack math.
   */
  stackOffset?: number;

  /** Background fill. Default "var(--glass)". FAB uses "rgba(32,34,38,0.92)". */
  fill?: string;

  /**
   * When true, hovering the tab grows it to full drawer-area height (legibility
   * preview). When false, hover keeps the tab at rest height (prevents a
   * sibling tab from visually covering an active drawer).
   *
   * Parent should pass `canHoverExpand={!anyEdgeTabActive || open}` — grow on
   * hover ONLY if this tab is already open OR no tab is active.
   */
  canHoverExpand?: boolean;

  /** Wordmark text (vertical). Example: "NOTIFICATIONS". Rendered uppercase. */
  wordmark: string;

  /** Wordmark shown when open. Default "CLOSE". */
  wordmarkOpen?: string;

  /** Icon glyph renderer — receives open state, returns an SVG React node. */
  renderGlyph: (open: boolean) => ReactNode;

  /**
   * Rotation (deg) applied to the glyph wrapper when closed. Default 0 (upright).
   * Notifications uses -90 so the bell lays sideways aligned with the vertical
   * wordmark. Quick Actions uses 0 so the plus glyph is upright.
   */
  closedGlyphRotation?: number;

  /**
   * Rotation (deg) applied to the glyph wrapper when open. Default 45 (turns
   * a + into × for FAB-style consumers; preserved for symmetry on bell-style
   * consumers since the open state shows × always).
   */
  openGlyphRotation?: number;

  /** Accessible label for the tab button. */
  ariaLabel: string;

  /** Keyboard shortcut shown in hover tooltip. Pass the glyph (e.g. "N" or "`"). */
  shortcut?: string;

  /** Human-readable title in hover tooltip. */
  tooltipTitle: string;
}

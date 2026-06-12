/**
 * Right-edge rail geometry (WEB OVERHAUL P2).
 *
 * Three fixed-height tabs share the rail, stacked with an 8px gap and
 * centered as a group on the rail midpoint. Tabs never grow on hover —
 * the old hover-grow/sibling-push choreography is gone (design decision,
 * see the P2 shell design spec §4.4). All drawers are 360px wide with
 * identical header/footer anatomy.
 *
 * Stack math (group = 164 + 8 + 140 + 8 + 96 = 416px, centered):
 *   notifications: top −208 … center −208 + 82           = −126
 *   quickActions:  top −208 + 164 + 8 = −36 … center +34
 *   bugReport:     top −36 + 140 + 8 = +112 … center +160
 *
 * Z within the floating-ui band: rest tabs 1540 < open drawer 1550 <
 * active tab 1560 — an open drawer covers its sibling tabs.
 */

export const EDGE_TAB_WIDTH = 28;
export const EDGE_TAB_GAP = 8;
export const EDGE_RAIL_TOP = 72;
export const EDGE_RAIL_BOTTOM = 16;

export const EDGE_Z_TAB_REST = 1540;
export const EDGE_Z_DRAWER = 1550;
export const EDGE_Z_TAB_ACTIVE = 1560;

/**
 * Drawer padding zones — defined once so the rail drawers can't drift into
 * per-callsite padding dialects. All values are 4/8-grid (DESIGN.md §7).
 */
export const EDGE_DRAWER_PADDING = {
  header: "12px 16px 8px",
  row: "8px 16px",
  footer: "8px 16px",
} as const;

export const EDGE_RAIL_STACK = {
  notifications: {
    height: 164,
    drawerHeight: 520,
    drawerWidth: 360,
    stackOffset: -126,
  },
  quickActions: {
    height: 140,
    // Drawer height is content-driven (computeQuickActionsPanelHeight),
    // capped at 452 — see quick-actions-tab.tsx.
    drawerWidth: 360,
    stackOffset: 34,
  },
  bugReport: {
    height: 96,
    drawerHeight: 520,
    drawerWidth: 360,
    stackOffset: 160,
  },
} as const;

export function getEdgeRailTopStyle(
  heightPx: number,
  stackOffsetPx: number
): string {
  return getEdgeRailBoundedTopStyle(
    heightPx,
    `calc(50% + ${stackOffsetPx}px - ${heightPx / 2}px)`
  );
}

export function getEdgeRailBoundedTopStyle(
  heightPx: number,
  desiredTop: string
): string {
  return `clamp(0px, ${desiredTop}, max(0px, calc(100% - ${heightPx}px)))`;
}

export function getEdgeRailHeightStyle(heightPx: number): string {
  return `min(${heightPx}px, 100%)`;
}

export function getEdgeRailDrawerWidthStyle(widthPx: number): string {
  return `min(${widthPx}px, calc(100vw - ${EDGE_TAB_WIDTH + EDGE_TAB_GAP}px))`;
}

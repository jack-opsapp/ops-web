/**
 * OPS Web — Route Registry
 *
 * THE single source of truth for every top-level route's identity: href,
 * icon, i18n label key, nav placement, RBAC permission, feature-flag
 * posture, and full-height layout mode.
 *
 * Consumers (WEB OVERHAUL P2): Sidebar, TopBar (page titles), mobile
 * drawer, CommandPalette nav section, number-key shortcuts,
 * `(dashboard)/layout.tsx` route-permission gate, and
 * `dashboard-layout.tsx` full-height modes. Before this file, route naming
 * lived in six parallel tables (sidebar dict, top-bar hardcode,
 * breadcrumbs dict, layout permission map, palette, shortcut map) — that
 * drift class (sidebar "Calendar" vs top bar "Schedule") is retired.
 *
 * Labels: every entry's `labelKey` resolves through the `navigation`
 * dictionary (`src/i18n/dictionaries/{en,es}/navigation.json`). Never
 * hardcode a route title.
 *
 * TRANSITION RULE (master plan §6): the nav is populated only with routes
 * that exist at ship time. Entries carrying `absorbedBy` are scheduled to
 * collapse into a P3 surface — each P3 wave's landing commit swaps the
 * entries and adds the §2 redirects in the same commit. At no point may a
 * nav entry point at a 404.
 *
 * Z-INDEX (nav band, per OPS-Web CLAUDE.md scale): top bar 500 · mobile
 * scrim 502 · sidebar 505. Dropdowns 1000, edge rail 1500s.
 */

import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  FolderKanban,
  CalendarDays,
  GitBranch,
  Calculator,
  Library,
  Users,
  Mail,
  Radar,
  BrainCircuit,
  Settings,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

export type FullHeightMode = "padded" | "bleed";
export type NavGroup = "command" | "ops";

export interface RouteEntry {
  /** Stable identifier (also the analytics-friendly name). */
  key: string;
  /** Route the entry navigates to / matches against. */
  href: string;
  /** lucide-react icon — 20px in the sidebar, per DESIGN.md §11 sizes. */
  icon: LucideIcon;
  /** Key into the `navigation` dictionary (en + es). */
  labelKey: string;
  /**
   * Sidebar placement. `false` = not in the nav (route still gets titles,
   * permissions, and full-height handling from this registry).
   */
  nav: { order: number; group: NavGroup } | false;
  /** RBAC permission required to see/visit (usePermissionStore.can). */
  permission?: string;
  /**
   * Any-of RBAC gate for hub surfaces that absorb several permissioned
   * areas (BOOKS mirrors iOS `MainTabView.hasBooksAccess`): visible when
   * the user holds AT LEAST ONE listed permission. Mutually exclusive
   * with `permission` — set one or the other.
   */
  anyOfPermissions?: string[];
  /**
   * Phase C posture (master plan §3): rendered ONLY when
   * `canAccessFeature("phase_c")` — invisible to everyone else. Distinct
   * from the dimmed request-access treatment driven by
   * `isPermissionUnlocked` (feature_flags), which stays for commercial
   * gating of visible entries.
   */
  phaseCOnly?: boolean;
  /** Live badge binding rendered by the sidebar when present. */
  badge?: "agentQueuePending";
  /** Full-height page mode (see dashboard-layout.tsx). */
  fullHeight?: FullHeightMode;
  /** P3 absorption schedule — documentation + the wave's swap checklist. */
  absorbedBy?: { phase: string; target: string };
  /** Command-palette search aliases (English code-level hints — the
   *  visible label stays i18n'd via labelKey). */
  paletteKeywords?: string[];
}

// ─── Registry ────────────────────────────────────────────────────────────────

export const ROUTE_REGISTRY: readonly RouteEntry[] = [
  {
    key: "dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    labelKey: "nav.dashboard",
    paletteKeywords: ["home", "overview", "stats"],
    nav: { order: 1, group: "command" },
  },
  {
    // Map was absorbed into Projects (P3.5): it is now the PROJECTS › MAP view
    // mode, deep-linked via `/projects?view=map`. The standalone /map route
    // 308-redirects there (src/middleware.ts, param-preserving); its palette
    // keywords moved here so "map" / "locations" / "tracking" / "gps" still
    // surface the destination. The MAP view itself is gated on `map.view` at
    // the Projects page (the switcher hides the segment without it).
    key: "projects",
    href: "/projects",
    icon: FolderKanban,
    labelKey: "nav.projects",
    paletteKeywords: ["jobs", "work", "map", "locations", "tracking", "gps"],
    nav: { order: 2, group: "command" },
    permission: "projects.view",
    fullHeight: "bleed",
  },
  {
    key: "schedule",
    href: "/schedule",
    icon: CalendarDays,
    labelKey: "nav.schedule",
    paletteKeywords: ["calendar", "events", "dates"],
    nav: { order: 4, group: "command" },
    permission: "calendar.view",
    fullHeight: "padded",
  },
  {
    key: "pipeline",
    href: "/pipeline",
    icon: GitBranch,
    labelKey: "nav.pipeline",
    paletteKeywords: ["leads", "sales", "crm"],
    nav: { order: 5, group: "command" },
    permission: "pipeline.view",
    // Full-bleed: the table runs edge-to-edge; the metrics bar scrolls away and
    // the toolbar + header pin (WEB OVERHAUL P6-2 rework).
    fullHeight: "bleed",
  },
  {
    // BOOKS — the unified financial hub (P3.1). Absorbed Estimates,
    // Invoices, Accounting (A/R + integrations + QB import), the expense
    // review hub, and the cashflow placeholder. Icon traces to the
    // OPS-ICON-SET-BRIEF `nav-finance` concept (Carbon `Calculator`).
    key: "books",
    href: "/books",
    icon: Calculator,
    labelKey: "nav.books",
    paletteKeywords: [
      "money",
      "invoices",
      "estimates",
      "quotes",
      "expenses",
      "accounting",
      "finance",
      "billing",
      "payments",
      "quickbooks",
    ],
    nav: { order: 6, group: "command" },
    // Any-of across the four segments' gates. expenses.approve (not .view):
    // the web expenses segment is the review hub — web has no own-scope
    // expense list, so .view alone would render an empty Books.
    anyOfPermissions: [
      "invoices.view",
      "estimates.view",
      "expenses.approve",
      "accounting.view",
    ],
    // Full-bleed: each segment hosts the unified TableShell edge-to-edge — the
    // metrics bar scrolls away, the toolbar + sticky header pin (WEB OVERHAUL
    // P6-2 rework).
    fullHeight: "bleed",
  },
  {
    // CATALOG — the variant-aware price book + stock hub (P3.2). Absorbed
    // Products and Inventory into PRODUCTS / STOCK segments mirroring the iOS
    // Catalog tab. Icon traces to the OPS-ICON-SET-BRIEF `nav-catalog`
    // concept (Carbon `Catalog`); ships lucide `Library` until the Carbon swap.
    key: "catalog",
    href: "/catalog",
    icon: Library,
    labelKey: "nav.catalog",
    paletteKeywords: [
      "products",
      "inventory",
      "stock",
      "items",
      "materials",
      "pricing",
      "price book",
      "skus",
      "variants",
    ],
    nav: { order: 9, group: "command" },
    // Any-of across the two segments' gates (mirrors iOS catalog access):
    // visible when the user can see catalog products OR stock.
    anyOfPermissions: ["catalog.products.view", "catalog.view"],
    // Full-bleed: each segment hosts the unified TableShell edge-to-edge — the
    // metrics bar scrolls away, the toolbar + sticky header pin (WEB OVERHAUL
    // P6-2 rework).
    fullHeight: "bleed",
  },
  {
    // /catalog/setup — the full-page Catalog Setup Wizard. NOT a nav entry
    // (launched from the first-run takeover + the catalog kebab), registered so
    // the layout gate enforces catalog.run_setup (tighter than /catalog's
    // catalog.products.view|catalog.view) and the top bar resolves a page title.
    // BY_SPECIFICITY matches this before /catalog.
    key: "catalog-setup",
    href: "/catalog/setup",
    icon: Library,
    labelKey: "nav.catalogSetup",
    nav: false,
    permission: "catalog.run_setup",
    fullHeight: "bleed",
  },
  {
    key: "clients",
    href: "/clients",
    icon: Users,
    labelKey: "nav.clients",
    paletteKeywords: ["customers", "contacts"],
    nav: { order: 11, group: "command" },
    permission: "clients.view",
    // Full-bleed: the unified TableShell runs edge-to-edge — the metrics bar
    // scrolls away, the toolbar + sticky header pin (WEB OVERHAUL P6-2 rework).
    fullHeight: "bleed",
  },
  // Team was absorbed into Settings (P3.4): it is now SETTINGS › TEAM ›
  // Members, deep-linked via `/settings?section=team`. The standalone /team
  // route 308-redirects there (src/middleware.ts); its palette keywords moved
  // onto the `settings` entry so "team" / "crew" still surface the destination.

  // ── // OPS group ──────────────────────────────────────────────────────────
  {
    key: "calibration",
    href: "/calibration",
    icon: Radar,
    labelKey: "nav.calibration",
    paletteKeywords: ["ai", "training", "corpus"],
    nav: { order: 20, group: "ops" },
    permission: "email.configure_ai",
    phaseCOnly: true,
  },
  {
    key: "agent-queue",
    href: "/agent/queue",
    icon: BrainCircuit,
    labelKey: "nav.agentQueue",
    paletteKeywords: ["approvals", "ai", "queue"],
    nav: { order: 21, group: "ops" },
    permission: "pipeline.view",
    phaseCOnly: true,
    badge: "agentQueuePending",
  },
  {
    key: "settings",
    href: "/settings",
    icon: Settings,
    labelKey: "nav.settings",
    paletteKeywords: ["preferences", "profile", "account", "team", "crew", "members", "staff", "roles", "permissions", "invite", "seats"],
    nav: { order: 22, group: "ops" },
  },

  // ── Routes outside the nav (titles / permissions / layout only) ──────────
  {
    // Inbox UI is shelved (master plan §3) — no nav entry for anyone. The
    // route remains for inbox_ui-flagged companies (server gate on the page
    // + synthetic per-company flag in /api/feature-flags), so it still
    // needs a title, a permission, and its full-height mode.
    key: "inbox",
    href: "/inbox",
    icon: Mail,
    labelKey: "nav.inbox",
    paletteKeywords: ["email", "mail", "threads"],
    nav: false,
    permission: "pipeline.view",
    fullHeight: "padded",
  },
  {
    // Title + permission umbrella for every /agent/* sub-route; the
    // /agent/queue nav entry above wins prefix-matching for the queue.
    key: "agent",
    href: "/agent",
    icon: BrainCircuit,
    labelKey: "nav.agentQueue",
    nav: false,
    permission: "pipeline.view",
  },
] as const;

// ─── Full-height exceptions ──────────────────────────────────────────────────

/**
 * Sub-routes that opt back OUT of an ancestor's full-height mode.
 * /projects/new is a scrolling full-page form under the bleed /projects.
 */
export const FULL_HEIGHT_EXCEPTIONS: readonly string[] = ["/projects/new"];

// ─── Lookup helpers ──────────────────────────────────────────────────────────

/** Registry sorted longest-href-first so prefix matching picks the most
 *  specific entry (/agent/queue before /agent). */
const BY_SPECIFICITY: readonly RouteEntry[] = [...ROUTE_REGISTRY].sort(
  (a, b) => b.href.length - a.href.length,
);

function matches(entry: RouteEntry, pathname: string): boolean {
  return pathname === entry.href || pathname.startsWith(entry.href + "/");
}

/** Most specific registry entry for a pathname, or null. */
export function getEntryForPath(pathname: string): RouteEntry | null {
  for (const entry of BY_SPECIFICITY) {
    if (matches(entry, pathname)) return entry;
  }
  return null;
}

/** i18n label key for a pathname's page title, or null (no title). */
export function getTitleKeyForPath(pathname: string): string | null {
  return getEntryForPath(pathname)?.labelKey ?? null;
}

/** RBAC permission required for a pathname, or null (always allowed).
 *  NOTE: any-of entries (BOOKS) return null here — use
 *  `getAnyOfPermissionsForPath` for full gating. */
export function getPermissionForPath(pathname: string): string | null {
  return getEntryForPath(pathname)?.permission ?? null;
}

/** Full RBAC gate for a pathname as an any-of list, or null (ungated).
 *  Single-permission entries normalize to a one-element array. */
export function getAnyOfPermissionsForPath(pathname: string): string[] | null {
  const entry = getEntryForPath(pathname);
  if (!entry) return null;
  if (entry.anyOfPermissions?.length) return entry.anyOfPermissions;
  return entry.permission ? [entry.permission] : null;
}

/** Normalized permission list for a registry entry ([] = ungated). */
export function entryPermissions(entry: RouteEntry): string[] {
  if (entry.anyOfPermissions?.length) return entry.anyOfPermissions;
  return entry.permission ? [entry.permission] : [];
}

/** Full-height mode for a pathname, honoring opt-out exceptions. */
export function getFullHeightMode(pathname: string): FullHeightMode | null {
  if (FULL_HEIGHT_EXCEPTIONS.includes(pathname)) return null;
  return getEntryForPath(pathname)?.fullHeight ?? null;
}

/** Nav entries in display order (both groups), unfiltered. Visibility
 *  (RBAC / flags / phase C) is applied by the consumer with live store
 *  state — the registry is static data. */
export function getNavEntries(): RouteEntry[] {
  return ROUTE_REGISTRY.filter(
    (e): e is RouteEntry & { nav: { order: number; group: NavGroup } } =>
      e.nav !== false,
  ).sort((a, b) => a.nav.order - b.nav.order);
}

/** Number-key (1–9) navigation targets, derived from command-group nav
 *  order so the shortcut map can never drift from the sidebar again. */
export function getNumberShortcutRoutes(): Record<string, string> {
  const commandEntries = getNavEntries().filter(
    (e) => e.nav !== false && e.nav.group === "command",
  );
  const map: Record<string, string> = {};
  commandEntries.slice(0, 9).forEach((e, i) => {
    map[String(i + 1)] = e.href;
  });
  return map;
}

/** True when the pathname's active-state should light a nav entry. The
 *  dashboard only matches exactly (it is also the app's root landing). */
export function isNavEntryActive(entry: RouteEntry, pathname: string): boolean {
  if (entry.href === "/dashboard") return pathname === "/dashboard";
  return matches(entry, pathname);
}

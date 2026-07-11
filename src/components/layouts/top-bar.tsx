"use client";

/**
 * TopBar (WEB OVERHAUL P5 redesign — gradient-scrim surface).
 *
 * Surface: the bar carries NO glass fill, NO blur, NO hairline seam. The
 * "horizon" treatment lives in dashboard-layout.tsx as a black→transparent
 * scrim behind these controls — content dissolves under it, the controls
 * float on the canvas, and the title stays legible over anything (incl. the
 * dashboard map). This component is transparent chrome only.
 *
 * Composition: [mobile hamburger] page title / breadcrumb — left · then a
 * single right-anchored cluster: contextual undo · ⌘K search · notifications
 * · │ · sync · clock. The old center-floated search/undo bisecting the bar
 * is gone (it read lopsided); search collapses to a quiet ⌘K affordance and
 * sync recedes to a single dot that only speaks up when something is wrong.
 *
 * Page titles resolve through the route registry's i18n label keys. Because
 * `useDictionary` returns the raw key while a namespace chunk is still
 * loading, the title is gated on `titleReady` so a `nav.*` key can never
 * flash as display copy on cold load (DESIGN.md §14: no raw data as copy).
 */

import {
  Search,
  RefreshCw,
  Menu,
  Undo2,
  Loader2,
  Bell,
} from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useConnectivity } from "@/lib/hooks/use-connectivity";
import { useDictionary } from "@/i18n/client";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useBreadcrumbStore } from "@/stores/breadcrumb-store";
import { useUndoStore } from "@/stores/undo-store";
import { useEdgeTabStore } from "@/stores/edge-tab-store";
import { useNotifications } from "@/lib/hooks/use-notifications";
import { resolveTone } from "@/lib/notifications/notification-meta";
import { getTitleKeyForPath } from "@/lib/navigation/route-registry";
import { formatEnumLabel } from "@/lib/utils/format";

// Shared control geometry — bare icon affordances (no per-control border).
// Web has no touch targets (DESIGN.md §15); 30px traces to the compact tier.
const CONTROL =
  "flex items-center justify-center h-[30px] w-[30px] rounded text-text-3 " +
  "hover:text-text-2 hover:bg-surface-hover transition-colors duration-150 " +
  "ease-smooth motion-reduce:transition-none";

// ── Sync indicator ───────────────────────────────────────────────────────────
//
// Invisible-helpfulness: nominal is a single calm olive dot (no label, no
// motion). Only the states the operator must act on assert themselves —
// in-flight work spins, offline shows a rose dot — and those carry a text
// label so state is never conveyed by color alone (DESIGN.md §15).

type SyncStatus = "synced" | "syncing" | "pending" | "offline";

function SyncIndicator({
  status,
  t,
}: {
  status: SyncStatus;
  t: (key: string, fallback?: string) => string;
}) {
  if (status === "synced") {
    return (
      <span
        className="ml-0.5 h-[7px] w-[7px] shrink-0 rounded-full bg-olive"
        title={t("sync.syncedTitle", "All data synced")}
        aria-label={t("sync.synced", "Synced")}
        role="img"
      />
    );
  }

  const cfg = {
    syncing: { label: t("sync.syncing", "Syncing"), tone: "text-tan", spin: true },
    pending: { label: t("sync.pending", "Pending"), tone: "text-tan", spin: true },
    offline: { label: t("sync.offline", "Offline"), tone: "text-rose", spin: false },
  }[status];

  return (
    <span
      className={cn("flex items-center gap-1.5", cfg.tone)}
      title={t(`sync.${status}Title`, cfg.label)}
    >
      {status === "offline" ? (
        <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-rose" />
      ) : (
        <RefreshCw
          className={cn(
            "h-[13px] w-[13px] shrink-0",
            cfg.spin && "animate-spin motion-reduce:animate-none"
          )}
        />
      )}
      <span className="font-mono text-micro uppercase tracking-wider">
        {cfg.label}
      </span>
    </span>
  );
}

// ── Clock ────────────────────────────────────────────────────────────────────

/** Mission-deck clock — 24h HH:MM, minute tick, tabular mono. Mounts empty
 *  and fills client-side so SSR HTML never carries a mismatched time. */
function DeckClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    // Align to the next minute boundary, then tick per minute.
    let interval: number | undefined;
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    const align = window.setTimeout(() => {
      setNow(new Date());
      interval = window.setInterval(() => setNow(new Date()), 60_000);
    }, msToNextMinute);
    return () => {
      window.clearTimeout(align);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);

  const text = now
    ? `${String(now.getHours()).padStart(2, "0")}:${String(
        now.getMinutes()
      ).padStart(2, "0")}`
    : "—:—";

  return (
    <span
      suppressHydrationWarning
      className="hidden sm:inline font-mono text-micro tracking-[0.08em] text-text-3 tabular-nums select-none"
    >
      {text}
    </span>
  );
}

// ── TopBar ────────────────────────────────────────────────────────────────────

export function TopBar() {
  const showShortcutHints = usePreferencesStore((s) => s.showShortcutHints);
  const { t } = useDictionary("topbar");
  const { t: tNav } = useDictionary("navigation");
  const openMobile = useSidebarStore((s) => s.openMobile);
  const router = useRouter();
  const pathname = usePathname();
  const entityName = useBreadcrumbStore((s) => s.entityName);
  const parentCrumbs = useBreadcrumbStore((s) => s.parentCrumbs);

  // Undo
  const undoStack = useUndoStore((s) => s.stack);
  const isUndoing = useUndoStore((s) => s.isUndoing);
  const undo = useUndoStore((s) => s.undo);
  const topEntry = undoStack[0] ?? null;
  const [isUndoHovered, setIsUndoHovered] = useState(false);

  const handleUndo = useCallback(() => {
    if (!isUndoing && topEntry) undo();
  }, [isUndoing, topEntry, undo]);

  // Cmd+Z keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        // Don't capture if user is typing in an input/textarea
        const tag = (e.target as HTMLElement)?.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          (e.target as HTMLElement)?.isContentEditable
        )
          return;

        e.preventDefault();
        const store = useUndoStore.getState();
        if (!store.isUndoing && store.stack.length > 0) store.undo();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Notifications — the bell drives the SAME right-edge drawer the edge tab
  // does (shared edge-tab mutex). The dot is the operator's "signals waiting"
  // cue: tan for ordinary unread, escalating to rose if any unread item is
  // critical (a fault must not hide behind a calm tan). Count lives in the
  // drawer (DESIGN.md 11px floor makes a numeric badge louder than minimal).
  const { data: notifs = [] } = useNotifications();
  const notifCount = notifs.length;
  const hasCritical = useMemo(
    () => notifs.some((n) => resolveTone(n.type) === "critical"),
    [notifs]
  );
  const toggleEdgeTab = useEdgeTabStore((s) => s.toggle);
  const notifOpen = useEdgeTabStore((s) => s.activeTab === "notifications");

  const openSearch = useCallback(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
    );
  }, []);

  // Build breadcrumb trail. Root titles come from the registry (i18n).
  const segments = pathname.split("/").filter(Boolean);
  const isNested = segments.length > 1;
  const titleKey = getTitleKeyForPath(pathname);
  // `useDictionary` returns the key itself until the namespace chunk loads —
  // gate the title so a raw `nav.*` key never paints as the page heading.
  const resolvedTitle = titleKey ? tNav(titleKey) : "";
  const titleReady = !!titleKey && resolvedTitle !== titleKey;
  const rootTitle = titleReady ? resolvedTitle : "";
  const parentRoute = "/" + segments[0];
  // Nested parent crumb resolves from the PARENT route, not the full path.
  // A nested route with its own registry entry (e.g. /catalog/setup →
  // "Catalog setup") would otherwise print the whole entry as the parent
  // crumb and the leaf would repeat it — "CATALOG SETUP // SETUP". Deriving
  // from `parentRoute` yields the parent's own title ("CATALOG // SETUP").
  const parentTitleKey = getTitleKeyForPath(parentRoute);
  const resolvedParentTitle = parentTitleKey ? tNav(parentTitleKey) : "";
  const parentTitleReady =
    !!parentTitleKey && resolvedParentTitle !== parentTitleKey;
  const parentTitle = parentTitleReady ? resolvedParentTitle : "";
  // Last-resort leaf fallback while the breadcrumb store hydrates — never
  // print a raw slug/UUID as the page title (DESIGN.md §14: no raw data as
  // display copy). IDs render as the `—` empty mark instead.
  const leafSegment = segments[segments.length - 1] ?? "";
  const leafFallback = /^[0-9a-f-]{20,}$/i.test(leafSegment)
    ? "—"
    : formatEnumLabel(leafSegment);

  // Live sync status from TanStack Query + connectivity
  const isOnline = useConnectivity();
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();
  const syncStatus: SyncStatus = !isOnline
    ? "offline"
    : isMutating > 0
      ? "pending"
      : isFetching > 0
        ? "syncing"
        : "synced";

  return (
    <header className="h-[56px] flex items-center px-3 shrink-0 relative bg-transparent min-w-0">
      {/* Left: Hamburger (mobile) + Page title / Breadcrumbs */}
      <div className="flex items-center gap-2 min-w-0 shrink">
        <button
          onClick={openMobile}
          className={cn(
            "md:hidden p-2 rounded shrink-0",
            "text-text-3 hover:text-text-2 hover:bg-surface-hover",
            "transition-colors duration-150 ease-smooth motion-reduce:transition-none"
          )}
          aria-label={t("menu.ariaLabel", "Open menu")}
        >
          <Menu className="w-[18px] h-[18px]" />
        </button>

        {isNested ? (
          /* Breadcrumb trail per the kit TopBar: JetBrains Mono 11px
             uppercase 0.16em crumbs with `//` separators in text-mute;
             the leaf entity title is Cake Mono 300 (the display voice —
             Mohave never carries tracked-uppercase headings). */
          <div className="flex items-center gap-1 min-w-0">
            {parentCrumbs ? (
              /* Custom parent crumbs (set by detail pages) */
              parentCrumbs.map((crumb, i) => (
                <div key={i} className="flex items-center gap-1">
                  {i > 0 && (
                    <span className="text-text-mute font-mono text-micro">
                      {"//"}
                    </span>
                  )}
                  {crumb.href ? (
                    <button
                      onClick={() => router.push(crumb.href!)}
                      className="font-mono text-micro text-text-3 hover:text-text-2 transition-colors uppercase tracking-[0.16em]"
                    >
                      {crumb.label}
                    </button>
                  ) : (
                    <span className="font-mono text-micro text-text-3 uppercase tracking-[0.16em]">
                      {crumb.label}
                    </span>
                  )}
                </div>
              ))
            ) : (
              /* Auto-generated: parent route title from the registry */
              parentTitle && (
                <button
                  onClick={() => router.push(parentRoute)}
                  className="font-mono text-micro text-text-3 hover:text-text-2 transition-colors uppercase tracking-[0.16em]"
                >
                  {parentTitle}
                </button>
              )
            )}
            {(parentCrumbs || parentTitle) && (
              <span className="text-text-mute font-mono text-micro">{"//"}</span>
            )}
            <span className="font-cakemono font-light text-heading text-text uppercase truncate">
              {entityName || leafFallback}
            </span>
          </div>
        ) : (
          /* Simple title for top-level routes */
          rootTitle && (
            <h1 className="font-cakemono font-light text-heading text-text uppercase truncate">
              {rootTitle}
            </h1>
          )
        )}
      </div>

      {/* Right: single anchored cluster — actions · │ · telemetry */}
      <div className="ml-auto flex items-center gap-1.5 shrink-0 pl-3">
        {/* Undo — contextual, only present when the stack is non-empty */}
        {topEntry && (
          <div className="relative animate-fade-in motion-reduce:animate-none">
            <button
              onClick={handleUndo}
              disabled={isUndoing}
              onMouseEnter={() => setIsUndoHovered(true)}
              onMouseLeave={() => setIsUndoHovered(false)}
              className={cn(CONTROL, isUndoing && "opacity-50 pointer-events-none")}
              aria-label={t("undo.ariaLabel", "Undo last action")}
            >
              {isUndoing ? (
                <Loader2 className="w-[16px] h-[16px] animate-spin motion-reduce:animate-none" />
              ) : (
                <Undo2 className="w-[16px] h-[16px]" />
              )}
            </button>
            {isUndoHovered && !isUndoing && (
              <div
                className="absolute top-full right-0 mt-2 px-3 py-[6px] rounded-chip whitespace-nowrap pointer-events-none animate-fade-in motion-reduce:animate-none"
                style={{
                  background: "var(--glass-dense)",
                  backdropFilter: "blur(28px) saturate(1.3)",
                  WebkitBackdropFilter: "blur(28px) saturate(1.3)",
                  border: "1px solid var(--glass-border)",
                }}
              >
                <span className="font-mono text-micro text-text-2 uppercase tracking-wider">
                  {t("undo.tooltip").replace("{label}", topEntry.label)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Search — collapses to a quiet ⌘K affordance (no center box) */}
        <button
          onClick={openSearch}
          aria-label={t("search.ariaLabel", "Open search")}
          className={cn(
            "flex items-center gap-1.5 h-[30px] rounded text-text-3",
            "hover:text-text-2 hover:bg-surface-hover transition-colors",
            "duration-150 ease-smooth motion-reduce:transition-none",
            showShortcutHints ? "px-2" : "w-[30px] justify-center"
          )}
        >
          <Search className="w-[16px] h-[16px] shrink-0" />
          {showShortcutHints && (
            <span className="font-mono text-micro text-text-mute hidden sm:inline">
              {t("search.shortcut", "⌘K")}
            </span>
          )}
        </button>

        {/* Notifications — drives the shared right-edge drawer */}
        <button
          onClick={() => toggleEdgeTab("notifications")}
          aria-label={t("notifications.ariaLabel", "Open notifications")}
          title={
            notifCount > 0
              ? t("notifications.unread", { count: notifCount })
              : t("notifications.label", "Notifications")
          }
          className={cn(
            CONTROL,
            "relative",
            notifOpen && "text-text-2 bg-surface-active"
          )}
        >
          <Bell className="w-[17px] h-[17px]" />
          {notifCount > 0 && (
            <span
              className={cn(
                "absolute top-[4px] right-[5px] h-[7px] w-[7px] rounded-full",
                "ring-[1.5px] ring-background animate-fade-in motion-reduce:animate-none",
                hasCritical ? "bg-rose" : "bg-tan"
              )}
            />
          )}
        </button>

        {/* Divider — actions │ telemetry. Hidden on mobile, where the clock
            drops (redundant with the OS status bar) and the divider would
            float before a lone sync dot. */}
        <span className="mx-1 hidden h-[18px] w-px shrink-0 bg-border sm:block" />

        {/* Telemetry terminus — sync state + deck clock */}
        <div className="flex items-center gap-2">
          <SyncIndicator status={syncStatus} t={t} />
          <DeckClock />
        </div>
      </div>
    </header>
  );
}

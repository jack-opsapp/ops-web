"use client";

/**
 * TopBar (WEB OVERHAUL P2 rebuild).
 *
 * Composition: [mobile hamburger] page title / breadcrumb trail — centered
 * undo + ⌘K search — right sync indicator + clock.
 *
 * Page titles resolve through the route registry's i18n label keys (the
 * old hardcoded English `routeTitles` map was the root cause of the
 * sidebar-"Calendar" / top-bar-"Schedule" drift — it is gone). Nested
 * routes render the breadcrumb trail from the breadcrumb store; the
 * auto-generated parent crumb uses the same registry title.
 */

import {
  Search,
  RefreshCw,
  Check,
  Clock,
  WifiOff,
  Menu,
  Undo2,
  Loader2,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useConnectivity } from "@/lib/hooks/use-connectivity";
import { useDictionary } from "@/i18n/client";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useBreadcrumbStore } from "@/stores/breadcrumb-store";
import { useUndoStore } from "@/stores/undo-store";
import { getTitleKeyForPath } from "@/lib/navigation/route-registry";

// ── Sync indicator ───────────────────────────────────────────────────────────

type SyncStatus = "synced" | "syncing" | "pending" | "offline";

function SyncIndicator({
  status,
  t,
}: {
  status: SyncStatus;
  t: (key: string) => string;
}) {
  const icon = {
    synced: <Check className="w-[14px] h-[14px] shrink-0" />,
    syncing: <RefreshCw className="w-[14px] h-[14px] shrink-0 animate-spin motion-reduce:animate-none" />,
    pending: <Clock className="w-[14px] h-[14px] shrink-0" />,
    offline: <WifiOff className="w-[14px] h-[14px] shrink-0" />,
  }[status];

  const label = {
    synced: t("sync.synced"),
    syncing: t("sync.syncing"),
    pending: t("sync.pending"),
    offline: t("sync.offline"),
  }[status];

  return (
    <div
      className={cn(
        "group flex items-center justify-center h-[40px] px-[12px] rounded-[5px]",
        "font-mono text-[11px] tracking-wider",
        "bg-surface-input border border-border",
        "transition-all duration-150 ease-smooth motion-reduce:transition-none",
        // rose is the error TEXT tone — brick (#93321A) is borders/dots only
        status === "offline" ? "text-rose" : "text-text-3"
      )}
      title={label}
    >
      <span className="max-w-0 overflow-hidden uppercase whitespace-nowrap transition-[max-width,margin] duration-150 ease-smooth motion-reduce:transition-none group-hover:max-w-[80px] group-hover:mr-[6px]">
        {label}
      </span>
      {icon}
    </div>
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
      className="font-mono text-[11px] tracking-[0.08em] text-text-3 tabular-nums select-none"
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

  // Build breadcrumb trail. Root titles come from the registry (i18n).
  const segments = pathname.split("/").filter(Boolean);
  const isNested = segments.length > 1;
  const titleKey = getTitleKeyForPath(pathname);
  const rootTitle = titleKey ? tNav(titleKey) : "";
  const parentRoute = "/" + segments[0];

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
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        <button
          onClick={openMobile}
          className={cn(
            "md:hidden p-2 rounded-[5px]",
            "text-text-3 hover:text-text-2",
            "bg-surface-input hover:bg-surface-hover border border-border",
            "transition-all duration-150 ease-smooth motion-reduce:transition-none"
          )}
          aria-label={t("menu.ariaLabel")}
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
              <button
                onClick={() => router.push(parentRoute)}
                className="font-mono text-micro text-text-3 hover:text-text-2 transition-colors uppercase tracking-[0.16em]"
              >
                {rootTitle}
              </button>
            )}
            <span className="text-text-mute font-mono text-micro">{"//"}</span>
            <span className="font-cakemono font-light text-heading text-text uppercase truncate">
              {entityName || segments[segments.length - 1]}
            </span>
          </div>
        ) : (
          /* Simple title for top-level routes */
          rootTitle && (
            <h1 className="font-cakemono font-light text-heading text-text uppercase">
              {rootTitle}
            </h1>
          )
        )}
      </div>

      {/* Center: Undo + Search */}
      <div className="flex items-center gap-1 mx-auto min-w-0 flex-shrink">
        {/* Undo button — only visible when stack is non-empty */}
        {topEntry && (
          <div className="relative">
            <button
              onClick={handleUndo}
              disabled={isUndoing}
              onMouseEnter={() => setIsUndoHovered(true)}
              onMouseLeave={() => setIsUndoHovered(false)}
              className={cn(
                "flex items-center justify-center h-[40px] w-[40px] rounded-[5px]",
                "bg-surface-input hover:bg-surface-hover border border-border",
                "text-text-3 hover:text-text-2",
                "transition-all duration-150 ease-smooth motion-reduce:transition-none animate-fade-in motion-reduce:animate-none",
                isUndoing && "opacity-50 pointer-events-none"
              )}
              aria-label={t("undo.ariaLabel")}
            >
              {isUndoing ? (
                <Loader2 className="w-[16px] h-[16px] animate-spin motion-reduce:animate-none" />
              ) : (
                <Undo2 className="w-[16px] h-[16px]" />
              )}
            </button>
            {/* Hover tooltip */}
            {isUndoHovered && !isUndoing && (
              <div
                className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-[6px] rounded-[4px] whitespace-nowrap pointer-events-none animate-fade-in motion-reduce:animate-none"
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
        <button
          className={cn(
            "flex items-center gap-1 h-[40px] px-2 rounded-[5px]",
            "bg-surface-input hover:bg-surface-hover border border-border",
            "text-text-3 hover:text-text-2",
            "transition-all duration-150 ease-smooth motion-reduce:transition-none cursor-pointer",
            "min-w-0 w-[140px] sm:w-[200px] shrink"
          )}
          onClick={() => {
            window.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "k",
                metaKey: true,
                bubbles: true,
              })
            );
          }}
          aria-label={t("search.ariaLabel")}
        >
          <Search className="w-[16px] h-[16px] shrink-0" />
          <span className="font-mohave text-body-sm hidden sm:inline">
            {t("search.placeholder")}
          </span>
          {showShortcutHints && (
            <kbd className="ml-auto font-mono text-micro text-text-2 bg-[rgba(255,255,255,0.06)] border border-border rounded-[3px] px-[5px] py-[1px] hidden sm:inline">
              {t("search.shortcut")}
            </kbd>
          )}
        </button>
      </div>

      {/* Right: Sync + clock */}
      <div className="flex items-center gap-1 shrink-0">
        <SyncIndicator status={syncStatus} t={t} />
        <DeckClock />
      </div>
    </header>
  );
}

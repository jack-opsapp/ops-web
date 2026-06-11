"use client";

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

// ── Route → title mapping ────────────────────────────────────────────────────

const routeTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/projects": "Projects",
  "/schedule": "Schedule",
  "/clients": "Clients",

  "/team": "Team",
  "/map": "Map",
  "/pipeline": "Pipeline",
  "/inbox": "Inbox",
  "/estimates": "Estimates",
  "/products": "Products",
  "/inventory": "Inventory",
  "/invoices": "Invoices",
  "/accounting": "Accounting",
  "/settings": "Settings",
};

function getPageTitle(pathname: string): string {
  // Exact match first
  if (routeTitles[pathname]) return routeTitles[pathname];
  // Match first segment for nested routes (e.g. /clients/abc → "Clients")
  const firstSegment = "/" + pathname.split("/").filter(Boolean)[0];
  return routeTitles[firstSegment] ?? "";
}

// ── Sync indicator ───────────────────────────────────────────────────────────

type SyncStatus = "synced" | "syncing" | "pending" | "offline";

function SyncIndicator({ status, t }: { status: SyncStatus; t: (key: string) => string }) {
  const icon = {
    synced: <Check className="w-[14px] h-[14px] shrink-0" />,
    syncing: <RefreshCw className="w-[14px] h-[14px] shrink-0 animate-spin" />,
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
        "group flex items-center justify-center h-[40px] px-[12px] rounded-[4px]",
        "font-mono text-[11px] tracking-wider",
        "bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)]",
        "border border-[rgba(255,255,255,0.06)]",
        "transition-all duration-150",
        status === "offline" ? "text-ops-error" : "text-text-3"
      )}
      title={label}
    >
      <span className="max-w-0 overflow-hidden group-hover:max-w-[80px] group-hover:mr-[6px] transition-all duration-200 ease-out uppercase whitespace-nowrap">
        {label}
      </span>
      {icon}
    </div>
  );
}

// ── TopBar ────────────────────────────────────────────────────────────────────

export function TopBar() {
  const showShortcutHints = usePreferencesStore((s) => s.showShortcutHints);
  const { t } = useDictionary("topbar");
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
        if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;

        e.preventDefault();
        const store = useUndoStore.getState();
        if (!store.isUndoing && store.stack.length > 0) store.undo();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Build breadcrumb trail
  const segments = pathname.split("/").filter(Boolean);
  const isNested = segments.length > 1;
  const rootTitle = getPageTitle(pathname); // always resolves to parent title
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
            "md:hidden p-2 rounded-[4px]",
            "text-text-3 hover:text-text-2",
            "bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)]",
            "border border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.14)]",
            "transition-all duration-150"
          )}
          aria-label={t("menu.ariaLabel")}
        >
          <Menu className="w-[18px] h-[18px]" />
        </button>

        {isNested ? (
          /* Breadcrumb trail for nested routes */
          <div className="flex items-center gap-[6px] min-w-0">
            {parentCrumbs ? (
              /* Custom parent crumbs (set by detail pages) */
              parentCrumbs.map((crumb, i) => (
                <div key={i} className="flex items-center gap-[6px]">
                  {i > 0 && <span className="text-text-mute font-mono text-body-sm">/</span>}
                  {crumb.href ? (
                    <button
                      onClick={() => router.push(crumb.href!)}
                      className="font-mohave text-body-sm text-text-3 hover:text-text-2 transition-colors uppercase tracking-wider"
                    >
                      {crumb.label}
                    </button>
                  ) : (
                    <span className="font-mohave text-body-sm text-text-3 uppercase tracking-wider">
                      {crumb.label}
                    </span>
                  )}
                </div>
              ))
            ) : (
              /* Auto-generated: parent route title */
              <button
                onClick={() => router.push(parentRoute)}
                className="font-mohave text-body-sm text-text-3 hover:text-text-2 transition-colors uppercase tracking-wider"
              >
                {rootTitle}
              </button>
            )}
            <span className="text-text-mute font-mono text-body-sm">/</span>
            <span className="font-mohave text-heading text-text uppercase tracking-wider truncate">
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
      <div className="flex items-center gap-[6px] mx-auto min-w-0 flex-shrink">
        {/* Undo button — only visible when stack is non-empty */}
        {topEntry && (
          <div className="relative">
            <button
              onClick={handleUndo}
              disabled={isUndoing}
              onMouseEnter={() => setIsUndoHovered(true)}
              onMouseLeave={() => setIsUndoHovered(false)}
              className={cn(
                "flex items-center justify-center h-[40px] w-[40px] rounded-[4px]",
                "bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)]",
                "border border-[rgba(255,255,255,0.06)]",
                "text-text-3 hover:border-[rgba(255,255,255,0.14)] hover:text-text-2",
                "transition-all duration-150 animate-fade-in",
                isUndoing && "opacity-50 pointer-events-none"
              )}
              aria-label={t("undo.ariaLabel")}
            >
              {isUndoing
                ? <Loader2 className="w-[16px] h-[16px] animate-spin" />
                : <Undo2 className="w-[16px] h-[16px]" />
              }
            </button>
            {/* Hover tooltip */}
            {isUndoHovered && !isUndoing && (
              <div
                className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-[6px] rounded-[4px] whitespace-nowrap pointer-events-none animate-fade-in"
                style={{
                  background: "var(--surface-glass-dense)",
                  backdropFilter: "blur(12px) saturate(1.2)",
                  WebkitBackdropFilter: "blur(12px) saturate(1.2)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
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
            "flex items-center gap-[6px] h-[40px] px-2 rounded-[4px]",
            "bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)]",
            "border border-[rgba(255,255,255,0.06)]",
            "text-text-3 hover:border-[rgba(255,255,255,0.14)] hover:text-text-2",
            "transition-all duration-150 cursor-pointer",
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
          <span className="font-mohave text-body-sm hidden sm:inline">{t("search.placeholder")}</span>
          {showShortcutHints && (
            <kbd className="ml-auto font-mono text-micro text-text-mute bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] rounded px-[5px] py-[1px] hidden sm:inline">
              {t("search.shortcut")}
            </kbd>
          )}
        </button>
      </div>

      {/* Right: Sync */}
      <div className="flex items-center gap-[6px] shrink-0">
        <SyncIndicator status={syncStatus} t={t} />
      </div>
    </header>
  );
}

"use client";

import {
  Search,
  RefreshCw,
  Check,
  Clock,
  WifiOff,
  Menu,
} from "lucide-react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useConnectivity } from "@/lib/hooks/use-connectivity";
import { useDictionary } from "@/i18n/client";
import { NotificationRail } from "./notification-rail";
import { useSidebarStore } from "@/stores/sidebar-store";

type SyncStatus = "synced" | "syncing" | "pending" | "offline";

function SyncIndicator({ status, t }: { status: SyncStatus; t: (key: string) => string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-[6px] px-2 py-[6px] rounded-[4px]",
        "font-mono text-[11px] tracking-wider",
        "bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)]",
        "border border-[rgba(255,255,255,0.06)]",
        status === "offline" ? "text-ops-error" : "text-text-tertiary"
      )}
      title={
        status === "synced"
          ? t("sync.syncedTitle")
          : status === "syncing"
            ? t("sync.syncingTitle")
            : status === "offline"
              ? t("sync.offlineTitle")
              : t("sync.pendingTitle")
      }
    >
      {status === "synced" && (
        <>
          <Check className="w-[14px] h-[14px]" />
          <span className="hidden xl:inline uppercase">{t("sync.synced")}</span>
        </>
      )}
      {status === "syncing" && (
        <>
          <RefreshCw className="w-[14px] h-[14px] animate-spin" />
          <span className="hidden xl:inline uppercase">{t("sync.syncing")}</span>
        </>
      )}
      {status === "pending" && (
        <>
          <Clock className="w-[14px] h-[14px]" />
          <span className="hidden xl:inline uppercase">{t("sync.pending")}</span>
        </>
      )}
      {status === "offline" && (
        <>
          <WifiOff className="w-[14px] h-[14px]" />
          <span className="hidden xl:inline uppercase">{t("sync.offline")}</span>
        </>
      )}
    </div>
  );
}

export function TopBar() {
  const showShortcutHints = usePreferencesStore((s) => s.showShortcutHints);
  const { t } = useDictionary("topbar");
  const openMobile = useSidebarStore((s) => s.openMobile);
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
    <header className="h-[56px] flex items-center justify-between px-3 shrink-0 relative bg-transparent min-w-0">
      {/* Left: Hamburger (mobile) + Notification Rail */}
      <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
        <button
          onClick={openMobile}
          className={cn(
            "md:hidden p-2 rounded-[4px]",
            "text-text-tertiary hover:text-text-secondary",
            "bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)]",
            "border border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.14)]",
            "transition-all duration-150"
          )}
          aria-label={t("menu.ariaLabel")}
        >
          <Menu className="w-[18px] h-[18px]" />
        </button>
        <NotificationRail />
      </div>

      {/* Right: Search + Sync */}
      <div className="flex items-center gap-[6px] shrink-0">
        {/* Search trigger - styled as input, opens CommandPalette */}
        <button
          className={cn(
            "flex items-center gap-[6px] px-2 py-[8px] rounded-[4px]",
            "bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)]",
            "border border-[rgba(255,255,255,0.06)]",
            "text-text-tertiary hover:border-[rgba(255,255,255,0.14)] hover:text-text-secondary",
            "transition-all duration-150 cursor-pointer",
            "min-w-[140px] sm:min-w-[200px]"
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
            <kbd className="ml-auto font-mono text-[10px] text-text-disabled bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] rounded px-[5px] py-[1px] hidden sm:inline">
              {t("search.shortcut")}
            </kbd>
          )}
        </button>

        {/* Sync status */}
        <SyncIndicator status={syncStatus} t={t} />

      </div>
    </header>
  );
}

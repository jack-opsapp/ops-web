"use client";

import {
  Search,
  Bell,
  RefreshCw,
  Check,
  Clock,
  WifiOff,
} from "lucide-react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useNotificationRailStore } from "@/stores/notification-rail-store";
import { useNotifications } from "@/lib/hooks/use-notifications";
import { useConnectivity } from "@/lib/hooks/use-connectivity";
import { useDictionary } from "@/i18n/client";
import { NotificationRail } from "./notification-rail";

type SyncStatus = "synced" | "syncing" | "pending" | "offline";

function SyncIndicator({ status, t }: { status: SyncStatus; t: (key: string) => string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-[6px] px-1 py-[6px] rounded",
        "font-mono text-[11px] tracking-wider",
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
  const openModal = useNotificationRailStore((s) => s.openModal);
  const { data: notifications = [] } = useNotifications();
  const unreadCount = notifications.length;

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
    <header className="h-[56px] flex items-center justify-between px-3 shrink-0 relative bg-transparent">
      {/* Left: Notification Rail */}
      <NotificationRail />

      {/* Right: Search + Sync + Notifications Bell */}
      <div className="flex items-center gap-1">
        {/* Search trigger - styled as input, opens CommandPalette */}
        <button
          className={cn(
            "flex items-center gap-[6px] px-1.5 py-[8px] rounded",
            "bg-[rgba(10,10,10,0.40)] backdrop-blur-sm border border-[rgba(255,255,255,0.10)]",
            "text-text-tertiary hover:border-[rgba(255,255,255,0.18)] hover:text-text-secondary",
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

        {/* Notifications bell — opens modal */}
        <button
          onClick={openModal}
          className="relative p-[10px] rounded text-text-tertiary hover:text-text-secondary hover:bg-[rgba(255,255,255,0.04)] transition-all"
          title={t("notifications.title")}
          aria-label={t("notifications.ariaLabel")}
        >
          <Bell className="w-[18px] h-[18px]" />

          {/* Unread dot */}
          {unreadCount > 0 && (
            <span
              className="absolute top-[8px] right-[8px] w-[6px] h-[6px] rounded-full"
              style={{ backgroundColor: "#93321A" }}
            />
          )}
        </button>
      </div>
    </header>
  );
}

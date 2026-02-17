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
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { usePageActionsStore } from "@/stores/page-actions-store";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useConnectivity } from "@/lib/hooks/use-connectivity";

type SyncStatus = "synced" | "syncing" | "pending" | "offline";

function SyncIndicator({ status }: { status: SyncStatus }) {
  return (
    <div
      className={cn(
        "flex items-center gap-[6px] px-1 py-[6px] rounded",
        "font-mono text-[11px] tracking-wider",
        status === "offline" ? "text-ops-error" : "text-text-tertiary"
      )}
      title={
        status === "synced"
          ? "All data synced"
          : status === "syncing"
            ? "Syncing data..."
            : status === "offline"
              ? "No internet connection"
              : "Changes pending sync"
      }
    >
      {status === "synced" && (
        <>
          <Check className="w-[14px] h-[14px]" />
          <span className="hidden xl:inline uppercase">Synced</span>
        </>
      )}
      {status === "syncing" && (
        <>
          <RefreshCw className="w-[14px] h-[14px] animate-spin" />
          <span className="hidden xl:inline uppercase">Syncing</span>
        </>
      )}
      {status === "pending" && (
        <>
          <Clock className="w-[14px] h-[14px]" />
          <span className="hidden xl:inline uppercase">Pending</span>
        </>
      )}
      {status === "offline" && (
        <>
          <WifiOff className="w-[14px] h-[14px]" />
          <span className="hidden xl:inline uppercase">Offline</span>
        </>
      )}
    </div>
  );
}

export function TopBar() {
  const pageActions = usePageActionsStore((s) => s.actions);
  const showShortcutHints = usePreferencesStore((s) => s.showShortcutHints);

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
    <header className="h-[56px] flex items-center justify-between px-3 shrink-0 relative">
      {/* Left: Page Action Buttons */}
      <TooltipProvider delayDuration={300}>
        <div className="flex items-center gap-1">
          {pageActions.map((action, i) => {
            const btn = (
              <Button
                key={i}
                variant="secondary"
                size="sm"
                className="gap-1"
                onClick={action.onClick}
              >
                {action.icon && <action.icon className="w-[14px] h-[14px]" />}
                {action.label}
                {showShortcutHints && action.shortcut && (
                  <kbd className="font-mono text-[10px] text-text-disabled opacity-60 ml-[2px]">
                    {action.shortcut}
                  </kbd>
                )}
              </Button>
            );

            if (action.shortcut) {
              return (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>{btn}</TooltipTrigger>
                  <TooltipContent>{action.shortcut}</TooltipContent>
                </Tooltip>
              );
            }
            return btn;
          })}
        </div>
      </TooltipProvider>

      {/* Right: Search + Sync + Notifications */}
      <div className="flex items-center gap-1">
        {/* Search trigger - styled as input, opens CommandPalette */}
        <button
          className={cn(
            "flex items-center gap-[6px] px-1.5 py-[8px] rounded-lg",
            "bg-background-input border border-border",
            "text-text-tertiary hover:border-ops-accent hover:text-text-secondary",
            "transition-all duration-150 cursor-pointer",
            "min-w-[200px]"
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
          aria-label="Open search"
        >
          <Search className="w-[16px] h-[16px] shrink-0" />
          <span className="font-mohave text-body-sm">Search...</span>
          <kbd className="ml-auto font-mono text-[10px] text-text-disabled bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] rounded px-[5px] py-[1px]">
            ⌘K
          </kbd>
        </button>

        {/* Sync status */}
        <SyncIndicator status={syncStatus} />

        {/* Notifications */}
        <button
          className="relative p-[10px] rounded text-text-tertiary hover:text-text-secondary hover:bg-[rgba(255,255,255,0.04)] transition-all"
          title="Notifications"
          aria-label="Notifications"
        >
          <Bell className="w-[18px] h-[18px]" />
        </button>
      </div>
    </header>
  );
}

"use client";

import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import {
  Search,
  Bell,
  RefreshCw,
  Check,
  Clock,
  ChevronRight,
  LogOut,
  User,
  Settings,
  WifiOff,
} from "lucide-react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import { useAuthStore } from "@/lib/store/auth-store";
import { signOut } from "@/lib/firebase/auth";
import { Button } from "@/components/ui/button";
import { usePageActionsStore } from "@/stores/page-actions-store";
import { useConnectivity } from "@/lib/hooks/use-connectivity";

const routeTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/projects": "Projects",
  "/calendar": "Calendar",
  "/clients": "Clients",
  "/job-board": "Job Board",
  "/team": "Team",
  "/map": "Map",
  "/pipeline": "Pipeline",
  "/invoices": "Invoices",
  "/accounting": "Accounting",
  "/settings": "Settings",
};

// Route-specific action buttons
interface PageAction {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}

function getBreadcrumbs(pathname: string): { label: string; href?: string }[] {
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; href?: string }[] = [];

  let currentPath = "";
  for (const segment of segments) {
    currentPath += `/${segment}`;
    const title = routeTitles[currentPath];
    if (title) {
      crumbs.push({ label: title, href: currentPath });
    } else if (segment === "new") {
      crumbs.push({ label: "New" });
    } else if (segment.match(/^[a-zA-Z0-9_-]+$/)) {
      crumbs.push({ label: segment });
    }
  }

  return crumbs;
}

function getPageTitle(pathname: string): string | null {
  // Find the first matching route title
  for (const [route, title] of Object.entries(routeTitles)) {
    if (pathname === route || pathname.startsWith(route + "/")) {
      return title;
    }
  }
  return null;
}

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

export interface TopBarProps {
  pageActions?: PageAction[];
}

export function TopBar({ pageActions: propActions }: TopBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const currentUser = useAuthStore((s) => s.currentUser);
  const logout = useAuthStore((s) => s.logout);
  const storeActions = usePageActionsStore((s) => s.actions);
  const pageActions = propActions ?? storeActions;
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const breadcrumbs = useMemo(() => getBreadcrumbs(pathname), [pathname]);
  const pageTitle = useMemo(() => getPageTitle(pathname), [pathname]);

  // Live sync status from TanStack Query + connectivity
  const isOnline = useConnectivity();
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();
  const syncStatus: SyncStatus = !isOnline ? "offline" : isMutating > 0 ? "pending" : isFetching > 0 ? "syncing" : "synced";

  // Close user menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cmd+K is handled by CommandPalette component directly

  const handleSignOut = useCallback(async () => {
    setUserMenuOpen(false);
    document.cookie = "ops-auth-token=; path=/; max-age=0";
    document.cookie = "__session=; path=/; max-age=0";
    logout();
    try { await signOut(); } catch {}
    window.location.href = "/login";
  }, [logout]);

  return (
    <header
      className={cn(
        "h-[56px] ultrathin-material-dark border-b border-[rgba(255,255,255,0.2)]",
        "flex items-center justify-between px-3 shrink-0",
        "relative"
      )}
    >
      {/* Left: Page Title + Breadcrumbs (detail pages only) */}
      <div className="flex items-center gap-2 min-w-0">
        {breadcrumbs.length > 1 ? (
          /* Detail pages: show breadcrumbs */
          <div className="flex items-center gap-[6px]">
            {breadcrumbs.map((crumb, index) => (
              <div key={index} className="flex items-center gap-[6px]">
                {index > 0 && (
                  <ChevronRight className="w-[14px] h-[14px] text-text-disabled shrink-0" />
                )}
                {crumb.href && index < breadcrumbs.length - 1 ? (
                  <button
                    onClick={() => router.push(crumb.href!)}
                    className="font-mohave text-body-sm text-text-tertiary hover:text-text-secondary transition-colors truncate"
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span className="font-mohave text-body-sm text-text-primary truncate uppercase tracking-wider">
                    {crumb.label}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : pageTitle ? (
          /* Top-level pages: single title only */
          <h1 className="font-mohave text-heading text-text-primary uppercase tracking-wider truncate">
            {pageTitle}
          </h1>
        ) : null}
      </div>

      {/* Right: Page Actions + Global Actions */}
      <div className="flex items-center gap-1">
        {/* Contextual page actions */}
        {pageActions && pageActions.length > 0 && (
          <div className="flex items-center gap-1 mr-1">
            {pageActions.map((action, i) => (
              <Button
                key={i}
                variant="primary"
                size="sm"
                className="gap-1"
                onClick={action.onClick}
              >
                {action.icon && <action.icon className="w-[14px] h-[14px]" />}
                {action.label}
              </Button>
            ))}
          </div>
        )}

        {/* Search trigger */}
        <button
          className="flex items-center gap-[6px] px-1 py-[6px] rounded text-text-tertiary hover:text-text-secondary hover:bg-[rgba(255,255,255,0.04)] transition-all"
          title="Search (Cmd+K)"
          aria-label="Open search"
          onClick={() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
          }}
        >
          <Search className="w-[18px] h-[18px]" />
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

        {/* User menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-1 p-[6px] rounded hover:bg-[rgba(255,255,255,0.04)] transition-all"
            aria-label="User menu"
          >
            <div className="w-[28px] h-[28px] rounded-full bg-[rgba(255,255,255,0.08)] flex items-center justify-center overflow-hidden">
              {currentUser?.profileImageURL ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={currentUser.profileImageURL}
                  alt=""
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="font-mohave text-body-sm text-text-secondary">
                  {currentUser?.firstName?.charAt(0)?.toUpperCase() || "U"}
                </span>
              )}
            </div>
          </button>

          {/* Dropdown - frosted glass */}
          {userMenuOpen && (
            <div className="absolute right-0 top-full mt-[4px] w-[200px] ultrathin-material-dark rounded shadow-floating z-50 animate-scale-in overflow-hidden">
              <div className="px-1.5 py-1 border-b border-[rgba(255,255,255,0.15)]">
                <p className="font-mohave text-body-sm text-text-primary truncate">
                  {currentUser ? `${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim() || "User" : "User"}
                </p>
                <p className="font-mono text-[11px] text-text-tertiary truncate">
                  {currentUser?.email}
                </p>
              </div>
              <div className="py-[4px]">
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    router.push("/settings");
                  }}
                  className="flex items-center gap-1 w-full px-1.5 py-[8px] text-text-secondary hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                >
                  <User className="w-[16px] h-[16px]" />
                  <span className="font-mohave text-body-sm uppercase">Profile</span>
                </button>
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    router.push("/settings");
                  }}
                  className="flex items-center gap-1 w-full px-1.5 py-[8px] text-text-secondary hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                >
                  <Settings className="w-[16px] h-[16px]" />
                  <span className="font-mohave text-body-sm uppercase">Settings</span>
                </button>
                <div className="border-t border-[rgba(255,255,255,0.15)] my-[4px]" />
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-1 w-full px-1.5 py-[8px] text-ops-error hover:bg-ops-error-muted transition-colors"
                >
                  <LogOut className="w-[16px] h-[16px]" />
                  <span className="font-mohave text-body-sm uppercase">Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

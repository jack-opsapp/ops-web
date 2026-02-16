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
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useAuthStore } from "@/lib/store/auth-store";
import { signOut } from "@/lib/firebase/auth";

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

type SyncStatus = "synced" | "syncing" | "pending";

function SyncIndicator({ status }: { status: SyncStatus }) {
  return (
    <div
      className={cn(
        "flex items-center gap-[6px] px-1 py-[6px] rounded",
        "font-mono text-[11px] tracking-wider text-[#5C6070]"
      )}
      title={
        status === "synced"
          ? "All data synced"
          : status === "syncing"
            ? "Syncing data..."
            : "Changes pending sync"
      }
    >
      {status === "synced" && (
        <>
          <Check className="w-[14px] h-[14px]" />
          <span className="hidden xl:inline">Synced</span>
        </>
      )}
      {status === "syncing" && (
        <>
          <RefreshCw className="w-[14px] h-[14px] animate-spin" />
          <span className="hidden xl:inline">Syncing</span>
        </>
      )}
      {status === "pending" && (
        <>
          <Clock className="w-[14px] h-[14px]" />
          <span className="hidden xl:inline">Pending</span>
        </>
      )}
    </div>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const currentUser = useAuthStore((s) => s.currentUser);
  const logout = useAuthStore((s) => s.logout);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const breadcrumbs = useMemo(() => getBreadcrumbs(pathname), [pathname]);

  // For now, sync status is static. Will be wired to real sync later.
  const syncStatus: SyncStatus = "synced";

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

  // Cmd+K search shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        // TODO: open command palette
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSignOut = useCallback(async () => {
    setUserMenuOpen(false);
    document.cookie = "ops-auth-token=; path=/; max-age=0";
    logout();
    try { await signOut(); } catch {}
    router.push("/login");
  }, [router, logout]);

  return (
    <header
      className={cn(
        "h-[56px] ultrathin-material-dark border-b border-border",
        "flex items-center justify-between px-3 shrink-0",
        "relative"
      )}
    >
      {/* Left: Breadcrumbs only */}
      <div className="flex items-center gap-[6px] min-w-0">
        {breadcrumbs.map((crumb, index) => (
          <div key={index} className="flex items-center gap-[6px]">
            {index > 0 && (
              <ChevronRight className="w-[14px] h-[14px] text-text-disabled shrink-0" />
            )}
            {crumb.href ? (
              <button
                onClick={() => router.push(crumb.href!)}
                className={cn(
                  "font-mohave text-body-sm truncate",
                  index === breadcrumbs.length - 1
                    ? "text-text-primary"
                    : "text-[#5C6070] hover:text-[#8B8F9A] transition-colors"
                )}
              >
                {crumb.label}
              </button>
            ) : (
              <span className="font-mohave text-body-sm text-text-primary truncate">
                {crumb.label}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
        {/* Search trigger */}
        <button
          className="flex items-center gap-[6px] px-1 py-[6px] rounded text-[#5C6070] hover:text-[#8B8F9A] hover:bg-[rgba(255,255,255,0.04)] transition-all"
          title="Search (Cmd+K)"
          onClick={() => {
            // TODO: open command palette
          }}
        >
          <Search className="w-[18px] h-[18px]" />
        </button>

        {/* Sync status */}
        <SyncIndicator status={syncStatus} />

        {/* Notifications */}
        <button
          className="relative p-[10px] rounded text-[#5C6070] hover:text-[#8B8F9A] hover:bg-[rgba(255,255,255,0.04)] transition-all"
          title="Notifications"
        >
          <Bell className="w-[18px] h-[18px]" />
          {/* Unread badge - subtle white dot */}
          <span className="absolute top-[6px] right-[6px] w-[6px] h-[6px] rounded-full bg-[rgba(255,255,255,0.4)]" />
        </button>

        {/* User menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-1 p-[6px] rounded hover:bg-[rgba(255,255,255,0.04)] transition-all"
          >
            <div className="w-[28px] h-[28px] rounded-full bg-[rgba(255,255,255,0.08)] flex items-center justify-center overflow-hidden">
              {currentUser?.profileImageURL ? (
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
              <div className="px-1.5 py-1 border-b border-[rgba(255,255,255,0.06)]">
                <p className="font-mohave text-body-sm text-text-primary truncate">
                  {currentUser ? `${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim() || "User" : "User"}
                </p>
                <p className="font-mono text-[11px] text-[#5C6070] truncate">
                  {currentUser?.email}
                </p>
              </div>
              <div className="py-[4px]">
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    router.push("/settings");
                  }}
                  className="flex items-center gap-1 w-full px-1.5 py-[8px] text-[#8B8F9A] hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                >
                  <User className="w-[16px] h-[16px]" />
                  <span className="font-mohave text-body-sm">Profile</span>
                </button>
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    router.push("/settings");
                  }}
                  className="flex items-center gap-1 w-full px-1.5 py-[8px] text-[#8B8F9A] hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                >
                  <Settings className="w-[16px] h-[16px]" />
                  <span className="font-mohave text-body-sm">Settings</span>
                </button>
                <div className="border-t border-[rgba(255,255,255,0.06)] my-[4px]" />
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-1 w-full px-1.5 py-[8px] text-ops-error hover:bg-ops-error-muted transition-colors"
                >
                  <LogOut className="w-[16px] h-[16px]" />
                  <span className="font-mohave text-body-sm">Sign out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

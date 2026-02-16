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
import { useAuthStore } from "@/stores/auth-store";
import { signOut } from "@/lib/firebase/auth";

const routeTitles: Record<string, string> = {
  "/dashboard": "DASHBOARD",
  "/projects": "PROJECTS",
  "/calendar": "CALENDAR",
  "/clients": "CLIENTS",
  "/job-board": "JOB BOARD",
  "/team": "TEAM",
  "/map": "MAP",
  "/pipeline": "PIPELINE",
  "/invoices": "INVOICES",
  "/accounting": "ACCOUNTING",
  "/settings": "SETTINGS",
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
      crumbs.push({ label: "NEW" });
    } else if (segment.match(/^[a-zA-Z0-9_-]+$/)) {
      crumbs.push({ label: segment.toUpperCase() });
    }
  }

  return crumbs;
}

function getPageTitle(pathname: string): string {
  // Check exact match first
  if (routeTitles[pathname]) return routeTitles[pathname];

  // Check prefix match (e.g., /projects/new -> PROJECTS)
  for (const [route, title] of Object.entries(routeTitles)) {
    if (pathname.startsWith(route)) return title;
  }

  return "OPS";
}

type SyncStatus = "synced" | "syncing" | "pending";

function SyncIndicator({ status }: { status: SyncStatus }) {
  return (
    <div
      className={cn(
        "flex items-center gap-[6px] px-1 py-[6px] rounded",
        "font-mono text-[11px] uppercase tracking-wider",
        status === "synced" && "text-ops-live",
        status === "syncing" && "text-ops-accent",
        status === "pending" && "text-ops-amber"
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
          <span className="hidden xl:inline">SYNCED</span>
          <span className="w-[6px] h-[6px] rounded-full bg-ops-live animate-pulse-live" />
        </>
      )}
      {status === "syncing" && (
        <>
          <RefreshCw className="w-[14px] h-[14px] animate-spin" />
          <span className="hidden xl:inline">SYNCING</span>
        </>
      )}
      {status === "pending" && (
        <>
          <Clock className="w-[14px] h-[14px]" />
          <span className="hidden xl:inline">PENDING</span>
        </>
      )}
    </div>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const breadcrumbs = useMemo(() => getBreadcrumbs(pathname), [pathname]);
  const pageTitle = useMemo(() => getPageTitle(pathname), [pathname]);

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
    await signOut();
    router.push("/login");
  }, [router]);

  return (
    <header
      className={cn(
        "h-[56px] bg-background-panel border-b border-border",
        "flex items-center justify-between px-3 shrink-0",
        "relative"
      )}
      style={{
        boxShadow: "0 1px 8px rgba(65, 115, 148, 0.08)",
      }}
    >
      {/* Left: Breadcrumbs */}
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
                  "font-kosugi text-caption-sm uppercase tracking-widest truncate",
                  index === breadcrumbs.length - 1
                    ? "text-text-primary"
                    : "text-text-tertiary hover:text-text-secondary transition-colors"
                )}
              >
                {crumb.label}
              </button>
            ) : (
              <span className="font-kosugi text-caption-sm text-text-primary uppercase tracking-widest truncate">
                {crumb.label}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Center: Page title */}
      <h1 className="absolute left-1/2 -translate-x-1/2 font-mohave text-heading text-text-primary tracking-wider hidden md:block">
        {pageTitle}
      </h1>

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
        {/* Search trigger */}
        <button
          className="flex items-center gap-[6px] px-1 py-[6px] rounded text-text-tertiary hover:text-text-secondary hover:bg-background-elevated transition-all"
          title="Search (Cmd+K)"
          onClick={() => {
            // TODO: open command palette
          }}
        >
          <Search className="w-[18px] h-[18px]" />
          <kbd className="hidden lg:inline-block font-mono text-[10px] text-text-disabled bg-background px-[6px] py-[2px] rounded-sm border border-border-subtle">
            {"\u2318"}K
          </kbd>
        </button>

        {/* Sync status */}
        <SyncIndicator status={syncStatus} />

        {/* Notifications */}
        <button
          className="relative p-[10px] rounded text-text-tertiary hover:text-text-secondary hover:bg-background-elevated transition-all"
          title="Notifications"
        >
          <Bell className="w-[18px] h-[18px]" />
          {/* Unread badge */}
          <span className="absolute top-[6px] right-[6px] w-[8px] h-[8px] rounded-full bg-ops-amber border-2 border-background-panel" />
        </button>

        {/* User menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-1 p-[6px] rounded hover:bg-background-elevated transition-all"
          >
            <div className="w-[28px] h-[28px] rounded-full bg-ops-accent-muted flex items-center justify-center overflow-hidden">
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt=""
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="font-mohave text-body-sm text-ops-accent">
                  {user?.displayName?.charAt(0)?.toUpperCase() || "U"}
                </span>
              )}
            </div>
          </button>

          {/* Dropdown */}
          {userMenuOpen && (
            <div className="absolute right-0 top-full mt-[4px] w-[200px] bg-background-panel border border-border rounded shadow-floating z-50 animate-scale-in overflow-hidden">
              <div className="px-1.5 py-1 border-b border-border-subtle">
                <p className="font-mohave text-body-sm text-text-primary truncate">
                  {user?.displayName || "User"}
                </p>
                <p className="font-mono text-[11px] text-text-tertiary truncate">
                  {user?.email}
                </p>
              </div>
              <div className="py-[4px]">
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    router.push("/settings");
                  }}
                  className="flex items-center gap-1 w-full px-1.5 py-[8px] text-text-secondary hover:text-text-primary hover:bg-background-elevated transition-colors"
                >
                  <User className="w-[16px] h-[16px]" />
                  <span className="font-mohave text-body-sm">Profile</span>
                </button>
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    router.push("/settings");
                  }}
                  className="flex items-center gap-1 w-full px-1.5 py-[8px] text-text-secondary hover:text-text-primary hover:bg-background-elevated transition-colors"
                >
                  <Settings className="w-[16px] h-[16px]" />
                  <span className="font-mohave text-body-sm">Settings</span>
                </button>
                <div className="border-t border-border-subtle my-[4px]" />
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

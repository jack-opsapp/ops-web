"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import Image from "next/image";
import {
  LayoutDashboard,
  FolderKanban,
  CalendarDays,
  Users,
  Columns3,
  UserCog,
  MapPin,
  GitBranch,
  Receipt,
  Calculator,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { signOut } from "@/lib/firebase/auth";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, shortcut: "1" },
  { label: "Projects", href: "/projects", icon: FolderKanban, shortcut: "2" },
  { label: "Calendar", href: "/calendar", icon: CalendarDays, shortcut: "3" },
  { label: "Clients", href: "/clients", icon: Users, shortcut: "4" },
  { label: "Job Board", href: "/job-board", icon: Columns3, shortcut: "5" },
  { label: "Team", href: "/team", icon: UserCog, shortcut: "6" },
  { label: "Map", href: "/map", icon: MapPin, shortcut: "7" },
  { label: "Pipeline", href: "/pipeline", icon: GitBranch, shortcut: "8" },
  { label: "Invoices", href: "/invoices", icon: Receipt, shortcut: "9" },
  { label: "Accounting", href: "/accounting", icon: Calculator },
  { label: "Settings", href: "/settings", icon: Settings },
];

function NavItemButton({
  item,
  isActive,
  isCollapsed,
}: {
  item: NavItem;
  isActive: boolean;
  isCollapsed: boolean;
}) {
  const router = useRouter();

  return (
    <button
      onClick={() => router.push(item.href)}
      title={isCollapsed ? item.label : undefined}
      className={cn(
        "group relative flex items-center w-full rounded transition-all duration-150",
        "text-text-secondary hover:text-text-primary hover:bg-background-elevated",
        isCollapsed ? "justify-center px-0 py-1.5 mx-auto" : "gap-1.5 px-1.5 py-1",
        isActive && [
          "text-text-primary bg-ops-accent-muted",
          "border-l-2 border-l-ops-accent",
        ],
        !isActive && "border-l-2 border-l-transparent"
      )}
    >
      <item.icon
        className={cn(
          "shrink-0 w-[20px] h-[20px] transition-colors",
          isActive ? "text-ops-accent" : "text-text-tertiary group-hover:text-text-secondary"
        )}
      />
      {!isCollapsed && (
        <>
          <span className="font-mohave text-body-sm truncate">{item.label}</span>
          <span className="ml-auto flex items-center gap-1">
            {item.shortcut && (
              <kbd className="hidden lg:inline-block font-mono text-[10px] text-text-disabled bg-background-panel px-[6px] py-[2px] rounded-sm border border-border-subtle">
                {item.shortcut}
              </kbd>
            )}
          </span>
        </>
      )}
    </button>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { isCollapsed, toggle } = useSidebarStore();
  const currentUser = useAuthStore((s) => s.currentUser);

  const handleSignOut = useCallback(async () => {
    await signOut();
    router.push("/login");
  }, [router]);

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 h-screen z-40",
        "ultrathin-material-dark border-r border-border",
        "flex flex-col transition-all duration-200 ease-out",
        isCollapsed ? "w-[72px]" : "w-[256px]"
      )}
    >
      {/* Logo Section */}
      <div
        className={cn(
          "flex items-center h-[56px] border-b border-border shrink-0",
          isCollapsed ? "justify-center px-1" : "px-2 gap-1"
        )}
      >
        <Image
          src="/images/ops-logo-white.png"
          alt="OPS"
          width={isCollapsed ? 36 : 80}
          height={isCollapsed ? 14 : 32}
          className="select-none"
          priority
        />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-1 px-1 space-y-[2px]">
        {navItems.map((item) => (
          <NavItemButton
            key={item.href}
            item={item}
            isActive={isActive(item.href)}
            isCollapsed={isCollapsed}
          />
        ))}
      </nav>

      {/* Bottom Section */}
      <div className="border-t border-border p-1 space-y-1 shrink-0">
        {/* Collapse toggle */}
        <button
          onClick={toggle}
          className={cn(
            "flex items-center w-full rounded transition-all duration-150",
            "text-text-tertiary hover:text-text-secondary hover:bg-background-elevated",
            isCollapsed ? "justify-center py-1" : "gap-1.5 px-1.5 py-1"
          )}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="w-[18px] h-[18px]" />
          ) : (
            <>
              <PanelLeftClose className="w-[18px] h-[18px]" />
              <span className="font-mohave text-body-sm">Collapse</span>
              <kbd className="ml-auto hidden lg:inline-block font-mono text-[10px] text-text-disabled bg-background-panel px-[6px] py-[2px] rounded-sm border border-border-subtle">
                {"\u2318"}B
              </kbd>
            </>
          )}
        </button>

        {/* User section */}
        <div
          className={cn(
            "flex items-center rounded bg-background-card-dark p-1",
            isCollapsed ? "justify-center" : "gap-1.5"
          )}
        >
          {/* Avatar */}
          <div className="shrink-0 w-[32px] h-[32px] rounded-full bg-ops-accent-muted flex items-center justify-center overflow-hidden">
            {currentUser?.profileImageURL ? (
              <img
                src={currentUser.profileImageURL}
                alt={currentUser.firstName || "User"}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="font-mohave text-body-sm text-ops-accent">
                {currentUser?.firstName?.charAt(0)?.toUpperCase() || currentUser?.email?.charAt(0)?.toUpperCase() || "U"}
              </span>
            )}
          </div>

          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <p className="font-mohave text-body-sm text-text-primary truncate">
                {currentUser ? `${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim() || currentUser.email : "User"}
              </p>
              <span className="inline-block font-kosugi text-[10px] text-ops-accent bg-ops-accent-muted px-[6px] py-[1px] rounded-sm uppercase tracking-wider">
                Admin
              </span>
            </div>
          )}

          {!isCollapsed && (
            <button
              onClick={handleSignOut}
              className="shrink-0 p-[6px] rounded text-text-tertiary hover:text-ops-error hover:bg-ops-error-muted transition-colors"
              title="Sign out"
            >
              <LogOut className="w-[16px] h-[16px]" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

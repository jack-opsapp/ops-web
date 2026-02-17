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
  ChevronLeft,
  ChevronRight,
  LogOut,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { signOut } from "@/lib/firebase/auth";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Calendar", href: "/calendar", icon: CalendarDays },
  { label: "Clients", href: "/clients", icon: Users },
  { label: "Job Board", href: "/job-board", icon: Columns3 },
  { label: "Team", href: "/team", icon: UserCog },
  { label: "Map", href: "/map", icon: MapPin },
  { label: "Pipeline", href: "/pipeline", icon: GitBranch },
  { label: "Invoices", href: "/invoices", icon: Receipt },
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
        "text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)]",
        isCollapsed ? "justify-center px-0 py-1.5 mx-auto" : "gap-1.5 px-1.5 py-1",
        isActive && [
          "text-text-primary bg-[rgba(255,255,255,0.06)]",
          "border-l-2 border-l-[rgba(255,255,255,0.2)]",
        ],
        !isActive && "border-l-2 border-l-transparent"
      )}
    >
      <item.icon
        className={cn(
          "shrink-0 w-[20px] h-[20px] transition-colors",
          isActive ? "text-text-primary" : "text-text-tertiary group-hover:text-text-secondary"
        )}
      />
      {!isCollapsed && (
        <span className="font-mohave text-body-sm truncate uppercase">{item.label}</span>
      )}
    </button>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { isCollapsed, toggle } = useSidebarStore();
  const currentUser = useAuthStore((s) => s.currentUser);
  const company = useAuthStore((s) => s.company);
  const logout = useAuthStore((s) => s.logout);

  const handleSignOut = useCallback(async () => {
    document.cookie = "ops-auth-token=; path=/; max-age=0";
    document.cookie = "__session=; path=/; max-age=0";
    logout();
    try { await signOut(); } catch {}
    window.location.href = "/login";
  }, [logout]);

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
      {/* Company Branding */}
      <div
        className={cn(
          "flex items-center h-[56px] border-b border-border shrink-0",
          isCollapsed ? "justify-center px-1" : "px-2 gap-1.5"
        )}
      >
        <div className="shrink-0 w-[24px] h-[24px] rounded bg-[rgba(255,255,255,0.08)] flex items-center justify-center overflow-hidden">
          {company?.logoURL ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={company.logoURL}
              alt={company.name || "Company"}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <Building2 className="w-[14px] h-[14px] text-text-tertiary" />
          )}
        </div>
        {!isCollapsed && (
          <span className="font-mohave text-body text-text-primary truncate">
            {company?.name || "My Company"}
          </span>
        )}
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

      {/* Collapse Chevron — positioned on sidebar right edge */}
      <button
        onClick={toggle}
        title={isCollapsed ? "Expand sidebar (⌘B)" : "Collapse sidebar (⌘B)"}
        className={cn(
          "absolute top-1/2 -translate-y-1/2 -right-[10px] z-50",
          "w-[20px] h-[20px] rounded-full",
          "bg-background-panel border border-border",
          "flex items-center justify-center",
          "text-text-tertiary hover:text-text-secondary hover:bg-[rgba(255,255,255,0.08)]",
          "transition-colors"
        )}
      >
        {isCollapsed ? (
          <ChevronRight className="w-[12px] h-[12px]" />
        ) : (
          <ChevronLeft className="w-[12px] h-[12px]" />
        )}
      </button>

      {/* Bottom Section */}
      <div className="border-t border-border p-1 space-y-1 shrink-0">
        {/* OPS Branding */}
        <div
          className={cn(
            "flex items-center rounded px-1.5 py-1",
            isCollapsed ? "justify-center" : "gap-1"
          )}
        >
          <Image
            src="/images/ops-logo-white.png"
            alt="OPS"
            width={16}
            height={6}
            className="select-none shrink-0 opacity-40"
          />
          {!isCollapsed && (
            <span className="font-mono text-[10px] text-text-disabled select-none">
              OPS &middot; Feb 2026
            </span>
          )}
        </div>

        {/* User section - just avatar + name + sign out */}
        <div
          className={cn(
            "flex items-center rounded bg-[rgba(255,255,255,0.03)] p-1",
            isCollapsed ? "justify-center" : "gap-1.5"
          )}
        >
          {/* Avatar */}
          <div className="shrink-0 w-[32px] h-[32px] rounded-full bg-[rgba(255,255,255,0.08)] flex items-center justify-center overflow-hidden">
            {currentUser?.profileImageURL ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={currentUser.profileImageURL}
                alt={currentUser.firstName || "User"}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="font-mohave text-body-sm text-text-secondary">
                {currentUser?.firstName?.charAt(0)?.toUpperCase() || currentUser?.email?.charAt(0)?.toUpperCase() || "U"}
              </span>
            )}
          </div>

          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <p className="font-mohave text-body-sm text-text-primary truncate">
                {currentUser ? `${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim() || currentUser.email : "User"}
              </p>
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

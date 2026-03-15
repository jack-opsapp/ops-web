"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
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
  FileText,
  Receipt,
  Package,
  Boxes,
  Calculator,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Building2,
  MessageSquareText,
  Globe,
  GraduationCap,
  Smartphone,
  Bug,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore, selectPermissionsReady } from "@/lib/store/permissions-store";
import { useFeatureFlagsStore } from "@/lib/store/feature-flags-store";
import { useCompany } from "@/lib/hooks";
import { useSignOutStore } from "@/stores/signout-store";
import { useDictionary } from "@/i18n/client";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Permission required to see this nav item (omit = always visible) */
  permission?: string;
}

type NavEntry = NavItem | "divider";

interface BuildNavOpts {
  inventoryAccess?: boolean;
}

function buildNavItems(t: (key: string) => string, opts: BuildNavOpts = {}): NavEntry[] {
  return [
    { label: t("nav.dashboard"), href: "/dashboard", icon: LayoutDashboard },
    "divider",
    { label: t("nav.projects"), href: "/projects", icon: FolderKanban, permission: "projects.view" },
    { label: t("nav.calendar"), href: "/calendar", icon: CalendarDays, permission: "calendar.view" },
    { label: t("nav.clients"), href: "/clients", icon: Users, permission: "clients.view" },
    { label: t("nav.jobBoard"), href: "/job-board", icon: Columns3, permission: "job_board.view" },
    { label: t("nav.team"), href: "/team", icon: UserCog, permission: "team.view" },
    { label: t("nav.map"), href: "/map", icon: MapPin, permission: "map.view" },
    "divider",
    { label: t("nav.pipeline"), href: "/pipeline", icon: GitBranch, permission: "pipeline.view" },
    { label: t("nav.estimates"), href: "/estimates", icon: FileText, permission: "estimates.view" },
    { label: t("nav.invoices"), href: "/invoices", icon: Receipt, permission: "invoices.view" },
    "divider",
    { label: t("nav.products"), href: "/products", icon: Package, permission: "products.view" },
    ...(opts.inventoryAccess
      ? [{ label: t("nav.inventory"), href: "/inventory", icon: Boxes, permission: "inventory.view" } as NavItem]
      : []),
    { label: t("nav.accounting"), href: "/accounting", icon: Calculator, permission: "accounting.view" },
    { label: t("nav.portalInbox"), href: "/portal-inbox", icon: MessageSquareText, permission: "portal.view" },
    "divider",
{ label: t("nav.settings"), href: "/settings", icon: Settings },
  ];
}

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
  const router = useRouter();
  const { isCollapsed, toggle } = useSidebarStore();
  const currentUser = useAuthStore((s) => s.currentUser);
  const storeCompany = useAuthStore((s) => s.company);
  const { data: freshCompany } = useCompany();
  const company = freshCompany ?? storeCompany;
  const beginSignOut = useSignOutStore((s) => s.begin);
  const { t } = useDictionary("sidebar");
  const can = usePermissionStore((s) => s.can);
  const permissionsReady = usePermissionStore(selectPermissionsReady);
  const isPermissionUnlocked = useFeatureFlagsStore((s) => s.isPermissionUnlocked);
  const hasInventoryAccess = currentUser?.inventoryAccess ?? false;
  const allNavItems = useMemo(
    () => buildNavItems(t, { inventoryAccess: hasInventoryAccess }),
    [t, hasInventoryAccess]
  );

  // Filter nav items by permission (only gate when permissions are loaded)
  const navItems = useMemo(() => {
    if (!permissionsReady) return allNavItems;

    const filtered = allNavItems.filter((entry) => {
      if (entry === "divider") return true;
      if (!entry.permission) return true;
      if (!isPermissionUnlocked(entry.permission)) return false;
      return can(entry.permission);
    });

    // Clean up consecutive/leading/trailing dividers
    return filtered.filter((entry, i, arr) => {
      if (entry !== "divider") return true;
      if (i === 0 || i === arr.length - 1) return false;
      return arr[i - 1] !== "divider";
    });
  }, [allNavItems, can, permissionsReady, isPermissionUnlocked]);

  const handleSignOut = useCallback(() => {
    beginSignOut(currentUser?.firstName || "", currentUser?.lastName || "");
  }, [beginSignOut, currentUser]);

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 h-screen z-[45]",
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
              alt={company.name || t("companyAlt")}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <Building2 className="w-[14px] h-[14px] text-text-tertiary" />
          )}
        </div>
        {!isCollapsed && (
          <span className="font-mohave text-body text-text-primary truncate uppercase">
            {company?.name || t("companyFallback")}
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-1 px-1 space-y-[2px]">
        {navItems.map((entry, i) => {
          if (entry === "divider") {
            return (
              <div key={`div-${i}`} className="my-1 mx-1.5 h-px bg-[rgba(255,255,255,0.06)]" />
            );
          }
          return (
            <NavItemButton
              key={entry.href}
              item={entry}
              isActive={isActive(entry.href)}
              isCollapsed={isCollapsed}
            />
          );
        })}
      </nav>

      {/* Collapse Chevron — positioned on sidebar right edge */}
      <button
        onClick={toggle}
        title={isCollapsed ? t("expandSidebar") : t("collapseSidebar")}
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
              VERSION 02/16/2026
            </span>
          )}
        </div>

        {/* User section — avatar dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex items-center rounded bg-[rgba(255,255,255,0.03)] p-1 w-full",
                "hover:bg-[rgba(255,255,255,0.06)] transition-colors cursor-pointer",
                isCollapsed ? "justify-center" : "gap-1.5"
              )}
            >
              <div
                className="shrink-0 w-[32px] h-[32px] rounded-full flex items-center justify-center overflow-hidden border-2 border-ops-accent"
              >
                {currentUser?.profileImageURL ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={currentUser.profileImageURL}
                    alt={currentUser.firstName || t("userFallback")}
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
                <div className="flex-1 min-w-0 text-left">
                  <p className="font-mohave text-body-sm text-text-primary truncate">
                    {currentUser ? `${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim() || currentUser.email : t("userFallback")}
                  </p>
                </div>
              )}
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent side="top" align={isCollapsed ? "center" : "start"} sideOffset={8}>
            <DropdownMenuItem onClick={() => router.push("/settings")}>
              <Settings className="w-[16px] h-[16px] text-text-tertiary" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.open("https://opsapp.co", "_blank")}>
              <Globe className="w-[16px] h-[16px] text-text-tertiary" />
              OPS Website
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.open("https://learn.opsapp.co", "_blank")}>
              <GraduationCap className="w-[16px] h-[16px] text-text-tertiary" />
              Courses
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.open("#", "_blank")}>
              <Smartphone className="w-[16px] h-[16px] text-text-tertiary" />
              Download iOS App
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-ops-error focus:text-ops-error">
              <LogOut className="w-[16px] h-[16px]" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

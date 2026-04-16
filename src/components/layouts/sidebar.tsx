"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import {
  LayoutDashboard,
  FolderKanban,
  CalendarDays,
  Users,

  UserCog,
  MapPin,
  GitBranch,
  Mail,
  FileText,
  Receipt,
  Package,
  Boxes,
  Calculator,
  Radar,
  BrainCircuit,
  Settings,
  LogOut,
  Building2,
  Globe,
  GraduationCap,
  Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore, selectPermissionsReady } from "@/lib/store/permissions-store";
import { useFeatureFlagsStore } from "@/lib/store/feature-flags-store";
import { useCompany } from "@/lib/hooks";
import { useSignOutStore } from "@/stores/signout-store";
import { useDictionary } from "@/i18n/client";
import { FeatureAccessModal } from "@/components/ops/feature-access-modal";
import { useFeatureAccessRequests } from "@/lib/hooks/use-feature-access-requests";
import { useUnifiedUnreadCount } from "@/lib/hooks/use-unified-inbox";
import { useApprovalQueuePendingCount } from "@/lib/hooks/use-approval-queue";
import { getSlugForPermission } from "@/lib/feature-flags/feature-flag-definitions";
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
  gated?: boolean;
  /** Unread count badge */
  badge?: number;
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

    { label: t("nav.team"), href: "/team", icon: UserCog, permission: "team.view" },
    { label: t("nav.map"), href: "/map", icon: MapPin, permission: "map.view" },
    "divider",
    { label: t("nav.pipeline"), href: "/pipeline", icon: GitBranch, permission: "pipeline.view" },
    { label: t("nav.inbox"), href: "/inbox", icon: Mail, permission: "pipeline.view" },
    { label: t("nav.estimates"), href: "/estimates", icon: FileText, permission: "estimates.view" },
    { label: t("nav.invoices"), href: "/invoices", icon: Receipt, permission: "invoices.view" },
    "divider",
    { label: t("nav.products"), href: "/products", icon: Package, permission: "products.view" },
    ...(opts.inventoryAccess
      ? [{ label: t("nav.inventory"), href: "/inventory", icon: Boxes, permission: "inventory.view" } as NavItem]
      : []),
    { label: t("nav.accounting"), href: "/accounting", icon: Calculator, permission: "accounting.view" },
    "divider",
    { label: t("nav.intel"), href: "/intel", icon: Radar, permission: "pipeline.view" },
    { label: t("nav.agentQueue"), href: "/agent/queue", icon: BrainCircuit, permission: "admin" },
    "divider",
    { label: t("nav.settings"), href: "/settings", icon: Settings },
  ];
}

function NavItemButton({
  item,
  isActive,
  isCollapsed,
  isRequested,
  onGatedClick,
  onNavigate,
}: {
  item: NavItem;
  isActive: boolean;
  isCollapsed: boolean;
  isRequested?: boolean;
  onGatedClick?: () => void;
  onNavigate?: () => void;
}) {
  const router = useRouter();

  const tooltipText = item.gated
    ? isRequested
      ? "Access requested \u2014 we\u2019ll be in touch"
      : "In development"
    : isCollapsed
      ? item.label
      : undefined;

  return (
    <button
      onClick={() => {
        if (item.gated && onGatedClick) {
          onGatedClick();
        } else if (!item.gated) {
          router.push(item.href);
          onNavigate?.();
        }
      }}
      title={tooltipText}
      className={cn(
        "group relative flex items-center w-full h-[36px] rounded-[2px] transition-colors duration-150",
        isCollapsed ? "justify-center px-0" : "gap-1.5 px-1.5",
        item.gated
          ? "text-text-mute opacity-50 cursor-pointer hover:opacity-70"
          : [
              "text-text-3 hover:text-text hover:bg-[rgba(255,255,255,0.04)]",
              isActive && "text-ops-accent bg-[rgba(89,119,148,0.10)]",
            ]
      )}
    >
      <item.icon
        className={cn(
          "shrink-0 w-[20px] h-[20px] transition-colors",
          item.gated
            ? "text-text-mute"
            : isActive
              ? "text-ops-accent"
              : "text-text-3 group-hover:text-text-2"
        )}
      />
      {!isCollapsed && (
        <span className="font-mohave text-body-sm truncate uppercase">{item.label}</span>
      )}
      {/* Unread badge */}
      {item.badge !== undefined && item.badge > 0 && (
        <span
          className={cn(
            "inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full",
            "font-kosugi text-[10px] leading-none bg-ops-accent text-white",
            isCollapsed && "absolute top-0 right-0"
          )}
        >
          {item.badge > 99 ? "99+" : item.badge}
        </span>
      )}
    </button>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { isHoverExpanded, setHoverExpanded, isMobileOpen, closeMobile } = useSidebarStore();
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
  const [accessModalOpen, setAccessModalOpen] = useState(false);
  const [accessModalFeature, setAccessModalFeature] = useState<{ label: string; slug: string } | null>(null);
  const { data: requestedSlugs, refetch: refetchRequests } = useFeatureAccessRequests(currentUser?.id);
  const { data: inboxUnreadCount = 0 } = useUnifiedUnreadCount();
  const { data: agentQueuePendingCount = 0 } = useApprovalQueuePendingCount();

  // Mobile: detect viewport and derive effective collapsed state
  const [isMobileView, setIsMobileView] = useState(false);
  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 768;
      setIsMobileView(mobile);
      if (!mobile) closeMobile();
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [closeMobile]);

  // Desktop: collapsed at rest, expanded on hover (overlay, no content push)
  // Mobile: always show expanded labels in the drawer
  const effectiveCollapsed = isMobileView ? false : !isHoverExpanded;
  const allNavItems = useMemo(
    () => buildNavItems(t, { inventoryAccess: hasInventoryAccess }),
    [t, hasInventoryAccess]
  );

  const navItems = useMemo(() => {
    if (!permissionsReady) return allNavItems;

    const mapped = allNavItems.map((entry) => {
      // Inject unread badge for inbox
      if (entry !== "divider" && entry.href === "/inbox" && inboxUnreadCount > 0) {
        entry = { ...entry, badge: inboxUnreadCount };
      }
      // Inject pending count badge for agent queue
      if (entry !== "divider" && entry.href === "/agent/queue" && agentQueuePendingCount > 0) {
        entry = { ...entry, badge: agentQueuePendingCount };
      }
      if (entry === "divider") return entry;
      if (!entry.permission) return entry;

      // Feature flag check — if gated, keep visible but mark as gated
      if (!isPermissionUnlocked(entry.permission)) {
        return { ...entry, gated: true };
      }

      // RBAC permission check — hide if user lacks permission
      if (!can(entry.permission)) return null;

      return entry;
    }).filter((entry): entry is NavEntry => entry !== null);

    // Clean up consecutive/leading/trailing dividers
    return mapped.filter((entry, i, arr) => {
      if (entry !== "divider") return true;
      if (i === 0 || i === arr.length - 1) return false;
      return arr[i - 1] !== "divider";
    });
  }, [allNavItems, can, permissionsReady, isPermissionUnlocked, inboxUnreadCount, agentQueuePendingCount]);

  const handleSignOut = useCallback(() => {
    beginSignOut(currentUser?.firstName || "", currentUser?.lastName || "");
  }, [beginSignOut, currentUser]);

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[44] md:hidden"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}
      <aside
        onMouseEnter={() => { if (!isMobileView) setHoverExpanded(true); }}
        onMouseLeave={() => { if (!isMobileView) setHoverExpanded(false); }}
        className={cn(
          "fixed left-0 top-0 h-screen z-[45]",
          "border-r border-[rgba(255,255,255,0.06)]",
          "flex flex-col transition-all duration-200 ease-out",
          effectiveCollapsed ? "w-[72px]" : "w-[256px]",
          // Mobile: off-screen by default, slide in when open
          isMobileOpen ? "translate-x-0" : "-translate-x-full",
          "md:translate-x-0"
        )}
        style={{
          background: "var(--surface-glass-dense)",
          backdropFilter: "blur(28px) saturate(1.3)",
          WebkitBackdropFilter: "blur(28px) saturate(1.3)",
        }}
      >
      {/* Company Branding */}
      <div
        className={cn(
          "flex items-center h-[56px] border-b border-border shrink-0",
          effectiveCollapsed ? "justify-center px-1" : "px-2 gap-1.5"
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
            <Building2 className="w-[14px] h-[14px] text-text-3" />
          )}
        </div>
        {!effectiveCollapsed && (
          <span className="font-mohave text-body text-text truncate uppercase">
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
          const slug = entry.permission ? getSlugForPermission(entry.permission) : null;
          const isRequested = slug ? requestedSlugs?.has(slug) ?? false : false;

          return (
            <NavItemButton
              key={entry.href}
              item={entry}
              isActive={!entry.gated && isActive(entry.href)}
              isCollapsed={effectiveCollapsed}
              onNavigate={() => { setHoverExpanded(false); closeMobile(); }}
              isRequested={isRequested}
              onGatedClick={
                entry.gated && slug
                  ? () => {
                      setAccessModalFeature({ label: entry.label, slug });
                      setAccessModalOpen(true);
                    }
                  : undefined
              }
            />
          );
        })}
      </nav>

      {/* Collapse chevron removed — sidebar uses hover-to-expand in HUD mode */}

      {/* Bottom Section */}
      <div className="border-t border-border p-1 space-y-1 shrink-0">
        {/* OPS Branding */}
        <div
          className={cn(
            "flex items-center rounded px-1.5 py-1",
            effectiveCollapsed ? "justify-center" : "gap-1"
          )}
        >
          <Image
            src="/images/ops-logo-white.png"
            alt="OPS"
            width={16}
            height={6}
            className="select-none shrink-0 opacity-40"
          />
          <span
            className={cn(
              "font-mono text-[10px] text-text-mute select-none transition-opacity duration-200",
              effectiveCollapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100 delay-150"
            )}
          >
            VERSION 02/16/2026
          </span>
        </div>

        {/* User section — avatar dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex items-center rounded bg-[rgba(255,255,255,0.03)] p-1 w-full",
                "hover:bg-[rgba(255,255,255,0.06)] transition-colors cursor-pointer",
                effectiveCollapsed ? "justify-center" : "gap-1.5"
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
                  <span className="font-mohave text-body-sm text-text-2">
                    {currentUser?.firstName?.charAt(0)?.toUpperCase() || currentUser?.email?.charAt(0)?.toUpperCase() || "U"}
                  </span>
                )}
              </div>

              {!effectiveCollapsed && (
                <div className="flex-1 min-w-0 text-left">
                  <p className="font-mohave text-body-sm text-text truncate">
                    {currentUser ? `${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim() || currentUser.email : t("userFallback")}
                  </p>
                </div>
              )}
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent side="top" align={effectiveCollapsed ? "center" : "start"} sideOffset={8}>
            <DropdownMenuItem onClick={() => router.push("/settings")}>
              <Settings className="w-[16px] h-[16px] text-text-3" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.open("https://opsapp.co", "_blank")}>
              <Globe className="w-[16px] h-[16px] text-text-3" />
              OPS Website
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.open("https://learn.opsapp.co", "_blank")}>
              <GraduationCap className="w-[16px] h-[16px] text-text-3" />
              Courses
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.open("#", "_blank")}>
              <Smartphone className="w-[16px] h-[16px] text-text-3" />
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

      {/* Feature Access Request Modal */}
      {accessModalFeature && (
        <FeatureAccessModal
          open={accessModalOpen}
          onClose={() => {
            setAccessModalOpen(false);
            setAccessModalFeature(null);
          }}
          featureLabel={accessModalFeature.label}
          featureSlug={accessModalFeature.slug}
          alreadyRequested={requestedSlugs?.has(accessModalFeature.slug) ?? false}
          onRequestSubmitted={() => refetchRequests()}
        />
      )}
    </aside>
    </>
  );
}

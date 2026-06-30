"use client";

/**
 * Operator menu — the sidebar's user section (WEB OVERHAUL P2 redesign).
 *
 * Trigger: avatar row at the rail foot (avatar only at rest, name + role
 * when the rail is expanded). Content: glass-dense panel opening upward —
 * operator identity block (`// OPERATOR :: NAME`, email, role tag), then
 * Settings, the external OPS destinations (↗), and Sign Out in rose.
 *
 * The old menu's "Download iOS App" pointed at "#" — it now opens the live
 * App Store listing (same URL ops-site ships everywhere).
 */

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import {
  ArrowUpRight,
  GraduationCap,
  Globe,
  LogOut,
  Settings,
  Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useSignOutStore } from "@/stores/signout-store";
import { useDictionary } from "@/i18n/client";
import {
  IOS_APP_STORE_URL,
  OPS_COURSES_URL,
  OPS_WEBSITE_URL,
} from "@/lib/constants/external-links";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const menuItemClass = cn(
  "h-[36px] gap-2.5 rounded-sidebar px-2.5",
  "font-cakemono font-light text-[14px] uppercase text-text-2",
  "focus:bg-[rgba(255,255,255,0.05)] focus:text-text"
);

function ExternalItem({
  icon: Icon,
  label,
  href,
}: {
  icon: typeof Globe;
  label: string;
  href: string;
}) {
  return (
    <DropdownMenuItem
      className={menuItemClass}
      onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
    >
      <Icon className="h-[16px] w-[16px] text-text-3" />
      {label}
      <ArrowUpRight className="ml-auto h-[12px] w-[12px] text-text-3" />
    </DropdownMenuItem>
  );
}

export function OperatorMenu({ expanded }: { expanded: boolean }) {
  const router = useRouter();
  const { t } = useDictionary("navigation");
  const currentUser = useAuthStore((s) => s.currentUser);
  const roleName = usePermissionStore((s) => s.roleName);
  const beginSignOut = useSignOutStore((s) => s.begin);

  const handleSignOut = useCallback(() => {
    beginSignOut(currentUser?.firstName || "", currentUser?.lastName || "");
  }, [beginSignOut, currentUser]);

  const displayName = currentUser
    ? `${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim() ||
      currentUser.email ||
      t("user.fallback")
    : t("user.fallback");
  const operatorHandle = (
    currentUser?.firstName ||
    currentUser?.email?.split("@")[0] ||
    t("user.fallback")
  ).toUpperCase();
  const initial =
    currentUser?.firstName?.charAt(0)?.toUpperCase() ||
    currentUser?.email?.charAt(0)?.toUpperCase() ||
    "—";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("user.menuAriaLabel")}
          className={cn(
            "flex w-full items-center rounded-sidebar bg-surface-input p-1.5",
            "transition-colors duration-150 ease-smooth motion-reduce:transition-none",
            "hover:bg-surface-hover",
            expanded ? "gap-2.5" : "justify-center"
          )}
        >
          <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center overflow-hidden rounded-full border-[1.5px] border-[rgba(255,255,255,0.18)]">
            {currentUser?.profileImageURL ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={currentUser.profileImageURL}
                alt={displayName}
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="font-mohave text-body-sm text-text-2">
                {initial}
              </span>
            )}
          </div>
          {expanded && (
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate font-mohave text-[14px] leading-[1.15] text-text">
                {displayName}
              </span>
              {roleName && (
                <span className="block truncate font-mono text-micro uppercase tracking-[0.14em] text-text-3">
                  {roleName}
                </span>
              )}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        // Desktop rail: a gradient flyout that pushes out from the rail's right
        // edge. sideOffset 16 == the footer's px-2 inset, so the panel's left
        // edge lands flush on the rail seam instead of overlapping the avatar.
        // Mobile drawer: the standard dense dropdown, opening upward.
        side={expanded ? "top" : "right"}
        align={expanded ? "start" : "end"}
        sideOffset={expanded ? 8 : 16}
        variant={expanded ? "default" : "rail-flyout"}
        className={cn(
          "z-[1000] p-0",
          expanded ? "w-[248px] rounded-modal" : "w-[264px]"
        )}
      >
        {/* Identity block */}
        <div className="border-b border-border px-4 pb-3 pt-3.5">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-2">
            <span aria-hidden="true" className="text-text-mute">
              {"// "}
            </span>
            {t("menu.operatorPrefix")}
            <span className="text-text-mute">{" :: "}</span>
            {operatorHandle}
          </p>
          {currentUser?.email && (
            <p className="mt-1 truncate font-mohave text-body-sm text-text-3">
              {currentUser.email}
            </p>
          )}
          {roleName && (
            <span className="mt-2 inline-flex rounded-chip border border-border bg-[rgba(255,255,255,0.05)] px-1.5 py-[2px] font-mono text-micro uppercase tracking-[0.12em] text-text-2">
              {roleName}
            </span>
          )}
        </div>

        <div className="p-1.5">
          <DropdownMenuItem
            className={menuItemClass}
            onClick={() => router.push("/settings")}
          >
            <Settings className="h-[16px] w-[16px] text-text-3" />
            {t("menu.settings")}
          </DropdownMenuItem>
        </div>

        <DropdownMenuSeparator className="my-0" />

        <div className="p-1.5">
          <ExternalItem icon={Globe} label={t("menu.website")} href={OPS_WEBSITE_URL} />
          <ExternalItem icon={GraduationCap} label={t("menu.courses")} href={OPS_COURSES_URL} />
          <ExternalItem icon={Smartphone} label={t("menu.iosApp")} href={IOS_APP_STORE_URL} />
        </div>

        <DropdownMenuSeparator className="my-0" />

        <div className="p-1.5">
          <DropdownMenuItem
            className={cn(
              menuItemClass,
              "text-rose focus:bg-rose-soft focus:text-rose"
            )}
            onClick={handleSignOut}
          >
            <LogOut className="h-[16px] w-[16px] text-rose" />
            {t("menu.signOut")}
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

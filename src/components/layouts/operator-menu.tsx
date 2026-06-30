"use client";

/**
 * Operator menu — the sidebar's user section (WEB OVERHAUL P2 redesign).
 *
 * Trigger: avatar row at the rail foot (avatar only at rest, name + role
 * when the rail is expanded).
 *
 * Open state: NO card. A full-height gradient washes in from the rail —
 * opaque black at the rail seam, fading to clear across the deck — with the
 * operator identity and actions floating directly on it, left-justified
 * against the rail. The gradient + content push in from the left; clicking
 * anywhere on the wash (or Escape) dismisses.
 */

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  ArrowUpRight,
  GraduationCap,
  Globe,
  LogOut,
  Settings,
  Smartphone,
  type LucideIcon,
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

// Rail seam the wash and the floating column anchor against. 72px desktop
// rail, 280px mobile drawer — kept in sync with sidebar.tsx geometry.
const RAIL_PX = 72;
const MOBILE_DRAWER_PX = 280;

// A single floating action — no surface, no border. A hairline marker slides
// in on hover/focus (the nav rail's vocabulary) so focus reads without a box.
function OperatorAction({
  icon: Icon,
  label,
  onSelect,
  external,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  external?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative flex items-center gap-[16px] py-[11px] pl-[24px] pr-6 text-left",
        "font-cakemono text-[20px] font-light uppercase tracking-[0.01em]",
        "transition-colors duration-150 ease-smooth motion-reduce:transition-none",
        "focus-visible:outline-none",
        danger
          ? "text-rose hover:text-rose focus-visible:text-rose"
          : "text-text hover:text-text focus-visible:text-text"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-1/2 h-[22px] w-[2px] -translate-y-1/2 rounded-[1px]",
          "opacity-0 transition-opacity duration-150 motion-reduce:transition-none",
          "group-hover:opacity-100 group-focus-visible:opacity-100",
          danger ? "bg-rose" : "bg-text"
        )}
      />
      <Icon
        className={cn(
          "h-[20px] w-[20px] shrink-0 transition-colors duration-150 motion-reduce:transition-none",
          danger
            ? "text-rose"
            : "text-text-2 group-hover:text-text group-focus-visible:text-text"
        )}
      />
      <span>{label}</span>
      {external && (
        <ArrowUpRight className="h-[15px] w-[15px] shrink-0 text-text-3" />
      )}
    </button>
  );
}

export function OperatorMenu({ expanded }: { expanded: boolean }) {
  const router = useRouter();
  const { t } = useDictionary("navigation");
  const currentUser = useAuthStore((s) => s.currentUser);
  const roleName = usePermissionStore((s) => s.roleName);
  const beginSignOut = useSignOutStore((s) => s.begin);
  const [open, setOpen] = useState(false);

  const handleSignOut = useCallback(() => {
    setOpen(false);
    beginSignOut(currentUser?.firstName || "", currentUser?.lastName || "");
  }, [beginSignOut, currentUser]);

  const goTo = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  const openExternal = useCallback((href: string) => {
    setOpen(false);
    window.open(href, "_blank", "noopener,noreferrer");
  }, []);

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

  const railPx = expanded ? MOBILE_DRAWER_PX : RAIL_PX;
  // Match the side nav bar's FILL. The rail's glass (0.58 tint) renders over
  // the near-black canvas, so it reads as a very dark charcoal ≈ rgb(13,13,15).
  // We paint that apparent colour as an opaque fill so the column reads
  // identical to the rail over the brighter dashboard, then fade to clear
  // across the deck. (Frosting the bright deck with the literal glass formula
  // is what made the column far lighter than the rail — the bug just fixed.)
  const wash = `linear-gradient(to right, transparent ${railPx - 2}px, rgb(13,13,15) ${railPx - 2}px, rgb(13,13,15) ${railPx + 250}px, rgba(13,13,15,0.55) 44%, transparent 70%)`;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
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
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-0 z-[3000] focus:outline-none",
            "motion-safe:data-[state=open]:animate-push-in-left motion-reduce:animate-fade-in"
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            {t("user.menuAriaLabel")}
          </DialogPrimitive.Title>

          {/* The wash — full height, borderless, rail-glass → clear. Also the
              click-away surface; clicking anywhere on it dismisses. */}
          <button
            type="button"
            aria-label={t("user.menuAriaLabel")}
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default"
            style={{ background: wash }}
          />

          {/* Floating content — left-justified against the rail, rising from
              the avatar. No surface of its own. */}
          <div
            className="absolute bottom-[92px] flex flex-col gap-[2px] pl-[36px] pr-16"
            style={{ left: railPx }}
          >
            <div className="mb-[22px] pl-[24px]">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text">
                <span aria-hidden="true" className="text-text-mute">
                  {"// "}
                </span>
                {t("menu.operatorPrefix")}
                <span aria-hidden="true" className="text-text-mute">
                  {" :: "}
                </span>
                {operatorHandle}
              </p>
              {currentUser?.email && (
                <p className="mt-[6px] font-mohave text-[14px] text-text-3">
                  {currentUser.email}
                </p>
              )}
              {roleName && (
                <p className="mt-[10px] font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
                  {roleName}
                </p>
              )}
            </div>

            <OperatorAction
              icon={Settings}
              label={t("menu.settings")}
              onSelect={() => goTo("/settings")}
            />
            <OperatorAction
              icon={Globe}
              label={t("menu.website")}
              onSelect={() => openExternal(OPS_WEBSITE_URL)}
              external
            />
            <OperatorAction
              icon={GraduationCap}
              label={t("menu.courses")}
              onSelect={() => openExternal(OPS_COURSES_URL)}
              external
            />
            <OperatorAction
              icon={Smartphone}
              label={t("menu.iosApp")}
              onSelect={() => openExternal(IOS_APP_STORE_URL)}
              external
            />
            <OperatorAction
              icon={LogOut}
              label={t("menu.signOut")}
              onSelect={handleSignOut}
              danger
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

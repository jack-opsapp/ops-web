"use client";

/**
 * Operator menu — the sidebar's user section (WEB OVERHAUL P2 redesign).
 *
 * Trigger: avatar row at the rail foot (avatar only at rest, name + role
 * when the rail is expanded).
 *
 * Open state: NO card. A full-height dark glass wash drops OVER the instrument
 * rail (covering the nav) and across the deck, fading to clear on the right —
 * but it fades OUT at the very top and bottom, so the brand logo (top) and the
 * avatar (bottom) read straight through it as the two anchors. The operator
 * identity + actions float on the wash, left-justified, rising from the avatar.
 *
 * Motion is pure CSS transition on an ALWAYS-mounted, portalled overlay (opacity
 * + transform, toggled by `open`). The overlay never unmounts, so there is no
 * exit-completion event to miss — the wash fades in/out and the rows
 * stagger-slide in every engine, where Radix's animationend gate and Framer's
 * AnimatePresence exit both stalled. Closed, the overlay is inert + click-
 * through; Escape and a click on the wash dismiss; scroll is locked while open.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  Bug,
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
import { useBugReportStore } from "@/stores/bug-report-store";
import { useEdgeTabStore } from "@/stores/edge-tab-store";
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

// Right-rail edge-tab id for the bug-report drawer. Mirrors the local const in
// bug-report-drawer.tsx / create-cluster.tsx — the id isn't centrally exported.
const EDGE_TAB_ID_BUG = "bug-report";

// Row stagger — first row settles after the wash starts, each one 45ms behind
// the last (motion identity: staggered rows reveal hierarchy).
const ROW_DELAY_BASE = 60;
const ROW_DELAY_STEP = 45;

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

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Escape, scroll-lock, focus-in on open / focus-return on close, and `inert`
  // so the closed (but still-mounted) overlay is unreachable by tab + a11y.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (overlay) overlay.inert = !open;
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      overlay?.querySelector<HTMLButtonElement>("[data-first-action]")?.focus();
    }, 80);
    const trigger = triggerRef.current;
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(focusTimer);
      trigger?.focus();
    };
  }, [open]);

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

  const handleReportBug = useCallback(() => {
    // Dismiss the menu, then capture the deck BEFORE the drawer mounts so the
    // screenshot reflects what the operator was looking at — not this menu. The
    // overlay is data-bug-report-ignore, so the closing wash never lands in the
    // shot regardless of capture timing. Guard the token bump so re-triggering
    // an already-open bug tab doesn't fire a redundant capture.
    setOpen(false);
    if (useEdgeTabStore.getState().activeTab !== EDGE_TAB_ID_BUG) {
      useBugReportStore.getState().requestScreenshot();
    }
    useEdgeTabStore.getState().setActive(EDGE_TAB_ID_BUG);
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

  // The wash is a PAINTED dark column dropped OVER the rail and across the deck
  // — deliberately NOT a live backdrop-filter. A real backdrop blur re-samples
  // everything behind it on every repaint, so each hover on a row re-composited
  // the whole masked deck and the dashboard flickered in and out. A flat paint
  // is stable: nothing samples the deck, so nothing can flicker. It runs the
  // FULL viewport height (no top/bottom fade — that read as height-restricted)
  // and fades only rightward: a near-opaque near-black fill solid across the
  // rail + near deck, then out to clear across the open deck.
  const washFill = "rgba(9,9,11,0.95)";
  const washMask = `linear-gradient(to right, #000 0, #000 ${railPx + 250}px, rgba(0,0,0,0.5) 44%, transparent 70%)`;

  // Rows in render order, each with its stagger delay. Identity first.
  const rowClass = cn(
    "transition-[opacity,transform] duration-300 ease-smooth",
    "motion-reduce:transition-opacity motion-reduce:duration-200",
    open
      ? "translate-x-0 opacity-100"
      : "-translate-x-[18px] opacity-0 motion-reduce:translate-x-0"
  );
  const rowStyle = (index: number) => ({
    transitionDelay: open ? `${ROW_DELAY_BASE + index * ROW_DELAY_STEP}ms` : "0ms",
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("user.menuAriaLabel")}
        onClick={() => setOpen(true)}
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

      {mounted &&
        createPortal(
          <div
            ref={overlayRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("user.menuAriaLabel")}
            // Always-mounted overlay — exclude it from bug-report screenshots so
            // the (closing) wash never appears in a capture triggered from here.
            data-bug-report-ignore="true"
            className={cn(
              "fixed inset-0 z-[3000] focus:outline-none",
              open ? "pointer-events-auto" : "pointer-events-none"
            )}
          >
            {/* The wash — full height over the rail, fading to clear on the
                right. Also the click-away surface. */}
            <button
              type="button"
              aria-label={t("user.menuAriaLabel")}
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className={cn(
                "absolute inset-0 cursor-default ease-smooth",
                // Entry beat: the wash DEPLOYS from the rail — a crisp clip-path
                // reveal sweeps left→right across the deck (its hard leading edge
                // dissolves into the mask's soft right fade), paired with a quick
                // opacity fade. Reduced motion drops the wipe for a plain fade.
                "transition-[clip-path,opacity] duration-[340ms]",
                "motion-reduce:transition-opacity motion-reduce:duration-200",
                open ? "opacity-100" : "opacity-0"
              )}
              style={{
                background: washFill,
                maskImage: washMask,
                WebkitMaskImage: washMask,
                // inset(0 100% 0 0) = fully clipped from the right (hidden);
                // inset(0 0 0 0) = fully revealed. Animating the right inset
                // 100%→0 wipes the wash in from the rail seam.
                clipPath: open ? "inset(0 0 0 0)" : "inset(0 100% 0 0)",
              }}
            />

            {/* Floating content — left-justified, rising from the avatar. */}
            <div
              className="absolute bottom-[120px] flex flex-col gap-[2px] pl-[40px] pr-16"
              style={{ left: 0 }}
            >
              <div className={cn(rowClass, "mb-[22px] pl-[24px]")} style={rowStyle(0)}>
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

              <div className={rowClass} style={rowStyle(1)} data-first-action>
                <OperatorAction
                  icon={Settings}
                  label={t("menu.settings")}
                  onSelect={() => goTo("/settings")}
                />
              </div>
              <div className={rowClass} style={rowStyle(2)}>
                <OperatorAction
                  icon={Globe}
                  label={t("menu.website")}
                  onSelect={() => openExternal(OPS_WEBSITE_URL)}
                  external
                />
              </div>
              <div className={rowClass} style={rowStyle(3)}>
                <OperatorAction
                  icon={GraduationCap}
                  label={t("menu.courses")}
                  onSelect={() => openExternal(OPS_COURSES_URL)}
                  external
                />
              </div>
              <div className={rowClass} style={rowStyle(4)}>
                <OperatorAction
                  icon={Smartphone}
                  label={t("menu.iosApp")}
                  onSelect={() => openExternal(IOS_APP_STORE_URL)}
                  external
                />
              </div>
              <div className={rowClass} style={rowStyle(5)}>
                <OperatorAction
                  icon={Bug}
                  label={t("menu.reportBug")}
                  onSelect={handleReportBug}
                />
              </div>
              <div className={rowClass} style={rowStyle(6)}>
                <OperatorAction
                  icon={LogOut}
                  label={t("menu.signOut")}
                  onSelect={handleSignOut}
                  danger
                />
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

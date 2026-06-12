"use client";

/**
 * Sidebar — the instrument rail (WEB OVERHAUL P2, variant B).
 *
 * Desktop: a fixed 72px icon rail. It never expands and nothing reflows —
 * each icon surfaces its label as a glass tooltip that flies out to the
 * right on hover/focus, leaving the rail (and the page) perfectly still.
 * This replaces the earlier hover-to-expand overlay, whose width animation
 * read as jarring every time the cursor grazed the rail.
 *
 * Mobile (<768px): slide-in drawer with the full labelled anatomy, scrim
 * dismiss + Escape.
 *
 * Nav structure comes from the route registry — labels resolve through the
 * `navigation` dictionary, visibility through RBAC (`can`), commercial
 * feature flags (`isPermissionUnlocked` → dimmed request-access state), and
 * the Phase C posture (`canAccessFeature("phase_c")` → entries render only
 * for flagged companies, invisible to everyone else). The Inbox nav entry
 * is gone (master plan §3 — UI shelved); its route survives behind the
 * inbox_ui flag, reachable by URL and old notification links.
 *
 * Z (nav band): top bar 500 · mobile scrim 502 · sidebar 505 · tooltip 1000.
 */

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { OpsMark } from "@/components/brand";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  usePermissionStore,
  selectPermissionsReady,
} from "@/lib/store/permissions-store";
import {
  useFeatureFlagsStore,
  selectFlagsReady,
} from "@/lib/store/feature-flags-store";
import { useCompany } from "@/lib/hooks";
import { useDictionary } from "@/i18n/client";
import { useFeatureAccessRequests } from "@/lib/hooks/use-feature-access-requests";
import { useApprovalQueuePendingCount } from "@/lib/hooks/use-approval-queue";
import { getSlugForPermission } from "@/lib/feature-flags/feature-flag-definitions";
import {
  getNavEntries,
  isNavEntryActive,
  entryPermissions,
  type RouteEntry,
  type NavGroup,
} from "@/lib/navigation/route-registry";
import { FeatureAccessModal } from "@/components/ops/feature-access-modal";
import { OperatorMenu } from "./operator-menu";
import packageJson from "../../../package.json";

// Rail geometry — the 72px width is shared with dashboard-layout's
// md:pl-[72px] content inset and md:left-[72px] top-bar / gradient offsets.
const RAIL_PX = 72;
const MOBILE_DRAWER_PX = 280;
// Tooltip dwell before it surfaces — long enough that cursor fly-overs on the
// way to page content never flash a label, short enough to feel instant.
const TOOLTIP_DELAY_MS = 90;

// ─── Tooltip (desktop icon labels) ───────────────────────────────────────────

interface TipState {
  label: string;
  top: number;
  left: number;
}

// ─── Nav row ─────────────────────────────────────────────────────────────────

interface NavRowProps {
  entry: RouteEntry;
  /** Mobile drawer shows labels inline; desktop rail is icon-only. */
  expanded: boolean;
  isActive: boolean;
  gated: boolean;
  badgeCount?: number;
  gatedTooltip?: string;
  onSelect: () => void;
  onShowTip: (el: HTMLElement, label: string) => void;
  onHideTip: () => void;
}

function NavRow({
  entry,
  expanded,
  isActive,
  gated,
  badgeCount,
  gatedTooltip,
  onSelect,
  onShowTip,
  onHideTip,
}: NavRowProps) {
  const Icon = entry.icon;
  const { t } = useDictionary("navigation");
  const label = t(entry.labelKey);

  // Desktop tooltip surfaces the label (or the gated reason). On mobile the
  // label is already inline, so the tooltip stays dormant.
  const tipLabel = gated ? gatedTooltip ?? label : label;
  const tipHandlers = expanded
    ? {}
    : {
        onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) =>
          onShowTip(e.currentTarget, tipLabel),
        onMouseLeave: onHideTip,
        onFocus: (e: React.FocusEvent<HTMLButtonElement>) =>
          onShowTip(e.currentTarget, tipLabel),
        onBlur: onHideTip,
      };

  return (
    <button
      type="button"
      onClick={() => {
        onHideTip();
        onSelect();
      }}
      aria-label={label}
      aria-current={isActive ? "page" : undefined}
      {...tipHandlers}
      className={cn(
        "group relative flex w-full items-center",
        "transition-colors duration-150 ease-smooth motion-reduce:transition-none",
        expanded
          ? "h-[40px] gap-3 rounded-[6px] px-3"
          : "h-[44px] justify-center px-0",
        gated
          ? "text-text-mute opacity-50 hover:opacity-70 cursor-pointer"
          : isActive
            ? "text-text"
            : "text-text-3 hover:text-text",
        // On mobile the whole row carries the fill; on the rail the fill is a
        // centered tile drawn below, so the row itself stays transparent.
        expanded &&
          !gated &&
          (isActive
            ? "bg-surface-active"
            : "hover:bg-surface-hover")
      )}
    >
      {/* Active edge marker — 2px text-2 bar at the rail's inner edge. No
          accent on nav (DESIGN.md §9). */}
      {isActive && !gated && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-1/2 h-[18px] w-[2px] -translate-y-1/2 rounded-[1px] bg-text-2",
            expanded ? "left-0" : "left-[7px]"
          )}
        />
      )}

      {/* Icon — on the rail it sits inside a 40px tile that carries the
          hover/active fill; in the drawer it's a bare glyph. */}
      <span
        className={cn(
          "relative flex shrink-0 items-center justify-center",
          !expanded &&
            "h-[40px] w-[40px] rounded-[6px] transition-colors duration-150 motion-reduce:transition-none",
          !expanded &&
            !gated &&
            (isActive
              ? "bg-surface-active"
              : "group-hover:bg-surface-hover")
        )}
      >
        <Icon
          className={cn(
            "h-[20px] w-[20px] transition-colors duration-150 motion-reduce:transition-none",
            gated
              ? "text-text-mute"
              : isActive
                ? "text-text"
                : "text-text-3 group-hover:text-text-2"
          )}
        />
        {/* Rail badge — small count dot pinned to the tile corner. */}
        {!expanded && badgeCount !== undefined && badgeCount > 0 && (
          <span className="absolute -right-[1px] -top-[1px] flex h-[15px] min-w-[15px] items-center justify-center rounded-[4px] bg-surface-active px-[3px] font-mono text-[9px] leading-none text-text-2 tabular-nums">
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </span>

      {expanded && (
        <span className="truncate font-cakemono text-[13px] font-light uppercase tracking-[0.02em]">
          {label}
        </span>
      )}
      {/* Drawer badge — inline trailing count. */}
      {expanded && badgeCount !== undefined && badgeCount > 0 && (
        <span className="ml-auto rounded-[4px] bg-surface-active px-[5px] py-[2px] font-mono text-[10px] leading-none text-text-2 tabular-nums">
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
    </button>
  );
}

// ─── Group section mark ──────────────────────────────────────────────────────

function GroupMark({
  group,
  expanded,
  first,
}: {
  group: NavGroup;
  expanded: boolean;
  first: boolean;
}) {
  const { t } = useDictionary("navigation");
  if (!expanded) {
    // On the rail there's no room for a label — the group boundary reads as a
    // short centered hairline.
    if (first) return null;
    return (
      <div
        aria-hidden="true"
        className="mx-auto my-2 h-px w-[28px] bg-[rgba(255,255,255,0.10)]"
      />
    );
  }
  return (
    <div className="flex items-baseline gap-1 px-2 pb-1.5 pt-3">
      <span
        aria-hidden="true"
        className="font-mono text-[10px] tracking-[0.16em] text-text-mute"
      >
        {"//"}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-3">
        {t(`group.${group}`)}
      </span>
    </div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { isMobileOpen, closeMobile } = useSidebarStore();
  const currentUser = useAuthStore((s) => s.currentUser);
  const storeCompany = useAuthStore((s) => s.company);
  const { data: freshCompany } = useCompany();
  const company = freshCompany ?? storeCompany;
  const { t } = useDictionary("navigation");

  const can = usePermissionStore((s) => s.can);
  const permissionsReady = usePermissionStore(selectPermissionsReady);
  const isPermissionUnlocked = useFeatureFlagsStore(
    (s) => s.isPermissionUnlocked
  );
  const canAccessFeature = useFeatureFlagsStore((s) => s.canAccessFeature);
  const flagsReady = useFeatureFlagsStore(selectFlagsReady);

  // Phase C surfaces render only for flagged companies. Flags load async and
  // unknown slugs default to accessible, so the readiness gate is what
  // prevents a boot-time flash of Calibration/Agent Queue for everyone.
  const phaseCVisible = flagsReady && canAccessFeature("phase_c");

  const { data: agentQueuePendingCount = 0 } = useApprovalQueuePendingCount({
    enabled: phaseCVisible,
  });

  const [accessModalFeature, setAccessModalFeature] = useState<{
    label: string;
    slug: string;
  } | null>(null);
  const { data: requestedSlugs, refetch: refetchRequests } =
    useFeatureAccessRequests(currentUser?.id);

  // ── Mobile detection ───────────────────────────────────────────────────
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

  // Escape closes the mobile drawer.
  useEffect(() => {
    if (!isMobileOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeMobile();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isMobileOpen, closeMobile]);

  const expanded = isMobileView;

  // ── Label tooltips (desktop rail) ──────────────────────────────────────
  // A single portalled chip, positioned from the hovered/focused row's rect
  // so it escapes the rail's clipping and never shifts layout.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [tip, setTip] = useState<TipState | null>(null);
  const tipTimer = useRef<number | null>(null);
  const clearTipTimer = useCallback(() => {
    if (tipTimer.current !== null) {
      window.clearTimeout(tipTimer.current);
      tipTimer.current = null;
    }
  }, []);
  const showTip = useCallback(
    (el: HTMLElement, label: string) => {
      if (isMobileView) return;
      clearTipTimer();
      tipTimer.current = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        // Anchor to the rail's right edge (not the button's) so the chip
        // always clears the rail with a consistent gap.
        const railRight =
          el.closest("aside")?.getBoundingClientRect().right ?? r.right;
        setTip({ label, top: r.top + r.height / 2, left: railRight + 8 });
      }, TOOLTIP_DELAY_MS);
    },
    [isMobileView, clearTipTimer]
  );
  const hideTip = useCallback(() => {
    clearTipTimer();
    setTip(null);
  }, [clearTipTimer]);
  useEffect(() => clearTipTimer, [clearTipTimer]);

  // ── Nav rows (registry × live gates) ───────────────────────────────────
  type Row =
    | { kind: "mark"; group: NavGroup; first: boolean }
    | { kind: "entry"; entry: RouteEntry; gated: boolean; badgeCount?: number };

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let currentGroup: NavGroup | null = null;

    for (const entry of getNavEntries()) {
      if (entry.nav === false) continue;
      if (entry.phaseCOnly && !phaseCVisible) continue;

      let gated = false;
      const perms = entryPermissions(entry);
      if (perms.length > 0) {
        if (!perms.some(isPermissionUnlocked)) {
          // Commercial feature flag locked — visible but dimmed, click opens
          // the request-access flow. Any-of entries (BOOKS) dim only when
          // every constituent permission is flag-locked.
          gated = true;
        } else if (permissionsReady && !perms.some((p) => can(p))) {
          // RBAC — hidden outright once permissions have resolved.
          continue;
        }
      }

      if (entry.nav.group !== currentGroup) {
        out.push({
          kind: "mark",
          group: entry.nav.group,
          first: currentGroup === null,
        });
        currentGroup = entry.nav.group;
      }

      out.push({
        kind: "entry",
        entry,
        gated,
        badgeCount:
          entry.badge === "agentQueuePending" && agentQueuePendingCount > 0
            ? agentQueuePendingCount
            : undefined,
      });
    }
    return out;
  }, [
    phaseCVisible,
    isPermissionUnlocked,
    permissionsReady,
    can,
    agentQueuePendingCount,
  ]);

  const handleSelect = useCallback(
    (entry: RouteEntry, gated: boolean) => {
      if (gated) {
        const slug = entryPermissions(entry)
          .map(getSlugForPermission)
          .find((s): s is NonNullable<ReturnType<typeof getSlugForPermission>> => !!s);
        if (slug) setAccessModalFeature({ label: t(entry.labelKey), slug });
        return;
      }
      router.push(entry.href);
      closeMobile();
    },
    [router, closeMobile, t]
  );

  return (
    <>
      {/* Mobile scrim */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-[502] bg-black/50 md:hidden"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      <aside
        aria-hidden={isMobileView && !isMobileOpen ? "true" : undefined}
        className={cn(
          "fixed left-0 top-0 z-[505] flex h-screen flex-col",
          "border-r border-glass-border",
          "transition-transform duration-200 ease-smooth motion-reduce:transition-none",
          // Mobile: off-canvas drawer. The visibility/pointer-events pair keeps
          // the drawer genuinely inert when closed even if a legacy WebView
          // drops the transform (drawer used to land back in layout and
          // overlap dashboard widgets at 390px).
          isMobileOpen
            ? "translate-x-0 visible pointer-events-auto"
            : "-translate-x-full invisible pointer-events-none",
          "md:translate-x-0 md:visible md:pointer-events-auto"
        )}
        style={{
          // Sidebar is a panel-tier surface: .glass-surface 0.58 (DESIGN.md §5
          // surface table) — glass-dense is reserved for modals/popovers.
          width: isMobileView ? MOBILE_DRAWER_PX : RAIL_PX,
          background: "var(--glass)",
          backdropFilter: "blur(28px) saturate(1.3)",
          WebkitBackdropFilter: "blur(28px) saturate(1.3)",
        }}
      >
        {/* glass-surface top-edge gradient — the only lit-from-above cue */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.04), transparent 40%)",
          }}
        />
        {/* Company header */}
        <div
          className={cn(
            "flex h-[56px] shrink-0 items-center border-b border-border",
            expanded ? "gap-2.5 px-[20px]" : "justify-center px-0"
          )}
        >
          <div className="flex h-[28px] w-[28px] shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-[rgba(255,255,255,0.08)]">
            {company?.logoURL ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={company.logoURL}
                alt={company.name || t("company.logoAlt")}
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <Building2 className="h-[16px] w-[16px] text-text-3" />
            )}
          </div>
          {expanded && (
            <span className="truncate font-cakemono text-[14px] font-light uppercase text-text">
              {company?.name || t("company.fallback")}
            </span>
          )}
        </div>

        {/* Navigation */}
        <nav
          className={cn(
            "flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide",
            expanded ? "px-3.5 py-1.5" : "px-0 py-2"
          )}
        >
          {rows.map((row, i) =>
            row.kind === "mark" ? (
              <GroupMark
                key={`mark-${row.group}-${i}`}
                group={row.group}
                expanded={expanded}
                first={row.first}
              />
            ) : (
              <div
                key={row.entry.key}
                className={cn(expanded ? "mb-[2px]" : "mb-[3px] px-2")}
              >
                <NavRow
                  entry={row.entry}
                  expanded={expanded}
                  isActive={!row.gated && isNavEntryActive(row.entry, pathname)}
                  gated={row.gated}
                  badgeCount={row.badgeCount}
                  gatedTooltip={
                    row.gated && entryPermissions(row.entry).length > 0
                      ? requestedSlugs?.has(
                          entryPermissions(row.entry)
                            .map(getSlugForPermission)
                            .find((s) => !!s) ?? ""
                        )
                        ? t("gated.accessRequested")
                        : t("gated.inDevelopment")
                      : undefined
                  }
                  onSelect={() => handleSelect(row.entry, row.gated)}
                  onShowTip={showTip}
                  onHideTip={hideTip}
                />
              </div>
            )
          )}
        </nav>

        {/* Footer: brand + version, then the operator section */}
        <div
          className={cn(
            "shrink-0 border-t border-border",
            expanded ? "p-3.5 pt-2.5" : "px-2 pb-2.5 pt-2"
          )}
        >
          <div
            className={cn(
              "flex items-center gap-2 pb-2",
              expanded ? "px-2" : "justify-center px-0"
            )}
          >
            <OpsMark
              title=""
              className="h-[14px] w-auto shrink-0 select-none text-text-3"
            />
            {expanded && (
              <span className="select-none font-mono text-[10px] tracking-[0.14em] text-text-3 tabular-nums">
                {t("version.prefix")}
                {packageJson.version}
              </span>
            )}
          </div>
          <OperatorMenu expanded={expanded} />
        </div>
      </aside>

      {/* Desktop label tooltip — portalled so it escapes the rail and never
          reflows the page. Suppressed on mobile, where labels are inline. */}
      {mounted &&
        tip &&
        !isMobileView &&
        createPortal(
          <div
            role="tooltip"
            style={{ position: "fixed", top: tip.top, left: tip.left }}
            className="pointer-events-none z-[1000] -translate-y-1/2 animate-fade-in rounded-[4px] border border-glass-border px-[9px] py-[5px] motion-reduce:animate-none"
          >
            <span
              aria-hidden="true"
              className="absolute inset-0 -z-[1] rounded-[4px]"
              style={{
                background: "var(--glass-dense)",
                backdropFilter: "blur(28px) saturate(1.3)",
                WebkitBackdropFilter: "blur(28px) saturate(1.3)",
              }}
            />
            <span className="whitespace-nowrap font-cakemono text-[12px] font-light uppercase tracking-[0.04em] text-text">
              {tip.label}
            </span>
          </div>,
          document.body
        )}

      {/* Feature access request modal (gated entries) */}
      {accessModalFeature && (
        <FeatureAccessModal
          open={accessModalFeature !== null}
          onClose={() => setAccessModalFeature(null)}
          featureLabel={accessModalFeature.label}
          featureSlug={accessModalFeature.slug}
          alreadyRequested={
            requestedSlugs?.has(accessModalFeature.slug) ?? false
          }
          onRequestSubmitted={() => refetchRequests()}
        />
      )}
    </>
  );
}

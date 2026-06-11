"use client";

/**
 * Sidebar — the HUD rail (WEB OVERHAUL P2, rebuilt from scratch).
 *
 * Desktop: 72px instrument rail at rest → 240px glass-dense overlay on
 * hover. Expansion waits 120ms of hover intent (mousing past the rail to
 * reach content never flares it open) and collapses after an 80ms grace.
 * Keyboard focus entering the rail expands it immediately.
 *
 * Mobile (<768px): slide-in drawer, always-expanded anatomy, scrim
 * dismiss + Escape.
 *
 * Nav structure comes from the route registry — labels resolve through the
 * `navigation` dictionary, visibility through RBAC (`can`), commercial
 * feature flags (`isPermissionUnlocked` → dimmed request-access state),
 * and the Phase C posture (`canAccessFeature("phase_c")` → entries render
 * only for flagged companies, invisible to everyone else). The Inbox nav
 * entry is gone (master plan §3 — UI shelved); its route survives for
 * inbox_ui-flagged companies via the page's server gate + the registry's
 * non-nav entry, reachable by URL and old notification links.
 *
 * Z (nav band): top bar 500 · mobile scrim 502 · sidebar 505.
 */

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type RouteEntry,
  type NavGroup,
} from "@/lib/navigation/route-registry";
import { FeatureAccessModal } from "@/components/ops/feature-access-modal";
import { OperatorMenu } from "./operator-menu";
import packageJson from "../../../package.json";

// Rail geometry — the 72px rest width is shared with dashboard-layout's
// pl-[72px] content inset and md:left-[72px] top-bar offset.
const RAIL_REST_PX = 72;
const RAIL_EXPANDED_PX = 240;
const MOBILE_DRAWER_PX = 280;
const HOVER_INTENT_MS = 120;
const HOVER_GRACE_MS = 80;

// ─── Nav row ─────────────────────────────────────────────────────────────────

interface NavRowProps {
  entry: RouteEntry;
  expanded: boolean;
  isActive: boolean;
  gated: boolean;
  badgeCount?: number;
  gatedTooltip?: string;
  onSelect: () => void;
}

function NavRow({
  entry,
  expanded,
  isActive,
  gated,
  badgeCount,
  gatedTooltip,
  onSelect,
}: NavRowProps) {
  const Icon = entry.icon;
  const { t } = useDictionary("navigation");

  return (
    <button
      type="button"
      onClick={onSelect}
      title={gated ? gatedTooltip : !expanded ? t(entry.labelKey) : undefined}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group relative flex w-full items-center h-[36px] rounded-[6px]",
        "transition-colors duration-150 ease-smooth motion-reduce:transition-none",
        expanded ? "gap-3 px-[11px]" : "justify-center px-0",
        gated
          ? "text-text-mute opacity-50 hover:opacity-70 cursor-pointer"
          : isActive
            ? "text-text"
            : "text-text-3 hover:text-text hover:bg-[rgba(255,255,255,0.04)]"
      )}
    >
      {/* Active indicator — 2px text-2 bar at the rail edge. No accent on nav. */}
      {isActive && !gated && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-3.5 top-[6px] bottom-[6px] w-[2px] rounded-[1px] bg-text-2"
        />
      )}
      <Icon
        className={cn(
          "h-[20px] w-[20px] shrink-0 transition-colors duration-150 motion-reduce:transition-none",
          gated
            ? "text-text-mute"
            : isActive
              ? "text-text"
              : "text-text-3 group-hover:text-text-2"
        )}
      />
      {expanded && (
        <span className="truncate font-cakemono font-light text-[13px] uppercase tracking-[0.02em]">
          {t(entry.labelKey)}
        </span>
      )}
      {badgeCount !== undefined && badgeCount > 0 && (
        <span
          className={cn(
            "font-mono text-micro leading-none text-text-2 tabular-nums",
            "rounded-[4px] bg-[rgba(255,255,255,0.08)] px-[5px] py-[2px]",
            expanded ? "ml-auto" : "absolute right-[6px] top-[2px]"
          )}
        >
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
    // At rest the group boundary reads as a hairline (no room for a label).
    if (first) return null;
    return (
      <div
        aria-hidden="true"
        className="mx-1.5 my-2 h-px bg-[rgba(255,255,255,0.06)]"
      />
    );
  }
  return (
    <div className="flex items-baseline gap-1 px-2 pb-1.5 pt-2.5">
      <span
        aria-hidden="true"
        className="font-mono text-[10px] tracking-[0.16em] text-text-mute"
      >
        {"//"}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
        {t(`group.${group}`)}
      </span>
    </div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { isHoverExpanded, setHoverExpanded, isMobileOpen, closeMobile } =
    useSidebarStore();
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

  // Phase C surfaces render only for flagged companies. Flags load async
  // and unknown slugs default to accessible, so the readiness gate is what
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

  // ── Hover intent (desktop) ─────────────────────────────────────────────
  const expandTimer = useRef<number | null>(null);
  const collapseTimer = useRef<number | null>(null);
  const clearTimers = useCallback(() => {
    if (expandTimer.current !== null) window.clearTimeout(expandTimer.current);
    if (collapseTimer.current !== null)
      window.clearTimeout(collapseTimer.current);
    expandTimer.current = null;
    collapseTimer.current = null;
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const handleEnter = useCallback(() => {
    if (isMobileView) return;
    clearTimers();
    expandTimer.current = window.setTimeout(
      () => setHoverExpanded(true),
      HOVER_INTENT_MS
    );
  }, [isMobileView, clearTimers, setHoverExpanded]);

  const handleLeave = useCallback(() => {
    if (isMobileView) return;
    clearTimers();
    collapseTimer.current = window.setTimeout(
      () => setHoverExpanded(false),
      HOVER_GRACE_MS
    );
  }, [isMobileView, clearTimers, setHoverExpanded]);

  // Keyboard parity: focus entering the rail expands immediately; focus
  // leaving collapses after the same grace as the pointer path.
  const handleFocus = useCallback(() => {
    if (isMobileView) return;
    clearTimers();
    setHoverExpanded(true);
  }, [isMobileView, clearTimers, setHoverExpanded]);

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLElement>) => {
      if (isMobileView) return;
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      handleLeave();
    },
    [isMobileView, handleLeave]
  );

  const expanded = isMobileView ? true : isHoverExpanded;

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
      if (entry.permission) {
        if (!isPermissionUnlocked(entry.permission)) {
          // Commercial feature flag locked — visible but dimmed, click
          // opens the request-access flow.
          gated = true;
        } else if (permissionsReady && !can(entry.permission)) {
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
      if (gated && entry.permission) {
        const slug = getSlugForPermission(entry.permission);
        if (slug) setAccessModalFeature({ label: t(entry.labelKey), slug });
        return;
      }
      router.push(entry.href);
      setHoverExpanded(false);
      closeMobile();
    },
    [router, setHoverExpanded, closeMobile, t]
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
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocusCapture={handleFocus}
        onBlur={handleBlur}
        aria-hidden={isMobileView && !isMobileOpen ? "true" : undefined}
        className={cn(
          "fixed left-0 top-0 z-[505] flex h-screen flex-col",
          "border-r border-[rgba(255,255,255,0.06)]",
          "transition-[width,transform] duration-200 ease-smooth motion-reduce:transition-none",
          // Mobile: off-canvas drawer. The visibility/pointer-events pair
          // keeps the drawer genuinely inert when closed even if a legacy
          // WebView drops the transform (drawer used to land back in layout
          // and overlap dashboard widgets at 390px).
          isMobileOpen
            ? "translate-x-0 visible pointer-events-auto"
            : "-translate-x-full invisible pointer-events-none",
          "md:translate-x-0 md:visible md:pointer-events-auto"
        )}
        style={{
          width: isMobileView
            ? MOBILE_DRAWER_PX
            : expanded
              ? RAIL_EXPANDED_PX
              : RAIL_REST_PX,
          background: "var(--surface-glass-dense)",
          backdropFilter: "blur(28px) saturate(1.3)",
          WebkitBackdropFilter: "blur(28px) saturate(1.3)",
        }}
      >
        {/* Company header */}
        <div
          className={cn(
            "flex h-[56px] shrink-0 items-center border-b border-[rgba(255,255,255,0.06)]",
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
            <span className="truncate font-cakemono font-light text-[14px] uppercase text-text">
              {company?.name || t("company.fallback")}
            </span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3.5 py-1.5 scrollbar-hide">
          {rows.map((row, i) =>
            row.kind === "mark" ? (
              <GroupMark
                key={`mark-${row.group}-${i}`}
                group={row.group}
                expanded={expanded}
                first={row.first}
              />
            ) : (
              <div key={row.entry.key} className="mb-[2px]">
                <NavRow
                  entry={row.entry}
                  expanded={expanded}
                  isActive={!row.gated && isNavEntryActive(row.entry, pathname)}
                  gated={row.gated}
                  badgeCount={row.badgeCount}
                  gatedTooltip={
                    row.gated && row.entry.permission
                      ? requestedSlugs?.has(
                          getSlugForPermission(row.entry.permission) ?? ""
                        )
                        ? t("gated.accessRequested")
                        : t("gated.inDevelopment")
                      : undefined
                  }
                  onSelect={() => handleSelect(row.entry, row.gated)}
                />
              </div>
            )
          )}
        </nav>

        {/* Footer: brand + version, then the operator section */}
        <div className="shrink-0 border-t border-[rgba(255,255,255,0.06)] p-3.5 pt-2.5">
          <div
            className={cn(
              "flex items-center gap-2 pb-2",
              expanded ? "px-2" : "justify-center px-0"
            )}
          >
            <OpsMark
              title=""
              className="h-[14px] w-auto shrink-0 select-none text-text-mute opacity-50"
            />
            {expanded && (
              <span className="select-none font-mono text-[10px] tracking-[0.14em] text-text-mute tabular-nums">
                {t("version.prefix")}
                {packageJson.version}
              </span>
            )}
          </div>
          <OperatorMenu expanded={expanded} />
        </div>
      </aside>

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

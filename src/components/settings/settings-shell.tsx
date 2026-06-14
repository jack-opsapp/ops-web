"use client";

/**
 * SettingsShell — the renovated Settings surface (WEB OVERHAUL P3-6).
 *
 * Horizontal domain tabs (icon + label, 2px monochrome active indicator — no
 * accent, per DESIGN.md §9 nav) over a shared `SegmentControl` of the active
 * domain's sub-sections (Books/Catalog grammar), over the section body. Replaces
 * the bespoke sliding-underline tab bar.
 *
 * State lives in the URL: `?section=<leaf>` is the source of truth (so the §2
 * `/team`→`/settings?section=team` redirect and stored deep links resolve);
 * legacy `?tab=<id>` canonicalizes to `?section=`. Visibility is granular-permission
 * + company-flag gated — never role-name filtering.
 */

import { useCallback, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore, selectPermissionsReady } from "@/lib/store/permissions-store";
import { useFeatureFlagsStore, selectFlagsReady } from "@/lib/store/feature-flags-store";
import { SegmentControl, type SegmentControlOption } from "@/components/ui/segment-control";
import {
  SETTINGS_DOMAINS,
  LEGACY_TAB_TO_SECTION,
  type SettingsDomain,
  type SettingsSection,
} from "./settings-domains";

export function SettingsShell() {
  usePageTitle("Settings");
  const { t } = useDictionary("settings");
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentUser = useAuthStore((s) => s.currentUser);
  const can = usePermissionStore((s) => s.can);
  const permReady = usePermissionStore(selectPermissionsReady);
  const isPermissionUnlocked = useFeatureFlagsStore((s) => s.isPermissionUnlocked);
  const canAccessFeature = useFeatureFlagsStore((s) => s.canAccessFeature);
  const flagsReady = useFeatureFlagsStore(selectFlagsReady);
  const devPermission = !!currentUser?.devPermission;

  // ── Section visibility (granular permission + company flag + dev gate) ────
  const isSectionVisible = useCallback(
    (s: SettingsSection): boolean => {
      if (s.devOnly) return devPermission;
      // Phase-C sections fail CLOSED until flags resolve (the store treats an
      // unknown slug as accessible, so a flag must be confirmed-enabled, not
      // merely not-yet-loaded).
      if (s.flag) {
        if (!flagsReady) return false;
        if (!canAccessFeature(s.flag)) return false;
      }
      if (s.permission) {
        if (!permReady) return false;
        if (!isPermissionUnlocked(s.permission)) return false;
        if (!can(s.permission)) return false;
      }
      return true;
    },
    [devPermission, flagsReady, canAccessFeature, permReady, isPermissionUnlocked, can],
  );

  // ── Visible domains (a domain shows iff ≥1 of its sections is visible) ────
  const visibleDomains = useMemo(() => {
    return SETTINGS_DOMAINS.map((domain) => ({
      ...domain,
      sections: domain.sections.filter(isSectionVisible),
    })).filter((domain) => domain.sections.length > 0);
  }, [isSectionVisible]);

  const visibleSectionIds = useMemo(
    () => new Set(visibleDomains.flatMap((d) => d.sections.map((s) => s.id))),
    [visibleDomains],
  );

  const firstVisibleSectionId = visibleDomains[0]?.sections[0]?.id ?? null;

  // ── URL state ─────────────────────────────────────────────────────────────
  const sectionParam = searchParams.get("section");
  const tabParam = searchParams.get("tab");

  // Canonicalize legacy `?tab=<id>` → `?section=<mapped>` (command palette /
  // stored links: /settings?tab=subscription, ?tab=roles, …).
  useEffect(() => {
    if (!tabParam) return;
    const mapped = LEGACY_TAB_TO_SECTION[tabParam] ?? tabParam;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tab");
    params.set("section", mapped);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam]);

  const activeSectionId =
    sectionParam && visibleSectionIds.has(sectionParam)
      ? sectionParam
      : firstVisibleSectionId;

  const activeDomain: SettingsDomain | null =
    visibleDomains.find((d) => d.sections.some((s) => s.id === activeSectionId)) ?? null;
  const activeSection = activeDomain?.sections.find((s) => s.id === activeSectionId) ?? null;

  const goToSection = useCallback(
    (sectionId: string) => {
      router.replace(`/settings?section=${sectionId}`, { scroll: false });
    },
    [router],
  );

  const goToDomain = useCallback(
    (domain: SettingsDomain) => {
      if (domain.id === activeDomain?.id) return;
      const first = domain.sections[0];
      if (first) goToSection(first.id);
    },
    [activeDomain?.id, goToSection],
  );

  // Sub-section segment options for the active domain.
  const segmentOptions: SegmentControlOption[] = useMemo(
    () => (activeDomain?.sections ?? []).map((s) => ({ value: s.id, label: t(s.labelKey) })),
    [activeDomain, t],
  );

  const Body = activeSection?.component ?? null;

  return (
    <div className="space-y-3">
      {/* ── Domain tabs ───────────────────────────────────────────────────── */}
      <div className="overflow-x-auto border-b border-line [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max items-stretch">
          {visibleDomains.map((domain) => {
            const isActive = domain.id === activeDomain?.id;
            const Icon = domain.icon;
            return (
              <button
                key={domain.id}
                type="button"
                onClick={() => goToDomain(domain)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex shrink-0 items-center gap-1.5 px-2 py-2",
                  "font-mohave text-body-sm uppercase tracking-[0.04em] whitespace-nowrap",
                  "transition-colors duration-150 ease-smooth",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
                  isActive ? "text-text" : "text-text-3 hover:text-text-2",
                )}
              >
                <Icon className="h-[16px] w-[16px]" />
                {t(domain.labelKey)}
                {isActive && (
                  <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-text-2" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Sub-section switcher (only when the domain has >1 section) ─────── */}
      {activeDomain && segmentOptions.length > 1 && activeSectionId && (
        <SegmentControl
          options={segmentOptions}
          value={activeSectionId}
          onChange={goToSection}
        />
      )}

      {/* ── Section body ──────────────────────────────────────────────────── */}
      <div key={activeSectionId ?? "none"} className="animate-slide-up">
        {/* Defense-in-depth: only render once a visible section resolves. */}
        {Body && activeSection && isSectionVisible(activeSection) ? <Body /> : null}
      </div>
    </div>
  );
}

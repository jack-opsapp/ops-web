"use client";

import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { useSearchParams } from "next/navigation";
import {
  User,
  Building2,
  CreditCard,
  SlidersHorizontal,
  Keyboard,
  Mail,
  Palette,
  Database,
  Receipt,
  Users,
  ListChecks,
  Code2,
  Globe,
  Plug,
  FileText,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore, selectPermissionsReady } from "@/lib/store/permissions-store";
import { useDictionary } from "@/i18n/client";
import { ProfileTab } from "@/components/settings/profile-tab";
import { CompanyTab } from "@/components/settings/company-tab";
import { SubscriptionTab } from "@/components/settings/subscription-tab";
import { IntegrationsTab } from "@/components/settings/integrations-tab";
import { PreferencesTab } from "@/components/settings/preferences-tab";
import { ShortcutsTab } from "@/components/settings/shortcuts-tab";
import { AppearanceTab } from "@/components/settings/appearance-tab";
import { DataPrivacyTab } from "@/components/settings/data-privacy-tab";
import { BillingTab } from "@/components/settings/billing-tab";
import { TeamTab } from "@/components/settings/team-tab";
import { TaskTypesTab } from "@/components/settings/task-types-tab";
import { DeveloperTab } from "@/components/settings/developer-tab";
import { PortalBrandingTab } from "@/components/settings/portal-branding-tab";
import { DocumentTemplatesTab } from "@/components/settings/document-templates-tab";
// QuickActionsTab merged into PreferencesTab
import { RolesTab } from "@/components/settings/roles-tab";
import { AccountingTab } from "@/components/settings/accounting-tab";
import { ExpenseSettingsTab } from "@/components/settings/expense-settings-tab";
import { NotificationsTab } from "@/components/settings/notifications-tab";
import { MapPreferencesTab } from "@/components/settings/map-preferences-tab";
import { InventoryTab } from "@/components/settings/inventory-tab";

// ─── Types ───────────────────────────────────────────────────────────────────

type SettingsGroup = "account" | "company" | "operations" | "billing" | "integrations" | "preferences" | "developer";

interface SubTab {
  id: string;
  labelKey: string;
}

interface GroupDef {
  id: SettingsGroup;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  subTabs: SubTab[];
}

// ─── Tab definitions ─────────────────────────────────────────────────────────

const BASE_GROUP_DEFS: GroupDef[] = [
  {
    id: "account",
    labelKey: "tabs.account",
    icon: User,
    subTabs: [
      { id: "profile", labelKey: "sections.profile" },
      { id: "appearance", labelKey: "sections.appearance" },
      { id: "notifications", labelKey: "sections.notifications" },
      { id: "shortcuts", labelKey: "sections.shortcuts" },
    ],
  },
  {
    id: "company",
    labelKey: "tabs.company",
    icon: Building2,
    subTabs: [
      { id: "company-details", labelKey: "sections.companyDetails" },
      { id: "team", labelKey: "sections.teamMembers" },
      { id: "roles", labelKey: "sections.roles" },
    ],
  },
  {
    id: "operations",
    labelKey: "tabs.operations",
    icon: Wrench,
    subTabs: [
      { id: "task-types", labelKey: "sections.taskTypes" },
      { id: "inventory", labelKey: "sections.inventory" },
      { id: "expenses", labelKey: "sections.expenses" },
    ],
  },
  {
    id: "billing",
    labelKey: "tabs.billing",
    icon: CreditCard,
    subTabs: [
      { id: "subscription", labelKey: "sections.subscription" },
      { id: "payment", labelKey: "sections.payment" },
    ],
  },
  {
    id: "integrations",
    labelKey: "tabs.integrations",
    icon: Plug,
    subTabs: [
      { id: "email", labelKey: "sections.email" },
      { id: "portal", labelKey: "sections.portal" },
      { id: "templates", labelKey: "sections.templates" },
      { id: "accounting", labelKey: "sections.accounting" },
    ],
  },
  {
    id: "preferences",
    labelKey: "tabs.preferences",
    icon: SlidersHorizontal,
    subTabs: [
      { id: "preferences-general", labelKey: "sections.preferences" },
      { id: "map", labelKey: "sections.map" },
      { id: "data-privacy", labelKey: "sections.dataPrivacy" },
    ],
  },
];

const DEV_GROUP: GroupDef = {
  id: "developer",
  labelKey: "tabs.developer",
  icon: Code2,
  subTabs: [{ id: "developer", labelKey: "sections.developer" }],
};

// Legacy tab IDs from URL params
const legacyTabMap: Record<string, { group: SettingsGroup; sub: string }> = {
  profile: { group: "account", sub: "profile" },
  appearance: { group: "account", sub: "appearance" },
  shortcuts: { group: "account", sub: "shortcuts" },
  notifications: { group: "account", sub: "notifications" },
  company: { group: "company", sub: "company-details" },
  team: { group: "company", sub: "team" },
  roles: { group: "company", sub: "roles" },
  "task-types": { group: "operations", sub: "task-types" },
  inventory: { group: "operations", sub: "inventory" },
  expenses: { group: "operations", sub: "expenses" },
  "quick-actions": { group: "preferences", sub: "preferences-general" },
  subscription: { group: "billing", sub: "subscription" },
  billing: { group: "billing", sub: "payment" },
  integrations: { group: "integrations", sub: "email" },
  portal: { group: "integrations", sub: "portal" },
  accounting: { group: "integrations", sub: "accounting" },
  preferences: { group: "preferences", sub: "preferences-general" },
  map: { group: "preferences", sub: "map" },
  "data-privacy": { group: "preferences", sub: "data-privacy" },
  developer: { group: "developer", sub: "developer" },
};

// ─── Content map ─────────────────────────────────────────────────────────────

const CONTENT_MAP: Record<string, React.ComponentType> = {
  profile: ProfileTab,
  appearance: AppearanceTab,
  shortcuts: ShortcutsTab,
  "company-details": CompanyTab,
  team: TeamTab,
  roles: RolesTab,
  "task-types": TaskTypesTab,
  inventory: InventoryTab,
  subscription: SubscriptionTab,
  payment: BillingTab,
  email: IntegrationsTab,
  portal: PortalBrandingTab,
  templates: DocumentTemplatesTab,
  accounting: AccountingTab,
  "preferences-general": PreferencesTab,
  notifications: NotificationsTab,
  map: MapPreferencesTab,
  expenses: ExpenseSettingsTab,
  "data-privacy": DataPrivacyTab,
  developer: DeveloperTab,
};

// ─── Component ───────────────────────────────────────────────────────────────

/** Sub-tab IDs that require a specific permission to be visible */
const SUB_TAB_PERMISSIONS: Record<string, string> = {
  roles: "team.assign_roles",
};

export default function SettingsPage() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const can = usePermissionStore((s) => s.can);
  const permReady = usePermissionStore(selectPermissionsReady);
  const { t } = useDictionary("settings");

  // Filter sub-tabs based on permissions (memoize to prevent infinite re-render loop)
  const groupDefs = useMemo(() => {
    const base = permReady
      ? BASE_GROUP_DEFS.map((group) => ({
          ...group,
          subTabs: group.subTabs.filter((sub) => {
            const required = SUB_TAB_PERMISSIONS[sub.id];
            return !required || can(required);
          }),
        })).filter((group) => group.subTabs.length > 0)
      : BASE_GROUP_DEFS;

    return currentUser?.devPermission ? [...base, DEV_GROUP] : base;
  }, [permReady, can, currentUser?.devPermission]);

  const searchParams = useSearchParams();

  const [activeGroup, setActiveGroup] = useState<SettingsGroup>("account");
  const [activeSubTab, setActiveSubTab] = useState("profile");
  const [underlineStyle, setUnderlineStyle] = useState({ left: 0, width: 0, opacity: 0 });
  const [flashContent, setFlashContent] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const majorTabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const subTabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const groupContainerRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // ── Group change handler ───────────────────────────────────────────────
  function handleGroupChange(groupId: SettingsGroup) {
    if (groupId === activeGroup) return;
    const def = groupDefs.find((g) => g.id === groupId);
    if (!def) return;
    setActiveGroup(groupId);
    setActiveSubTab(def.subTabs[0].id);
  }

  // ── Underline position calculation ─────────────────────────────────────
  const updateUnderline = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const activeGroupDef = groupDefs.find((g) => g.id === activeGroup);
    const hasMultipleSubs = (activeGroupDef?.subTabs.length ?? 0) > 1;

    // When group has multiple sub-tabs, span the entire group container
    // Otherwise just the major tab button
    const el = hasMultipleSubs
      ? groupContainerRefs.current.get(activeGroup)
      : majorTabRefs.current.get(activeGroup);

    if (el) {
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      if (elRect.width > 0) {
        const inset = hasMultipleSubs ? 4 : 12;
        setUnderlineStyle({
          left: elRect.left - containerRect.left + inset,
          width: elRect.width - inset * 2,
          opacity: 1,
        });
      }
    }
  }, [activeGroup, activeSubTab, groupDefs]);

  // Recalculate underline after group/sub changes (after expand animation)
  useEffect(() => {
    setUnderlineStyle((prev) => ({ ...prev, opacity: 0 }));
    const timer = setTimeout(() => updateUnderline(), 320);
    return () => clearTimeout(timer);
  }, [activeGroup, activeSubTab, updateUnderline]);

  // ResizeObserver for responsive updates
  useEffect(() => {
    const observer = new ResizeObserver(() => updateUnderline());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updateUnderline]);

  // Handle URL params — reacts to searchParams changes (e.g., from command palette)
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (!tab) return;

    let didNavigate = false;
    if (groupDefs.some((g) => g.id === tab)) {
      handleGroupChange(tab as SettingsGroup);
      didNavigate = true;
    } else if (legacyTabMap[tab]) {
      setActiveGroup(legacyTabMap[tab].group);
      setActiveSubTab(legacyTabMap[tab].sub);
      didNavigate = true;
    }

    // Flash the content card to draw attention
    if (didNavigate) {
      setFlashContent(false);
      requestAnimationFrame(() => setFlashContent(true));
      const timer = setTimeout(() => setFlashContent(false), 1200);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ── Render ─────────────────────────────────────────────────────────────
  const ContentComponent = CONTENT_MAP[activeSubTab];

  return (
    <div className="space-y-3">
      {/* ── Tab bar ───────────────────────────────────────────────────── */}
      <div className="border-b border-[rgba(255,255,255,0.15)] overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div
          ref={containerRef}
          className="relative flex items-center min-w-max"
        >
          {groupDefs.map((group) => {
            const isActive = activeGroup === group.id;
            const Icon = group.icon;
            const hasMultipleSubs = group.subTabs.length > 1;

            return (
              <div
                key={group.id}
                ref={(el) => {
                  if (el) groupContainerRefs.current.set(group.id, el);
                }}
                className={cn(
                  "flex items-center shrink-0",
                  isActive && hasMultipleSubs && "mr-2"
                )}
              >
                {/* Major tab button */}
                <button
                  ref={(el) => {
                    if (el) majorTabRefs.current.set(group.id, el);
                  }}
                  onClick={() => handleGroupChange(group.id)}
                  className={cn(
                    "relative flex items-center justify-center gap-[6px] px-1.5 py-[8px]",
                    "transition-colors duration-200 shrink-0",
                    isActive
                      ? "text-text-primary"
                      : "text-text-tertiary hover:text-text-secondary"
                  )}
                >
                  <Icon className="w-[16px] h-[16px]" />
                  <span className="font-mohave text-body-sm uppercase tracking-[0.04em] whitespace-nowrap">
                    {t(group.labelKey)}
                  </span>
                </button>

                {/* Expandable sub-tabs (only for groups with 2+ sub-tabs) */}
                {hasMultipleSubs && (
                  <div
                    className={cn(
                      "grid transition-[grid-template-columns] duration-300 ease-out",
                      isActive ? "grid-cols-[1fr]" : "grid-cols-[0fr]"
                    )}
                  >
                    <div className="overflow-hidden min-w-0 flex items-center">
                      {/* Vertical divider */}
                      <div
                        className={cn(
                          "w-px h-[14px] bg-border-default mx-[3px] shrink-0 transition-opacity duration-200",
                          isActive ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {/* Sub-tab buttons */}
                      {group.subTabs.map((sub, i) => (
                        <Fragment key={sub.id}>
                          {i > 0 && (
                            <span
                              className={cn(
                                "text-text-disabled text-[8px] mx-[2px] select-none",
                                "transition-opacity duration-200",
                                isActive ? "opacity-60" : "opacity-0"
                              )}
                            >
                              /
                            </span>
                          )}
                          <button
                            ref={(el) => {
                              if (el) subTabRefs.current.set(sub.id, el);
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveSubTab(sub.id);
                            }}
                            className={cn(
                              "px-1.5 py-[6px] font-kosugi text-[11px] whitespace-nowrap rounded-sm",
                              "transition-all duration-200 shrink-0",
                              activeSubTab === sub.id
                                ? "text-text-primary bg-[rgba(255,255,255,0.06)]"
                                : "text-text-disabled hover:text-text-tertiary"
                            )}
                          >
                            {t(sub.labelKey)}
                          </button>
                        </Fragment>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Sliding underline */}
          <div
            className="absolute bottom-0 h-[2px] bg-text-primary rounded-full transition-all duration-300 ease-out"
            style={{
              left: underlineStyle.left,
              width: underlineStyle.width,
              opacity: underlineStyle.opacity,
            }}
          />
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────── */}
      <div
        className={cn(
          "animate-slide-up rounded transition-all duration-500",
          flashContent && "ring-2 ring-ops-accent ring-offset-2 ring-offset-background"
        )}
        key={activeSubTab}
      >
        {ContentComponent && <ContentComponent />}
      </div>
    </div>
  );
}

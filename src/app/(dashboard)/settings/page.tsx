"use client";

import { useState, useEffect } from "react";
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
} from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import { SegmentedPicker } from "@/components/ops/segmented-picker";
import { SettingsSection } from "@/components/settings/settings-section";
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

type SettingsGroup = "account" | "company" | "billing" | "integrations" | "preferences" | "developer";

// Legacy tab IDs that might come from URL params — map to new groups
const legacyTabMap: Record<string, SettingsGroup> = {
  profile: "account",
  appearance: "account",
  shortcuts: "account",
  company: "company",
  team: "company",
  "task-types": "company",
  subscription: "billing",
  billing: "billing",
  integrations: "integrations",
  portal: "integrations",
  preferences: "preferences",
  "data-privacy": "preferences",
  developer: "developer",
};

const baseGroups: { id: SettingsGroup; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "account", label: "Account", icon: User },
  { id: "company", label: "Company", icon: Building2 },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
];

export default function SettingsPage() {
  const [activeGroup, setActiveGroup] = useState<SettingsGroup>("account");
  const currentUser = useAuthStore((s) => s.currentUser);

  const groups = currentUser?.devPermission
    ? [...baseGroups, { id: "developer" as const, label: "Developer", icon: Code2 }]
    : baseGroups;

  // Handle URL params (supports both new group IDs and legacy tab IDs)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab) {
      // Try as a group ID first
      if (groups.some((g) => g.id === tab)) {
        setActiveGroup(tab as SettingsGroup);
      } else if (legacyTabMap[tab]) {
        // Map legacy tab to new group
        setActiveGroup(legacyTabMap[tab]);
      }
    }
  }, [groups]);

  return (
    <div className="space-y-3 max-w-[1000px]">
      <div className="border-b border-[rgba(255,255,255,0.15)] overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <SegmentedPicker
          options={groups.map((g) => ({ value: g.id, label: g.label, icon: g.icon }))}
          value={activeGroup}
          onChange={setActiveGroup}
          className="min-w-max"
        />
      </div>

      <div className="space-y-1.5 animate-fade-in" key={activeGroup}>
        {/* ── Account ─────────────────────────────────────────────────────── */}
        {activeGroup === "account" && (
          <>
            <SettingsSection title="Profile" icon={User} defaultOpen>
              <ProfileTab />
            </SettingsSection>
            <SettingsSection title="Appearance" icon={Palette}>
              <AppearanceTab />
            </SettingsSection>
            <SettingsSection title="Keyboard Shortcuts" icon={Keyboard}>
              <ShortcutsTab />
            </SettingsSection>
          </>
        )}

        {/* ── Company ────────────────────────────────────────────────────── */}
        {activeGroup === "company" && (
          <>
            <SettingsSection title="Company Details" icon={Building2} defaultOpen>
              <CompanyTab />
            </SettingsSection>
            <SettingsSection title="Team Members" icon={Users}>
              <TeamTab />
            </SettingsSection>
            <SettingsSection title="Task Types" icon={ListChecks}>
              <TaskTypesTab />
            </SettingsSection>
          </>
        )}

        {/* ── Billing ────────────────────────────────────────────────────── */}
        {activeGroup === "billing" && (
          <>
            <SettingsSection title="Subscription Plan" icon={CreditCard} defaultOpen>
              <SubscriptionTab />
            </SettingsSection>
            <SettingsSection title="Payment & Invoices" icon={Receipt}>
              <BillingTab />
            </SettingsSection>
          </>
        )}

        {/* ── Integrations ───────────────────────────────────────────────── */}
        {activeGroup === "integrations" && (
          <>
            <SettingsSection title="Email & Services" icon={Mail} defaultOpen>
              <IntegrationsTab />
            </SettingsSection>
            <SettingsSection title="Client Portal" icon={Globe}>
              <PortalBrandingTab />
            </SettingsSection>
          </>
        )}

        {/* ── Preferences ────────────────────────────────────────────────── */}
        {activeGroup === "preferences" && (
          <>
            <SettingsSection title="App Preferences" icon={SlidersHorizontal} defaultOpen>
              <PreferencesTab />
            </SettingsSection>
            <SettingsSection title="Data & Privacy" icon={Database}>
              <DataPrivacyTab />
            </SettingsSection>
          </>
        )}

        {/* ── Developer ──────────────────────────────────────────────────── */}
        {activeGroup === "developer" && (
          <SettingsSection title="Developer Tools" icon={Code2} defaultOpen>
            <DeveloperTab />
          </SettingsSection>
        )}
      </div>
    </div>
  );
}

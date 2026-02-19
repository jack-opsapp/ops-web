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
  Shield,
  Database,
  Receipt,
  Users,
  ListChecks,
  Code2,
  Globe,
} from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import { SegmentedPicker } from "@/components/ops/segmented-picker";
import { ProfileTab } from "@/components/settings/profile-tab";
import { CompanyTab } from "@/components/settings/company-tab";
import { SubscriptionTab } from "@/components/settings/subscription-tab";
import { IntegrationsTab } from "@/components/settings/integrations-tab";
import { PreferencesTab } from "@/components/settings/preferences-tab";
import { ShortcutsTab } from "@/components/settings/shortcuts-tab";
import { AppearanceTab } from "@/components/settings/appearance-tab";
import { SecurityTab } from "@/components/settings/security-tab";
import { DataPrivacyTab } from "@/components/settings/data-privacy-tab";
import { BillingTab } from "@/components/settings/billing-tab";
import { TeamTab } from "@/components/settings/team-tab";
import { TaskTypesTab } from "@/components/settings/task-types-tab";
import { DeveloperTab } from "@/components/settings/developer-tab";
import { PortalBrandingTab } from "@/components/settings/portal-branding-tab";

type SettingsTab =
  | "profile"
  | "company"
  | "team"
  | "task-types"
  | "subscription"
  | "integrations"
  | "preferences"
  | "shortcuts"
  | "appearance"
  | "portal"
  | "security"
  | "data-privacy"
  | "billing"
  | "developer";

const baseTabs: { id: SettingsTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "company", label: "Company", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "task-types", label: "Task Types", icon: ListChecks },
  { id: "subscription", label: "Subscription", icon: CreditCard },
  { id: "billing", label: "Billing", icon: Receipt },
  { id: "integrations", label: "Integrations", icon: Mail },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "portal", label: "Client Portal", icon: Globe },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "security", label: "Security", icon: Shield },
  { id: "data-privacy", label: "Data & Privacy", icon: Database },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const currentUser = useAuthStore((s) => s.currentUser);

  // Show developer tab only for users with devPermission
  const tabs = currentUser?.devPermission
    ? [...baseTabs, { id: "developer" as const, label: "Developer", icon: Code2 }]
    : baseTabs;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab") as SettingsTab | null;
    if (tab && tabs.some((t) => t.id === tab)) {
      setActiveTab(tab);
    }
  }, [tabs]);

  return (
    <div className="space-y-3 max-w-[1000px]">
      <div className="border-b border-[rgba(255,255,255,0.15)]">
        <SegmentedPicker
          options={tabs.map((t) => ({ value: t.id, label: t.label, icon: t.icon }))}
          value={activeTab}
          onChange={setActiveTab}
        />
      </div>

      <div className="animate-fade-in" key={activeTab}>
        {activeTab === "profile" && <ProfileTab />}
        {activeTab === "company" && <CompanyTab />}
        {activeTab === "team" && <TeamTab />}
        {activeTab === "task-types" && <TaskTypesTab />}
        {activeTab === "subscription" && <SubscriptionTab />}
        {activeTab === "billing" && <BillingTab />}
        {activeTab === "integrations" && <IntegrationsTab />}
        {activeTab === "appearance" && <AppearanceTab />}
        {activeTab === "portal" && <PortalBrandingTab />}
        {activeTab === "preferences" && <PreferencesTab />}
        {activeTab === "security" && <SecurityTab />}
        {activeTab === "data-privacy" && <DataPrivacyTab />}
        {activeTab === "shortcuts" && <ShortcutsTab />}
        {activeTab === "developer" && <DeveloperTab />}
      </div>
    </div>
  );
}

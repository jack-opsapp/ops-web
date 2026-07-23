"use client";

/**
 * Settings IA — the domain/section registry (WEB OVERHAUL P3-6).
 *
 * THE single source of truth for the Settings information architecture: every
 * top-level domain, its sub-sections, the granular permission each section
 * requires, the company feature flag (phase_c) that gates Phase-C surfaces, and
 * the legacy `?tab=` ids that resolve onto each section.
 *
 * Design (Jackson, 2026-06-13): horizontal domain tabs on the shared kit + a
 * sub-section `SegmentControl` (Books/Catalog grammar) — NOT a left rail and NOT
 * the retired bespoke sliding-underline tab bar. A domain is visible iff at least
 * one of its sections is visible; a section is visible iff its permission is
 * BOTH feature-flag-unlocked and granted, its company flag (if any) is enabled,
 * and its dev gate (if any) is held — never role-name filtering.
 *
 * Absorption: Team (the retired standalone `/team` page) lives here as
 * TEAM › Members; deep-linked via `?section=team` (the §2 redirect target).
 *
 * Phase-C posture (master plan §3): the email engine is headless and lead import
 * is ungated, so Email / Templates / Lifecycle stay visible to every company;
 * ONLY Client Comms (the agent's outbound-autonomy face) carries `flag: "phase_c"`
 * here, and the autonomy/auto-send panels inside the Email section gate on
 * phase_c within `IntegrationsTab` itself.
 */

import type { LucideIcon } from "lucide-react";
import {
  User,
  Users,
  Building2,
  Calculator,
  Mail,
  SlidersHorizontal,
} from "lucide-react";

// ── Section bodies ─────────────────────────────────────────────────────────────
import { ProfileTab } from "./profile-tab";
import { NotificationsTab } from "./notifications-tab";
import { AppearanceTab } from "./appearance-tab";
import { PreferencesTab } from "./preferences-tab";
import { ShortcutsTab } from "./shortcuts-tab";
import { TeamSection } from "./team-section";
import { RolesTab } from "./roles-tab";
import { CompanyTab } from "./company-tab";
import { TaskTypesTab } from "./task-types-tab";
import { InventoryTab } from "./inventory-tab";
import { SubscriptionTab } from "./subscription-tab";
import { BillingTab } from "./billing-tab";
import { InvoiceSettingsTab } from "./invoice-settings-tab";
import { FinancialSettingsTab } from "./financial-settings-tab";
import { ExpenseSettingsTab } from "./expense-settings-tab";
import { AccountingTab } from "./accounting-tab";
import { DocumentTemplatesTab } from "./document-templates-tab";
import { IntegrationsTab } from "./integrations-tab";
import { EmailTemplatesTab } from "./email-templates-tab";
import { LifecycleSettingsTab } from "./lifecycle-settings-tab";
import { PortalBrandingTab } from "./portal-branding-tab";
import { ClientCommsSettingsTab } from "./client-comms-settings-tab";
import { MapPreferencesTab } from "./map-preferences-tab";
import { DataPrivacyTab } from "./data-privacy-tab";
import { DeveloperTab } from "./developer-tab";

// ── Composite sections (more than one legacy tab body to one IA section) ─────────

/** FINANCIAL › Billing — plan/seats/upgrade (+add-ons) then saved card + history. */
function BillingSection() {
  return (
    <div className="space-y-3">
      <SubscriptionTab />
      <BillingTab />
    </div>
  );
}

/** FINANCIAL › Automation — invoice/dunning defaults then financial-alert thresholds.
 *  Both write `companies.invoice_settings` JSONB via `/api/settings/invoice` — they
 *  are plain company money-rules, NOT Phase-C (verified P3-6 recon). */
function AutomationSection() {
  return (
    <div className="space-y-3">
      <InvoiceSettingsTab />
      <FinancialSettingsTab />
    </div>
  );
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SettingsSection {
  /** `?section=` value + stable id. */
  id: string;
  /** Key into the `settings` dictionary. */
  labelKey: string;
  /** Granular RBAC permission required (feature-flag-unlocked AND granted). */
  permission?: string;
  /** Company feature flag required (canAccessFeature). Only `phase_c` today. */
  flag?: "phase_c";
  /** Visible only to dev-flagged operators (`currentUser.devPermission`). */
  devOnly?: boolean;
  /** Section body. */
  component: React.ComponentType;
  /** Legacy `?tab=` ids (command-palette / stored links) that resolve here. */
  legacyTabIds?: string[];
}

export interface SettingsDomain {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  sections: SettingsSection[];
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const SETTINGS_DOMAINS: SettingsDomain[] = [
  {
    id: "you",
    labelKey: "domains.you",
    icon: User,
    sections: [
      { id: "profile", labelKey: "sections.profile", component: ProfileTab, legacyTabIds: ["profile"] },
      { id: "notifications", labelKey: "sections.notifications", component: NotificationsTab, legacyTabIds: ["notifications"] },
      { id: "appearance", labelKey: "sections.appearance", component: AppearanceTab, legacyTabIds: ["appearance"] },
      { id: "preferences", labelKey: "sections.preferences", permission: "settings.preferences", component: PreferencesTab, legacyTabIds: ["preferences", "quick-actions"] },
      { id: "shortcuts", labelKey: "sections.shortcuts", component: ShortcutsTab, legacyTabIds: ["shortcuts"] },
    ],
  },
  {
    id: "team",
    labelKey: "domains.team",
    icon: Users,
    sections: [
      { id: "team", labelKey: "sections.members", permission: "team.view", component: TeamSection, legacyTabIds: ["team"] },
      { id: "roles", labelKey: "sections.roles", permission: "team.assign_roles", component: RolesTab, legacyTabIds: ["roles"] },
    ],
  },
  {
    id: "company",
    labelKey: "domains.company",
    icon: Building2,
    sections: [
      { id: "company-details", labelKey: "sections.companyDetails", permission: "settings.company", component: CompanyTab, legacyTabIds: ["company"] },
      { id: "task-types", labelKey: "sections.taskTypes", permission: "settings.company", component: TaskTypesTab, legacyTabIds: ["task-types", "setup"] },
      { id: "inventory", labelKey: "sections.inventory", permission: "inventory.manage", component: InventoryTab, legacyTabIds: ["inventory"] },
    ],
  },
  {
    id: "financial",
    labelKey: "domains.financial",
    icon: Calculator,
    sections: [
      { id: "billing", labelKey: "sections.billing", permission: "settings.billing", component: BillingSection, legacyTabIds: ["subscription", "billing"] },
      // Automation = invoice + financial settings. Gate kept at settings.billing —
      // a deliberate re-classification out of the mis-filed "AI"/settings.integrations
      // group (P3-6); these are financial money-rules, not Phase-C.
      { id: "automation", labelKey: "sections.automation", permission: "settings.billing", component: AutomationSection, legacyTabIds: ["invoice-automation", "financial-intelligence"] },
      { id: "expenses", labelKey: "sections.expenses", permission: "expenses.configure", component: ExpenseSettingsTab, legacyTabIds: ["expenses"] },
      { id: "accounting", labelKey: "sections.accounting", permission: "accounting.manage_connections", component: AccountingTab, legacyTabIds: ["accounting"] },
      { id: "documents", labelKey: "sections.templates", permission: "documents.manage_templates", component: DocumentTemplatesTab, legacyTabIds: ["templates"] },
    ],
  },
  {
    id: "comms",
    labelKey: "domains.comms",
    icon: Mail,
    sections: [
      { id: "email", labelKey: "sections.email", permission: "settings.integrations", component: IntegrationsTab, legacyTabIds: ["integrations"] },
      { id: "templates", labelKey: "sections.emailTemplates", permission: "settings.integrations", component: EmailTemplatesTab, legacyTabIds: ["email-templates"] },
      { id: "lifecycle", labelKey: "sections.lifecycle", permission: "settings.company", component: LifecycleSettingsTab, legacyTabIds: ["lifecycle", "ai"] },
      { id: "portal", labelKey: "sections.portal", permission: "portal.manage_branding", component: PortalBrandingTab, legacyTabIds: ["portal"] },
      // Client Comms = the agent's outbound-autonomy face → Phase-C only (Canpro).
      { id: "client-comms", labelKey: "sections.clientComms", permission: "settings.integrations", flag: "phase_c", component: ClientCommsSettingsTab, legacyTabIds: ["client-comms"] },
    ],
  },
  {
    id: "advanced",
    labelKey: "domains.advanced",
    icon: SlidersHorizontal,
    sections: [
      { id: "map", labelKey: "sections.map", permission: "settings.preferences", component: MapPreferencesTab, legacyTabIds: ["map"] },
      { id: "data-privacy", labelKey: "sections.dataPrivacy", permission: "settings.preferences", component: DataPrivacyTab, legacyTabIds: ["data-privacy"] },
      { id: "developer", labelKey: "sections.developer", devOnly: true, component: DeveloperTab, legacyTabIds: ["developer"] },
    ],
  },
];

// ── Lookups ────────────────────────────────────────────────────────────────────

/** Every legacy `?tab=` id → its new section id (built from the registry). */
export const LEGACY_TAB_TO_SECTION: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const domain of SETTINGS_DOMAINS) {
    for (const section of domain.sections) {
      for (const legacy of section.legacyTabIds ?? []) map[legacy] = section.id;
    }
  }
  return map;
})();

/** The domain owning a section id, or null. */
export function domainForSection(sectionId: string): SettingsDomain | null {
  return (
    SETTINGS_DOMAINS.find((d) => d.sections.some((s) => s.id === sectionId)) ?? null
  );
}

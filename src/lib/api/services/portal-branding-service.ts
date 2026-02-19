/**
 * OPS Web - Portal Branding Service
 *
 * Manages company portal branding configuration.
 * Uses upsert-read pattern like CompanySettingsService.
 */

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { parseDateRequired } from "@/lib/supabase/helpers";
import type {
  PortalBranding,
  CreatePortalBranding,
  PortalTemplate,
  PortalThemeMode,
} from "@/lib/types/portal";

// ─── Database Mapping ────────────────────────────────────────────────────────

function mapBrandingFromDb(row: Record<string, unknown>): PortalBranding {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    logoUrl: (row.logo_url as string) ?? null,
    accentColor: (row.accent_color as string) ?? "#417394",
    template: (row.template as PortalTemplate) ?? "modern",
    themeMode: (row.theme_mode as PortalThemeMode) ?? "dark",
    fontCombo: (row.font_combo as PortalTemplate) ?? "modern",
    welcomeMessage: (row.welcome_message as string) ?? null,
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDateRequired(row.updated_at),
  };
}

function mapBrandingToDb(data: Partial<CreatePortalBranding>): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.logoUrl !== undefined) row.logo_url = data.logoUrl;
  if (data.accentColor !== undefined) row.accent_color = data.accentColor;
  if (data.template !== undefined) row.template = data.template;
  if (data.themeMode !== undefined) row.theme_mode = data.themeMode;
  if (data.fontCombo !== undefined) row.font_combo = data.fontCombo;
  if (data.welcomeMessage !== undefined) row.welcome_message = data.welcomeMessage;

  return row;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const PortalBrandingService = {
  /**
   * Get branding for a company, creating a default if none exists.
   */
  async getBranding(companyId: string): Promise<PortalBranding> {
    const supabase = getServiceRoleClient();

    // Try to find existing
    const { data, error } = await supabase
      .from("portal_branding")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch branding: ${error.message}`);

    if (data) return mapBrandingFromDb(data);

    // Create default
    const { data: created, error: insertError } = await supabase
      .from("portal_branding")
      .insert({ company_id: companyId })
      .select()
      .single();

    if (insertError) throw new Error(`Failed to create default branding: ${insertError.message}`);
    return mapBrandingFromDb(created);
  },

  /**
   * Update branding for a company (upserts).
   */
  async updateBranding(
    companyId: string,
    data: Partial<CreatePortalBranding>
  ): Promise<PortalBranding> {
    const supabase = getServiceRoleClient();

    const row = mapBrandingToDb(data);
    row.company_id = companyId;
    row.updated_at = new Date().toISOString();

    const { data: updated, error } = await supabase
      .from("portal_branding")
      .upsert(row, { onConflict: "company_id" })
      .select()
      .single();

    if (error) throw new Error(`Failed to update branding: ${error.message}`);
    return mapBrandingFromDb(updated);
  },
};

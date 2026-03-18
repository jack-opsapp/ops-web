/**
 * OPS Web - Admin Feature Override Service
 *
 * Controls per-company AI feature gating. AI features require BOTH:
 * 1. The product-level feature flag (ai_email_review, phase_c)
 * 2. An admin override enabling it for the specific company
 *
 * Uses getServiceRoleClient() because this bypasses RLS — the
 * admin_feature_overrides table has no user-facing RLS policies.
 */

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { AdminFeatureOverride } from "@/lib/types/email-connection";

type AIFeatureKey = "ai_email_review" | "phase_c";

// ─── Database ↔ TypeScript Mapping ──────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): AdminFeatureOverride {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    featureKey: row.feature_key as string,
    enabled: row.enabled as boolean,
    enabledBy: (row.enabled_by as string) ?? null,
    enabledAt: row.enabled_at ? new Date(row.enabled_at as string) : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

// ─── Service ────────────────────────────────────────────────────────────────

export const AdminFeatureOverrideService = {
  /**
   * Check if an AI feature is enabled for a company.
   * Requires BOTH the product-level feature flag AND the admin override.
   */
  async isAIFeatureEnabled(
    companyId: string,
    feature: AIFeatureKey
  ): Promise<boolean> {
    const supabase = getServiceRoleClient();

    const { data } = await supabase
      .from("admin_feature_overrides")
      .select("enabled")
      .eq("company_id", companyId)
      .eq("feature_key", feature)
      .single();

    return data?.enabled === true;
  },

  /**
   * Get all overrides for a company.
   */
  async getOverrides(companyId: string): Promise<AdminFeatureOverride[]> {
    const supabase = getServiceRoleClient();

    const { data, error } = await supabase
      .from("admin_feature_overrides")
      .select("*")
      .eq("company_id", companyId);

    if (error)
      throw new Error(
        `Failed to fetch feature overrides: ${error.message}`
      );
    return (data ?? []).map(mapFromDb);
  },

  /**
   * Toggle an AI feature for a company (admin only).
   */
  async setOverride(
    companyId: string,
    feature: AIFeatureKey,
    enabled: boolean,
    adminUserId: string
  ): Promise<void> {
    const supabase = getServiceRoleClient();

    const { error } = await supabase
      .from("admin_feature_overrides")
      .upsert(
        {
          company_id: companyId,
          feature_key: feature,
          enabled,
          enabled_by: adminUserId,
          enabled_at: enabled ? new Date().toISOString() : null,
        },
        { onConflict: "company_id,feature_key" }
      );

    if (error)
      throw new Error(`Failed to set feature override: ${error.message}`);
  },
};

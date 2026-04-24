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

// ai_email_review kept as historical key for reading legacy rows only.
// Post-2026-04-24 migration 20260424000000, all new writes must use phase_c.
// setOverride() throws if called with ai_email_review. Final removal
// happens in Group N3 alongside union narrowing.
type AIFeatureKey = "ai_email_review" | "phase_c" | "ai_auto_send";

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
   *
   * When phase_c transitions from disabled → enabled for the first time
   * (or after a long gap), we fire a persistent notification routing the
   * user into the communications configuration wizard so they can set up
   * autonomy levels before any emails go out.
   */
  async setOverride(
    companyId: string,
    feature: AIFeatureKey,
    enabled: boolean,
    adminUserId: string
  ): Promise<void> {
    if (feature === "ai_email_review") {
      throw new Error(
        "ai_email_review is deprecated — use phase_c instead (migration 20260424000000)."
      );
    }

    const supabase = getServiceRoleClient();

    // Capture prior state to detect the first-enable transition
    const { data: prior } = await supabase
      .from("admin_feature_overrides")
      .select("enabled")
      .eq("company_id", companyId)
      .eq("feature_key", feature)
      .maybeSingle();

    const wasEnabled = prior?.enabled === true;

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

    // On first phase_c enable, fire the wizard notification to all admins
    if (feature === "phase_c" && enabled && !wasEnabled) {
      try {
        const { AutonomyMilestoneService } = await import(
          "./autonomy-milestone-service"
        );
        await AutonomyMilestoneService.fireCommsWizardReadyOnPhaseCEnable(
          companyId
        );
      } catch (err) {
        console.error(
          "[admin-feature-override] wizard notification failed (non-fatal):",
          err
        );
      }
    }
  },
};

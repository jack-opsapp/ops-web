/**
 * OPS Web - Admin Feature Override Service
 *
 * Controls per-company AI feature gating. AI features require BOTH:
 * 1. The product-level feature flag (phase_c / ai_auto_send)
 * 2. An admin override enabling it for the specific company
 *
 * Uses getServiceRoleClient() because this bypasses RLS — the
 * admin_feature_overrides table has no user-facing RLS policies.
 *
 * ai_email_review was collapsed into phase_c on 2026-04-24. Union narrow
 * happens here in N3; legacy rows are dropped by migration 20260424000002.
 */

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { AdminFeatureOverride } from "@/lib/types/email-connection";

type AIFeatureKey = "phase_c" | "ai_auto_send";

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

    const { data, error } = await supabase
      .from("admin_feature_overrides")
      .select("enabled")
      .eq("company_id", companyId)
      .eq("feature_key", feature)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to read AI feature override: ${error.message}`);
    }

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
      throw new Error(`Failed to fetch feature overrides: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },

  /**
   * Generic per-company feature gate (non-AI flags like `inbox_ui`).
   * Reads admin_feature_overrides via the service-role client (no RLS).
   */
  async isFeatureEnabled(
    companyId: string,
    featureKey: string
  ): Promise<boolean> {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("admin_feature_overrides")
      .select("enabled")
      .eq("company_id", companyId)
      .eq("feature_key", featureKey)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to read feature override: ${error.message}`);
    }
    return data?.enabled === true;
  },

  /**
   * Set a generic per-company feature override (no phase_c wizard side-effects).
   */
  async setFeatureOverride(
    companyId: string,
    featureKey: string,
    enabled: boolean,
    adminUserId: string
  ): Promise<void> {
    const supabase = getServiceRoleClient();
    const { error } = await supabase.from("admin_feature_overrides").upsert(
      {
        company_id: companyId,
        feature_key: featureKey,
        enabled,
        enabled_by: adminUserId,
        enabled_at: enabled ? new Date().toISOString() : null,
      },
      { onConflict: "company_id,feature_key" }
    );
    if (error)
      throw new Error(`Failed to set feature override: ${error.message}`);
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
    const supabase = getServiceRoleClient();

    // Capture prior state to detect the first-enable transition
    const { data: prior } = await supabase
      .from("admin_feature_overrides")
      .select("enabled")
      .eq("company_id", companyId)
      .eq("feature_key", feature)
      .maybeSingle();

    const wasEnabled = prior?.enabled === true;

    const { error } = await supabase.from("admin_feature_overrides").upsert(
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
        const { AutonomyMilestoneService } =
          await import("./autonomy-milestone-service");
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

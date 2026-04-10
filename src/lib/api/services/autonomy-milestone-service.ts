/**
 * OPS Web - Autonomy Milestone Service
 *
 * Tracks where each user is on the progressive autonomy ladder and fires
 * notifications exactly once per milestone transition.
 *
 * Milestones:
 *   Level 0 → 1: DRAFT_AVAILABLE     (confidence crosses 0.2 for the first time)
 *   Level 2 → 3: AUTO_DRAFT_READY    (confidence > 0.75, 250+ emails, draft_available shown)
 *   Level 3 → 4: AUTO_SEND_SUGGESTED (95% approval over 20+ drafts, auto_draft enabled)
 *
 * Milestone state is stored in email_connections.auto_send_settings JSONB
 * under the "milestones" key. Idempotent: re-checking a shown milestone is a no-op.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import { WritingProfileService } from "./writing-profile-service";
import { NotificationService } from "./notification-service";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MilestoneState {
  draft_available_shown: boolean;
  auto_draft_suggested: boolean;
  auto_send_suggested: boolean;
}

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4 | 5;

const DEFAULT_MILESTONES: MilestoneState = {
  draft_available_shown: false,
  auto_draft_suggested: false,
  auto_send_suggested: false,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseMilestones(raw: unknown): MilestoneState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_MILESTONES };
  const obj = raw as Record<string, unknown>;
  return {
    draft_available_shown: obj.draft_available_shown === true,
    auto_draft_suggested: obj.auto_draft_suggested === true,
    auto_send_suggested: obj.auto_send_suggested === true,
  };
}

/**
 * Compute the user's current autonomy level from their profile + settings state.
 */
function computeLevel(params: {
  emailsAnalyzed: number;
  confidence: number;
  autoDraftEnabled: boolean;
  autoSendEnabled: boolean;
  categoryAutonomyConfigured: boolean;
  approvalRate: number;
  totalDrafts: number;
}): AutonomyLevel {
  const { emailsAnalyzed, confidence, autoDraftEnabled, autoSendEnabled, categoryAutonomyConfigured, approvalRate, totalDrafts } = params;

  if (categoryAutonomyConfigured && autoSendEnabled) return 5;
  if (autoSendEnabled && approvalRate >= 0.95 && totalDrafts >= 20) return 4;
  if (autoDraftEnabled && confidence > 0.75 && emailsAnalyzed >= 250) return 3;
  if (emailsAnalyzed >= 100 && confidence > 0.5) return 2;
  if (emailsAnalyzed >= 25 && confidence > 0.2) return 1;
  return 0;
}

// ─── Service ────────────────────────────────────────────────────────────────

export const AutonomyMilestoneService = {
  /**
   * Check milestones after a sync cycle processes emails.
   * Called from sync-engine.ts after learnFromOutboundEmail calls.
   * Fire-and-forget — errors are logged, not thrown.
   */
  async checkMilestonesAfterSync(
    companyId: string,
    userId: string,
    connectionId: string,
  ): Promise<void> {
    try {
      const supabase = requireSupabase();

      // ── Fetch connection settings ─────────────────────────────────────
      const { data: conn } = await supabase
        .from("email_connections")
        .select("auto_send_settings")
        .eq("id", connectionId)
        .eq("company_id", companyId)
        .single();

      if (!conn) return;

      const settings = (conn.auto_send_settings as Record<string, unknown>) || {};
      const milestones = parseMilestones(settings.milestones);

      // ── Fetch writing profile confidence ──────────────────────────────
      const profile = await WritingProfileService.getProfile(companyId, userId);
      if (!profile) return;

      const emailsAnalyzed = (profile.emails_analyzed as number) || 0;
      const confidence = WritingProfileService.getConfidence(emailsAnalyzed);

      // ── Milestone 1: DRAFT_AVAILABLE (confidence crosses 0.2) ─────────
      if (!milestones.draft_available_shown && confidence > 0.2 && emailsAnalyzed >= 25) {
        await NotificationService.create({
          userId,
          companyId,
          type: "ai_milestone",
          title: "AI EMAIL DRAFTING READY",
          body: "Your writing profile is strong enough to generate draft replies. Try it on your next email.",
          persistent: true,
          actionUrl: "/inbox",
          actionLabel: "Try It",
        });

        milestones.draft_available_shown = true;
      }

      // ── Milestone 2: AUTO_DRAFT_READY ─────────────────────────────────
      if (
        milestones.draft_available_shown &&
        !milestones.auto_draft_suggested &&
        confidence > 0.75 &&
        emailsAnalyzed >= 250
      ) {
        await NotificationService.create({
          userId,
          companyId,
          type: "ai_milestone",
          title: "AUTO-DRAFT AVAILABLE",
          body: "Draft replies can be generated automatically before you open emails.",
          persistent: true,
          actionUrl: "/settings/integrations",
          actionLabel: "Turn On",
        });

        milestones.auto_draft_suggested = true;
      }

      // ── Persist milestones ────────────────────────────────────────────
      await supabase
        .from("email_connections")
        .update({
          auto_send_settings: {
            ...settings,
            milestones,
          },
        })
        .eq("id", connectionId)
        .eq("company_id", companyId);
    } catch (err) {
      console.error("[autonomy-milestones] Check after sync failed (non-fatal):", err);
    }
  },

  /**
   * Check milestones after a draft outcome is recorded.
   * Called from ai-draft-service.ts after recordDraftOutcome.
   * Checks the auto-send threshold (95% approval over 20+ drafts).
   */
  async checkMilestonesAfterDraftFeedback(
    companyId: string,
    userId: string,
    connectionId: string,
  ): Promise<void> {
    try {
      const supabase = requireSupabase();

      // ── Fetch connection settings ─────────────────────────────────────
      const { data: conn } = await supabase
        .from("email_connections")
        .select("auto_send_settings")
        .eq("id", connectionId)
        .eq("company_id", companyId)
        .single();

      if (!conn) return;

      const settings = (conn.auto_send_settings as Record<string, unknown>) || {};
      const milestones = parseMilestones(settings.milestones);
      const autoDraftEnabled = settings.auto_draft_enabled === true;

      // Only check auto-send milestone if auto-draft is already on
      if (!autoDraftEnabled || milestones.auto_send_suggested) return;

      // ── Fetch draft approval stats ────────────────────────────────────
      const { data: draftStats } = await supabase
        .from("ai_draft_history")
        .select("status, sent_without_changes")
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .in("status", ["sent", "auto_drafted"])
        .order("created_at", { ascending: false })
        .limit(50);

      if (!draftStats) return;

      const sentDrafts = draftStats.filter(
        (d) => (d.status as string) === "sent"
      );
      const totalSent = sentDrafts.length;

      if (totalSent < 20) return;

      const sentWithoutChanges = sentDrafts.filter(
        (d) => d.sent_without_changes === true
      ).length;
      const approvalRate = sentWithoutChanges / totalSent;

      // ── Milestone 3: AUTO_SEND_SUGGESTED ──────────────────────────────
      if (approvalRate >= 0.95) {
        await NotificationService.create({
          userId,
          companyId,
          type: "ai_milestone",
          title: "AUTO-SEND RECOMMENDED",
          body: `${(approvalRate * 100).toFixed(0)}% of your drafts are sent without changes. Auto-send can handle routine replies.`,
          persistent: true,
          actionUrl: "/settings/integrations",
          actionLabel: "Configure",
        });

        milestones.auto_send_suggested = true;

        await supabase
          .from("email_connections")
          .update({
            auto_send_settings: {
              ...settings,
              milestones,
            },
          })
          .eq("id", connectionId)
          .eq("company_id", companyId);
      }
    } catch (err) {
      console.error("[autonomy-milestones] Check after draft feedback failed (non-fatal):", err);
    }
  },

  /**
   * Compute the user's current autonomy level.
   * Used by the settings UI to show the autonomy ladder status.
   */
  async getAutonomyLevel(
    companyId: string,
    userId: string,
    connectionId: string,
  ): Promise<{
    level: AutonomyLevel;
    emailsAnalyzed: number;
    confidence: number;
    approvalRate: number;
    totalDrafts: number;
    milestones: MilestoneState;
    autoDraftEnabled: boolean;
    autoSendEnabled: boolean;
    categoryAutonomy: Record<string, string>;
  }> {
    const supabase = requireSupabase();

    // Fetch connection settings
    const { data: conn } = await supabase
      .from("email_connections")
      .select("auto_send_settings")
      .eq("id", connectionId)
      .eq("company_id", companyId)
      .single();

    const settings = (conn?.auto_send_settings as Record<string, unknown>) || {};
    const milestones = parseMilestones(settings.milestones);
    const autoDraftEnabled = settings.auto_draft_enabled === true;
    const autoSendEnabled = settings.enabled === true;
    const categoryAutonomy = (settings.category_autonomy as Record<string, string>) || {};

    // Fetch writing profile
    const profile = await WritingProfileService.getProfile(companyId, userId);
    const emailsAnalyzed = (profile?.emails_analyzed as number) || 0;
    const confidence = WritingProfileService.getConfidence(emailsAnalyzed);

    // Fetch draft stats
    const { data: draftStats } = await supabase
      .from("ai_draft_history")
      .select("status, sent_without_changes")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("status", "sent")
      .order("created_at", { ascending: false })
      .limit(50);

    const totalDrafts = draftStats?.length || 0;
    const sentWithoutChanges = draftStats?.filter(
      (d) => d.sent_without_changes === true
    ).length || 0;
    const approvalRate = totalDrafts > 0 ? sentWithoutChanges / totalDrafts : 0;

    const categoryAutonomyConfigured = Object.values(categoryAutonomy).some(
      (v) => v !== "draft_on_request"
    );

    const level = computeLevel({
      emailsAnalyzed,
      confidence,
      autoDraftEnabled,
      autoSendEnabled,
      categoryAutonomyConfigured,
      approvalRate,
      totalDrafts,
    });

    return {
      level,
      emailsAnalyzed,
      confidence,
      approvalRate,
      totalDrafts,
      milestones,
      autoDraftEnabled,
      autoSendEnabled,
      categoryAutonomy,
    };
  },

  /**
   * Get email counts per profile_type for the category autonomy UI.
   * Shows how many emails have been analyzed for each category.
   */
  async getCategoryStats(
    companyId: string,
    userId: string,
  ): Promise<Record<string, number>> {
    const supabase = requireSupabase();

    const { data } = await supabase
      .from("ai_draft_history")
      .select("profile_type")
      .eq("company_id", companyId)
      .eq("user_id", userId);

    if (!data) return {};

    const counts: Record<string, number> = {};
    for (const row of data) {
      const pt = (row.profile_type as string) || "general";
      counts[pt] = (counts[pt] || 0) + 1;
    }

    return counts;
  },
};

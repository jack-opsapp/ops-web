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
import { getCompanyManagerUserIds } from "./company-managers";
import { WritingProfileService } from "./writing-profile-service";
import { NotificationService } from "./notification-service";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MilestoneState {
  draft_available_shown: boolean;
  auto_draft_suggested: boolean;
  auto_send_suggested: boolean;
  /** S2 amendment: fired when writing profile confidence crosses 0.75 and the
   *  communications configuration wizard has not yet been completed. */
  comms_wizard_ready_shown: boolean;
}

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4 | 5;

const DEFAULT_MILESTONES: MilestoneState = {
  draft_available_shown: false,
  auto_draft_suggested: false,
  auto_send_suggested: false,
  comms_wizard_ready_shown: false,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseMilestones(raw: unknown): MilestoneState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_MILESTONES };
  const obj = raw as Record<string, unknown>;
  return {
    draft_available_shown: obj.draft_available_shown === true,
    auto_draft_suggested: obj.auto_draft_suggested === true,
    auto_send_suggested: obj.auto_send_suggested === true,
    comms_wizard_ready_shown: obj.comms_wizard_ready_shown === true,
  };
}

/** Check if the company has completed the comms wizard at the current version.
 *  If they have, we shouldn't re-fire the wizard notification. */
async function isCommsWizardCompleted(companyId: string): Promise<boolean> {
  const supabase = requireSupabase();
  const { data } = await supabase
    .from("companies")
    .select("client_comms_settings")
    .eq("id", companyId)
    .maybeSingle();

  const raw =
    (data?.client_comms_settings as Record<string, unknown>) ?? {};
  const completedAt = raw.comms_wizard_completed_at;
  const version = (raw.comms_wizard_version as number) ?? 0;
  const CURRENT_VERSION = 1;
  return typeof completedAt === "string" && version >= CURRENT_VERSION;
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
          title: "SYS :: AUTONOMY UNLOCK · DRAFTING AVAILABLE",
          body: "Writing profile confidence reached 0.20. Drafting capability is available for activation.",
          persistent: true,
          actionUrl: "/calibration?section=milestones#milestone-3",
          actionLabel: "Review",
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
          title: "SYS :: AUTONOMY UNLOCK · AUTO-DRAFT UNLOCKED",
          body: "Writing profile confidence reached 0.75. Auto-draft capability is available for activation.",
          persistent: true,
          actionUrl: "/calibration?section=milestones#milestone-4",
          actionLabel: "Review",
        });

        milestones.auto_draft_suggested = true;
      }

      // ── Milestone: COMMS_WIZARD_READY ─────────────────────────────────
      //
      // Fires when writing profile confidence crosses 0.75 and the comms
      // wizard has not yet been completed at the current version. Routes
      // the user into /agent/comms-config where they set up appointment
      // confirmations, reminders, and other autonomous communications.
      if (
        !milestones.comms_wizard_ready_shown &&
        confidence > 0.75 &&
        !(await isCommsWizardCompleted(companyId))
      ) {
        await NotificationService.create({
          userId,
          companyId,
          type: "ai_milestone",
          title: "SYS :: AUTONOMY UNLOCK · CONFIGURE COMMUNICATIONS",
          body: "Your AI is ready to handle client communications. Take 2 minutes to set up how you want it to work.",
          persistent: true,
          actionUrl: "/calibration?section=config&wizard=open",
          actionLabel: "Configure",
        });

        milestones.comms_wizard_ready_shown = true;
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
          title: "SYS :: AUTONOMY UNLOCK · AUTO-SEND UNLOCKED",
          body: `${(approvalRate * 100).toFixed(0)}% of your drafts are sent without changes. Auto-send is available for activation.`,
          persistent: true,
          actionUrl: "/calibration?section=milestones#milestone-8",
          actionLabel: "Review",
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
   * Fire the comms-wizard notification to all admin/owner users on a
   * company when phase_c is first enabled. No-op if the wizard was already
   * completed at the current version.
   *
   * Called from AdminFeatureOverrideService.setOverride on the
   * disabled→enabled transition for phase_c.
   */
  async fireCommsWizardReadyOnPhaseCEnable(companyId: string): Promise<void> {
    try {
      if (await isCommsWizardCompleted(companyId)) return;

      const supabase = requireSupabase();

      // 7-day re-fire guard: if an admin toggles phase_c off and on during
      // setup, we don't want to spam the notification rail. Check whether
      // any setup-ready notification has been created for this company in
      // the last 7 days. If so, skip.
      //
      // The title list intentionally includes the legacy
      // "CONFIGURE YOUR AI COMMUNICATIONS" so customers who already
      // received the previous wording don't get a duplicate after the
      // notification was repointed at the AI Setup wizard.
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: recent } = await supabase
        .from("notifications")
        .select("id")
        .eq("company_id", companyId)
        .eq("type", "ai_milestone")
        .in("title", [
          "YOUR AI IS READY — SET IT UP",
          "CONFIGURE YOUR AI COMMUNICATIONS",
          "notification.commsWizardReady.title",
        ])
        .gte("created_at", sevenDaysAgo.toISOString())
        .limit(1);

      if (recent && recent.length > 0) {
        return;
      }

      // Find all management users to target (account_holder ∪ admin_ids),
      // capped at 10 recipients to match the prior fallback's `.limit(10)`.
      const targetIds = (
        await getCompanyManagerUserIds(supabase, companyId)
      ).slice(0, 10);

      // Route the user to the AI Setup wizard, not to /agent/comms-config.
      // The comms-config page gates on writing profile confidence and
      // redirects back to the queue when confidence is 0, so pointing a
      // brand-new customer there was a dead-end. The setup wizard
      // (/settings/integrations/ai-setup) is the actual starting point:
      // it runs the intake interview, email scan, and database mining
      // that builds the writing profile — after which the comms wizard
      // unlocks itself via the milestone-check path in
      // checkMilestonesAfterDraftFeedback.
      await Promise.allSettled(
        targetIds.map((userId) =>
          NotificationService.create({
            userId,
            companyId,
            type: "ai_milestone",
            title: "SYS :: CALIBRATION READY",
            body: "Phase C is enabled. Run the 5-minute intake to teach your AI your voice, your clients, and your business rules.",
            persistent: true,
            actionUrl: "/calibration",
            actionLabel: "Start Setup",
          })
        )
      );
    } catch (err) {
      console.error(
        "[autonomy-milestones] fireCommsWizardReadyOnPhaseCEnable failed:",
        err
      );
    }
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

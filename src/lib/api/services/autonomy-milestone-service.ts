/**
 * OPS Web - Autonomy Milestone Service
 *
 * Tracks where each user is on the progressive autonomy ladder and fires
 * notifications exactly once per milestone transition.
 *
 * Milestones:
 *   Level 0 → 1: DRAFT_AVAILABLE     (confidence crosses 0.2 for the first time)
 *   Level 2 → 3: AUTO_DRAFT_READY    (confidence > 0.75, 250+ emails, draft_available shown)
 *
 * Auto-send readiness is deliberately absent from this mailbox-wide ladder.
 * That decision belongs to the exact actor, connection, and primary-category
 * graduation ledger and its atomic acceptance path.
 *
 * Milestone state is stored per OPS actor in email_autonomy_milestones. The
 * connection's auto_send_settings remains the connection-wide transport and
 * category configuration; it must never be used as user-specific state.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanyManagerUserIds } from "./company-managers";
import { getHumanDraftAccuracy } from "./phase-c-draft-accuracy-service";
import { WritingProfileService } from "./writing-profile-service";
import { NotificationService } from "./notification-service";
import { PhaseCCategoryAutonomy } from "./phase-c-category-autonomy-service";

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
export type AutonomyMilestoneKey = keyof MilestoneState;

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

const MILESTONE_COLUMNS =
  "draft_available_shown, auto_draft_suggested, auto_send_suggested, comms_wizard_ready_shown";

function assertActorMailboxScope(
  connection: { type: unknown; user_id: unknown },
  userId: string
): void {
  if (connection.type === "company") return;
  if (
    connection.type === "individual" &&
    typeof connection.user_id === "string" &&
    connection.user_id.trim() === userId
  ) {
    return;
  }
  throw new Error("Email connection unavailable for actor");
}

export async function getActorAutonomyMilestones(input: {
  companyId: string;
  connectionId: string;
  userId: string;
  supabase?: SupabaseClient;
}): Promise<MilestoneState> {
  const supabase = input.supabase ?? requireSupabase();
  const { data, error } = await supabase
    .from("email_autonomy_milestones")
    .select(MILESTONE_COLUMNS)
    .eq("company_id", input.companyId)
    .eq("connection_id", input.connectionId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return parseMilestones(data);
}

async function recordMilestoneNotification(input: {
  supabase: SupabaseClient;
  companyId: string;
  connectionId: string;
  userId: string;
  milestone: AutonomyMilestoneKey;
  title: string;
  body: string;
  actionUrl: string;
  actionLabel: string;
}): Promise<boolean> {
  const { data, error } = await input.supabase.rpc(
    "record_email_autonomy_milestone",
    {
      p_company_id: input.companyId,
      p_connection_id: input.connectionId,
      p_user_id: input.userId,
      p_milestone: input.milestone,
      p_title: input.title,
      p_body: input.body,
      p_action_url: input.actionUrl,
      p_action_label: input.actionLabel,
    }
  );

  if (error) {
    throw new Error(error.message);
  }
  if (typeof data !== "boolean") {
    throw new Error("Milestone recorder returned an invalid result");
  }

  return data;
}

/** Check if the company has completed the comms wizard at the current version.
 *  If they have, we shouldn't re-fire the wizard notification. */
async function isCommsWizardCompleted(companyId: string): Promise<boolean> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("companies")
    .select("client_comms_settings")
    .eq("id", companyId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const raw = (data?.client_comms_settings as Record<string, unknown>) ?? {};
  const completedAt = raw.comms_wizard_completed_at;
  const version = (raw.comms_wizard_version as number) ?? 0;
  const CURRENT_VERSION = 1;
  return typeof completedAt === "string" && version >= CURRENT_VERSION;
}

/**
 * Read the actor's writing profile without collapsing database failures into
 * an apparently missing profile. Durable milestone retries must distinguish
 * "not learned yet" from "the prerequisite ledger could not be read".
 */
async function getActorWritingProfile(
  companyId: string,
  userId: string
): Promise<Record<string, unknown> | null> {
  const supabase = requireSupabase();
  const { data: general, error: generalError } = await supabase
    .from("agent_writing_profiles")
    .select("*")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("profile_type", "general")
    .maybeSingle();
  if (generalError) throw new Error(generalError.message);
  if (general) return general as Record<string, unknown>;

  const { data: fallback, error: fallbackError } = await supabase
    .from("agent_writing_profiles")
    .select("*")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .order("emails_analyzed", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (fallbackError) throw new Error(fallbackError.message);
  return (fallback as Record<string, unknown> | null) ?? null;
}

/**
 * Compute the user's current autonomy level from their profile + settings state.
 */
function computeLevel(params: {
  emailsAnalyzed: number;
  confidence: number;
  autoDraftEnabled: boolean;
}): AutonomyLevel {
  const { emailsAnalyzed, confidence, autoDraftEnabled } = params;

  if (autoDraftEnabled && confidence > 0.75 && emailsAnalyzed >= 250) return 3;
  if (emailsAnalyzed >= 100 && confidence > 0.5) return 2;
  if (emailsAnalyzed >= 25 && confidence > 0.2) return 1;
  return 0;
}

async function getHumanDraftApprovalStats(
  companyId: string,
  connectionId: string,
  userId: string
): Promise<{ approvalRate: number; totalDrafts: number }> {
  const accuracy = await getHumanDraftAccuracy({
    companyId,
    connectionId,
    userId,
  });
  return {
    totalDrafts: accuracy.sampleSize,
    approvalRate: accuracy.approvalRate,
  };
}

// ─── Service ────────────────────────────────────────────────────────────────

export const AutonomyMilestoneService = {
  /**
   * Check milestones after a sync cycle processes emails.
   * Called from sync-engine.ts after learnFromOutboundEmail calls.
   * Interactive callers stay fire-and-forget; the daily durable retry sweep
   * requests strict error propagation.
   */
  async checkMilestonesAfterSync(
    companyId: string,
    userId: string,
    connectionId: string,
    options: { throwOnError?: boolean } = {}
  ): Promise<void> {
    try {
      const supabase = requireSupabase();

      // ── Validate the exact mailbox connection ─────────────────────────
      const { data: conn, error: connectionError } = await supabase
        .from("email_connections")
        .select("id, type, user_id")
        .eq("id", connectionId)
        .eq("company_id", companyId)
        .single();

      if (connectionError) throw new Error(connectionError.message);
      if (!conn) return;
      assertActorMailboxScope(conn, userId);

      const milestones = await getActorAutonomyMilestones({
        companyId,
        connectionId,
        userId,
        supabase,
      });

      // ── Fetch writing profile confidence ──────────────────────────────
      const profile = await getActorWritingProfile(companyId, userId);
      if (!profile) return;

      const emailsAnalyzed = (profile.emails_analyzed as number) || 0;
      const confidence = WritingProfileService.getConfidence(emailsAnalyzed);

      // ── Milestone 1: DRAFT_AVAILABLE (confidence crosses 0.2) ─────────
      if (
        !milestones.draft_available_shown &&
        confidence > 0.2 &&
        emailsAnalyzed >= 25
      ) {
        await recordMilestoneNotification({
          supabase,
          userId,
          companyId,
          connectionId,
          milestone: "draft_available_shown",
          title: "SYS :: AUTONOMY UNLOCK · DRAFTING AVAILABLE",
          body: "Writing profile confidence reached 0.20. Drafting capability is available for activation.",
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
        await recordMilestoneNotification({
          supabase,
          userId,
          companyId,
          connectionId,
          milestone: "auto_draft_suggested",
          title: "SYS :: AUTONOMY UNLOCK · AUTO-DRAFT UNLOCKED",
          body: "Writing profile confidence reached 0.75. Auto-draft capability is available for activation.",
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
        await recordMilestoneNotification({
          supabase,
          userId,
          companyId,
          connectionId,
          milestone: "comms_wizard_ready_shown",
          title: "SYS :: AUTONOMY UNLOCK · CONFIGURE COMMUNICATIONS",
          body: "Your AI is ready to handle client communications. Take 2 minutes to set up how you want it to work.",
          actionUrl: "/calibration?section=config&wizard=open",
          actionLabel: "Configure",
        });

        milestones.comms_wizard_ready_shown = true;
      }
    } catch (err) {
      if (options.throwOnError) throw err;
      console.error(
        "[autonomy-milestones] Check after sync failed (non-fatal):",
        err
      );
    }
  },

  /**
   * Check milestones after a draft outcome is recorded.
   * Called from ai-draft-service.ts after recordDraftOutcome.
   * Validates the actor/mailbox milestone ledger. Exact-category graduation
   * and its persistent prompt are handled by the durable graduation sweep.
   */
  async checkMilestonesAfterDraftFeedback(
    companyId: string,
    userId: string,
    connectionId: string,
    options: { throwOnError?: boolean } = {}
  ): Promise<void> {
    try {
      const supabase = requireSupabase();

      // ── Fetch connection settings ─────────────────────────────────────
      const { data: conn, error: connectionError } = await supabase
        .from("email_connections")
        .select("auto_send_settings, type, user_id")
        .eq("id", connectionId)
        .eq("company_id", companyId)
        .single();

      if (connectionError) throw new Error(connectionError.message);
      if (!conn) return;
      assertActorMailboxScope(conn, userId);

      await getActorAutonomyMilestones({
        companyId,
        connectionId,
        userId,
        supabase,
      });
    } catch (err) {
      if (options.throwOnError) throw err;
      console.error(
        "[autonomy-milestones] Check after draft feedback failed (non-fatal):",
        err
      );
    }
  },

  /**
   * Compute the user's current autonomy level.
   * Used by the settings UI to show the autonomy ladder status.
   */
  async getAutonomyLevel(
    companyId: string,
    userId: string,
    connectionId: string
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
    const { data: conn, error: connectionError } = await supabase
      .from("email_connections")
      .select("auto_send_settings, type, user_id")
      .eq("id", connectionId)
      .eq("company_id", companyId)
      .single();

    if (connectionError) throw new Error(connectionError.message);
    if (!conn) throw new Error("Email connection unavailable");
    assertActorMailboxScope(conn, userId);

    const settings = (conn.auto_send_settings as Record<string, unknown>) || {};
    const milestones = await getActorAutonomyMilestones({
      companyId,
      connectionId,
      userId,
      supabase,
    });
    const autoDraftEnabled = settings.auto_draft_enabled === true;
    const autoSendEnabled = settings.enabled === true;
    const actorCategoryAutonomy = await PhaseCCategoryAutonomy.get(
      connectionId,
      userId
    );
    const categoryAutonomy = Object.fromEntries(
      Object.entries(actorCategoryAutonomy).map(([category, level]) => [
        `primary:${category}`,
        level,
      ])
    );

    // Fetch writing profile
    const profile = await getActorWritingProfile(companyId, userId);
    const emailsAnalyzed = (profile?.emails_analyzed as number) || 0;
    const confidence = WritingProfileService.getConfidence(emailsAnalyzed);

    // Fetch draft stats
    const { totalDrafts, approvalRate } = await getHumanDraftApprovalStats(
      companyId,
      connectionId,
      userId
    );

    const level = computeLevel({
      emailsAnalyzed,
      confidence,
      autoDraftEnabled,
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
    userId: string
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

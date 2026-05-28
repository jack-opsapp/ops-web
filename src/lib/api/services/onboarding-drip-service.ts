import type { SupabaseClient } from "@supabase/supabase-js";
import { detectCompanyTimezone } from "@/lib/utils/company-timezone";
import {
  sendOnboardingDay0Welcome,
  sendOnboardingDay1NoProject,
  sendOnboardingDay1HasProject,
  sendOnboardingDay3Inbox,
  sendOnboardingDay4NoNotification,
  sendOnboardingDay4HasNotification,
  sendOnboardingDay8Estimates,
  sendOnboardingDay14Quiet,
  sendOnboardingDay14Active,
  sendOnboardingLostYou,
} from "@/lib/email/sendgrid";

/**
 * Onboarding drip service. Calendar-driven plus behavior-triggered
 * sends for trial signups, Day 0 through Day 14. Cleanly hands off
 * to TrialExpiryService at Day 23.
 *
 * See specs/2026-05-27-onboarding-drip-design.md (v3.1) for the
 * canonical design. Every method here is documented against a
 * section of that spec.
 */

export type DaySlot =
  | "day_0"
  | "day_1"
  | "day_3"
  | "day_4"
  | "day_8"
  | "day_14"
  | "lost_you";

export type Branch =
  | "no_project"
  | "has_project"
  | "no_aha"
  | "has_aha"
  | "quiet"
  | "active"
  | null;

export interface ComputedState {
  branch: Branch;
  emailType: string;
  payload: Record<string, unknown>;
}

export type ClaimAndSendStatus =
  | "already_claimed"
  | "reconciled"
  | "sent"
  | "paused"
  | "suppressed"
  | "failed";

export interface ClaimAndSendParams {
  user: { id: string; email: string; first_name: string | null };
  company: { id: string; latitude: number | null; longitude: number | null };
  daySlot: DaySlot;
  branch: Branch;
  emailType: string;
  payload: Record<string, unknown>;
  now: Date;
}

export interface ClaimAndSendResult {
  status: ClaimAndSendStatus;
  rowId?: string;
}

/**
 * Compute the hard end of the retry window for a day-slot. Per spec §8,
 * day_slot_expires_at is conservatively set to now + 24h so the cron has
 * the full day to retry on transient failures. The timezone argument is
 * currently unused but reserved for a future refinement that aligns the
 * cutoff to operator-local end-of-day.
 */
function computeDaySlotExpiresAt(now: Date, _daySlot: DaySlot, _timezone: string): Date {
  return new Date(now.getTime() + 24 * 60 * 60_000);
}

/**
 * Partial-success reconciliation per spec §3 v3.1. After winning the
 * onboarding_email_log claim, check whether a matching email_log row
 * already exists with status='sent'. Primary join uses
 * metadata.onboarding_email_log_id (set by the typed sender). Fallback
 * joins by recipient_email + 5-minute sent_at window in case the primary
 * key wasn't yet persisted when the prior send completed.
 */
async function reconcileAgainstEmailLog(
  db: SupabaseClient,
  opts: {
    userId: string;
    emailType: string;
    recipientEmail: string;
    claimRowId: string;
    createdAt: Date;
  },
): Promise<{ sgMessageId: string | null } | null> {
  // Primary join: metadata.onboarding_email_log_id
  const { data: primary } = await db
    .from("email_log")
    .select("id, metadata")
    .eq("user_id", opts.userId)
    .eq("email_type", opts.emailType)
    .eq("status", "sent")
    .eq("metadata->>onboarding_email_log_id", opts.claimRowId)
    .limit(1);
  if (primary && primary.length > 0) {
    const meta = (primary[0] as { metadata?: Record<string, unknown> }).metadata;
    return { sgMessageId: (meta?.sg_message_id as string | undefined) ?? null };
  }
  // Fallback: recipient_email + 5-minute window
  const fiveMinutesBack = new Date(opts.createdAt.getTime() - 5 * 60_000).toISOString();
  const { data: fallback } = await db
    .from("email_log")
    .select("id, metadata")
    .eq("user_id", opts.userId)
    .eq("email_type", opts.emailType)
    .eq("status", "sent")
    .eq("recipient_email", opts.recipientEmail.toLowerCase())
    .gte("sent_at", fiveMinutesBack)
    .order("sent_at", { ascending: false })
    .limit(1);
  if (fallback && fallback.length > 0) {
    const meta = (fallback[0] as { metadata?: Record<string, unknown> }).metadata;
    return { sgMessageId: (meta?.sg_message_id as string | undefined) ?? null };
  }
  return null;
}

/**
 * Switch on emailType and call the right typed sender from sendgrid.tsx.
 * Each sender accepts `onboardingEmailLogId` and includes it in
 * metadata + customArgs for reconciliation + webhook attribution.
 */
async function dispatchTypedSender(
  params: ClaimAndSendParams,
  onboardingEmailLogId: string,
) {
  const baseArgs = {
    email: params.user.email,
    firstName: params.user.first_name,
    onboardingEmailLogId,
  };
  switch (params.emailType) {
    case "onboarding_day_0_welcome":
      return sendOnboardingDay0Welcome(baseArgs);
    case "onboarding_day_1_no_project":
      return sendOnboardingDay1NoProject({
        email: params.user.email,
        ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL}/projects/new`,
        onboardingEmailLogId,
      });
    case "onboarding_day_1_has_project":
      return sendOnboardingDay1HasProject({
        email: params.user.email,
        projectCount: (params.payload.projectCount as number) ?? 1,
        ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
        onboardingEmailLogId,
      });
    case "onboarding_day_3_inbox":
      return sendOnboardingDay3Inbox(baseArgs);
    case "onboarding_day_4_no_notification":
      return sendOnboardingDay4NoNotification({
        email: params.user.email,
        ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL}/settings/team`,
        onboardingEmailLogId,
      });
    case "onboarding_day_4_has_notification":
      return sendOnboardingDay4HasNotification({
        email: params.user.email,
        ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL}/projects?filter=recurring`,
        onboardingEmailLogId,
      });
    case "onboarding_day_8_estimates":
      return sendOnboardingDay8Estimates(baseArgs);
    case "onboarding_day_14_quiet":
      return sendOnboardingDay14Quiet(baseArgs);
    case "onboarding_day_14_active":
      return sendOnboardingDay14Active({
        email: params.user.email,
        firstName: params.user.first_name,
        projectCount: (params.payload.projectCount as number) ?? 0,
        taskCount: (params.payload.taskCount as number) ?? 0,
        notificationCount: (params.payload.notificationCount as number) ?? 0,
        onboardingEmailLogId,
      });
    case "onboarding_lost_you":
      return sendOnboardingLostYou({
        email: params.user.email,
        firstName: params.user.first_name,
        daysSinceSignup: (params.payload.daysSinceSignup as number) ?? 0,
        daysSinceLastActivity: (params.payload.daysSinceLastActivity as number) ?? 0,
        onboardingEmailLogId,
      });
    default:
      throw new Error(`Unknown emailType: ${params.emailType}`);
  }
}

/**
 * Returns the wall-clock hour (0-23) in the operator's local timezone.
 * Used by the cron's localHour===9 gate. Falls back to UTC if timezone
 * is unknown.
 */
export function computeOperatorLocalHour(
  utcNow: Date,
  timezone: string | null,
): number {
  if (!timezone) return utcNow.getUTCHours();
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const parts = fmt.formatToParts(utcNow);
    const hourPart = parts.find((p) => p.type === "hour");
    const h = hourPart ? parseInt(hourPart.value, 10) : NaN;
    // Intl returns "24" for midnight in some locales; normalize to 0
    return isNaN(h) ? utcNow.getUTCHours() : h % 24;
  } catch {
    return utcNow.getUTCHours();
  }
}

export const OnboardingDripService = {
  /**
   * Resolve the branch + emailType for the given day, given the company + user
   * state. Returns the email_type string to pass into KIND_TO_LIST + sendgrid.
   * See spec §5 for the exact branch conditions.
   */
  async computeState(
    db: SupabaseClient,
    user: { id: string; first_name?: string | null; onboarding_completed?: Record<string, boolean> | null },
    company: { id: string },
    daySlot: DaySlot,
  ): Promise<ComputedState> {
    switch (daySlot) {
      case "day_0":
        return { branch: null, emailType: "onboarding_day_0_welcome", payload: {} };

      case "day_1": {
        const webOnboarded = user.onboarding_completed?.web === true;
        let projectCount = 0;
        if (webOnboarded) {
          const { count } = await db
            .from("projects")
            .select("id", { count: "exact", head: true })
            .eq("company_id", company.id)
            .is("deleted_at", null);
          projectCount = count ?? 0;
        }
        if (webOnboarded && projectCount >= 1) {
          return {
            branch: "has_project",
            emailType: "onboarding_day_1_has_project",
            payload: { projectCount },
          };
        }
        return { branch: "no_project", emailType: "onboarding_day_1_no_project", payload: {} };
      }

      case "day_3":
        return { branch: null, emailType: "onboarding_day_3_inbox", payload: {} };

      case "day_4": {
        const { count } = await db
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("type", "task_completed");
        if ((count ?? 0) >= 1) {
          return { branch: "has_aha", emailType: "onboarding_day_4_has_notification", payload: {} };
        }
        return { branch: "no_aha", emailType: "onboarding_day_4_no_notification", payload: {} };
      }

      case "day_8":
        return { branch: null, emailType: "onboarding_day_8_estimates", payload: {} };

      case "day_14": {
        // Activity = any updated_at newer than 7d ago across 6 tables for this company
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
        const tables = ["projects", "project_tasks", "clients", "opportunities", "estimates", "invoices"] as const;
        const checks = await Promise.all(
          tables.map(async (table) => {
            const { count } = await db
              .from(table)
              .select("id", { count: "exact", head: true })
              .eq("company_id", company.id)
              .gte("updated_at", sevenDaysAgo);
            return count ?? 0;
          }),
        );
        const totalActivity = checks.reduce((a, b) => a + b, 0);
        if (totalActivity > 0) {
          const [proj, task, notif] = await Promise.all([
            db.from("projects").select("id", { count: "exact", head: true }).eq("company_id", company.id).is("deleted_at", null),
            db.from("project_tasks").select("id", { count: "exact", head: true }).eq("company_id", company.id).is("deleted_at", null),
            db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("type", "task_completed"),
          ]);
          return {
            branch: "active",
            emailType: "onboarding_day_14_active",
            payload: {
              projectCount: proj.count ?? 0,
              taskCount: task.count ?? 0,
              notificationCount: notif.count ?? 0,
            },
          };
        }
        return { branch: "quiet", emailType: "onboarding_day_14_quiet", payload: {} };
      }

      case "lost_you":
        return { branch: null, emailType: "onboarding_lost_you", payload: {} };
    }
  },

  /**
   * Core dispatch primitive. Claim a (user_id, day_slot) slot via INSERT
   * ON CONFLICT, reconcile against any prior email_log delivery (partial
   * success during a previous crashed/retried run), then dispatch the
   * typed sender. Updates the claim row to reflect the final outcome.
   *
   * Per spec §3 v3.1:
   *   - 'already_claimed': another worker beat us to the row → return
   *   - 'reconciled': a prior send for this row landed → mark sent, return
   *   - 'sent': gatedSend succeeded → mark sent + sg_message_id
   *   - 'paused': gatedSend returned paused_skipped → re-pend (no attempt
   *     increment, since pause is reversible and retryable)
   *   - 'suppressed': gatedSend returned suppression_skipped → mark
   *     skipped (terminal — suppressions are permanent opt-outs)
   */
  async claimAndSend(
    db: SupabaseClient,
    params: ClaimAndSendParams,
  ): Promise<ClaimAndSendResult> {
    // Compute day_slot_expires_at via the operator's local timezone.
    const timezone = detectCompanyTimezone(
      params.company.latitude,
      params.company.longitude,
    );
    const expiresAt = computeDaySlotExpiresAt(params.now, params.daySlot, timezone);

    // 1. Claim — INSERT pending row. UNIQUE (user_id, day_slot) means a
    // duplicate violation hands the row to another worker.
    const { data: claimed, error: claimErr } = await db
      .from("onboarding_email_log")
      .insert({
        user_id: params.user.id,
        company_id: params.company.id,
        day_slot: params.daySlot,
        branch: params.branch,
        email_type: params.emailType,
        status: "pending",
        attempts: 0,
        day_slot_expires_at: expiresAt.toISOString(),
      })
      .select("id")
      .single();

    if (claimErr || !claimed) {
      // Unique violation — another worker won the race.
      return { status: "already_claimed" };
    }

    // 2. Partial-success reconciliation. If a previous run already wrote a
    // sent row into email_log for this claim, mark the claim as sent
    // without re-dispatching SendGrid (which would double-send).
    const reconciled = await reconcileAgainstEmailLog(db, {
      userId: params.user.id,
      emailType: params.emailType,
      recipientEmail: params.user.email,
      claimRowId: (claimed as { id: string }).id,
      createdAt: params.now,
    });

    if (reconciled) {
      await db
        .from("onboarding_email_log")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          sg_message_id: reconciled.sgMessageId,
        })
        .eq("id", (claimed as { id: string }).id);
      return { status: "reconciled", rowId: (claimed as { id: string }).id };
    }

    // 3. Dispatch the typed sender. gatedSend handles pause + suppression
    // gating internally and writes the email_log row.
    const sendResult = await dispatchTypedSender(params, (claimed as { id: string }).id);

    // 4. Reconcile post-send status onto the claim row.
    if (sendResult.status === "sent") {
      await db
        .from("onboarding_email_log")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          sg_message_id: sendResult.messageId,
        })
        .eq("id", (claimed as { id: string }).id);
      return { status: "sent", rowId: (claimed as { id: string }).id };
    }

    if (sendResult.status === "paused_skipped") {
      // Paused: re-pend without attempt increment — pauses are reversible
      // so the next cron tick retries naturally.
      await db
        .from("onboarding_email_log")
        .update({ status: "pending" })
        .eq("id", (claimed as { id: string }).id);
      return { status: "paused", rowId: (claimed as { id: string }).id };
    }

    if (sendResult.status === "suppression_skipped") {
      // Suppressed: terminal. The recipient opted out; do not retry.
      await db
        .from("onboarding_email_log")
        .update({ status: "skipped" })
        .eq("id", (claimed as { id: string }).id);
      return { status: "suppressed", rowId: (claimed as { id: string }).id };
    }

    // Unreachable in normal flow — GatedSendResult is a discriminated union
    // covering exactly the three statuses above.
    return { status: "failed", rowId: (claimed as { id: string }).id };
  },
};

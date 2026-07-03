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
    userId: params.user.id,
  };
  switch (params.emailType) {
    case "onboarding_day_0_welcome":
      return sendOnboardingDay0Welcome(baseArgs);
    case "onboarding_day_1_no_project":
      return sendOnboardingDay1NoProject({
        email: params.user.email,
        // /projects/new is the permanent create deep link (opens the
        // workspace create window on the dashboard) — never retire it.
        ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL}/projects/new`,
        onboardingEmailLogId,
        userId: params.user.id,
      });
    case "onboarding_day_1_has_project":
      return sendOnboardingDay1HasProject({
        email: params.user.email,
        projectCount: (params.payload.projectCount as number) ?? 1,
        ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
        onboardingEmailLogId,
        userId: params.user.id,
      });
    case "onboarding_day_3_inbox":
      return sendOnboardingDay3Inbox(baseArgs);
    case "onboarding_day_4_no_notification":
      return sendOnboardingDay4NoNotification({
        email: params.user.email,
        ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL}/settings/team`,
        onboardingEmailLogId,
        userId: params.user.id,
      });
    case "onboarding_day_4_has_notification":
      return sendOnboardingDay4HasNotification({
        email: params.user.email,
        ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL}/projects?filter=recurring`,
        onboardingEmailLogId,
        userId: params.user.id,
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
        userId: params.user.id,
      });
    case "onboarding_lost_you":
      return sendOnboardingLostYou({
        email: params.user.email,
        firstName: params.user.first_name,
        daysSinceSignup: (params.payload.daysSinceSignup as number) ?? 0,
        daysSinceLastActivity: (params.payload.daysSinceLastActivity as number) ?? 0,
        onboardingEmailLogId,
        userId: params.user.id,
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

  /**
   * Per-company orchestrator. Runs kill-switch checks, resolves the
   * account_holder operator, computes which day slot(s) apply based on
   * company age (whole days since created_at), then dispatches each
   * applicable slot through computeState → claimAndSend.
   *
   * Kill switches (spec §4):
   *   - company.deleted_at set
   *   - subscription_status ∈ {cancelled, expired, paused}
   *   - account_holder_id missing
   *   - operator missing/deleted/no email
   *   - internal email domain (@opsapp.co for staff, @anthropic.com for testing)
   *
   * Day-slot eligibility is age-driven: a company that signed up N whole
   * days ago is eligible for day_N if N ∈ {1, 3, 4, 8, 14}. Day 0 lives
   * in the signup webhook (immediate), not the cron. The lost_you slot
   * is event-triggered elsewhere, not age-driven.
   */
  async processCompany(
    db: SupabaseClient,
    company: {
      id: string;
      deleted_at: string | null;
      subscription_status: string;
      account_holder_id: string | null;
      admin_ids: string[] | null;
      created_at: string;
      latitude: number | null;
      longitude: number | null;
    },
    now: Date,
  ): Promise<{ processed: number; skipped: { reason: string }[] }> {
    const result = { processed: 0, skipped: [] as { reason: string }[] };

    // Kill switches
    if (company.deleted_at) {
      result.skipped.push({ reason: "company deleted" });
      return result;
    }
    if (["cancelled", "expired", "paused"].includes(company.subscription_status)) {
      result.skipped.push({ reason: `subscription ${company.subscription_status}` });
      return result;
    }
    if (!company.account_holder_id) {
      result.skipped.push({ reason: "no account_holder_id" });
      return result;
    }

    // Resolve operator
    const { data: operator } = await db
      .from("users")
      .select("id, email, first_name, deleted_at, onboarding_completed")
      .eq("id", company.account_holder_id)
      .maybeSingle();

    if (!operator || operator.deleted_at || !operator.email) {
      result.skipped.push({ reason: "no active operator" });
      return result;
    }

    // Internal-domain allowlist — staff + testing inbox never receive the drip
    const INTERNAL_DOMAINS = ["@opsapp.co", "@anthropic.com"];
    if (INTERNAL_DOMAINS.some((d) => operator.email.toLowerCase().endsWith(d))) {
      result.skipped.push({ reason: "internal email domain" });
      return result;
    }

    // Compute eligible day slots based on company age (rounded down to whole days)
    const ageDays = Math.floor(
      (now.getTime() - new Date(company.created_at).getTime()) / 86400_000,
    );
    const eligibleSlots: DaySlot[] = [];
    if (ageDays === 1) eligibleSlots.push("day_1");
    if (ageDays === 3) eligibleSlots.push("day_3");
    if (ageDays === 4) eligibleSlots.push("day_4");
    if (ageDays === 8) eligibleSlots.push("day_8");
    if (ageDays === 14) eligibleSlots.push("day_14");

    for (const daySlot of eligibleSlots) {
      const state = await this.computeState(db, operator as any, company, daySlot);
      const sendResult = await this.claimAndSend(db, {
        user: operator as { id: string; email: string; first_name: string | null },
        company,
        daySlot,
        branch: state.branch,
        emailType: state.emailType,
        payload: state.payload,
        now,
      });
      if (sendResult.status === "sent" || sendResult.status === "reconciled") {
        result.processed++;
      }
    }
    return result;
  },

  /**
   * Retry sweep per spec §3. Picks up onboarding_email_log rows that are
   * still pending or failed and re-attempts the send. Three gates must
   * all pass for a row to be eligible:
   *
   *   1. attempts < 3 — max three total attempts before giving up
   *   2. now() < day_slot_expires_at — haven't blown past the retry window
   *   3. updated_at < now() - 5 minutes — in-flight gate to prevent racing
   *      a concurrent async Day 0 dispatch that just claimed the row
   *
   * For each candidate: re-fetch operator + company, reconcile against
   * email_log (covers the case where a prior attempt actually sent but
   * didn't update the claim row), then either mark sent (if reconciled)
   * or call dispatchTypedSender and update status. Mirrors the post-claim
   * path of claimAndSend.
   *
   * Notes on attempts accounting:
   *   - 'sent' increments attempts (records the work done)
   *   - 'paused_skipped' does NOT increment attempts — pause is operator-
   *     initiated and reversible, so we shouldn't burn retries on it
   *   - 'suppression_skipped' is terminal (status=skipped); never retried
   */
  async processRetries(db: SupabaseClient, now: Date): Promise<{ retried: number }> {
    const fiveMinAgo = new Date(now.getTime() - 5 * 60_000).toISOString();
    const { data: candidates } = await db
      .from("onboarding_email_log")
      .select("id, user_id, company_id, day_slot, branch, email_type, attempts")
      .in("status", ["pending", "failed"])
      .lt("attempts", 3)
      .gt("day_slot_expires_at", now.toISOString())
      .lt("updated_at", fiveMinAgo)
      .limit(100);

    let retried = 0;
    for (const row of (candidates ?? []) as Array<{
      id: string;
      user_id: string;
      company_id: string;
      day_slot: string;
      branch: string | null;
      email_type: string;
      attempts: number;
    }>) {
      // Re-fetch operator + company so the typed sender can dispatch.
      const { data: operator } = await db
        .from("users")
        .select("id, email, first_name, deleted_at")
        .eq("id", row.user_id)
        .maybeSingle();

      if (!operator || operator.deleted_at || !operator.email) {
        // Operator vanished mid-flight — leave the row alone; expiry will clean up.
        continue;
      }

      const { data: company } = await db
        .from("companies")
        .select("id, latitude, longitude")
        .eq("id", row.company_id)
        .maybeSingle();

      if (!company) continue;

      // Reconcile against email_log first. If a prior attempt actually
      // landed (but the claim row wasn't updated due to crash/timeout),
      // we mark the row sent without re-dispatching.
      const reconciled = await reconcileAgainstEmailLog(db, {
        userId: row.user_id,
        emailType: row.email_type,
        recipientEmail: operator.email,
        claimRowId: row.id,
        createdAt: now,
      });

      if (reconciled) {
        await db
          .from("onboarding_email_log")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            sg_message_id: reconciled.sgMessageId,
          })
          .eq("id", row.id);
        retried++;
        continue;
      }

      // Dispatch the typed sender (mirrors claimAndSend post-claim logic).
      // payload is empty here — recomputing computeState would yield
      // slightly different stats (best-effort accepted; retry sends rare).
      const sendResult = await dispatchTypedSender(
        {
          user: operator as { id: string; email: string; first_name: string | null },
          company: company as { id: string; latitude: number | null; longitude: number | null },
          daySlot: row.day_slot as DaySlot,
          branch: row.branch as Branch,
          emailType: row.email_type,
          payload: {},
          now,
        },
        row.id,
      );

      if (sendResult.status === "sent") {
        await db
          .from("onboarding_email_log")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            sg_message_id: sendResult.messageId,
            attempts: row.attempts + 1,
          })
          .eq("id", row.id);
        retried++;
      } else if (sendResult.status === "paused_skipped") {
        // Re-pend without attempt increment — pause is reversible and
        // operator-initiated, so we shouldn't burn retries on it.
        await db
          .from("onboarding_email_log")
          .update({ status: "pending" })
          .eq("id", row.id);
      } else if (sendResult.status === "suppression_skipped") {
        // Suppression is terminal — recipient explicitly opted out.
        await db
          .from("onboarding_email_log")
          .update({ status: "skipped" })
          .eq("id", row.id);
      }
    }

    return { retried };
  },

  /**
   * Behavior-triggered re-engagement send (spec §7). Fires once per trial
   * when the operator has had zero activity for 6+ consecutive calendar
   * days between Day 1 and Day 14. All five conditions must hold: kill
   * switches clear, age in [1, 14], neither Day 14 nor Lost You already
   * sent, zero activity across the 6 tables in the last 6 days, operator
   * still active.
   */
  async processLostYouCandidate(
    db: SupabaseClient,
    company: {
      id: string;
      account_holder_id: string | null;
      created_at: string;
      latitude: number | null;
      longitude: number | null;
      subscription_status: string;
      deleted_at: string | null;
    },
    now: Date,
  ): Promise<{ fired: boolean; reason?: string }> {
    if (company.deleted_at) return { fired: false, reason: "deleted" };
    if (["cancelled", "expired", "paused"].includes(company.subscription_status)) {
      return { fired: false, reason: `subscription ${company.subscription_status}` };
    }
    if (!company.account_holder_id) {
      return { fired: false, reason: "no account_holder_id" };
    }

    const ageDays = Math.floor(
      (now.getTime() - new Date(company.created_at).getTime()) / 86400_000,
    );
    if (ageDays < 1 || ageDays > 14) {
      return { fired: false, reason: "outside window" };
    }

    const { data: existing } = await db
      .from("onboarding_email_log")
      .select("day_slot")
      .eq("company_id", company.id)
      .in("day_slot", ["day_14", "lost_you"]);
    if ((existing ?? []).length > 0) {
      return { fired: false, reason: "day_14 or lost_you already sent" };
    }

    const sixDaysAgo = new Date(now.getTime() - 6 * 86400_000).toISOString();
    const tables = [
      "projects",
      "project_tasks",
      "clients",
      "opportunities",
      "estimates",
      "invoices",
    ] as const;
    const checks = await Promise.all(
      tables.map(async (t) => {
        const { count } = await db
          .from(t)
          .select("id", { count: "exact", head: true })
          .eq("company_id", company.id)
          .gte("updated_at", sixDaysAgo);
        return count ?? 0;
      }),
    );
    const totalRecent = checks.reduce((a, b) => a + b, 0);
    if (totalRecent > 0) return { fired: false, reason: "recent activity" };

    const { data: operator } = await db
      .from("users")
      .select("id, email, first_name, deleted_at")
      .eq("id", company.account_holder_id)
      .maybeSingle();

    if (!operator || operator.deleted_at || !operator.email) {
      return { fired: false, reason: "no operator" };
    }

    const result = await this.claimAndSend(db, {
      user: operator as { id: string; email: string; first_name: string | null },
      company,
      daySlot: "lost_you",
      branch: null,
      emailType: "onboarding_lost_you",
      payload: {
        daysSinceSignup: ageDays,
        daysSinceLastActivity: 6,
      },
      now,
    });
    return { fired: result.status === "sent" || result.status === "reconciled" };
  },

  /**
   * Top-level cron orchestrator (spec §9). Queries every company that
   * signed up within the last 15 days (UTC tolerance buffer — operators
   * at the 14d boundary in their local timezone could still be inside the
   * 15d UTC window), then for each company:
   *
   *   1. Gates by `computeOperatorLocalHour === 9` using the operator's
   *      detected timezone. The cron is invoked hourly, but only the run
   *      that lands at the operator's local 9am dispatches calendar +
   *      lost_you sends. This keeps emails landing during business hours
   *      across every North American timezone.
   *   2. Runs `processCompany` (calendar-driven day_1/3/4/8/14 dispatch).
   *   3. Runs `processLostYouCandidate` (behavior-triggered re-engagement).
   *
   * Retries are timezone-agnostic — the in-flight 5-minute gate and 24h
   * expiry already protect them — so `processRetries` is invoked once
   * per cron tick regardless of the localHour gate.
   *
   * Returned counters:
   *   - scanned: total companies returned by the candidate query
   *   - calendar_processed: # of slots successfully sent across all companies
   *   - lost_you_fired: # of lost_you sends that fired
   *   - retried: # of retry rows reconciled or re-dispatched
   */
  async processAll(
    db: SupabaseClient,
    now: Date = new Date(),
  ): Promise<{ scanned: number; calendar_processed: number; lost_you_fired: number; retried: number }> {
    const fifteenDaysAgo = new Date(now.getTime() - 15 * 86400_000).toISOString();

    const { data: candidates } = await db
      .from("companies")
      .select(
        "id, account_holder_id, admin_ids, deleted_at, subscription_status, created_at, latitude, longitude",
      )
      .gte("created_at", fifteenDaysAgo)
      .is("deleted_at", null);

    let calendar = 0;
    let lost = 0;
    for (const company of (candidates ?? []) as Array<{
      id: string;
      account_holder_id: string | null;
      admin_ids: string[] | null;
      deleted_at: string | null;
      subscription_status: string;
      created_at: string;
      latitude: number | null;
      longitude: number | null;
    }>) {
      const tz = detectCompanyTimezone(company.latitude, company.longitude);
      const localHour = computeOperatorLocalHour(now, tz);
      if (localHour !== 9) continue;
      const r1 = await this.processCompany(db, company, now);
      calendar += r1.processed;
      const r2 = await this.processLostYouCandidate(db, company, now);
      if (r2.fired) lost++;
    }

    // Always sweep retries regardless of local time — retries are
    // timezone-agnostic; they only care about the 5-min in-flight gate
    // and the 24h day_slot_expires_at window.
    const r3 = await this.processRetries(db, now);

    return {
      scanned: candidates?.length ?? 0,
      calendar_processed: calendar,
      lost_you_fired: lost,
      retried: r3.retried,
    };
  },
};

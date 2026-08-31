/**
 * OPS Web - Trial Expiry Service
 *
 * Finds companies in trial and sends warning, discount, and re-engagement
 * emails at specific day-offsets from the trial end date.
 *
 * Called exclusively from /api/cron/trial-expiry which runs once daily.
 * Dedupes via the trial_expiry_notifications table (UNIQUE on
 * company_id + notification_type) so reruns on the same day are safe.
 *
 * Notification schedule:
 *   daysRemaining  = 7  → warning_7d        (email only)
 *   daysRemaining  = 5  → warning_5d        (email only)
 *   daysRemaining  = 3  → discount_3d       (email + push + in-app)
 *   daysRemaining  = 1  → warning_1d        (email only)
 *   daysSinceEnd   = 7  → reengagement_7d   (email + in-app)
 *   daysSinceEnd   = 30 → reengagement_30d  (email + in-app)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sendTrialExpiryWarning,
  sendTrialExpiryDiscount,
  sendTrialExpiryReengagement,
} from "@/lib/email/sendgrid";
import { sendOneSignalPush } from "@/lib/integrations/onesignal";
import { filterPushRecipientsByQuietHours } from "@/lib/notifications/server-notification-service";
import {
  detectCompanyTimezone,
  formatTrialEndDisplay,
} from "@/lib/utils/company-timezone";
import { getAppUrl } from "@/lib/utils/app-url";
import {
  CronDatabaseOperationError,
  isDatabasePressureError,
} from "./cron-workload-control-service";

// ─── Types ───────────────────────────────────────────────────────────────────

export type TrialNotificationType =
  | "warning_7d"
  | "warning_5d"
  | "discount_3d"
  | "warning_1d"
  | "reengagement_7d"
  | "reengagement_30d";

interface TrialCompanyRow {
  id: string;
  name: string;
  trial_end_date: string;
  latitude: number | null;
  longitude: number | null;
  default_project_color: string | null;
  logo_url: string | null;
  admin_ids: string[] | null;
}

interface AdminUserRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  deleted_at: string | null;
}

interface PromoCodePair {
  code50: string;
  code30: string;
}

export interface ProcessResult {
  scanned: number;
  sent: Array<{ companyId: string; type: TrialNotificationType }>;
  skipped: Array<{ companyId: string; reason: string }>;
  errors: Array<{ companyId: string; error: string }>;
  /**
   * Companies whose push leg failed on an earlier run and succeeded on this
   * one. The email and in-app legs were already delivered under the original
   * claim — only the push was re-attempted (bug 60480c86).
   */
  pushRetries: Array<{ companyId: string }>;
  nextCompanyCursor: string | null;
}

/**
 * How many times the push leg of one claimed notification may be attempted
 * before it is written off as `failed`. Trial expiry is a daily cadence, so
 * the budget spans days, not seconds.
 */
export const TRIAL_EXPIRY_PUSH_MAX_ATTEMPTS = 3;

type PushLegStatus =
  | "not_applicable"
  | "sent"
  | "skipped_quiet_hours"
  | "retry_eligible"
  | "failed";

interface PushLegOutcome {
  status: "sent" | "skipped_quiet_hours" | "retry_eligible";
  error?: string;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/**
 * Compute how many days remain until trialEnd, rounding up so "2 days left"
 * means the user still has today and tomorrow. Negative when expired.
 */
function daysRemainingUntil(trialEnd: Date, now: Date): number {
  const deltaMs = trialEnd.getTime() - now.getTime();
  return Math.ceil(deltaMs / MS_PER_DAY);
}

/**
 * Compute how many whole days have passed since trialEnd. Floor so day 7
 * fires 7+ days after expiry, not 6+ days after.
 */
function daysSince(trialEnd: Date, now: Date): number {
  const deltaMs = now.getTime() - trialEnd.getTime();
  return Math.floor(deltaMs / MS_PER_DAY);
}

function determineNotificationType(
  trialEnd: Date,
  now: Date
): TrialNotificationType | null {
  const remaining = daysRemainingUntil(trialEnd, now);

  if (remaining === 7) return "warning_7d";
  if (remaining === 5) return "warning_5d";
  if (remaining === 3) return "discount_3d";
  if (remaining === 1) return "warning_1d";

  if (remaining < 0) {
    const sinceEnd = daysSince(trialEnd, now);
    if (sinceEnd === 7) return "reengagement_7d";
    if (sinceEnd === 30) return "reengagement_30d";
  }

  return null;
}

function getPromoCodes(type: TrialNotificationType): PromoCodePair | null {
  const read = (key: string): string => {
    const value = process.env[key];
    if (!value) {
      console.error(`[trial-expiry] Missing env var: ${key}`);
      return "";
    }
    return value;
  };

  switch (type) {
    case "discount_3d":
      return {
        code50: read("STRIPE_PROMO_PREEXPIRY_50"),
        code30: read("STRIPE_PROMO_PREEXPIRY_30"),
      };
    case "reengagement_7d":
      return {
        code50: read("STRIPE_PROMO_POSTEXPIRY_7D_50"),
        code30: read("STRIPE_PROMO_POSTEXPIRY_7D_30"),
      };
    case "reengagement_30d":
      return {
        code50: read("STRIPE_PROMO_POSTEXPIRY_30D_50"),
        code30: read("STRIPE_PROMO_POSTEXPIRY_30D_30"),
      };
    default:
      return null;
  }
}

function getSubscribeUrl(): string {
  return `${getAppUrl()}/settings?tab=subscription`;
}

function isDiscountType(type: TrialNotificationType): boolean {
  return (
    type === "discount_3d" ||
    type === "reengagement_7d" ||
    type === "reengagement_30d"
  );
}

function shouldSendPush(type: TrialNotificationType): boolean {
  // Per spec, only the pre-expiry discount offer fires a push.
  // Post-expiry users are assumed to have disengaged or uninstalled.
  return type === "discount_3d";
}

function buildPushCopy(
  type: TrialNotificationType,
  daysRemaining: number,
  daysSinceExpiry: number
): { title: string; body: string } {
  switch (type) {
    case "warning_7d":
    case "warning_5d":
    case "warning_1d":
      return {
        title: "OPS trial ending",
        body:
          daysRemaining === 1
            ? "Your trial ends tomorrow. Tap to pick a plan."
            : `Your trial ends in ${daysRemaining} days. Tap to pick a plan.`,
      };
    case "discount_3d":
      return {
        title: "3 days left — take 50% off",
        body: "Two codes waiting inside. Tap to apply and subscribe.",
      };
    case "reengagement_7d":
      return {
        title: "Still thinking about OPS?",
        body: "50% off or 30% off — two codes inside.",
      };
    case "reengagement_30d":
      return {
        title: "Last check-in from OPS",
        body: `Your trial ended ${daysSinceExpiry} days ago. 50% or 30% off inside.`,
      };
  }
}

function buildInAppCopy(
  type: TrialNotificationType,
  daysRemaining: number
): { title: string; body: string } {
  switch (type) {
    case "warning_7d":
    case "warning_5d":
    case "warning_1d":
      return {
        title: "OPS trial ending soon",
        body:
          daysRemaining === 1
            ? "Your trial ends tomorrow — pick a plan to keep your crew working."
            : `Your trial ends in ${daysRemaining} days — pick a plan to keep your crew working.`,
      };
    case "discount_3d":
      return {
        title: "3 days left — 50% off or 30% off",
        body: "Tap to open plan selection with your discount applied.",
      };
    case "reengagement_7d":
      return {
        title: "Come back to OPS — 50% off or 30% off",
        body: "Your data is still here. Tap to subscribe with a discount.",
      };
    case "reengagement_30d":
      return {
        title: "Last check-in — 50% off or 30% off",
        body: "Tap to subscribe with a discount before we stop reaching out.",
      };
  }
}

async function fetchAdminUsers(
  supabase: SupabaseClient,
  adminIds: string[]
): Promise<AdminUserRow[]> {
  if (adminIds.length === 0) return [];

  const { data, error } = await supabase
    .from("users")
    .select("id, email, first_name, last_name, deleted_at")
    .in("id", adminIds);

  if (error) {
    throw new CronDatabaseOperationError(
      "trial expiry admin-user read failed",
      { cause: error }
    );
  }

  return (data ?? []) as AdminUserRow[];
}

/**
 * Run the push leg for one claimed trial-expiry notification and report what
 * happened. Never throws on a provider failure — the outcome is the contract,
 * so the caller can record it durably (bug 60480c86: a OneSignal
 * `invalid_aliases` response used to be logged and forgotten, which silently
 * suppressed the push forever because the claim row was already committed).
 */
async function deliverTrialExpiryPushLeg(params: {
  supabase: SupabaseClient;
  claimId: string;
  companyId: string;
  recipientUserIds: string[];
  type: TrialNotificationType;
  daysRemaining: number;
  daysSinceExpiry: number;
  promoCode50: string;
}): Promise<PushLegOutcome> {
  const pushTargets = await filterPushRecipientsByQuietHours({
    companyId: params.companyId,
    recipientUserIds: params.recipientUserIds,
    db: params.supabase,
  });
  // Quiet hours suppress the push leg only, by design — the email and the
  // in-app row already carried this message. Terminal: there is nothing to
  // retry, the notification was deliberately forgone on this channel.
  if (pushTargets.length === 0) return { status: "skipped_quiet_hours" };

  const pushCopy = buildPushCopy(
    params.type,
    params.daysRemaining,
    params.daysSinceExpiry
  );
  const pushResult = await sendOneSignalPush({
    recipientUserIds: pushTargets,
    title: pushCopy.title,
    body: pushCopy.body,
    data: {
      type: "trial_expiry",
      screen: "subscription",
      promo_code: params.promoCode50,
    },
    // Stable across retries of this one logical push: a timed-out send that
    // actually delivered is suppressed by OneSignal; a total invalid_aliases
    // failure created nothing, so the same key retries cleanly.
    idempotencyKey: params.claimId,
  });

  if (pushResult.ok) {
    if (pushResult.invalidAliases?.length) {
      console.warn(
        `[trial-expiry] push delivered with invalid aliases for company ${params.companyId}:`,
        pushResult.invalidAliases
      );
    }
    return { status: "sent" };
  }

  // invalid_aliases (nothing created), timeouts, 5xx, and missing config are
  // all retry-eligible here. Unlike the event-notification workers (whose
  // status-based classifier rightly terminals a semantic alias failure —
  // a stale event push is worthless), this is a daily lifecycle warning:
  // tomorrow's delivery still matters, and aliases become valid the moment
  // the owner's device registers its external_id.
  const detail = pushResult.invalidAliases?.length
    ? `invalid_aliases: ${pushResult.invalidAliases.join(",")}`
    : describePushFailure(pushResult.error);
  return { status: "retry_eligible", error: detail };
}

/** Render any provider failure as a bounded, storable string. Never throws. */
function describePushFailure(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  if (typeof error === "string") return error.slice(0, 500);
  try {
    return (JSON.stringify(error) ?? String(error)).slice(0, 500);
  } catch {
    return String(error).slice(0, 500);
  }
}

/**
 * Write the push leg's outcome onto the claim row. The claim itself is never
 * released — the email and in-app legs already ran under it.
 *
 * `currentAttempts` is always known by the caller (0 on a row this run just
 * inserted, or the value read back on the retry path), so no read-modify-write
 * round trip is needed.
 */
async function recordPushLegOutcome(params: {
  supabase: SupabaseClient;
  claimId: string;
  outcome: PushLegOutcome | { status: "not_applicable"; error?: string };
  currentAttempts: number;
  attemptsDelta: 0 | 1;
}): Promise<void> {
  const attempts = params.currentAttempts + params.attemptsDelta;
  const status: PushLegStatus =
    params.outcome.status === "retry_eligible" &&
    attempts >= TRIAL_EXPIRY_PUSH_MAX_ATTEMPTS
      ? "failed"
      : params.outcome.status;
  const { error } = await params.supabase
    .from("trial_expiry_notifications")
    .update({
      push_status: status,
      push_attempts: attempts,
      push_last_error: params.outcome.error ?? null,
      // Only stamped when an attempt actually happened, so a later quiet-hours
      // skip cannot erase the timestamp of a real prior attempt.
      ...(params.attemptsDelta
        ? { push_last_attempt_at: new Date().toISOString() }
        : {}),
    })
    .eq("id", params.claimId);
  if (error) {
    throw new CronDatabaseOperationError(
      "trial expiry push state write failed",
      { cause: error }
    );
  }
}

/**
 * The claim already exists: this company's bundle was sent on an earlier run.
 * The only leg allowed to run again is a push that failed with a
 * retry-eligible outcome and still has budget left.
 */
async function retryClaimedPushLeg(params: {
  supabase: SupabaseClient;
  companyId: string;
  type: TrialNotificationType;
  recipientUserIds: string[];
  daysRemaining: number;
  daysSinceExpiry: number;
  promoCode50: string;
  result: ProcessResult;
}): Promise<void> {
  const { data: existing, error: readError } = await params.supabase
    .from("trial_expiry_notifications")
    .select("id, push_status, push_attempts")
    .eq("company_id", params.companyId)
    .eq("notification_type", params.type)
    .single();
  if (readError) {
    throw new CronDatabaseOperationError("trial expiry claim readback failed", {
      cause: readError,
    });
  }
  const currentAttempts = Number(existing?.push_attempts ?? 0);
  if (
    !existing?.id ||
    existing.push_status !== "retry_eligible" ||
    currentAttempts >= TRIAL_EXPIRY_PUSH_MAX_ATTEMPTS
  ) {
    return;
  }

  const claimId = String(existing.id);
  const outcome = await deliverTrialExpiryPushLeg({
    supabase: params.supabase,
    claimId,
    companyId: params.companyId,
    recipientUserIds: params.recipientUserIds,
    type: params.type,
    daysRemaining: params.daysRemaining,
    daysSinceExpiry: params.daysSinceExpiry,
    promoCode50: params.promoCode50,
  });
  await recordPushLegOutcome({
    supabase: params.supabase,
    claimId,
    outcome,
    currentAttempts,
    attemptsDelta: outcome.status === "skipped_quiet_hours" ? 0 : 1,
  });

  if (outcome.status === "retry_eligible") {
    params.result.errors.push({
      companyId: params.companyId,
      error: `push retry failed: ${outcome.error}`,
    });
  } else if (outcome.status === "sent") {
    params.result.pushRetries.push({ companyId: params.companyId });
  }
}

// ─── Main service ────────────────────────────────────────────────────────────

export const TrialExpiryService = {
  /**
   * Process trial expiry notifications for every trialing company.
   * Idempotent — safe to rerun the same day.
   */
  async processAll(
    supabase: SupabaseClient,
    now = new Date(),
    options: {
      afterCompanyId?: string | null;
      limit?: number;
    } = {}
  ): Promise<ProcessResult> {
    const limit = Math.max(1, Math.min(options.limit ?? 10, 10));
    const result: ProcessResult = {
      scanned: 0,
      sent: [],
      skipped: [],
      errors: [],
      pushRetries: [],
      nextCompanyCursor: null,
    };

    let query = supabase
      .from("companies")
      .select(
        "id, name, trial_end_date, latitude, longitude, default_project_color, logo_url, admin_ids"
      )
      .eq("subscription_status", "trial")
      .not("trial_end_date", "is", null)
      .is("deleted_at", null)
      .order("id", { ascending: true });
    if (options.afterCompanyId) {
      query = query.gt("id", options.afterCompanyId);
    }
    let { data: companies, error } = await query.limit(limit);

    if (!error && (companies?.length ?? 0) === 0 && options.afterCompanyId) {
      const wrapped = await supabase
        .from("companies")
        .select(
          "id, name, trial_end_date, latitude, longitude, default_project_color, logo_url, admin_ids"
        )
        .eq("subscription_status", "trial")
        .not("trial_end_date", "is", null)
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .limit(limit);
      companies = wrapped.data;
      error = wrapped.error;
    }

    if (error) {
      throw new CronDatabaseOperationError(
        "trial expiry company page read failed",
        { cause: error }
      );
    }

    const rows = (companies ?? []) as TrialCompanyRow[];
    result.scanned = rows.length;
    result.nextCompanyCursor =
      rows.length === limit ? rows[rows.length - 1].id : null;

    for (const company of rows) {
      try {
        await this.processCompany(supabase, company, now, result);
      } catch (err) {
        if (
          err instanceof CronDatabaseOperationError ||
          isDatabasePressureError(err)
        ) {
          throw err;
        }
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[trial-expiry] Unhandled error for company ${company.id}:`,
          message
        );
        result.errors.push({ companyId: company.id, error: message });
      }
    }

    return result;
  },

  /**
   * Process a single company. Decides whether a notification should fire,
   * sends it, and records the dedup row. Throws on hard failures; records
   * soft failures (e.g. no admins) in `result.skipped`.
   */
  async processCompany(
    supabase: SupabaseClient,
    company: TrialCompanyRow,
    now: Date,
    result: ProcessResult
  ): Promise<void> {
    const trialEnd = new Date(company.trial_end_date);
    if (Number.isNaN(trialEnd.getTime())) {
      result.skipped.push({
        companyId: company.id,
        reason: "invalid trial_end_date",
      });
      return;
    }

    const type = determineNotificationType(trialEnd, now);
    if (!type) {
      return; // outside any notification window — normal case
    }

    const adminIds = company.admin_ids ?? [];
    if (adminIds.length === 0) {
      result.skipped.push({
        companyId: company.id,
        reason: "no admin_ids",
      });
      return;
    }

    const admins = await fetchAdminUsers(supabase, adminIds);
    const activeAdmins = admins.filter(
      (u) => !u.deleted_at && typeof u.email === "string" && u.email.length > 0
    );

    if (activeAdmins.length === 0) {
      result.skipped.push({
        companyId: company.id,
        reason: "no active admin emails",
      });
      return;
    }

    const timezone = detectCompanyTimezone(company.latitude, company.longitude);
    const trialEndDisplay = formatTrialEndDisplay(trialEnd, timezone);
    const subscribeUrl = getSubscribeUrl();
    const accentColor = company.default_project_color ?? "#6F94B0";
    const logoUrl = company.logo_url;

    const remaining = daysRemainingUntil(trialEnd, now);
    const sinceExpiry = daysSince(trialEnd, now);

    const promoCodes = getPromoCodes(type);

    // Claim the unique notification BEFORE any provider send. A concurrent or
    // retried cron sees 23505 and exits without sending again. If provider
    // acceptance is followed by a database outage, this durable row still
    // prevents an ambiguous resend.
    const { data: claimRow, error: claimError } = await supabase
      .from("trial_expiry_notifications")
      .insert({
        company_id: company.id,
        notification_type: type,
        promo_code_50: promoCodes?.code50 ?? null,
        promo_code_30: promoCodes?.code30 ?? null,
      })
      .select("id")
      .single();
    if (claimError) {
      if (claimError.code === "23505") {
        // The bundle already went out on an earlier run. Emails and in-app
        // rows are never re-sent; only a push that failed with a retryable
        // outcome is given another attempt (bug 60480c86).
        if (!shouldSendPush(type)) return;
        await retryClaimedPushLeg({
          supabase,
          companyId: company.id,
          type,
          recipientUserIds: activeAdmins.map((u) => u.id),
          daysRemaining: remaining,
          daysSinceExpiry: sinceExpiry,
          promoCode50: promoCodes?.code50 ?? "",
          result,
        });
        return;
      }
      throw new CronDatabaseOperationError(
        "trial expiry notification claim failed",
        { cause: claimError }
      );
    }
    if (!claimRow?.id) {
      throw new CronDatabaseOperationError(
        "trial expiry notification claim returned no row id",
        { cause: claimRow ?? null }
      );
    }
    const claimId = String(claimRow.id);

    // ─── Send email(s) ─────────────────────────────────────────────────────
    await this.sendEmails({
      type,
      admins: activeAdmins,
      companyName: company.name,
      daysRemaining: remaining,
      daysSinceExpiry: sinceExpiry,
      trialEndDisplay,
      subscribeUrl,
      accentColor,
      logoUrl,
      promoCodes,
    });

    // ─── Send push (only for discount_3d per spec) ─────────────────────────
    // The push leg records its own outcome on the claim row. Quiet hours still
    // suppress push only (bug 42aa787c) — the email above and the in-app rows
    // below are unaffected.
    if (shouldSendPush(type)) {
      const outcome = await deliverTrialExpiryPushLeg({
        supabase,
        claimId,
        companyId: company.id,
        recipientUserIds: activeAdmins.map((u) => u.id),
        type,
        daysRemaining: remaining,
        daysSinceExpiry: sinceExpiry,
        promoCode50: promoCodes?.code50 ?? "",
      });
      await recordPushLegOutcome({
        supabase,
        claimId,
        outcome,
        currentAttempts: 0,
        attemptsDelta: outcome.status === "skipped_quiet_hours" ? 0 : 1,
      });
      if (outcome.status === "retry_eligible") {
        console.error(
          `[trial-expiry] Push failed for company ${company.id}:`,
          outcome.error
        );
        // The company still counts as sent (email + in-app landed), but the
        // push failure is no longer invisible to the route.
        result.errors.push({
          companyId: company.id,
          error: `push failed (will retry): ${outcome.error}`,
        });
      }
    } else {
      await recordPushLegOutcome({
        supabase,
        claimId,
        outcome: { status: "not_applicable" },
        currentAttempts: 0,
        attemptsDelta: 0,
      });
    }

    // ─── Create in-app notifications for discount types ────────────────────
    if (isDiscountType(type) && promoCodes) {
      await this.createInAppNotifications({
        supabase,
        adminIds: activeAdmins.map((u) => u.id),
        companyId: company.id,
        type,
        daysRemaining: remaining,
        promoCode50: promoCodes.code50,
      });
    }

    result.sent.push({ companyId: company.id, type });
  },

  async sendEmails(params: {
    type: TrialNotificationType;
    admins: AdminUserRow[];
    companyName: string;
    daysRemaining: number;
    daysSinceExpiry: number;
    trialEndDisplay: string;
    subscribeUrl: string;
    accentColor: string;
    logoUrl: string | null;
    promoCodes: PromoCodePair | null;
  }): Promise<void> {
    for (const admin of params.admins) {
      if (!admin.email) continue;

      try {
        if (
          params.type === "warning_7d" ||
          params.type === "warning_5d" ||
          params.type === "warning_1d"
        ) {
          await sendTrialExpiryWarning({
            email: admin.email,
            companyName: params.companyName,
            daysRemaining: params.daysRemaining,
            trialEndDisplay: params.trialEndDisplay,
            subscribeUrl: params.subscribeUrl,
            accentColor: params.accentColor,
            logoUrl: params.logoUrl,
          });
        } else if (params.type === "discount_3d") {
          if (!params.promoCodes) {
            throw new Error("Missing promo codes for discount_3d");
          }
          await sendTrialExpiryDiscount({
            email: admin.email,
            companyName: params.companyName,
            daysRemaining: params.daysRemaining,
            trialEndDisplay: params.trialEndDisplay,
            promoCode50: params.promoCodes.code50,
            promoCode30: params.promoCodes.code30,
            subscribeUrl: params.subscribeUrl,
            accentColor: params.accentColor,
            logoUrl: params.logoUrl,
          });
        } else {
          if (!params.promoCodes) {
            throw new Error(`Missing promo codes for ${params.type}`);
          }
          await sendTrialExpiryReengagement({
            email: admin.email,
            companyName: params.companyName,
            daysSinceExpiry: params.daysSinceExpiry,
            promoCode50: params.promoCodes.code50,
            promoCode30: params.promoCodes.code30,
            subscribeUrl: params.subscribeUrl,
            accentColor: params.accentColor,
            logoUrl: params.logoUrl,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[trial-expiry] Email send failed for ${admin.email}:`,
          message
        );
        // Keep going for other admins — one bad send shouldn't block the rest.
      }
    }
  },

  async createInAppNotifications(params: {
    supabase: SupabaseClient;
    adminIds: string[];
    companyId: string;
    type: TrialNotificationType;
    daysRemaining: number;
    promoCode50: string;
  }): Promise<void> {
    const copy = buildInAppCopy(params.type, params.daysRemaining);
    const rows = params.adminIds.map((userId) => ({
      user_id: userId,
      company_id: params.companyId,
      type: "trial_expiry",
      title: copy.title,
      body: copy.body,
      is_read: false,
      persistent: false,
      deep_link_type: "trial_expiry",
      batch_id: params.promoCode50,
      action_url: "/settings?tab=subscription",
      action_label: "Subscribe",
    }));

    const { error } = await params.supabase.from("notifications").insert(rows);
    if (error) {
      throw new CronDatabaseOperationError(
        "trial expiry in-app notification insert failed",
        { cause: error }
      );
    }
  },
};

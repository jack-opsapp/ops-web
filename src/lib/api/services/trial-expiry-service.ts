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
import {
  detectCompanyTimezone,
  formatTrialEndDisplay,
} from "@/lib/utils/company-timezone";

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
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co";
  return `${base}/settings?tab=subscription`;
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
    console.error("[trial-expiry] Failed to fetch admin users:", error.message);
    return [];
  }

  return (data ?? []) as AdminUserRow[];
}

// ─── Main service ────────────────────────────────────────────────────────────

export const TrialExpiryService = {
  /**
   * Process trial expiry notifications for every trialing company.
   * Idempotent — safe to rerun the same day.
   */
  async processAll(supabase: SupabaseClient, now = new Date()): Promise<ProcessResult> {
    const result: ProcessResult = {
      scanned: 0,
      sent: [],
      skipped: [],
      errors: [],
    };

    const { data: companies, error } = await supabase
      .from("companies")
      .select(
        "id, name, trial_end_date, latitude, longitude, default_project_color, logo_url, admin_ids"
      )
      .eq("subscription_status", "trial")
      .not("trial_end_date", "is", null)
      .is("deleted_at", null);

    if (error) {
      throw new Error(
        `Failed to load trial companies: ${error.message}`
      );
    }

    const rows = (companies ?? []) as TrialCompanyRow[];
    result.scanned = rows.length;

    for (const company of rows) {
      try {
        await this.processCompany(supabase, company, now, result);
      } catch (err) {
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

    // Dedup check — have we already sent this type for this company?
    const { data: existing, error: existingError } = await supabase
      .from("trial_expiry_notifications")
      .select("id")
      .eq("company_id", company.id)
      .eq("notification_type", type)
      .maybeSingle();

    if (existingError) {
      throw new Error(
        `Failed to check dedup table: ${existingError.message}`
      );
    }

    if (existing) {
      return; // already sent — skip silently
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
    const accentColor = company.default_project_color ?? "#597794";
    const logoUrl = company.logo_url;

    const remaining = daysRemainingUntil(trialEnd, now);
    const sinceExpiry = daysSince(trialEnd, now);

    const promoCodes = getPromoCodes(type);

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
    if (shouldSendPush(type)) {
      const pushCopy = buildPushCopy(type, remaining, sinceExpiry);
      const pushResult = await sendOneSignalPush({
        recipientUserIds: activeAdmins.map((u) => u.id),
        title: pushCopy.title,
        body: pushCopy.body,
        data: {
          type: "trial_expiry",
          screen: "subscription",
          promo_code: promoCodes?.code50 ?? "",
        },
      });
      if (!pushResult.ok) {
        console.error(
          `[trial-expiry] Push failed for company ${company.id}:`,
          pushResult.error
        );
      }
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
        subscribeUrl,
      });
    }

    // ─── Record the dedup row ──────────────────────────────────────────────
    const { error: insertError } = await supabase
      .from("trial_expiry_notifications")
      .insert({
        company_id: company.id,
        notification_type: type,
        promo_code_50: promoCodes?.code50 ?? null,
        promo_code_30: promoCodes?.code30 ?? null,
      });

    if (insertError) {
      // 23505 = unique_violation (another cron run beat us). Not an error.
      if (insertError.code !== "23505") {
        throw new Error(
          `Failed to record dedup row: ${insertError.message}`
        );
      }
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
    subscribeUrl: string;
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
      action_url: params.subscribeUrl,
      action_label: "Subscribe",
    }));

    const { error } = await params.supabase.from("notifications").insert(rows);
    if (error) {
      console.error(
        `[trial-expiry] In-app notification insert failed for company ${params.companyId}:`,
        error.message
      );
    }
  },
};

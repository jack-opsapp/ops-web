import type { SupabaseClient } from "@supabase/supabase-js";

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
};

/**
 * OPS Web - Notification Preferences Service
 *
 * Per-user notification preferences using Supabase.
 * Uses upsert-read pattern: getPreferences creates defaults if row doesn't exist.
 */

import { requireSupabase, parseDateRequired } from "@/lib/supabase/helpers";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NotificationPreferences {
  id: string;
  userId: string;
  companyId: string;
  pushEnabled: boolean;
  emailEnabled: boolean;
  taskAssigned: boolean;
  taskCompleted: boolean;
  scheduleChanges: boolean;
  projectUpdates: boolean;
  expenseSubmitted: boolean;
  expenseApproved: boolean;
  invoiceSent: boolean;
  paymentReceived: boolean;
  teamMentions: boolean;
  dailyDigest: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateNotificationPreferences {
  pushEnabled?: boolean;
  emailEnabled?: boolean;
  taskAssigned?: boolean;
  taskCompleted?: boolean;
  scheduleChanges?: boolean;
  projectUpdates?: boolean;
  expenseSubmitted?: boolean;
  expenseApproved?: boolean;
  invoiceSent?: boolean;
  paymentReceived?: boolean;
  teamMentions?: boolean;
  dailyDigest?: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
}

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): NotificationPreferences {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    companyId: row.company_id as string,
    pushEnabled: (row.push_enabled as boolean) ?? true,
    emailEnabled: (row.email_enabled as boolean) ?? true,
    taskAssigned: (row.task_assigned as boolean) ?? true,
    taskCompleted: (row.task_completed as boolean) ?? true,
    scheduleChanges: (row.schedule_changes as boolean) ?? true,
    projectUpdates: (row.project_updates as boolean) ?? true,
    expenseSubmitted: (row.expense_submitted as boolean) ?? true,
    expenseApproved: (row.expense_approved as boolean) ?? true,
    invoiceSent: (row.invoice_sent as boolean) ?? true,
    paymentReceived: (row.payment_received as boolean) ?? true,
    teamMentions: (row.team_mentions as boolean) ?? true,
    dailyDigest: (row.daily_digest as boolean) ?? false,
    quietHoursStart: (row.quiet_hours_start as string) ?? null,
    quietHoursEnd: (row.quiet_hours_end as string) ?? null,
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDateRequired(row.updated_at),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const NotificationPreferencesService = {
  /**
   * Get notification preferences for a user+company. Creates defaults if missing.
   */
  async getPreferences(userId: string, companyId: string): Promise<NotificationPreferences> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("notification_preferences")
      .upsert(
        { user_id: userId, company_id: companyId },
        { onConflict: "user_id,company_id", ignoreDuplicates: true }
      )
      .select()
      .single();

    if (error) {
      const { data: fetched, error: fetchError } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .single();

      if (fetchError) throw new Error(`Failed to get notification preferences: ${fetchError.message}`);
      return mapFromDb(fetched);
    }

    return mapFromDb(data);
  },

  async updatePreferences(
    userId: string,
    companyId: string,
    updates: UpdateNotificationPreferences
  ): Promise<NotificationPreferences> {
    const supabase = requireSupabase();

    const row: Record<string, unknown> = {};
    if (updates.pushEnabled !== undefined) row.push_enabled = updates.pushEnabled;
    if (updates.emailEnabled !== undefined) row.email_enabled = updates.emailEnabled;
    if (updates.taskAssigned !== undefined) row.task_assigned = updates.taskAssigned;
    if (updates.taskCompleted !== undefined) row.task_completed = updates.taskCompleted;
    if (updates.scheduleChanges !== undefined) row.schedule_changes = updates.scheduleChanges;
    if (updates.projectUpdates !== undefined) row.project_updates = updates.projectUpdates;
    if (updates.expenseSubmitted !== undefined) row.expense_submitted = updates.expenseSubmitted;
    if (updates.expenseApproved !== undefined) row.expense_approved = updates.expenseApproved;
    if (updates.invoiceSent !== undefined) row.invoice_sent = updates.invoiceSent;
    if (updates.paymentReceived !== undefined) row.payment_received = updates.paymentReceived;
    if (updates.teamMentions !== undefined) row.team_mentions = updates.teamMentions;
    if (updates.dailyDigest !== undefined) row.daily_digest = updates.dailyDigest;
    if (updates.quietHoursStart !== undefined) row.quiet_hours_start = updates.quietHoursStart;
    if (updates.quietHoursEnd !== undefined) row.quiet_hours_end = updates.quietHoursEnd;

    const { data, error } = await supabase
      .from("notification_preferences")
      .update(row)
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update notification preferences: ${error.message}`);
    return mapFromDb(data);
  },
};

/**
 * OPS Web - Notification Preferences Service
 *
 * Per-user notification preferences using Supabase.
 * Uses upsert-read pattern: getPreferences creates defaults if row doesn't exist.
 *
 * Channel preferences are stored as JSONB: each event type has { push, email } booleans.
 * Global kill switches (pushEnabled, emailEnabled) override per-channel settings.
 */

import { requireSupabase, parseDateRequired } from "@/lib/supabase/helpers";

// ─── Channel Preferences Types ──────────────────────────────────────────────

/** Per-channel toggles for a single event type */
export interface ChannelToggle {
  push: boolean;
  email: boolean;
}

/** All event types with their per-channel preferences */
export type EventType =
  | "task_assigned"
  | "task_completed"
  | "schedule_changes"
  | "project_updates"
  | "lead_assignments"
  | "expense_submitted"
  | "expense_approved"
  | "invoice_sent"
  | "payment_received"
  | "team_mentions"
  | "daily_digest";

export type ChannelPreferences = Record<EventType, ChannelToggle>;

/** Default channel preferences for new users */
export const DEFAULT_CHANNEL_PREFERENCES: ChannelPreferences = {
  task_assigned: { push: true, email: false },
  task_completed: { push: true, email: false },
  schedule_changes: { push: true, email: false },
  project_updates: { push: true, email: true },
  lead_assignments: { push: true, email: false },
  expense_submitted: { push: true, email: true },
  expense_approved: { push: true, email: true },
  invoice_sent: { push: true, email: false },
  payment_received: { push: true, email: true },
  team_mentions: { push: true, email: false },
  daily_digest: { push: false, email: false },
};

// ─── Preferences Types ──────────────────────────────────────────────────────

export interface NotificationPreferences {
  id: string;
  userId: string;
  companyId: string;
  /** Global kill switch for push notifications */
  pushEnabled: boolean;
  /** Global kill switch for email notifications */
  emailEnabled: boolean;
  /** Per-event, per-channel preferences */
  channelPreferences: ChannelPreferences;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  createdAt: Date;
  updatedAt: Date;

  // Legacy boolean fields — kept for backward compatibility reads
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
}

export interface UpdateNotificationPreferences {
  pushEnabled?: boolean;
  emailEnabled?: boolean;
  channelPreferences?: Partial<ChannelPreferences>;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;

  // Legacy fields — still accepted for backward compatibility
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
}

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function parseChannelPreferences(raw: unknown): ChannelPreferences {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const result = { ...DEFAULT_CHANNEL_PREFERENCES };
    for (const key of Object.keys(DEFAULT_CHANNEL_PREFERENCES)) {
      const eventKey = key as EventType;
      const val = obj[eventKey];
      if (val && typeof val === "object") {
        const toggle = val as Record<string, unknown>;
        result[eventKey] = {
          push:
            typeof toggle.push === "boolean"
              ? toggle.push
              : DEFAULT_CHANNEL_PREFERENCES[eventKey].push,
          email:
            typeof toggle.email === "boolean"
              ? toggle.email
              : DEFAULT_CHANNEL_PREFERENCES[eventKey].email,
        };
      }
    }
    return result;
  }
  return { ...DEFAULT_CHANNEL_PREFERENCES };
}

function mapFromDb(row: Record<string, unknown>): NotificationPreferences {
  const channelPrefs = parseChannelPreferences(row.channel_preferences);

  return {
    id: row.id as string,
    userId: row.user_id as string,
    companyId: row.company_id as string,
    pushEnabled: (row.push_enabled as boolean) ?? true,
    emailEnabled: (row.email_enabled as boolean) ?? true,
    channelPreferences: channelPrefs,
    quietHoursStart: (row.quiet_hours_start as string) ?? null,
    quietHoursEnd: (row.quiet_hours_end as string) ?? null,
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDateRequired(row.updated_at),

    // Legacy fields — derive from channelPreferences for backward compat
    taskAssigned:
      channelPrefs.task_assigned.push || channelPrefs.task_assigned.email,
    taskCompleted:
      channelPrefs.task_completed.push || channelPrefs.task_completed.email,
    scheduleChanges:
      channelPrefs.schedule_changes.push || channelPrefs.schedule_changes.email,
    projectUpdates:
      channelPrefs.project_updates.push || channelPrefs.project_updates.email,
    expenseSubmitted:
      channelPrefs.expense_submitted.push ||
      channelPrefs.expense_submitted.email,
    expenseApproved:
      channelPrefs.expense_approved.push || channelPrefs.expense_approved.email,
    invoiceSent:
      channelPrefs.invoice_sent.push || channelPrefs.invoice_sent.email,
    paymentReceived:
      channelPrefs.payment_received.push || channelPrefs.payment_received.email,
    teamMentions:
      channelPrefs.team_mentions.push || channelPrefs.team_mentions.email,
    dailyDigest:
      channelPrefs.daily_digest.push || channelPrefs.daily_digest.email,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const NotificationPreferencesService = {
  /**
   * Get notification preferences for a user+company. Creates defaults if missing.
   */
  async getPreferences(
    userId: string,
    companyId: string
  ): Promise<NotificationPreferences> {
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

      if (fetchError)
        throw new Error(
          `Failed to get notification preferences: ${fetchError.message}`
        );
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

    // Global kill switches
    if (updates.pushEnabled !== undefined)
      row.push_enabled = updates.pushEnabled;
    if (updates.emailEnabled !== undefined)
      row.email_enabled = updates.emailEnabled;

    // Quiet hours
    if (updates.quietHoursStart !== undefined)
      row.quiet_hours_start = updates.quietHoursStart;
    if (updates.quietHoursEnd !== undefined)
      row.quiet_hours_end = updates.quietHoursEnd;

    // Per-channel preferences — merge partial update into existing JSONB
    if (updates.channelPreferences) {
      // Fetch current to merge
      const { data: current } = await supabase
        .from("notification_preferences")
        .select("channel_preferences")
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .single();

      const existing = parseChannelPreferences(current?.channel_preferences);
      const merged = { ...existing };

      for (const [eventType, toggle] of Object.entries(
        updates.channelPreferences
      )) {
        const key = eventType as EventType;
        if (toggle) {
          merged[key] = {
            push: toggle.push !== undefined ? toggle.push : merged[key].push,
            email:
              toggle.email !== undefined ? toggle.email : merged[key].email,
          };
        }
      }

      row.channel_preferences = merged;

      // Also sync legacy boolean columns for backward compat
      for (const [eventType, toggle] of Object.entries(merged)) {
        const legacyKey = eventType; // column names match event type keys
        row[legacyKey] = toggle.push || toggle.email;
      }
    }

    // Legacy field updates (for any code still using the old API)
    const legacyKeys: Array<{
      ts: keyof UpdateNotificationPreferences;
      db: string;
    }> = [
      { ts: "taskAssigned", db: "task_assigned" },
      { ts: "taskCompleted", db: "task_completed" },
      { ts: "scheduleChanges", db: "schedule_changes" },
      { ts: "projectUpdates", db: "project_updates" },
      { ts: "expenseSubmitted", db: "expense_submitted" },
      { ts: "expenseApproved", db: "expense_approved" },
      { ts: "invoiceSent", db: "invoice_sent" },
      { ts: "paymentReceived", db: "payment_received" },
      { ts: "teamMentions", db: "team_mentions" },
      { ts: "dailyDigest", db: "daily_digest" },
    ];
    for (const { ts, db } of legacyKeys) {
      if (updates[ts] !== undefined && !updates.channelPreferences) {
        row[db] = updates[ts];
      }
    }

    const { data, error } = await supabase
      .from("notification_preferences")
      .update(row)
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .select()
      .single();

    if (error)
      throw new Error(
        `Failed to update notification preferences: ${error.message}`
      );
    return mapFromDb(data);
  },
};

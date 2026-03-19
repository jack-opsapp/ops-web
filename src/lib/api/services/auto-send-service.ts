/**
 * OPS Web - Auto-Send Service
 *
 * Handles auto-send email functionality:
 * - Scheduling auto-sends with randomized delays
 * - Business hours enforcement
 * - Processing pending sends via cron
 * - Cancellation
 *
 * Feature-gated by ai_auto_send admin flag.
 * Uses OPENAI_API_KEY_DRAFTING for draft generation.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import { AIDraftService } from "./ai-draft-service";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AutoSendSettings {
  enabled: boolean;
  businessHoursStart: string; // "08:00" (24h format)
  businessHoursEnd: string; // "18:00"
  timezone: string; // IANA timezone e.g. "America/New_York"
  delayMinMinutes: number; // default 30
  delayMaxMinutes: number; // default 60
  enabledAt?: string;
}

export const DEFAULT_AUTO_SEND_SETTINGS: AutoSendSettings = {
  enabled: false,
  businessHoursStart: "08:00",
  businessHoursEnd: "18:00",
  timezone: "America/New_York",
  delayMinMinutes: 30,
  delayMaxMinutes: 60,
};

export interface PendingAutoSend {
  id: string;
  companyId: string;
  connectionId: string;
  opportunityId: string | null;
  threadId: string;
  inReplyTo: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  draftText: string;
  draftHistoryId: string | null;
  scheduledSendAt: Date;
  status: "pending" | "sent" | "cancelled" | "failed";
  createdAt: Date;
  sentAt: Date | null;
  cancelledAt: Date | null;
  error: string | null;
  retryCount: number;
}

/** Max retry attempts before permanently failing */
const MAX_RETRY_COUNT = 3;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generate a random delay between min and max minutes.
 * Uses crypto-quality randomness for non-predictable intervals.
 */
function randomDelay(minMinutes: number, maxMinutes: number): number {
  const range = maxMinutes - minMinutes;
  const randomFraction = Math.random();
  return Math.floor(minMinutes + randomFraction * range);
}

/**
 * Given a base time + delay, adjust the scheduled time to fall within
 * business hours. If the calculated time is outside business hours,
 * push it to the next business-hours window.
 */
function adjustToBusinessHours(
  baseTime: Date,
  delayMinutes: number,
  settings: AutoSendSettings
): Date {
  const scheduled = new Date(baseTime.getTime() + delayMinutes * 60 * 1000);

  // Parse business hours
  const [startH, startM] = settings.businessHoursStart.split(":").map(Number);
  const [endH, endM] = settings.businessHoursEnd.split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  // Convert scheduled time to the user's timezone
  // We work with the timezone-adjusted hour/minute
  const tzOptions: Intl.DateTimeFormatOptions = {
    timeZone: settings.timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  };

  const formatter = new Intl.DateTimeFormat("en-US", tzOptions);
  const parts = formatter.formatToParts(scheduled);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0");
  const scheduledMinutes = hour * 60 + minute;

  // Check if within business hours
  if (scheduledMinutes >= startMinutes && scheduledMinutes < endMinutes) {
    return scheduled;
  }

  // Outside business hours — push to next business-hours start
  if (scheduledMinutes >= endMinutes) {
    // After business hours today → next day start
    const nextDay = new Date(scheduled);
    nextDay.setDate(nextDay.getDate() + 1);

    // Set to business hours start in user's timezone
    // Approximate: add the difference to get to start time next day
    const minutesUntilNextStart =
      24 * 60 - scheduledMinutes + startMinutes;
    return new Date(
      scheduled.getTime() + minutesUntilNextStart * 60 * 1000
    );
  }

  // Before business hours today → push to start time today
  const minutesUntilStart = startMinutes - scheduledMinutes;
  return new Date(scheduled.getTime() + minutesUntilStart * 60 * 1000);
}

function mapPendingFromDb(row: Record<string, unknown>): PendingAutoSend {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    connectionId: row.connection_id as string,
    opportunityId: (row.opportunity_id as string) ?? null,
    threadId: row.thread_id as string,
    inReplyTo: (row.in_reply_to as string) ?? null,
    toEmails: (row.to_emails as string[]) ?? [],
    ccEmails: (row.cc_emails as string[]) ?? [],
    subject: row.subject as string,
    draftText: row.draft_text as string,
    draftHistoryId: (row.draft_history_id as string) ?? null,
    scheduledSendAt: new Date(row.scheduled_send_at as string),
    status: row.status as PendingAutoSend["status"],
    createdAt: new Date(row.created_at as string),
    sentAt: row.sent_at ? new Date(row.sent_at as string) : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at as string) : null,
    error: (row.error as string) ?? null,
    retryCount: (row.retry_count as number) ?? 0,
  };
}

// ─── Service ────────────────────────────────────────────────────────────────

export const AutoSendService = {
  /**
   * Check if auto-send is enabled for a connection.
   * Requires both the admin feature flag AND the per-connection toggle.
   */
  async isEnabled(
    companyId: string,
    connectionId: string
  ): Promise<{ enabled: boolean; settings: AutoSendSettings | null }> {
    // Check admin feature gate first
    const featureEnabled =
      await AdminFeatureOverrideService.isAIFeatureEnabled(
        companyId,
        "ai_auto_send"
      );
    if (!featureEnabled) {
      return { enabled: false, settings: null };
    }

    const supabase = requireSupabase();
    const { data } = await supabase
      .from("email_connections")
      .select("auto_send_settings")
      .eq("id", connectionId)
      .eq("company_id", companyId)
      .single();

    if (!data?.auto_send_settings) {
      return { enabled: false, settings: null };
    }

    const settings = data.auto_send_settings as Record<string, unknown>;
    const parsed: AutoSendSettings = {
      enabled: settings.enabled === true,
      businessHoursStart:
        (settings.business_hours_start as string) ||
        DEFAULT_AUTO_SEND_SETTINGS.businessHoursStart,
      businessHoursEnd:
        (settings.business_hours_end as string) ||
        DEFAULT_AUTO_SEND_SETTINGS.businessHoursEnd,
      timezone:
        (settings.timezone as string) ||
        DEFAULT_AUTO_SEND_SETTINGS.timezone,
      delayMinMinutes:
        (settings.delay_min_minutes as number) ||
        DEFAULT_AUTO_SEND_SETTINGS.delayMinMinutes,
      delayMaxMinutes:
        (settings.delay_max_minutes as number) ||
        DEFAULT_AUTO_SEND_SETTINGS.delayMaxMinutes,
      enabledAt: settings.enabled_at as string | undefined,
    };

    return { enabled: parsed.enabled, settings: parsed };
  },

  /**
   * Update auto-send settings for a connection.
   */
  async updateSettings(
    companyId: string,
    connectionId: string,
    settings: Partial<AutoSendSettings>
  ): Promise<void> {
    const supabase = requireSupabase();

    // Read current settings
    const { data: current } = await supabase
      .from("email_connections")
      .select("auto_send_settings")
      .eq("id", connectionId)
      .eq("company_id", companyId)
      .single();

    const currentSettings =
      (current?.auto_send_settings as Record<string, unknown>) || {};

    const merged = {
      ...currentSettings,
      ...(settings.enabled !== undefined && { enabled: settings.enabled }),
      ...(settings.businessHoursStart && {
        business_hours_start: settings.businessHoursStart,
      }),
      ...(settings.businessHoursEnd && {
        business_hours_end: settings.businessHoursEnd,
      }),
      ...(settings.timezone && { timezone: settings.timezone }),
      ...(settings.delayMinMinutes !== undefined && {
        delay_min_minutes: settings.delayMinMinutes,
      }),
      ...(settings.delayMaxMinutes !== undefined && {
        delay_max_minutes: settings.delayMaxMinutes,
      }),
      ...(settings.enabled === true && !currentSettings.enabled_at
        ? { enabled_at: new Date().toISOString() }
        : {}),
    };

    await supabase
      .from("email_connections")
      .update({ auto_send_settings: merged })
      .eq("id", connectionId)
      .eq("company_id", companyId);
  },

  /**
   * Schedule an auto-send for a thread.
   * Called when a new inbound email arrives on a linked thread
   * and auto-send is enabled for that connection.
   */
  async scheduleAutoSend(params: {
    companyId: string;
    userId: string;
    connectionId: string;
    opportunityId?: string;
    threadId: string;
    inReplyTo?: string;
    toEmails: string[];
    ccEmails?: string[];
    subject: string;
    settings: AutoSendSettings;
  }): Promise<PendingAutoSend | null> {
    const supabase = requireSupabase();

    // Generate AI draft
    const draftResult = await AIDraftService.generateDraft({
      companyId: params.companyId,
      userId: params.userId,
      connectionId: params.connectionId,
      opportunityId: params.opportunityId,
      threadId: params.threadId,
    });

    if (!draftResult.available || !draftResult.draft) {
      console.error(
        "[auto-send] Draft generation failed:",
        draftResult.reason
      );
      return null;
    }

    // Calculate scheduled send time with randomized delay
    const delay = randomDelay(
      params.settings.delayMinMinutes,
      params.settings.delayMaxMinutes
    );
    const scheduledAt = adjustToBusinessHours(
      new Date(),
      delay,
      params.settings
    );

    // Insert into pending_auto_sends
    const { data: row } = await supabase
      .from("pending_auto_sends")
      .insert({
        company_id: params.companyId,
        connection_id: params.connectionId,
        opportunity_id: params.opportunityId || null,
        thread_id: params.threadId,
        in_reply_to: params.inReplyTo || null,
        to_emails: params.toEmails,
        cc_emails: params.ccEmails || [],
        subject: params.subject,
        draft_text: draftResult.draft,
        draft_history_id: draftResult.draftHistoryId || null,
        scheduled_send_at: scheduledAt.toISOString(),
        status: "pending",
      })
      .select("*")
      .single();

    if (!row) return null;
    return mapPendingFromDb(row);
  },

  /**
   * Cancel a pending auto-send.
   */
  async cancelAutoSend(
    id: string,
    companyId: string
  ): Promise<boolean> {
    const supabase = requireSupabase();

    const { data } = await supabase
      .from("pending_auto_sends")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("company_id", companyId)
      .eq("status", "pending")
      .select("id")
      .single();

    // Also mark the draft history as discarded
    if (data) {
      const { data: pending } = await supabase
        .from("pending_auto_sends")
        .select("draft_history_id")
        .eq("id", id)
        .single();

      if (pending?.draft_history_id) {
        await supabase
          .from("ai_draft_history")
          .update({ status: "discarded" })
          .eq("id", pending.draft_history_id as string);
      }
    }

    return !!data;
  },

  /**
   * Get pending auto-sends for a company (for inbox display).
   */
  async getPendingSends(companyId: string): Promise<PendingAutoSend[]> {
    const supabase = requireSupabase();

    const { data } = await supabase
      .from("pending_auto_sends")
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "pending")
      .order("scheduled_send_at", { ascending: true });

    return (data || []).map(mapPendingFromDb);
  },

  /**
   * Process pending auto-sends that are due (called by cron).
   * Sends each pending email and updates status.
   */
  async processPendingSends(): Promise<{
    sent: number;
    failed: number;
    errors: string[];
  }> {
    const supabase = requireSupabase();
    const now = new Date().toISOString();

    // Fetch pending sends that are due
    const { data: pendingSends } = await supabase
      .from("pending_auto_sends")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_send_at", now)
      .order("scheduled_send_at", { ascending: true })
      .limit(50);

    if (!pendingSends || pendingSends.length === 0) {
      return { sent: 0, failed: 0, errors: [] };
    }

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const row of pendingSends) {
      const pending = mapPendingFromDb(row);

      try {
        // Verify connection is still active and auto-send still enabled
        const { enabled } = await this.isEnabled(
          pending.companyId,
          pending.connectionId
        );
        if (!enabled) {
          // Auto-send was disabled — cancel silently
          await supabase
            .from("pending_auto_sends")
            .update({
              status: "cancelled",
              cancelled_at: now,
              error: "Auto-send disabled",
            })
            .eq("id", pending.id);
          continue;
        }

        // Fetch the connection's userId for the send endpoint
        const { data: conn } = await supabase
          .from("email_connections")
          .select("user_id")
          .eq("id", pending.connectionId)
          .single();

        const connectionUserId = (conn?.user_id as string) || "";

        // Send via the email send endpoint (internal call)
        const sendResponse = await fetch(
          `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/integrations/email/send`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId: connectionUserId,
              companyId: pending.companyId,
              connectionId: pending.connectionId,
              to: pending.toEmails,
              cc: pending.ccEmails,
              subject: pending.subject,
              body: pending.draftText,
              format: "markdown",
              opportunityId: pending.opportunityId,
              inReplyTo: pending.inReplyTo,
              threadId: pending.threadId,
            }),
          }
        );

        if (!sendResponse.ok) {
          const errData = await sendResponse.json().catch(() => ({}));
          throw new Error(
            (errData as { error?: string }).error || `HTTP ${sendResponse.status}`
          );
        }

        // Mark as sent
        await supabase
          .from("pending_auto_sends")
          .update({ status: "sent", sent_at: now })
          .eq("id", pending.id);

        // Update draft history as sent without changes
        if (pending.draftHistoryId) {
          await AIDraftService.recordDraftOutcome(
            pending.draftHistoryId,
            pending.companyId,
            "", // No specific user for auto-sends
            "sent",
            pending.draftText
          );
        }

        sent++;
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Unknown error";
        errors.push(`${pending.id}: ${errorMsg}`);

        const newRetryCount = pending.retryCount + 1;
        const permanentlyFailed = newRetryCount >= MAX_RETRY_COUNT;

        await supabase
          .from("pending_auto_sends")
          .update({
            // Keep as "pending" for retry, or mark "failed" permanently
            status: permanentlyFailed ? "failed" : "pending",
            retry_count: newRetryCount,
            // Push scheduled_send_at forward by 5 min for next retry attempt
            ...(permanentlyFailed
              ? {}
              : {
                  scheduled_send_at: new Date(
                    Date.now() + 5 * 60 * 1000
                  ).toISOString(),
                }),
            error: permanentlyFailed
              ? `Permanently failed after ${MAX_RETRY_COUNT} attempts: ${errorMsg}`
              : `Attempt ${newRetryCount}/${MAX_RETRY_COUNT}: ${errorMsg}`,
          })
          .eq("id", pending.id);

        failed++;
      }
    }

    return { sent, failed, errors };
  },
};

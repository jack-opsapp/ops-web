/**
 * POST /api/notifications/dispatch
 *
 * General-purpose multi-channel notification dispatcher.
 * Creates in-app notifications and sends push via OneSignal.
 * Checks per-user notification preferences before delivery.
 *
 * Auth: Firebase/Supabase token via cookie or Authorization header.
 * The authenticated user is automatically excluded from recipients (no self-notifications).
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const ONESIGNAL_APP_ID = "0fc0a8e0-9727-49b6-9e37-5d6d919d741f";
const ONESIGNAL_API_ENDPOINT = "https://onesignal.com/api/v1/notifications";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Notification event types that can be dispatched.
 * Each maps to a preference column in `notification_preferences`.
 */
type NotificationEventType =
  | "project_assigned"
  | "project_status_change"
  | "project_archived"
  | "lead_converted"
  | "task_assigned"
  | "task_completed"
  | "schedule_change"
  | "expense_submitted"
  | "expense_approved"
  | "mention";

interface DispatchBody {
  /** The event type — determines which preference column to check */
  eventType: NotificationEventType;
  /** User IDs to notify */
  recipientIds: string[];
  /** Company ID for scoping */
  companyId: string;
  /** Notification title (shown in-app and push) */
  title: string;
  /** Notification body text */
  body: string;
  /** Optional project ID to link the notification */
  projectId?: string;
  /** Optional note ID to link the notification */
  noteId?: string;
  /** Optional in-app action URL (e.g., "/projects/abc") */
  actionUrl?: string;
  /** Optional in-app action button label (e.g., "View Project") */
  actionLabel?: string;
  /** Whether the in-app notification is persistent (cannot be dismissed) */
  persistent?: boolean;
  /** Push notification data payload — forwarded to OneSignal `data` field.
   *  Should include `type` (iOS deep-link type) and `screen` at minimum. */
  pushData?: Record<string, string>;
}

// ─── Preference Key Mapping ──────────────────────────────────────────────────

/**
 * Maps dispatch event types to the key inside the `channel_preferences` JSONB column.
 * The JSONB stores: { "task_assigned": { "push": true, "email": false }, ... }
 */
const CHANNEL_PREF_KEY: Record<NotificationEventType, string> = {
  project_assigned: "project_updates",
  project_status_change: "project_updates",
  project_archived: "project_updates",
  lead_converted: "project_updates",
  task_assigned: "task_assigned",
  task_completed: "task_completed",
  schedule_change: "schedule_changes",
  expense_submitted: "expense_submitted",
  expense_approved: "expense_approved",
  mention: "team_mentions",
};

/**
 * Maps event types to the in-app notification `type` column value.
 * Falls back to the eventType itself if not explicitly mapped.
 */
const INAPP_TYPE: Record<NotificationEventType, string> = {
  project_assigned: "project_assigned",
  project_status_change: "project_status_change",
  project_archived: "project_archived",
  lead_converted: "lead_converted",
  task_assigned: "task_assigned",
  task_completed: "task_completed",
  schedule_change: "schedule_change",
  expense_submitted: "expense_submitted",
  expense_approved: "expense_approved",
  mention: "mention",
};

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // 1. Verify auth — the caller's uid is used to filter self-notifications
    const user = await verifyAdminAuth(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse & validate body
    const body = (await req.json()) as DispatchBody;
    const {
      eventType,
      recipientIds,
      companyId,
      title,
      body: notifBody,
      projectId,
      noteId,
      actionUrl,
      actionLabel,
      persistent = false,
      pushData,
    } = body;

    if (!eventType || !recipientIds?.length || !companyId || !title || !notifBody) {
      return NextResponse.json(
        { error: "Missing required fields: eventType, recipientIds, companyId, title, body" },
        { status: 400 },
      );
    }

    // 3. Filter out the acting user (no self-notifications)
    const filteredIds = recipientIds.filter((id) => id !== user.uid);
    if (filteredIds.length === 0) {
      return NextResponse.json({ success: true, notified: 0, pushed: 0 });
    }

    // 4. Fetch notification preferences for all recipients (service role bypasses RLS)
    const db = getServiceRoleClient();
    const channelKey = CHANNEL_PREF_KEY[eventType];

    const { data: prefs } = await db
      .from("notification_preferences")
      .select("user_id, push_enabled, email_enabled, channel_preferences")
      .in("user_id", filteredIds)
      .eq("company_id", companyId);

    const prefsMap = new Map<string, Record<string, unknown>>(
      (prefs ?? []).map((p: Record<string, unknown>) => [p.user_id as string, p]),
    );

    // 5. Partition recipients into in-app, push, and email lists
    //    channel_preferences JSONB: { "task_assigned": { "push": true, "email": false }, ... }
    //    Global kill switches: push_enabled, email_enabled override per-channel settings.
    const inAppRecipients: string[] = [];
    const pushRecipients: string[] = [];
    const emailRecipients: string[] = [];

    for (const userId of filteredIds) {
      const userPrefs = prefsMap.get(userId);

      // Global kill switches (default to true for new users without preferences)
      const globalPush = userPrefs ? userPrefs.push_enabled !== false : true;
      const globalEmail = userPrefs ? userPrefs.email_enabled !== false : true;

      // Per-channel preferences from JSONB
      let wantsPush = true;
      let wantsEmail = false;

      if (userPrefs?.channel_preferences && typeof userPrefs.channel_preferences === "object") {
        const cp = userPrefs.channel_preferences as Record<string, unknown>;
        const eventPref = cp[channelKey] as { push?: boolean; email?: boolean } | undefined;
        if (eventPref) {
          wantsPush = eventPref.push !== false;
          wantsEmail = eventPref.email === true;
        }
      }

      // In-app notification: sent if user wants push OR email for this event
      if (wantsPush || wantsEmail) {
        inAppRecipients.push(userId);
      }

      // Push: per-channel + global kill switch
      if (wantsPush && globalPush) {
        pushRecipients.push(userId);
      }

      // Email: per-channel + global kill switch
      if (wantsEmail && globalEmail) {
        emailRecipients.push(userId);
      }
    }

    // 6. Create in-app notifications
    if (inAppRecipients.length > 0) {
      const rows = inAppRecipients.map((userId) => ({
        user_id: userId,
        company_id: companyId,
        type: INAPP_TYPE[eventType] ?? eventType,
        title,
        body: notifBody,
        project_id: projectId ?? null,
        note_id: noteId ?? null,
        is_read: false,
        persistent,
        action_url: actionUrl ?? null,
        action_label: actionLabel ?? null,
      }));

      const { error: notifError } = await db.from("notifications").insert(rows);
      if (notifError) {
        console.error(`[dispatch/${eventType}] Failed to create in-app notifications:`, notifError);
      }
    }

    // 7. Send push notifications via OneSignal
    if (pushRecipients.length > 0) {
      const oneSignalApiKey = process.env.ONESIGNAL_REST_API_KEY;
      if (oneSignalApiKey) {
        try {
          const payload: Record<string, unknown> = {
            app_id: ONESIGNAL_APP_ID,
            include_aliases: { external_id: pushRecipients },
            target_channel: "push",
            headings: { en: title },
            contents: { en: notifBody },
            ios_badgeType: "Increase",
            ios_badgeCount: 1,
          };

          if (pushData) {
            payload.data = pushData;
          }

          const osResponse = await fetch(ONESIGNAL_API_ENDPOINT, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Basic ${oneSignalApiKey}`,
            },
            body: JSON.stringify(payload),
          });

          if (!osResponse.ok) {
            const osResult = await osResponse.json().catch(() => ({}));
            console.error(`[dispatch/${eventType}] OneSignal error:`, osResult);
          }
        } catch (pushErr) {
          console.error(`[dispatch/${eventType}] Push notification failed:`, pushErr);
        }
      } else {
        console.warn("[dispatch] ONESIGNAL_REST_API_KEY not configured — push skipped");
      }
    }

    // 8. Email notifications (placeholder — requires SendGrid templates per event type)
    // emailRecipients list is computed above but email sending is not yet implemented
    // for all event types. Log for visibility.
    if (emailRecipients.length > 0) {
      console.log(`[dispatch/${eventType}] ${emailRecipients.length} user(s) opted for email — email delivery pending template setup`);
    }

    return NextResponse.json({
      success: true,
      notified: inAppRecipients.length,
      pushed: pushRecipients.length,
      emailed: emailRecipients.length,
    });
  } catch (err) {
    console.error("[dispatch] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 },
    );
  }
}

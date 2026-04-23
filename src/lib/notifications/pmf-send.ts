/**
 * OPS Web — Unified PMF notification sender.
 *
 * Fan-out across SMS (Twilio), email (SendGrid), and the in-app
 * notification rail, with dedup, retry, and per-channel logging into
 * `pmf_notification_log`.
 *
 * Channel gating:
 *   - `threshold_alert` → SMS (if smsBody), email (if subject+react), in-app rail (if inAppTitle)
 *   - `daily_digest`    → email only
 *   - `weekly_digest`   → email only
 *
 * Dedup window defaults to 4h for threshold alerts, 0 for digests. Each
 * successful or failed send writes one row to `pmf_notification_log`
 * keyed by (kind, trigger, channel); success rows set `sent_at`, failure
 * rows set `error` instead.
 */
import "server-only";
import type { ReactElement } from "react";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { sendSms } from "./twilio";
import { getPmfRecipients } from "@/lib/pmf/recipients";
import { sendTransactionalEmail } from "@/lib/email/sendgrid";
import { render } from "@react-email/render";

export type NotificationKind =
  | "threshold_alert"
  | "daily_digest"
  | "weekly_digest";

export type NotificationChannel = "sms" | "email" | "in_app";

export interface SendOptions {
  kind: NotificationKind;
  trigger: string;
  smsBody?: string;
  emailSubject?: string;
  emailReact?: ReactElement;
  inAppTitle?: string;
  inAppBody?: string;
  inAppActionUrl?: string;
  /** Dedup window in ms; default 4 hours for threshold alerts, 0 for digests. */
  dedupMs?: number;
}

const DEFAULT_DEDUP: Record<NotificationKind, number> = {
  threshold_alert: 4 * 60 * 60 * 1000,
  daily_digest: 0,
  weekly_digest: 0,
};

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function hasRecentSend(
  kind: NotificationKind,
  trigger: string,
  withinMs: number
): Promise<boolean> {
  if (withinMs <= 0) return false;
  const sb = getAdminSupabase();
  const since = new Date(Date.now() - withinMs).toISOString();
  const { data, error } = await sb
    .from("pmf_notification_log")
    .select("id")
    .eq("kind", kind)
    .eq("trigger", trigger)
    .gte("created_at", since)
    .is("error", null)
    .limit(1);
  if (error) {
    console.error("[pmf-send] hasRecentSend query failed:", error);
    return false;
  }
  return (data ?? []).length > 0;
}

interface LogSendArgs {
  kind: NotificationKind;
  trigger: string;
  channel: NotificationChannel;
  recipient: string;
  payload: Record<string, unknown>;
  error?: string;
}

async function logSend(args: LogSendArgs): Promise<void> {
  try {
    const sb = getAdminSupabase();
    await sb.from("pmf_notification_log").insert({
      kind: args.kind,
      trigger: args.trigger,
      channel: args.channel,
      recipient: args.recipient,
      payload: args.payload,
      sent_at: args.error ? null : new Date().toISOString(),
      error: args.error ?? null,
    });
  } catch (e) {
    console.error("[pmf-send] logSend failed:", e);
  }
}

/**
 * Retry with exponential delay: 1s, 5s, 25s between attempts (1s * 5^i).
 * The final attempt's rejection propagates so the caller can log it.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === attempts - 1) break;
      const waitMs = Math.pow(5, i) * 1000; // 1s, 5s, 25s
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

export async function sendPmfNotification(opts: SendOptions): Promise<void> {
  const dedupMs = opts.dedupMs ?? DEFAULT_DEDUP[opts.kind];
  if (await hasRecentSend(opts.kind, opts.trigger, dedupMs)) return;

  const recipients = getPmfRecipients();
  const sb = getAdminSupabase();

  // SMS — only for threshold alerts.
  if (opts.kind === "threshold_alert" && opts.smsBody) {
    const smsBody = opts.smsBody;
    try {
      await withRetry(() => sendSms(recipients.sms, smsBody));
      await logSend({
        kind: opts.kind,
        trigger: opts.trigger,
        channel: "sms",
        recipient: recipients.sms,
        payload: { body: smsBody },
      });
    } catch (e) {
      await logSend({
        kind: opts.kind,
        trigger: opts.trigger,
        channel: "sms",
        recipient: recipients.sms,
        payload: { body: smsBody },
        error: errorMessage(e),
      });
    }
  }

  // Email.
  if (opts.emailSubject && opts.emailReact) {
    const subject = opts.emailSubject;
    const html = await render(opts.emailReact);
    try {
      await withRetry(() =>
        sendTransactionalEmail({ to: recipients.email, subject, html })
      );
      await logSend({
        kind: opts.kind,
        trigger: opts.trigger,
        channel: "email",
        recipient: recipients.email,
        payload: { subject },
      });
    } catch (e) {
      await logSend({
        kind: opts.kind,
        trigger: opts.trigger,
        channel: "email",
        recipient: recipients.email,
        payload: { subject },
        error: errorMessage(e),
      });
    }
  }

  // In-app rail — only for threshold alerts.
  if (opts.kind === "threshold_alert" && opts.inAppTitle) {
    const title = opts.inAppTitle;
    try {
      const { error } = await sb.from("notifications").insert({
        user_id: recipients.operatorUserId,
        company_id: recipients.operatorCompanyId,
        type: "pmf_alert",
        title,
        body: opts.inAppBody ?? "",
        is_read: false,
        persistent: false,
        action_url: opts.inAppActionUrl ?? "/admin/pmf",
        action_label: "VIEW DECK",
      });
      if (error) throw new Error(error.message);
      await logSend({
        kind: opts.kind,
        trigger: opts.trigger,
        channel: "in_app",
        recipient: recipients.operatorUserId,
        payload: { title },
      });
    } catch (e) {
      await logSend({
        kind: opts.kind,
        trigger: opts.trigger,
        channel: "in_app",
        recipient: recipients.operatorUserId,
        payload: { title },
        error: errorMessage(e),
      });
    }
  }
}

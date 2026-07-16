/**
 * Pure classification logic for the email-ingest heartbeat watchdog.
 *
 * Extracted from /api/cron/email-ingest-heartbeat so the failure-detection
 * rules can be unit-tested in isolation (no Next / Supabase imports here).
 *
 * The watchdog checks **provider-side health**, not inbox volume — a
 * low-volume crew that gets three leads a day is silent most hours and must
 * never be flagged. See classifyFailure for the three genuine failure modes.
 */

import type { InboxConnectionDownReason } from "@/lib/email/react/templates/InboxConnectionDown";

/**
 * Staleness ceiling for the `sync_stale` signal.
 *
 * `last_synced_at` only advances when a sync actually runs — the email-sync
 * poll cron or a webhook-triggered sync. The poll cron (vercel.json →
 * /api/cron/email-sync) runs `*​/15 13-23,0-4 * * *`: it is DARK from
 * 05:00–13:00 UTC every day (~8h). A perfectly healthy but quiet inbox
 * therefore legitimately shows zero sync activity across that window — the
 * last overnight poll lands ~04:00 UTC and the next one ~13:00 UTC (a ~9h
 * gap), with no webhook pushes in between because nothing new arrived.
 *
 * A 6h threshold sat INSIDE that dark window, so it fired a false
 * "connection down" alert every quiet night (Canpro got one ~daily from
 * 2026-05 onward while its connection was demonstrably healthy). The
 * threshold must exceed the poll blackout: 13h clears the ~9h worst-case
 * healthy gap with margin, so `sync_stale` now only trips when a connection
 * has genuinely gone dark through an entire active polling window.
 *
 * Genuine auth failures do NOT depend on this backstop: the moment a sync
 * attempt throws (revoked/expired token), sync-engine flips the connection
 * to `needs_reconnect` and fires its own alert within minutes — which is
 * why this constant can be generous without slowing real-outage detection.
 */
export const STALE_SYNC_THRESHOLD_MS = 13 * 60 * 60 * 1000; // 13h — must exceed the email-sync poll blackout (05:00–13:00 UTC)
export const SETUP_GRACE_MS = 24 * 60 * 60 * 1000; // 24h
export const ALERT_DEDUP_MS = 4 * 60 * 60 * 1000; // 4h

export interface FailureSignal {
  connectionId: string;
  companyId: string;
  email: string;
  provider: "gmail" | "microsoft365";
  /** Exact active personal-mailbox owner candidate; always NULL for company mailboxes. */
  connectionOwnerUserId: string | null;
  type: "company" | "individual";
  reason: InboxConnectionDownReason;
  /** Hours since last healthy heartbeat — used for the email's `hoursSilent` field. */
  hoursSilent: number;
}

export interface ConnectionRow {
  id: string;
  company_id: string;
  user_id: string | null;
  email: string;
  provider: string;
  type: "company" | "individual";
  status: string;
  sync_enabled: boolean;
  webhook_subscription_id: string | null;
  webhook_expires_at: string | null;
  last_synced_at: string | null;
  created_at: string;
}

export function classifyFailure(
  conn: ConnectionRow,
  now: number,
): FailureSignal | null {
  // status='needs_reconnect' has its own notification path — skip here.
  if (conn.status !== "active") return null;
  if (!conn.sync_enabled) return null;

  const created = new Date(conn.created_at).getTime();
  const expires = conn.webhook_expires_at
    ? new Date(conn.webhook_expires_at).getTime()
    : null;
  const lastSync = conn.last_synced_at
    ? new Date(conn.last_synced_at).getTime()
    : null;

  // 1) Webhook setup never completed and we're past the grace window.
  if (!conn.webhook_subscription_id && now - created > SETUP_GRACE_MS) {
    const hours = Math.max(1, Math.floor((now - created) / (60 * 60 * 1000)));
    return {
      connectionId: conn.id,
      companyId: conn.company_id,
      email: conn.email,
      provider: conn.provider as "gmail" | "microsoft365",
      connectionOwnerUserId:
        conn.type === "individual" ? conn.user_id : null,
      type: conn.type,
      reason: "webhook_setup_failed",
      hoursSilent: hours,
    };
  }

  // 2) Webhook expired without a successful renewal.
  if (expires !== null && expires < now) {
    const hours = Math.max(1, Math.floor((now - expires) / (60 * 60 * 1000)));
    return {
      connectionId: conn.id,
      companyId: conn.company_id,
      email: conn.email,
      provider: conn.provider as "gmail" | "microsoft365",
      connectionOwnerUserId:
        conn.type === "individual" ? conn.user_id : null,
      type: conn.type,
      reason: "webhook_expired",
      hoursSilent: hours,
    };
  }

  // 3) Sync hasn't run in 13+ hours despite being active. The threshold must
  //    clear the nightly email-sync poll blackout (see STALE_SYNC_THRESHOLD_MS)
  //    so a quiet-but-healthy overnight inbox is never mistaken for an outage.
  if (lastSync !== null && now - lastSync > STALE_SYNC_THRESHOLD_MS) {
    const hours = Math.floor((now - lastSync) / (60 * 60 * 1000));
    return {
      connectionId: conn.id,
      companyId: conn.company_id,
      email: conn.email,
      provider: conn.provider as "gmail" | "microsoft365",
      connectionOwnerUserId:
        conn.type === "individual" ? conn.user_id : null,
      type: conn.type,
      reason: "sync_stale",
      hoursSilent: hours,
    };
  }

  return null;
}

/** When a company has multiple failed connections, report the worst. */
export function pickWorstFailure(failures: FailureSignal[]): FailureSignal {
  // webhook_expired is the most actionable, then webhook_setup_failed,
  // then sync_stale (which can sometimes self-heal on next manual sync).
  const priority: Record<InboxConnectionDownReason, number> = {
    webhook_expired: 3,
    webhook_setup_failed: 2,
    sync_stale: 1,
  };
  return [...failures].sort(
    (a, b) =>
      priority[b.reason] - priority[a.reason] || b.hoursSilent - a.hoursSilent,
  )[0];
}

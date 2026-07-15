/**
 * GET /api/cron/email-ingest-heartbeat
 *
 * Connection-health watchdog for the email-ingest pipeline. Runs hourly.
 *
 * Earlier revisions of this cron alerted on inbox *quietness* — zero new
 * email_threads or opportunities in a 60-min window. That produced constant
 * false positives for low-volume companies (a deck-and-rail crew that gets
 * three leads a day looks "silent" most hours of every day) and trained
 * operators to ignore the alert.
 *
 * The approach checks **provider-side health**, not inbox volume:
 *
 *   1. webhook_expired — `webhook_expires_at < NOW()` and no successful
 *      renewal. Webhook-renewal cron should keep this fresh; if it didn't,
 *      the user genuinely needs to reconnect.
 *
 *   2. webhook_setup_failed — `webhook_subscription_id IS NULL` and the
 *      connection has existed for >24h. The webhook-renewal cron retries
 *      these; if it's still null after a day, OAuth scopes or the
 *      provider's API are blocking setup.
 *
 *   3. sync_stale — `last_synced_at` older than STALE_SYNC_THRESHOLD_MS for
 *      an active connection. `last_synced_at` only advances when a sync
 *      actually runs, and the email-sync poll cron is dark 05:00–13:00 UTC,
 *      so the threshold must clear that blackout or a quiet-but-healthy
 *      overnight inbox reads as an outage. See ingest-heartbeat-classify.ts
 *      for the full derivation.
 *
 * `status='needs_reconnect'` is intentionally skipped here — it has its own
 * notification path inside sync-engine that fires the moment a sync attempt
 * throws (revoked/expired token). Re-alerting here would just double-notify,
 * and it's why sync_stale can be a generous backstop rather than the
 * front-line token-failure detector.
 *
 * One alert per company per 4-hour dedup window.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { sendInboxConnectionDown } from "@/lib/email/sendgrid";
import {
  ALERT_DEDUP_MS,
  classifyFailure,
  pickWorstFailure,
  type ConnectionRow,
  type FailureSignal,
} from "@/lib/email/ingest-heartbeat-classify";
import { buildReconnectDeepLink } from "@/lib/email/reconnect-deep-link";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceRoleClient();
  const now = Date.now();

  // 1. Pull every connection — we need the full row to classify.
  const { data: connections, error: connErr } = await supabase
    .from("email_connections")
    .select(
      "id, company_id, user_id, email, provider, type, status, sync_enabled, webhook_subscription_id, webhook_expires_at, last_synced_at, created_at"
    );
  if (connErr) {
    console.error("[email-heartbeat] fetch connections failed", connErr);
    return NextResponse.json({ error: connErr.message }, { status: 500 });
  }

  // 2. Classify each connection. Group failures by company so each company
  //    gets at most one alert per cron tick (the worst failure).
  const failuresByCompany = new Map<string, FailureSignal[]>();
  let checkedCount = 0;
  for (const raw of connections ?? []) {
    checkedCount += 1;
    const failure = classifyFailure(raw as ConnectionRow, now);
    if (!failure) continue;
    const list = failuresByCompany.get(failure.companyId) ?? [];
    list.push(failure);
    failuresByCompany.set(failure.companyId, list);
  }

  if (failuresByCompany.size === 0) {
    return NextResponse.json({
      ok: true,
      checked: checkedCount,
      failed: 0,
      alerted: 0,
    });
  }

  const failedCompanyIds = Array.from(failuresByCompany.keys());

  // 3. Dedup against the 4h alert log.
  const dedupSince = new Date(now - ALERT_DEDUP_MS).toISOString();
  const { data: recentAlerts, error: recentAlertsError } = await supabase
    .from("email_ingest_heartbeat_log")
    .select("company_id")
    .gte("triggered_at", dedupSince)
    .in("company_id", failedCompanyIds);
  if (recentAlertsError) {
    return NextResponse.json(
      { error: recentAlertsError.message },
      { status: 500 }
    );
  }

  const recentlyAlertedIds = new Set(
    (recentAlerts ?? []).map((r) => r.company_id as string)
  );
  const toAlertIds = failedCompanyIds.filter(
    (id) => !recentlyAlertedIds.has(id)
  );

  if (toAlertIds.length === 0) {
    return NextResponse.json({
      ok: true,
      checked: checkedCount,
      failed: failedCompanyIds.length,
      alerted: 0,
      dedupedFailed: failedCompanyIds.length,
    });
  }

  // 4. Resolve company name + admin recipient.
  const { data: companies, error: companiesError } = await supabase
    .from("companies")
    .select("id, name, admin_ids")
    .in("id", toAlertIds);
  if (companiesError) {
    return NextResponse.json(
      { error: companiesError.message },
      { status: 500 }
    );
  }

  const adminIds = (companies ?? []).flatMap(
    (c) => (c.admin_ids as string[]) ?? []
  );
  const { data: admins, error: adminsError } =
    adminIds.length > 0
      ? await supabase
          .from("users")
          .select("id, email, company_id")
          .in("id", adminIds)
      : { data: [], error: null };
  if (adminsError) {
    return NextResponse.json({ error: adminsError.message }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co";

  let alertedCount = 0;
  let deliveryFailureCount = Math.max(
    0,
    toAlertIds.length - (companies?.length ?? 0)
  );
  for (const company of companies ?? []) {
    const companyId = company.id as string;
    const companyName = (company.name as string) ?? "Your company";
    const failures = failuresByCompany.get(companyId);
    if (!failures || failures.length === 0) continue;
    const worst = pickWorstFailure(failures);

    const recipient = (admins ?? []).find((a) => a.company_id === companyId);
    const recipientEmail = recipient?.email as string | undefined;
    const recipientUserId = recipient?.id as string | undefined;

    // Email button → authenticated reconnect confirmation. Logged-out users
    // sign in and return to the same confirmation before provider consent.
    // Falls back to the connection's original user_id when the recipient
    // admin isn't resolvable (rare; the
    // reconnect state remains bound to the exact failed mailbox row).
    const deepLinkUserId = recipientUserId ?? worst.connectionUserId;
    const reconnectUrl = buildReconnectDeepLink({
      appUrl,
      provider: worst.provider,
      companyId,
      userId: deepLinkUserId,
      type: worst.type,
      connectionId: worst.connectionId,
      expectedEmail: worst.email,
    });

    // Notification rail entry — non-technical wording. Uses the in-app
    // settings URL because the user is already authenticated when reading
    // the rail; the deep-link is only needed for the email path.
    const { error: notificationError } = await supabase
      .from("notifications")
      .insert({
        user_id: recipientUserId ?? null,
        company_id: companyId,
        type: "system_alert",
        title: "Your inbox stopped sending leads to OPS",
        body: `${worst.email} is disconnected. Reconnect to start capturing leads again.`,
        is_read: false,
        persistent: true,
        action_url: "/settings?tab=integrations",
        action_label: "RECONNECT INBOX",
      });
    const inAppDelivered = !notificationError;
    if (notificationError) {
      console.error("[email-heartbeat] notification insert failed", {
        companyId,
        error: notificationError.message,
      });
    }

    // SendGrid alert — properly templated, dispatched through gatedSend.
    let emailDelivered = false;
    if (recipientEmail) {
      try {
        const sendResult = await sendInboxConnectionDown({
          email: recipientEmail,
          companyName,
          inboxAddress: worst.email,
          reason: worst.reason,
          hoursSilent: worst.hoursSilent,
          reconnectUrl,
        });
        emailDelivered = sendResult.status === "sent";
        if (!emailDelivered) {
          console.error("[email-heartbeat] email alert skipped", {
            companyId,
            status: sendResult.status,
          });
        }
      } catch (err) {
        console.error("[email-heartbeat] sendInboxConnectionDown failed", {
          companyId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!inAppDelivered && !emailDelivered) {
      deliveryFailureCount += 1;
      continue;
    }

    const deliveryReason =
      inAppDelivered && emailDelivered
        ? `${worst.reason}_email_and_inapp`
        : emailDelivered
          ? `${worst.reason}_email_only`
          : `${worst.reason}_inapp_only`;
    const { error: logError } = await supabase
      .from("email_ingest_heartbeat_log")
      .insert({
        company_id: companyId,
        triggered_at: new Date(now).toISOString(),
        reason: deliveryReason,
      });
    if (logError) {
      console.error("[email-heartbeat] delivered-alert log failed", {
        companyId,
        error: logError.message,
      });
      deliveryFailureCount += 1;
      continue;
    }

    alertedCount += 1;
  }

  return NextResponse.json(
    {
      ok: deliveryFailureCount === 0,
      checked: checkedCount,
      failed: failedCompanyIds.length,
      alerted: alertedCount,
      deliveryFailures: deliveryFailureCount,
    },
    { status: deliveryFailureCount === 0 ? 200 : 503 }
  );
}

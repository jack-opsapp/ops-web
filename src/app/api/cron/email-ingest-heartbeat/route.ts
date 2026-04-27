/**
 * GET /api/cron/email-ingest-heartbeat
 *
 * Phase C observability heartbeat. Runs every 15 min.
 *
 * For each active email_connections row, checks whether ANY ingestion
 * activity has occurred in the last 60 minutes:
 *   - inserts in `email_threads` (provider sync wrote a thread)
 *   - inserts in `opportunities` with source='email' (lead-creation fired)
 *
 * If a company has at least one active integration but ZERO inserts in the
 * window, that's a strong signal the pipeline is silently broken — sends a
 * single SendGrid email + writes a notification rail entry. Runs are
 * deduplicated to one alert per company per 4 hours so a paused inbox
 * doesn't flood the inbox.
 *
 * Auth: same Bearer ${CRON_SECRET} pattern as the other cron endpoints.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { sendTransactionalEmail } from "@/lib/email/sendgrid";

export const maxDuration = 60;

const HEARTBEAT_WINDOW_MS = 60 * 60 * 1000; // 1h
const ALERT_DEDUP_MS = 4 * 60 * 60 * 1000; // 4h

interface HeartbeatRow {
  company_id: string;
  triggered_at: string;
}

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
  const since = new Date(Date.now() - HEARTBEAT_WINDOW_MS).toISOString();

  // 1. Active email connections, grouped by company
  const { data: connections, error: connErr } = await supabase
    .from("email_connections")
    .select("company_id, provider, email")
    .eq("status", "active")
    .eq("sync_enabled", true);
  if (connErr) {
    console.error("[email-heartbeat] fetch connections failed", connErr);
    return NextResponse.json({ error: connErr.message }, { status: 500 });
  }

  const companyIds = Array.from(
    new Set((connections ?? []).map((c) => c.company_id as string))
  );
  if (companyIds.length === 0) {
    return NextResponse.json({ ok: true, checked: 0, alerted: 0 });
  }

  // 2. Per-company activity in the last hour
  const [threadsResult, opportunitiesResult] = await Promise.all([
    supabase
      .from("email_threads")
      .select("company_id")
      .gte("created_at", since)
      .in("company_id", companyIds),
    supabase
      .from("opportunities")
      .select("company_id")
      .eq("source", "email")
      .gte("created_at", since)
      .in("company_id", companyIds),
  ]);

  const activeCompanyIds = new Set<string>();
  for (const row of threadsResult.data ?? []) {
    activeCompanyIds.add(row.company_id as string);
  }
  for (const row of opportunitiesResult.data ?? []) {
    activeCompanyIds.add(row.company_id as string);
  }

  const silentCompanyIds = companyIds.filter((id) => !activeCompanyIds.has(id));
  if (silentCompanyIds.length === 0) {
    return NextResponse.json({
      ok: true,
      checked: companyIds.length,
      alerted: 0,
    });
  }

  // 3. Dedup against recent alerts
  const dedupSince = new Date(Date.now() - ALERT_DEDUP_MS).toISOString();
  const { data: recentAlerts } = await supabase
    .from("email_ingest_heartbeat_log")
    .select("company_id, triggered_at")
    .gte("triggered_at", dedupSince)
    .in("company_id", silentCompanyIds);

  const recentlyAlertedIds = new Set(
    ((recentAlerts ?? []) as HeartbeatRow[]).map((r) => r.company_id)
  );
  const toAlertIds = silentCompanyIds.filter(
    (id) => !recentlyAlertedIds.has(id)
  );

  if (toAlertIds.length === 0) {
    return NextResponse.json({
      ok: true,
      checked: companyIds.length,
      alerted: 0,
      dedupedSilent: silentCompanyIds.length,
    });
  }

  // 4. Resolve operator email + name per company
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name, admin_ids")
    .in("id", toAlertIds);

  const adminIds = (companies ?? []).flatMap(
    (c) => (c.admin_ids as string[]) ?? []
  );
  const { data: admins } =
    adminIds.length > 0
      ? await supabase
          .from("users")
          .select("id, email, first_name, last_name, company_id")
          .in("id", adminIds)
      : { data: [] };

  let alertedCount = 0;
  for (const company of companies ?? []) {
    const companyId = company.id as string;
    const companyName = (company.name as string) ?? "Your company";
    const recipient = (admins ?? []).find(
      (a) => a.company_id === companyId
    );
    const recipientEmail = recipient?.email as string | undefined;

    // Always: notification rail entry
    await supabase.from("notifications").insert({
      user_id: recipient?.id ?? null,
      company_id: companyId,
      type: "system_alert",
      title: "Email ingestion silent",
      body: `No emails or leads recorded for ${companyName} in the last hour. Check Settings → Integrations.`,
      is_read: false,
      persistent: true,
      action_url: "/settings/integrations",
      action_label: "VIEW INTEGRATIONS",
    });

    // Best-effort: SendGrid alert to the resolved admin
    if (recipientEmail) {
      try {
        await sendTransactionalEmail({
          to: recipientEmail,
          subject: `[OPS] Email ingestion silent — ${companyName}`,
          html: `
            <p>OPS hasn't recorded any new emails or leads for <strong>${companyName}</strong> in the last hour.</p>
            <p>This usually means a webhook subscription has lapsed or the OAuth token needs to be re-granted.</p>
            <p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ""}/settings/integrations">Reconnect your inbox</a></p>
            <p style="font-size:12px;color:#666">You can suppress this alert for 4 hours by clicking the link above and re-running a manual sync.</p>
          `.trim(),
          fromName: "OPS Observability",
        });
      } catch (err) {
        console.error("[email-heartbeat] sendTransactionalEmail failed", {
          companyId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await supabase.from("email_ingest_heartbeat_log").insert({
      company_id: companyId,
      triggered_at: new Date().toISOString(),
      reason: recipientEmail
        ? "silent_window_alert_email_and_inapp"
        : "silent_window_alert_inapp_only",
    });

    alertedCount += 1;
  }

  return NextResponse.json({
    ok: true,
    checked: companyIds.length,
    silent: silentCompanyIds.length,
    alerted: alertedCount,
  });
}

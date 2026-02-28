/**
 * POST /api/webhooks/sendgrid?secret=<SENDGRID_WEBHOOK_SECRET>
 *
 * Receives SendGrid Event Webhook payloads and stores them in email_events.
 * Events: delivered, open, click, bounce, dropped, deferred, spam_report, unsubscribe, processed
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

interface SendGridEvent {
  email: string;
  event: string;
  sg_message_id?: string;
  timestamp: number;
  url?: string;
  useragent?: string;
  ip?: string;
  reason?: string;
  [key: string]: unknown;
}

export async function POST(req: NextRequest) {
  // Verify shared secret
  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret || secret !== process.env.SENDGRID_WEBHOOK_SECRET) {
    console.error("[sendgrid-webhook] Invalid or missing secret");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let events: SendGridEvent[];
  try {
    events = await req.json();
  } catch {
    console.error("[sendgrid-webhook] Failed to parse request body");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ received: true });
  }

  const supabase = getServiceRoleClient();

  const rows = events.map((evt) => ({
    email: evt.email,
    event: evt.event,
    sg_message_id: evt.sg_message_id ?? null,
    timestamp: new Date(evt.timestamp * 1000).toISOString(),
    url: evt.url ?? null,
    useragent: evt.useragent ?? null,
    ip: evt.ip ?? null,
    reason: evt.reason ?? null,
    raw: evt as unknown as Record<string, unknown>,
  }));

  const { error } = await supabase.from("email_events").insert(rows);

  if (error) {
    console.error("[sendgrid-webhook] Insert failed:", error.message);
    return NextResponse.json({ error: "Failed to store events" }, { status: 500 });
  }

  console.log(`[sendgrid-webhook] Stored ${rows.length} events`);
  return NextResponse.json({ received: true });
}

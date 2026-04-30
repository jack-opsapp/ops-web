/**
 * POST /api/webhooks/sendgrid?secret=<SENDGRID_WEBHOOK_SECRET>
 *
 * Receives SendGrid Event Webhook payloads, persists them to email_events
 * idempotently, and lets the trg_email_events_auto_suppress trigger fan
 * terminal events into email_suppressions.
 *
 * Events expected: delivered, open, click, bounce, dropped, deferred,
 * spamreport, unsubscribe, processed, group_unsubscribe, group_resubscribe.
 *
 * Idempotency: events are upserted on the unique index
 * (sg_message_id, event, timestamp). Replays are silently absorbed.
 *
 * Rate limit: 600 requests/min/IP via Vercel KV (see ratelimit.ts). Even
 * with the secret, a leaked credential should not be able to DoS the DB.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { rateLimit } from "@/lib/utils/ratelimit";

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

interface EmailEventRow {
  email: string;
  event: string;
  sg_message_id: string | null;
  timestamp: string;
  url: string | null;
  useragent: string | null;
  ip: string | null;
  reason: string | null;
  raw: Record<string, unknown>;
}

const VALID_EVENTS = new Set([
  "delivered",
  "open",
  "click",
  "bounce",
  "dropped",
  "deferred",
  "spamreport",
  "unsubscribe",
  "processed",
  "group_unsubscribe",
  "group_resubscribe",
]);

function getClientIp(req: NextRequest): string {
  // Vercel sets x-forwarded-for. Fall back to a static key if unavailable
  // so rate limit still applies to local dev.
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  // Rate limit by IP (defense-in-depth alongside the secret).
  const ip = getClientIp(req);
  const limited = await rateLimit({ key: `sendgrid-webhook:${ip}`, limit: 600, windowSec: 60 });
  if (limited.exceeded) {
    console.warn(`[sendgrid-webhook] rate limited ip=${ip} count=${limited.count}`);
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "retry-after": String(limited.retryAfterSec) } }
    );
  }

  // Verify shared secret
  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret || secret !== process.env.SENDGRID_WEBHOOK_SECRET) {
    console.error("[sendgrid-webhook] invalid or missing secret");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse body
  let events: SendGridEvent[];
  try {
    const body = await req.json();
    if (!Array.isArray(body)) {
      console.error("[sendgrid-webhook] body is not an array");
      return NextResponse.json({ error: "Body must be an array of events" }, { status: 400 });
    }
    events = body as SendGridEvent[];
  } catch {
    console.error("[sendgrid-webhook] failed to parse JSON body");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (events.length === 0) {
    return NextResponse.json({ received: 0 });
  }

  // Hard cap at 1000 events/request (SendGrid batches at 1000 by default).
  if (events.length > 1000) {
    console.warn(`[sendgrid-webhook] oversize batch: ${events.length} events`);
    return NextResponse.json({ error: "Too many events in batch" }, { status: 413 });
  }

  // Validate + map. Skip invalid rows but keep valid ones.
  const rows: EmailEventRow[] = [];
  let skipped = 0;
  for (const evt of events) {
    if (!evt || typeof evt !== "object") {
      skipped++;
      continue;
    }
    if (typeof evt.email !== "string" || !evt.email) {
      skipped++;
      continue;
    }
    if (typeof evt.event !== "string" || !VALID_EVENTS.has(evt.event)) {
      skipped++;
      continue;
    }
    if (typeof evt.timestamp !== "number" || !Number.isFinite(evt.timestamp)) {
      skipped++;
      continue;
    }

    rows.push({
      email: evt.email,
      event: evt.event,
      sg_message_id: typeof evt.sg_message_id === "string" ? evt.sg_message_id : null,
      timestamp: new Date(evt.timestamp * 1000).toISOString(),
      url: typeof evt.url === "string" ? evt.url : null,
      useragent: typeof evt.useragent === "string" ? evt.useragent : null,
      ip: typeof evt.ip === "string" ? evt.ip : null,
      reason: typeof evt.reason === "string" ? evt.reason : null,
      raw: evt as unknown as Record<string, unknown>,
    });
  }

  if (rows.length === 0) {
    console.warn(`[sendgrid-webhook] all ${events.length} events invalid; skipping insert`);
    return NextResponse.json({ received: events.length, stored: 0, skipped });
  }

  // Idempotent upsert. The unique index is partial (only when sg_message_id
  // IS NOT NULL), so events without sg_message_id are inserted as new rows
  // every time. SendGrid omits sg_message_id only on rare system events,
  // which is acceptable.
  const supabase = getServiceRoleClient();
  const { error, count } = await supabase
    .from("email_events")
    .upsert(rows, {
      onConflict: "sg_message_id,event,timestamp",
      ignoreDuplicates: true,
      count: "exact",
    });

  if (error) {
    // Transient DB error — return 500 so SendGrid retries.
    console.error("[sendgrid-webhook] upsert failed:", error.message);
    return NextResponse.json({ error: "Failed to persist events" }, { status: 500 });
  }

  console.warn(
    `[sendgrid-webhook] received=${events.length} stored=${count ?? rows.length} skipped=${skipped}`
  );
  return NextResponse.json({ received: events.length, stored: count ?? rows.length, skipped });
}

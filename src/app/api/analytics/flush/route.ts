import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { rateLimit } from "@/lib/utils/ratelimit";
import type { AnalyticsStoredEvent } from "@/lib/analytics/analytics-types";
import {
  analyticsUtf8ByteLength,
  ANALYTICS_BATCH_SIZE,
  ANALYTICS_MAX_PAYLOAD_BYTES,
} from "@/lib/analytics/event-contract";
import {
  isAnalyticsUuid,
  sanitizeClientAnalyticsEvent,
} from "@/lib/analytics/event-sanitizer";

const HOURLY_EVENT_LIMIT = 5_000;

function isLocalRequest(req: NextRequest): boolean {
  const candidates = [
    req.nextUrl.hostname,
    req.headers.get("origin"),
    req.headers.get("referer"),
  ].filter((value): value is string => Boolean(value));
  return candidates.some((value) => {
    try {
      const hostname = value.includes("://") ? new URL(value).hostname : value;
      return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    } catch {
      return true;
    }
  });
}

export async function POST(req: NextRequest) {
  const auth = await verifyAdminAuth(req);
  if (!auth) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > ANALYTICS_MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ success: false, error: "Payload too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    const rawBody = await req.text();
    if (analyticsUtf8ByteLength(rawBody) > ANALYTICS_MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ success: false, error: "Payload too large" }, { status: 413 });
    }
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body) || body.length === 0 || body.length > ANALYTICS_BATCH_SIZE) {
    return NextResponse.json({ success: false, error: "Invalid analytics batch" }, { status: 400 });
  }
  const now = Date.now();
  const events = body
    .map((value) => sanitizeClientAnalyticsEvent(value, now))
    .filter((value) => value !== null);
  const acceptedIdSet = new Set(events.map((event) => event.id));
  const rejectedIds = body
    .map((value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>).id
        : null
    )
    .filter(
      (value): value is string =>
        isAnalyticsUuid(value) && !acceptedIdSet.has(value)
    );

  if (
    events.length === 0 ||
    events.some((event) => event.environment === "test" || event.environment === "development") ||
    (isLocalRequest(req) && events.some((event) => event.environment === "production"))
  ) {
    return NextResponse.json(
      { success: false, error: "Analytics environment rejected", rejectedIds },
      { status: 400 }
    );
  }

  const user = await findUserByAuth(
    auth.uid,
    auth.email,
    "id, company_id, role, is_active, deleted_at"
  );
  if (
    !user ||
    typeof user.id !== "string" ||
    user.is_active !== true ||
    user.deleted_at !== null
  ) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const limited = await rateLimit({
    key: `analytics:${user.id}`,
    limit: HOURLY_EVENT_LIMIT,
    windowSec: 3_600,
    cost: events.length,
  });
  if (limited.exceeded) {
    return NextResponse.json(
      { success: false, error: "Rate limit exceeded" },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      }
    );
  }

  const supabase = getAdminSupabase();
  const companyId = typeof user.company_id === "string" ? user.company_id : null;
  let plan: string | null = null;
  if (companyId) {
    const { data: company, error } = await supabase
      .from("companies")
      .select("subscription_plan")
      .eq("id", companyId)
      .maybeSingle();
    if (error) {
      console.error("[Analytics] Company plan lookup failed", { code: error.code });
      return NextResponse.json({ success: false, error: "Analytics unavailable" }, { status: 503 });
    }
    plan = typeof company?.subscription_plan === "string"
      ? company.subscription_plan
      : null;
  }

  const rows: AnalyticsStoredEvent[] = events.map((event) => ({
    ...event,
    user_id: user.id as string,
    company_id: companyId,
    role: typeof user.role === "string" ? user.role : null,
    plan,
    platform: "web",
  }));
  const { error } = await supabase.from("analytics_events").upsert(rows, {
    onConflict: "id",
    ignoreDuplicates: true,
  });
  if (error) {
    console.error("[Analytics] Flush failed", { code: error.code });
    return NextResponse.json({ success: false, error: "Analytics unavailable" }, { status: 503 });
  }

  return NextResponse.json({
    success: true,
    acceptedIds: events.map((event) => event.id),
    rejectedIds,
  });
}

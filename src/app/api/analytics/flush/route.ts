/**
 * OPS Web — Analytics Flush Endpoint
 *
 * Receives buffered analytics events via navigator.sendBeacon (beforeunload)
 * and inserts them into Supabase using the admin client.
 *
 * This route exists because server actions cannot be called from
 * synchronous beforeunload handlers. The normal flush path uses
 * the server action directly.
 */
import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import type { AnalyticsEvent } from "@/lib/analytics/analytics-types";

export async function POST(req: Request) {
  try {
    const events: AnalyticsEvent[] = await req.json();

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ success: true });
    }

    // Limit to 50 events per request (same as batch size)
    const batch = events.slice(0, 50);

    const supabase = getAdminSupabase();
    const { error } = await supabase
      .from("analytics_events")
      .insert(batch);

    if (error) {
      console.error("[Analytics] Beacon flush failed:", error.message);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Analytics] Beacon flush exception:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/**
 * OPS Web — Analytics Server Action
 *
 * SERVER ONLY. Inserts analytics events using the admin Supabase client
 * (service role, bypasses RLS). Called by the client-side AnalyticsService
 * during batch flush.
 */
"use server";

import { getAdminSupabase } from "@/lib/supabase/admin-client";
import type { AnalyticsEvent } from "./analytics-types";

/**
 * Batch-insert analytics events into the analytics_events table.
 * Uses service role to bypass RLS (the table has no RLS policies).
 * Max 50 events per call to keep write transactions small.
 */
export async function flushAnalyticsEvents(
  events: AnalyticsEvent[]
): Promise<{ success: boolean; error?: string }> {
  if (events.length === 0) return { success: true };

  try {
    const supabase = getAdminSupabase();
    const { error } = await supabase
      .from("analytics_events")
      .insert(events);

    if (error) {
      console.error("[Analytics] Flush failed:", error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Analytics] Flush exception:", message);
    return { success: false, error: message };
  }
}

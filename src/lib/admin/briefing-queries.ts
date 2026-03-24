/**
 * OPS Admin — Ad Briefing Supabase CRUD
 * SERVER ONLY. Uses admin client (service role, bypasses RLS).
 */
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import type { AdBriefing, BriefingProgress } from "./briefing-types";

const db = () => getAdminSupabase();

/** Create a new briefing row with 'generating' status. Returns the ID. */
export async function createBriefing(triggeredBy: "cron" | "manual"): Promise<string> {
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setDate(periodEnd.getDate() - 1); // yesterday
  const periodStart = new Date(periodEnd);
  periodStart.setDate(periodStart.getDate() - 6); // 7 days back

  const { data, error } = await db()
    .from("ad_briefings")
    .insert({
      status: "generating",
      period_start: periodStart.toISOString().split("T")[0],
      period_end: periodEnd.toISOString().split("T")[0],
      triggered_by: triggeredBy,
      progress: { step: 0, total: 5, label: "Starting...", completedSteps: [] },
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create briefing: ${error.message}`);
  return data.id;
}

/** Check if a briefing is currently generating (idempotency guard). */
export async function getActiveBriefing(): Promise<string | null> {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data } = await db()
    .from("ad_briefings")
    .select("id")
    .eq("status", "generating")
    .gte("created_at", tenMinutesAgo)
    .limit(1)
    .single();
  return data?.id ?? null;
}

/** Update briefing progress (called between steps). */
export async function updateBriefingProgress(
  id: string,
  progress: BriefingProgress
): Promise<void> {
  await db().from("ad_briefings").update({ progress }).eq("id", id);
}

/** Mark briefing as complete with all data. */
export async function completeBriefing(
  id: string,
  data: Omit<AdBriefing, "id" | "created_at" | "period_start" | "period_end" | "status" | "triggered_by" | "progress" | "email_sent" | "error">
): Promise<void> {
  await db()
    .from("ad_briefings")
    .update({
      status: "complete",
      summary: data.summary,
      performance_data: data.performance_data,
      competitor_intel: data.competitor_intel,
      market_sentiment: data.market_sentiment,
      insights: data.insights,
      ad_suggestions: data.ad_suggestions,
      keyword_recs: data.keyword_recs,
      ab_test_proposals: data.ab_test_proposals,
      action_items: data.action_items,
      progress: null,
    })
    .eq("id", id);
}

/** Mark briefing as failed. */
export async function failBriefing(id: string, error: string): Promise<void> {
  await db()
    .from("ad_briefings")
    .update({ status: "failed", error, progress: null })
    .eq("id", id);
}

/** Mark email as sent. */
export async function markEmailSent(id: string): Promise<void> {
  await db().from("ad_briefings").update({ email_sent: true }).eq("id", id);
}

/** Get a single briefing by ID. */
export async function getBriefingById(id: string): Promise<AdBriefing | null> {
  const { data } = await db()
    .from("ad_briefings")
    .select("*")
    .eq("id", id)
    .single();
  return data as AdBriefing | null;
}

/** Get all briefings, most recent first. */
export async function listBriefings(limit = 20): Promise<AdBriefing[]> {
  const { data } = await db()
    .from("ad_briefings")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as AdBriefing[];
}

/** Get the latest complete briefing. */
export async function getLatestBriefing(): Promise<AdBriefing | null> {
  const { data } = await db()
    .from("ad_briefings")
    .select("*")
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data as AdBriefing | null;
}

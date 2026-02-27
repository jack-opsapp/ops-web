/**
 * OPS Admin — Email Dashboard Supabase Queries
 *
 * SERVER ONLY. All functions use getAdminSupabase() (service role, bypasses RLS).
 */
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { bucketize } from "./date-utils";
import type {
  EmailLogRow,
  EmailOverviewStats,
  EmailFunnelData,
  NewsletterContent,
} from "./types";

const db = () => getAdminSupabase();

// ─── Overview Stats ──────────────────────────────────────────────────────────

export async function getEmailOverviewStats(): Promise<EmailOverviewStats> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const from = thirtyDaysAgo.toISOString();
  const to = new Date().toISOString();

  const [
    { count: totalSent },
    { count: totalDelivered },
    { count: totalFailed },
    { data: recentRows },
  ] = await Promise.all([
    db()
      .from("email_log")
      .select("*", { count: "exact", head: true }),
    db()
      .from("email_log")
      .select("*", { count: "exact", head: true })
      .in("status", ["sent", "delivered"]),
    db()
      .from("email_log")
      .select("*", { count: "exact", head: true })
      .eq("status", "failed"),
    db()
      .from("email_log")
      .select("sent_at")
      .gte("sent_at", from)
      .order("sent_at", { ascending: true }),
  ]);

  const sent = totalSent ?? 0;
  const delivered = totalDelivered ?? 0;
  const failed = totalFailed ?? 0;
  const deliveryRate = sent > 0 ? Math.round((delivered / sent) * 100) : 0;

  const dailyVolume = bucketize(
    (recentRows ?? []) as { sent_at: string }[],
    from,
    to,
    "daily",
    "sent_at" as keyof { sent_at: string }
  );

  return { totalSent: sent, totalDelivered: delivered, totalFailed: failed, deliveryRate, dailyVolume };
}

// ─── Funnel Data ─────────────────────────────────────────────────────────────

export async function getEmailFunnelData(): Promise<EmailFunnelData> {
  const [{ data: segmentData }, { data: funnelData }] = await Promise.all([
    db().rpc("email_segment_counts"),
    db().rpc("email_funnel_counts"),
  ]);

  const segments = (segmentData as EmailFunnelData["segmentCounts"]) ?? {
    total_users: 0,
    bubble_reauth: 0,
    unverified: 0,
    auth_lifecycle: 0,
    removed: 0,
  };

  const counts = (funnelData as Record<string, number>) ?? {};

  // Build funnel stages from email_log send counts
  const bubble: EmailFunnelData["bubble"] = [
    { step: "Eligible", count: segments.bubble_reauth },
    { step: "Day 0", count: counts["bubble_reauth_day0"] ?? 0 },
    { step: "Day 7", count: counts["bubble_reauth_day7"] ?? 0 },
    { step: "Day 30", count: counts["bubble_reauth_day30"] ?? 0 },
    { step: "Day 90", count: counts["bubble_reauth_day90"] ?? 0 },
  ];

  const unverified: EmailFunnelData["unverified"] = [
    { step: "Eligible", count: segments.unverified },
    { step: "Day 1", count: counts["unverified_day1"] ?? 0 },
    { step: "Day 7", count: counts["unverified_day7"] ?? 0 },
    { step: "Day 14", count: counts["unverified_day14"] ?? 0 },
    { step: "Day 30", count: counts["unverified_day30"] ?? 0 },
    { step: "Day 60", count: counts["unverified_day60"] ?? 0 },
    { step: "Day 90", count: counts["unverified_day90"] ?? 0 },
    { step: "Day 180", count: counts["unverified_day180"] ?? 0 },
  ];

  const auth: EmailFunnelData["auth"] = [
    { step: "No Onboarding", count: counts["lifecycle_no_onboarding"] ?? 0 },
    { step: "No First Project", count: counts["lifecycle_no_first_project"] ?? 0 },
    { step: "Inactive", count: counts["lifecycle_inactive"] ?? 0 },
    { step: "Trial Expiring", count: counts["lifecycle_trial_expiring"] ?? 0 },
    { step: "Trial Expired", count: counts["lifecycle_trial_expired"] ?? 0 },
  ];

  return { bubble, unverified, auth, segmentCounts: segments };
}

// ─── Email Log ───────────────────────────────────────────────────────────────

export async function getEmailLog(limit = 200): Promise<EmailLogRow[]> {
  const { data } = await db()
    .from("email_log")
    .select("*")
    .order("sent_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as EmailLogRow[];
}

// ─── Newsletter CRUD ─────────────────────────────────────────────────────────

export async function getNewsletters(): Promise<NewsletterContent[]> {
  const { data } = await db()
    .from("newsletter_content")
    .select("*")
    .order("year", { ascending: false })
    .order("month", { ascending: false });
  return (data ?? []) as NewsletterContent[];
}

export async function upsertNewsletter(
  content: Omit<NewsletterContent, "id" | "created_at" | "updated_at">
): Promise<NewsletterContent> {
  const { data, error } = await db()
    .from("newsletter_content")
    .upsert(
      { ...content, updated_at: new Date().toISOString() },
      { onConflict: "month,year" }
    )
    .select()
    .single();
  if (error) throw error;
  return data as NewsletterContent;
}

export async function updateNewsletter(
  id: string,
  updates: Partial<NewsletterContent>
): Promise<NewsletterContent> {
  const { data, error } = await db()
    .from("newsletter_content")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as NewsletterContent;
}

export async function deleteNewsletter(id: string): Promise<void> {
  const { error } = await db()
    .from("newsletter_content")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

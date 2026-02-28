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
  EmailEngagementStats,
  EmailFunnelData,
  EmailScheduleDay,
  EmailDayDetail,
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

// ─── Engagement Stats (from SendGrid webhook events) ─────────────────────────

export async function getEmailEngagementStats(): Promise<EmailEngagementStats> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const from = thirtyDaysAgo.toISOString();

  const [
    { count: totalDelivered },
    { data: uniqueOpenRows },
    { data: uniqueClickRows },
    { count: totalBounces },
    { count: spamReports },
  ] = await Promise.all([
    db()
      .from("email_events")
      .select("*", { count: "exact", head: true })
      .eq("event", "delivered")
      .gte("timestamp", from),
    db()
      .from("email_events")
      .select("email")
      .eq("event", "open")
      .gte("timestamp", from),
    db()
      .from("email_events")
      .select("email")
      .eq("event", "click")
      .gte("timestamp", from),
    db()
      .from("email_events")
      .select("*", { count: "exact", head: true })
      .eq("event", "bounce")
      .gte("timestamp", from),
    db()
      .from("email_events")
      .select("*", { count: "exact", head: true })
      .eq("event", "spamreport")
      .gte("timestamp", from),
  ]);

  const delivered = totalDelivered ?? 0;
  const uniqueOpens = new Set((uniqueOpenRows ?? []).map((r: { email: string }) => r.email)).size;
  const uniqueClicks = new Set((uniqueClickRows ?? []).map((r: { email: string }) => r.email)).size;
  const bounces = totalBounces ?? 0;
  const spam = spamReports ?? 0;

  const openRate = delivered > 0 ? Math.round((uniqueOpens / delivered) * 100) : 0;
  const clickRate = delivered > 0 ? Math.round((uniqueClicks / delivered) * 100) : 0;

  return {
    totalDelivered: delivered,
    uniqueOpens,
    uniqueClicks,
    totalBounces: bounces,
    spamReports: spam,
    openRate,
    clickRate,
  };
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

// ─── Last Email by Type ──────────────────────────────────────────────────────

/** Map trigger slug → email_type prefix(es) used in email_log */
const TRIGGER_TYPE_PREFIXES: Record<string, string[]> = {
  "lifecycle-emails": ["lifecycle_no_onboarding", "lifecycle_no_first_project", "lifecycle_inactive", "lifecycle_trial_expiring", "lifecycle_trial_expired"],
  "bubble-reauth-emails": ["bubble_reauth"],
  "unverified-emails": ["unverified"],
  "newsletter-emails": ["newsletter"],
};

export async function getLastEmailByType(
  emailTypePrefix: string
): Promise<EmailLogRow | null> {
  // Find all prefixes for this trigger slug, or use as literal prefix
  const prefixes = TRIGGER_TYPE_PREFIXES[emailTypePrefix] ?? [emailTypePrefix];

  // Query with OR filter across all matching prefixes
  let query = db()
    .from("email_log")
    .select("*")
    .order("sent_at", { ascending: false })
    .limit(1);

  if (prefixes.length === 1) {
    query = query.ilike("email_type", `${prefixes[0]}%`);
  } else {
    // Build OR filter: email_type like 'prefix1%' or email_type like 'prefix2%' ...
    const orFilter = prefixes.map((p) => `email_type.ilike.${p}%`).join(",");
    query = query.or(orFilter);
  }

  const { data } = await query;
  return (data?.[0] as EmailLogRow) ?? null;
}

// ─── Schedule Data ───────────────────────────────────────────────────────────

/** Bucket an email_type into a display segment */
function emailTypeToSegment(emailType: string): string {
  if (emailType.startsWith("lifecycle_") || emailType.startsWith("lifecycle-")) return "lifecycle";
  if (emailType.startsWith("bubble_reauth") || emailType.startsWith("bubble-reauth")) return "bubble";
  if (emailType.startsWith("unverified")) return "unverified";
  if (emailType.startsWith("newsletter")) return "newsletter";
  return "other";
}

export async function getEmailScheduleData(
  year: number,
  month: number
): Promise<EmailScheduleDay[]> {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 1); // first day of next month

  const { data } = await db()
    .from("email_log")
    .select("email_type, sent_at")
    .gte("sent_at", startDate.toISOString())
    .lt("sent_at", endDate.toISOString());

  // Group by date + segment
  const dayMap: Record<string, Record<string, number>> = {};

  for (const row of (data ?? []) as { email_type: string; sent_at: string }[]) {
    const date = row.sent_at.slice(0, 10); // YYYY-MM-DD
    const segment = emailTypeToSegment(row.email_type);
    if (!dayMap[date]) dayMap[date] = {};
    dayMap[date][segment] = (dayMap[date][segment] ?? 0) + 1;
  }

  return Object.entries(dayMap).map(([date, counts]) => ({
    date,
    counts,
    total: Object.values(counts).reduce((s, n) => s + n, 0),
  }));
}

export async function getEmailsByDate(date: string): Promise<EmailDayDetail[]> {
  const start = `${date}T00:00:00.000Z`;
  const end = `${date}T23:59:59.999Z`;

  const { data } = await db()
    .from("email_log")
    .select("recipient_email, email_type, subject, status, sent_at")
    .gte("sent_at", start)
    .lte("sent_at", end)
    .order("sent_at", { ascending: false })
    .limit(500);

  return (data ?? []) as EmailDayDetail[];
}

/**
 * Admin queries for onboarding analytics.
 * Reads from the `onboarding_events` table populated by try-ops.
 */
import { getAdminSupabase } from "@/lib/supabase/admin-client";

const db = () => getAdminSupabase();

// ── Types ──────────────────────────────────────────────────────────

export interface OnboardingFunnelData {
  variant: string;
  tutorialStarts: number;
  tutorialCompletes: number;
  signupStarts: number;
  signupCompletes: number;
  downloads: number;
}

export interface TriageBreakdown {
  decision: string;
  count: number;
}

export interface DailyOnboardingEvent {
  date: string;
  signups: number;
  completions: number;
  downloads: number;
}

export interface OnboardingOverview {
  totalEvents: number;
  totalSignups: number;
  totalTutorialCompletes: number;
  totalDownloads: number;
  variantWinner: string | null;
  variantWinnerRate: number;
}

// ── Queries ────────────────────────────────────────────────────────

export async function getOnboardingFunnel(days: number = 30): Promise<OnboardingFunnelData[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db()
    .from("onboarding_events")
    .select("event_type, variant")
    .gte("created_at", since);

  if (error || !data) return [];

  const variants = ["a", "b", "c"];
  return variants.map((v) => {
    const ve = data.filter((e) => e.variant === v);
    return {
      variant: v,
      tutorialStarts: ve.filter((e) =>
        ["tutorial_phase_complete", "tutorial_step_complete", "tutorial_complete"].includes(e.event_type)
      ).length,
      tutorialCompletes: ve.filter((e) => e.event_type === "tutorial_complete").length,
      signupStarts: ve.filter((e) => e.event_type === "signup_auth_attempt").length,
      signupCompletes: ve.filter((e) => e.event_type === "signup_complete").length,
      downloads: ve.filter((e) => e.event_type === "app_download_click").length,
    };
  });
}

export async function getTriageBreakdown(days: number = 30): Promise<TriageBreakdown[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db()
    .from("onboarding_events")
    .select("decision")
    .eq("event_type", "triage_decision")
    .gte("created_at", since)
    .not("decision", "is", null);

  if (error || !data) return [];

  const counts: Record<string, number> = {};
  data.forEach((e) => {
    const d = e.decision as string;
    counts[d] = (counts[d] || 0) + 1;
  });

  return Object.entries(counts)
    .map(([decision, count]) => ({ decision, count }))
    .sort((a, b) => b.count - a.count);
}

export async function getDailyOnboardingStats(days: number = 30): Promise<DailyOnboardingEvent[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db()
    .from("onboarding_events")
    .select("event_type, created_at")
    .gte("created_at", since)
    .in("event_type", ["signup_complete", "tutorial_complete", "app_download_click"])
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  const dailyMap: Record<string, { signups: number; completions: number; downloads: number }> = {};

  data.forEach((e) => {
    const date = new Date(e.created_at).toISOString().split("T")[0];
    if (!dailyMap[date]) dailyMap[date] = { signups: 0, completions: 0, downloads: 0 };

    if (e.event_type === "signup_complete") dailyMap[date].signups++;
    else if (e.event_type === "tutorial_complete") dailyMap[date].completions++;
    else if (e.event_type === "app_download_click") dailyMap[date].downloads++;
  });

  return Object.entries(dailyMap).map(([date, stats]) => ({ date, ...stats }));
}

export async function getOnboardingOverview(days: number = 30): Promise<OnboardingOverview> {
  const funnel = await getOnboardingFunnel(days);

  const totalSignups = funnel.reduce((s, v) => s + v.signupCompletes, 0);
  const totalTutorialCompletes = funnel.reduce((s, v) => s + v.tutorialCompletes, 0);
  const totalDownloads = funnel.reduce((s, v) => s + v.downloads, 0);
  const totalEvents = funnel.reduce(
    (s, v) => s + v.tutorialStarts + v.tutorialCompletes + v.signupStarts + v.signupCompletes + v.downloads,
    0
  );

  // Determine variant winner by signup completion rate
  let variantWinner: string | null = null;
  let variantWinnerRate = 0;
  for (const v of funnel) {
    const rate = v.tutorialStarts > 0 ? v.signupCompletes / v.tutorialStarts : 0;
    if (rate > variantWinnerRate) {
      variantWinnerRate = rate;
      variantWinner = v.variant;
    }
  }

  return {
    totalEvents,
    totalSignups,
    totalTutorialCompletes,
    totalDownloads,
    variantWinner,
    variantWinnerRate: Math.round(variantWinnerRate * 100),
  };
}

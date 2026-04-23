# Google Ads Intelligence Briefing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a weekly AI-powered Google Ads intelligence agent that generates actionable briefings with ad suggestions, competitor research, and market sentiment analysis.

**Architecture:** Cron-triggered pipeline (5 steps: ads data → competitor search → sentiment scan → AI generation → store/email) stored in Supabase `ad_briefings` table, displayed as a mission-briefing UI in the admin panel. Manual trigger via admin API route. Tavily for web search, OpenAI for structured AI output.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (service role), OpenAI (gpt-4o, structured output), Tavily (web search), SendGrid (email), Recharts (sparklines), Framer Motion (animations), Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-23-google-ads-intelligence-briefing-design.md`

**Design System:** `C:\OPS\.interface-design\system.md` — dark theme, #0D0D0D bg, Mohave/Kosugi fonts, borders-only, EASE_SMOOTH animations

---

## File Structure

### New Files (19)

| File | Responsibility |
|------|---------------|
| `src/lib/admin/briefing-types.ts` | Zod schemas + TypeScript interfaces for all briefing data |
| `src/lib/admin/briefing-queries.ts` | Supabase CRUD for `ad_briefings` table |
| `src/lib/admin/briefing-agent.ts` | 5-step pipeline orchestrator |
| `src/lib/admin/briefing-steps/pull-ads-data.ts` | Step 1: Google Ads performance + prior period |
| `src/lib/admin/briefing-steps/competitor-research.ts` | Step 2: Tavily web search for competitor ads |
| `src/lib/admin/briefing-steps/market-sentiment.ts` | Step 3: Tavily web search for Reddit/forum sentiment |
| `src/lib/admin/briefing-steps/ai-analysis.ts` | Step 4: OpenAI structured output generation |
| `src/lib/admin/briefing-steps/deliver.ts` | Step 5: Store in Supabase + send email |
| `src/lib/email/templates/ads-briefing.ts` | HTML email template |
| `src/app/api/cron/ads-briefing/route.ts` | Cron trigger (CRON_SECRET auth) |
| `src/app/api/admin/google-ads/briefing/generate/route.ts` | Manual trigger (withAdmin auth) |
| `src/app/api/admin/google-ads/briefing/[id]/route.ts` | GET briefing by ID (polling) |
| `src/app/admin/google-ads/briefings/page.tsx` | Briefing archive list |
| `src/app/admin/google-ads/briefings/[id]/page.tsx` | Briefing detail page |
| `src/app/admin/google-ads/briefings/_components/briefing-hero.tsx` | Latest briefing summary for main page |
| `src/app/admin/google-ads/briefings/_components/action-items.tsx` | Ranked action item list |
| `src/app/admin/google-ads/briefings/_components/ad-preview.tsx` | Google Ad mockup + keyword recs |
| `src/app/admin/google-ads/briefings/_components/ab-comparison.tsx` | Side-by-side A/B test proposal |
| `src/app/admin/google-ads/briefings/_components/generation-progress.tsx` | Real-time step progress |

### Modified Files (7)

| File | Change |
|------|--------|
| `src/lib/analytics/google-ads-client.ts` | Add `getMetricsForDateRange()` for prior-period queries |
| `src/lib/admin/admin-queries.ts` | Add `getAdminEmails()` function |
| `src/app/admin/google-ads/page.tsx` | Add briefing hero section above data tables |
| `src/lib/email/sendgrid.ts` | Add `sendAdsBriefing()` export |
| `vercel.json` | Add cron entry |
| `package.json` | Add `tavily` dependency |
| `.env.example` | Add `TAVILY_API_KEY` |

---

## Task 1: Install Tavily + env var

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Install tavily**

```bash
cd /c/OPS/ops-web && npm install @tavily/core zod-to-json-schema
```

- [ ] **Step 2: Add env var to .env.example**

Add after the Google Ads env vars:

```
# --- Tavily (web search for AI agent) ---
TAVILY_API_KEY=                                       # [V] free tier at tavily.com
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add tavily web search dependency"
```

---

## Task 2: Briefing type definitions

**Files:**
- Create: `src/lib/admin/briefing-types.ts`

- [ ] **Step 1: Create type definitions with Zod schemas**

Create `src/lib/admin/briefing-types.ts` with all interfaces from the spec: `CompetitorSnapshot`, `SentimentTheme`, `PerformanceSnapshot`, `BriefingInsight`, `AdSuggestion`, `KeywordRec`, `ABTestProposal`, `ActionItem`, `AdBriefing`, `BriefingProgress`. Include Zod schemas for OpenAI structured output validation (`briefingOutputSchema`). Also include the JSON Schema equivalent for OpenAI's `response_format` parameter.

Key types (see spec Section 3 for full definitions):

```typescript
import { z } from "zod";

// --- Competitor Research ---
export interface CompetitorSnapshot {
  name: string;
  adCopy: { headline: string; description: string }[];
  offers: string[];
  landingPageAngle: string;
  weaknesses: string[];
}

// --- Market Sentiment ---
export interface SentimentTheme {
  theme: string;
  sentiment: "positive" | "negative" | "neutral";
  sources: string[];
  quotes: string[];
  opportunity: string;
}

// --- Performance (with prior-period comparison) ---
export interface PerformanceSnapshot {
  current: MetricSet;
  prior: MetricSet;
  deltas: MetricSet; // percentage change
  topCampaign: { name: string; conversions: number; cpa: number };
  worstCampaign: { name: string; spend: number; conversions: number; cpa: number };
  dailySpend: { date: string; spend: number }[];
}

interface MetricSet {
  spend: number; cpa: number; ctr: number;
  clicks: number; impressions: number; conversions: number;
}

// --- AI Output Types ---
export interface BriefingInsight {
  category: "cost" | "keywords" | "creative" | "competitive" | "market";
  severity: "high" | "medium" | "low";
  title: string;
  explanation: string;
  recommendation: string;
  impactScore: number;
}

export interface AdSuggestion {
  type: "headline" | "description" | "sitelink";
  text: string;
  rationale: string;
  basedOn: "competitor_gap" | "sentiment_insight" | "performance_data";
}

export interface KeywordRec {
  keyword: string;
  matchType: "exact" | "phrase" | "broad";
  action: "add" | "negative";
  rationale: string;
  estimatedImpact: string;
}

export interface ABTestProposal {
  name: string;
  currentAd: { headline: string; description: string };
  proposedAd: { headline: string; description: string };
  hypothesis: string;
  metricToWatch: string;
  confidence: "high" | "medium";
}

export interface ActionItem {
  priority: "high" | "medium" | "low";
  action: string;
  expectedImpact: string;
  category: "keywords" | "bidding" | "creative" | "targeting";
  effort: "5min" | "30min" | "1hr";
}

// --- Progress tracking ---
export interface BriefingProgress {
  step: number;
  total: number;
  label: string;
  completedSteps: string[];
}

// --- Full briefing row ---
export interface AdBriefing {
  id: string;
  created_at: string;
  period_start: string;
  period_end: string;
  status: "generating" | "complete" | "failed";
  progress: BriefingProgress | null;
  summary: string | null;
  performance_data: PerformanceSnapshot | null;
  competitor_intel: CompetitorSnapshot[];
  market_sentiment: SentimentTheme[];
  insights: BriefingInsight[];
  ad_suggestions: AdSuggestion[];
  keyword_recs: KeywordRec[];
  ab_test_proposals: ABTestProposal[];
  action_items: ActionItem[];
  email_sent: boolean;
  triggered_by: "cron" | "manual";
  error: string | null;
}

// --- Zod schema for OpenAI structured output (Step 4) ---
export const briefingOutputSchema = z.object({
  summary: z.string(),
  insights: z.array(z.object({
    category: z.enum(["cost", "keywords", "creative", "competitive", "market"]),
    severity: z.enum(["high", "medium", "low"]),
    title: z.string(),
    explanation: z.string(),
    recommendation: z.string(),
    impactScore: z.number().min(1).max(10),
  })),
  adSuggestions: z.array(z.object({
    type: z.enum(["headline", "description", "sitelink"]),
    text: z.string(),
    rationale: z.string(),
    basedOn: z.enum(["competitor_gap", "sentiment_insight", "performance_data"]),
  })),
  keywordRecs: z.array(z.object({
    keyword: z.string(),
    matchType: z.enum(["exact", "phrase", "broad"]),
    action: z.enum(["add", "negative"]),
    rationale: z.string(),
    estimatedImpact: z.string(),
  })),
  abTestProposals: z.array(z.object({
    name: z.string(),
    currentAd: z.object({ headline: z.string(), description: z.string() }),
    proposedAd: z.object({ headline: z.string(), description: z.string() }),
    hypothesis: z.string(),
    metricToWatch: z.string(),
    confidence: z.enum(["high", "medium"]),
  })),
  actionItems: z.array(z.object({
    priority: z.enum(["high", "medium", "low"]),
    action: z.string(),
    expectedImpact: z.string(),
    category: z.enum(["keywords", "bidding", "creative", "targeting"]),
    effort: z.enum(["5min", "30min", "1hr"]),
  })),
  competitorIntel: z.array(z.object({
    name: z.string(),
    adCopy: z.array(z.object({ headline: z.string(), description: z.string() })),
    offers: z.array(z.string()),
    landingPageAngle: z.string(),
    weaknesses: z.array(z.string()),
  })),
  marketSentiment: z.array(z.object({
    theme: z.string(),
    sentiment: z.enum(["positive", "negative", "neutral"]),
    sources: z.array(z.string()),
    quotes: z.array(z.string()),
    opportunity: z.string(),
  })),
});

export type BriefingOutput = z.infer<typeof briefingOutputSchema>;
```

- [ ] **Step 2: Verify types compile**

```bash
cd /c/OPS/ops-web && npx tsc --noEmit 2>&1 | grep "briefing-types"
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/admin/briefing-types.ts
git commit -m "feat(briefing): add type definitions and Zod schemas"
```

---

## Task 3: Add prior-period query to Google Ads client

**Files:**
- Modify: `src/lib/analytics/google-ads-client.ts`

- [ ] **Step 1: Add getMetricsForDateRange function**

Add to `src/lib/analytics/google-ads-client.ts` — a new exported function that queries Google Ads with explicit date filters instead of `DURING` literals. This is needed for prior-period comparison (the 7 days before the current 7 days).

```typescript
// Add after the existing getDailySpend function, before the cached exports section:

/** Format a Date to YYYY-MM-DD for GAQL queries */
function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * Get account summary for an explicit date range (not DURING literal).
 * Used for prior-period comparison in briefings.
 */
export async function getAccountSummaryForRange(
  startDate: Date,
  endDate: Date
): Promise<GoogleAdsAccountSummary> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  const rows = await queryGoogleAds(`
    SELECT
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.cost_per_conversion,
      metrics.ctr
    FROM customer
    WHERE segments.date >= '${start}' AND segments.date <= '${end}'
  `);

  if (!rows.length) {
    return { totalSpend: 0, totalClicks: 0, totalImpressions: 0, totalConversions: 0, avgCpa: 0, avgCtr: 0 };
  }

  const row = rows[0];
  return {
    totalSpend: microsToDollars(row.metrics?.costMicros),
    totalClicks: Number(row.metrics?.clicks ?? 0),
    totalImpressions: Number(row.metrics?.impressions ?? 0),
    totalConversions: Number(row.metrics?.conversions ?? 0),
    avgCpa: microsToDollars(row.metrics?.costPerConversion),
    avgCtr: Number(row.metrics?.ctr ?? 0),
  };
}

/**
 * Get campaign performance for an explicit date range.
 */
export async function getCampaignPerformanceForRange(
  startDate: Date,
  endDate: Date
): Promise<CampaignPerformance[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  const rows = await queryGoogleAds(`
    SELECT
      campaign.name,
      campaign.status,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.cost_micros,
      metrics.conversions,
      metrics.cost_per_conversion
    FROM campaign
    WHERE segments.date >= '${start}' AND segments.date <= '${end}'
      AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `);

  return rows.map((row) => ({
    name: String(row.campaign?.name ?? "Unknown"),
    status: (row.campaign?.status ?? "ENABLED") as CampaignPerformance["status"],
    impressions: Number(row.metrics?.impressions ?? 0),
    clicks: Number(row.metrics?.clicks ?? 0),
    ctr: Number(row.metrics?.ctr ?? 0),
    cost: microsToDollars(row.metrics?.costMicros),
    conversions: Number(row.metrics?.conversions ?? 0),
    cpa: microsToDollars(row.metrics?.costPerConversion),
  }));
}

/**
 * Get daily spend for an explicit date range.
 */
export async function getDailySpendForRange(
  startDate: Date,
  endDate: Date
): Promise<DailySpend[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  const rows = await queryGoogleAds(`
    SELECT
      segments.date,
      metrics.cost_micros,
      metrics.clicks,
      metrics.conversions
    FROM customer
    WHERE segments.date >= '${start}' AND segments.date <= '${end}'
    ORDER BY segments.date ASC
  `);

  return rows.map((row) => ({
    date: String(row.segments?.date ?? ""),
    spend: microsToDollars(row.metrics?.costMicros),
    clicks: Number(row.metrics?.clicks ?? 0),
    conversions: Number(row.metrics?.conversions ?? 0),
  }));
}
```

- [ ] **Step 2: Verify build**

```bash
cd /c/OPS/ops-web && npx tsc --noEmit 2>&1 | grep "google-ads-client"
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/analytics/google-ads-client.ts
git commit -m "feat(briefing): add date-range Google Ads queries for prior-period comparison"
```

---

## Task 4: Add getAdminEmails to admin-queries

**Files:**
- Modify: `src/lib/admin/admin-queries.ts`

- [ ] **Step 1: Add getAdminEmails function**

Add to `src/lib/admin/admin-queries.ts` after the existing `isAdminEmail` function:

```typescript
/** Get all admin email addresses (for briefing email delivery). */
export async function getAdminEmails(): Promise<string[]> {
  const { data } = await db()
    .from("admins")
    .select("email");
  return (data ?? []).map((row) => row.email).filter(Boolean);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/admin/admin-queries.ts
git commit -m "feat(briefing): add getAdminEmails query for email delivery"
```

---

## Task 5: Briefing Supabase queries (CRUD)

**Files:**
- Create: `src/lib/admin/briefing-queries.ts`

- [ ] **Step 1: Create briefing CRUD**

Create `src/lib/admin/briefing-queries.ts`:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/admin/briefing-queries.ts
git commit -m "feat(briefing): add Supabase CRUD for ad_briefings"
```

---

## Task 6: Pipeline Step 1 — Pull Ads Data

**Files:**
- Create: `src/lib/admin/briefing-steps/pull-ads-data.ts`

- [ ] **Step 1: Create Step 1 module**

This step pulls current 7-day and prior 7-day Google Ads data, computes deltas, and identifies top/worst campaigns.

```typescript
/**
 * Briefing Step 1: Pull Google Ads performance data.
 * Current 7 days + prior 7 days for comparison.
 */
import {
  getAccountSummaryForRange,
  getCampaignPerformanceForRange,
  getDailySpendForRange,
} from "@/lib/analytics/google-ads-client";
import type { PerformanceSnapshot } from "../briefing-types";

export async function pullAdsData(): Promise<PerformanceSnapshot> {
  const now = new Date();
  const currentEnd = new Date(now);
  currentEnd.setDate(currentEnd.getDate() - 1); // yesterday
  const currentStart = new Date(currentEnd);
  currentStart.setDate(currentStart.getDate() - 6); // 7 days

  const priorEnd = new Date(currentStart);
  priorEnd.setDate(priorEnd.getDate() - 1); // day before current period
  const priorStart = new Date(priorEnd);
  priorStart.setDate(priorStart.getDate() - 6); // 7 days

  const [current, prior, campaigns, dailySpend] = await Promise.all([
    getAccountSummaryForRange(currentStart, currentEnd),
    getAccountSummaryForRange(priorStart, priorEnd),
    getCampaignPerformanceForRange(currentStart, currentEnd),
    getDailySpendForRange(currentStart, currentEnd),
  ]);

  // Compute percentage deltas (negative = decrease)
  const delta = (curr: number, prev: number) =>
    prev === 0 ? (curr === 0 ? 0 : 1) : (curr - prev) / prev;

  const deltas = {
    spend: delta(current.totalSpend, prior.totalSpend),
    cpa: delta(current.avgCpa, prior.avgCpa),
    ctr: delta(current.avgCtr, prior.avgCtr),
    clicks: delta(current.totalClicks, prior.totalClicks),
    impressions: delta(current.totalImpressions, prior.totalImpressions),
    conversions: delta(current.totalConversions, prior.totalConversions),
  };

  // Find top campaign (most conversions) and worst (highest CPA with spend)
  const withSpend = campaigns.filter((c) => c.cost > 0);
  const topCampaign = [...withSpend].sort((a, b) => b.conversions - a.conversions)[0];
  const worstCampaign = [...withSpend].sort((a, b) => b.cpa - a.cpa)[0];

  return {
    current: {
      spend: current.totalSpend,
      cpa: current.avgCpa,
      ctr: current.avgCtr,
      clicks: current.totalClicks,
      impressions: current.totalImpressions,
      conversions: current.totalConversions,
    },
    prior: {
      spend: prior.totalSpend,
      cpa: prior.avgCpa,
      ctr: prior.avgCtr,
      clicks: prior.totalClicks,
      impressions: prior.totalImpressions,
      conversions: prior.totalConversions,
    },
    deltas,
    topCampaign: topCampaign
      ? { name: topCampaign.name, conversions: topCampaign.conversions, cpa: topCampaign.cpa }
      : { name: "N/A", conversions: 0, cpa: 0 },
    worstCampaign: worstCampaign
      ? { name: worstCampaign.name, spend: worstCampaign.cost, conversions: worstCampaign.conversions, cpa: worstCampaign.cpa }
      : { name: "N/A", spend: 0, conversions: 0, cpa: 0 },
    dailySpend: dailySpend.map((d) => ({ date: d.date, spend: d.spend })),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/admin/briefing-steps/pull-ads-data.ts
git commit -m "feat(briefing): add Step 1 — pull Google Ads performance data"
```

---

## Task 7: Pipeline Steps 2 & 3 — Competitor Research + Market Sentiment

**Files:**
- Create: `src/lib/admin/briefing-steps/competitor-research.ts`
- Create: `src/lib/admin/briefing-steps/market-sentiment.ts`

- [ ] **Step 1: Create competitor research module**

```typescript
/**
 * Briefing Step 2: Research competitor Google Ads.
 * Uses Tavily web search to find competitor ad copy, offers, and messaging.
 */
import { tavily } from "@tavily/core";
import type { CompetitorSnapshot } from "../briefing-types";

const SEARCH_QUERIES = [
  '"field service management software" Google Ads competitor ads 2026',
  "Jobber vs ServiceTitan vs Housecall Pro ads pricing offers",
  '"contractor scheduling app" Google Ads headlines descriptions',
  "field service software landing page value proposition comparison",
];

function getTavilyClient() {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("Missing TAVILY_API_KEY env var");
  return tavily({ apiKey });
}

/** Get raw competitor search content for Step 4's AI prompt. */
export async function getCompetitorSearchContent(): Promise<string> {
  const client = getTavilyClient();
  const results = await Promise.all(
    SEARCH_QUERIES.map((query) =>
      client.search(query, { maxResults: 5, searchDepth: "advanced", includeAnswer: true })
        .catch(() => ({ results: [], answer: "" }))
    )
  );

  const parts: string[] = [];
  for (const result of results) {
    if (result.answer) parts.push(`SUMMARY: ${result.answer}`);
    for (const item of result.results) {
      parts.push(`SOURCE: ${item.title}\n${item.content}`);
    }
  }
  return parts.join("\n\n---\n\n");
}
```

- [ ] **Step 2: Create market sentiment module**

```typescript
/**
 * Briefing Step 3: Scan market sentiment.
 * Uses Tavily to search Reddit, forums, and X for trade worker opinions.
 */
import { tavily } from "@tavily/core";

const SENTIMENT_QUERIES = [
  'site:reddit.com "field service software" OR "scheduling app" electrician plumber HVAC contractor',
  'site:reddit.com r/smallbusiness contractor software complaints OR recommendations 2026',
  '"field service management" software frustrating OR "switched to" OR "love using"',
  'trade contractor app scheduling invoicing pain points 2026',
];

function getTavilyClient() {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("Missing TAVILY_API_KEY env var");
  return tavily({ apiKey });
}

/** Get raw market sentiment content for Step 4's AI prompt. */
export async function getMarketSentimentContent(): Promise<string> {
  const client = getTavilyClient();
  const results = await Promise.all(
    SENTIMENT_QUERIES.map((query) =>
      client.search(query, { maxResults: 5, searchDepth: "advanced", includeAnswer: true })
        .catch(() => ({ results: [], answer: "" }))
    )
  );

  const parts: string[] = [];
  for (const result of results) {
    if (result.answer) parts.push(`SUMMARY: ${result.answer}`);
    for (const item of result.results) {
      parts.push(`SOURCE: ${item.title}\nURL: ${item.url}\n${item.content}`);
    }
  }
  return parts.join("\n\n---\n\n");
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/admin/briefing-steps/competitor-research.ts src/lib/admin/briefing-steps/market-sentiment.ts
git commit -m "feat(briefing): add Steps 2-3 — competitor research + market sentiment"
```

---

## Task 8: Pipeline Step 4 — AI Analysis

**Files:**
- Create: `src/lib/admin/briefing-steps/ai-analysis.ts`

- [ ] **Step 1: Create AI analysis module**

Uses OpenAI `gpt-4o` with JSON Schema structured output. Takes performance data + search content → produces the full briefing output.

```typescript
/**
 * Briefing Step 4: AI Analysis + Generation.
 * Feeds Steps 1-3 data to OpenAI gpt-4o with structured output.
 */
import OpenAI from "openai";
import { zodToJsonSchema } from "zod-to-json-schema";
import { briefingOutputSchema, type BriefingOutput, type PerformanceSnapshot } from "../briefing-types";

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  _client = new OpenAI({ apiKey });
  return _client;
}

const SYSTEM_PROMPT = `You are an expert PPC analyst and ad strategist for OPS, a field service management platform for trade workers (electricians, plumbers, HVAC technicians, contractors, roofers).

OPS helps trade businesses manage jobs, scheduling, invoicing, and crew coordination. Key differentiators:
- Built specifically for trade crews (not generic project management)
- No contracts, no setup fees
- Mobile-first for field use
- Simple pricing ($90-190/month)

Your job is to analyze Google Ads performance data, competitor intelligence, and market sentiment to produce an actionable weekly briefing. Be specific, quantitative, and direct. Every recommendation must be implementable.`;

export async function generateBriefingAnalysis(
  performanceData: PerformanceSnapshot,
  competitorContent: string,
  sentimentContent: string,
  isFirstBriefing: boolean
): Promise<BriefingOutput> {
  const client = getClient();
  const jsonSchema = zodToJsonSchema(briefingOutputSchema, "BriefingOutput");

  const userPrompt = `Analyze the following data and generate a comprehensive Google Ads intelligence briefing.

## PERFORMANCE DATA (Last 7 Days)
Spend: $${performanceData.current.spend.toFixed(2)} (${isFirstBriefing ? "first briefing, no comparison" : `${(performanceData.deltas.spend * 100).toFixed(1)}% vs prior week`})
CPA: $${performanceData.current.cpa.toFixed(2)} (${isFirstBriefing ? "no comparison" : `${(performanceData.deltas.cpa * 100).toFixed(1)}%`})
CTR: ${(performanceData.current.ctr * 100).toFixed(2)}% (${isFirstBriefing ? "no comparison" : `${(performanceData.deltas.ctr * 100).toFixed(1)}%`})
Clicks: ${performanceData.current.clicks} | Impressions: ${performanceData.current.impressions} | Conversions: ${performanceData.current.conversions}
Top Campaign: ${performanceData.topCampaign.name} (${performanceData.topCampaign.conversions} conv, $${performanceData.topCampaign.cpa.toFixed(2)} CPA)
Worst Campaign: ${performanceData.worstCampaign.name} ($${performanceData.worstCampaign.spend.toFixed(2)} spend, ${performanceData.worstCampaign.conversions} conv, $${performanceData.worstCampaign.cpa.toFixed(2)} CPA)

## COMPETITOR INTELLIGENCE
${competitorContent || "No competitor data available this week."}

## MARKET SENTIMENT (Reddit, Forums, X)
${sentimentContent || "No sentiment data available this week."}

## INSTRUCTIONS
Generate:
1. Executive summary (2-3 sentences, lead with the most impactful finding)
2. 5-8 insights scored 1-10 by impact
3. 5 headline suggestions (max 30 chars each) + 3 description suggestions (max 90 chars each)
4. Keyword recommendations (add + negative)
5. 2-3 A/B test proposals comparing realistic current ads vs proposed variants
6. Ranked action items with effort estimates
7. Structured competitor intel: for each competitor found (Jobber, ServiceTitan, Housecall Pro, etc.), extract their ad copy, offers, landing page angle, and weaknesses OPS can exploit
8. Structured market sentiment: extract 3-5 themes from the Reddit/forum data with sentiment, source attribution, direct quotes, and messaging opportunities

Be specific. Use actual numbers from the data. Reference specific competitors and sentiment quotes where relevant.`;

  const completion = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "BriefingOutput",
        schema: jsonSchema as Record<string, unknown>,
        strict: true,
      },
    },
    temperature: 0.7,
    max_tokens: 4096,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty response");

  const parsed = JSON.parse(content);
  return briefingOutputSchema.parse(parsed);
}
```

**Note:** `zod-to-json-schema` is a dependency of `zod` and is already available. If not, the implementation should check and install it. Alternatively, hand-write the JSON Schema.

- [ ] **Step 2: Verify zod-to-json-schema is available**

```bash
ls node_modules/zod-to-json-schema 2>/dev/null && echo "available" || echo "need to install"
```

If not available, install: `npm install zod-to-json-schema`

- [ ] **Step 3: Commit**

```bash
git add src/lib/admin/briefing-steps/ai-analysis.ts
git commit -m "feat(briefing): add Step 4 — OpenAI structured output analysis"
```

---

## Task 9: Pipeline Step 5 — Deliver (Store + Email)

**Files:**
- Create: `src/lib/admin/briefing-steps/deliver.ts`
- Create: `src/lib/email/templates/ads-briefing.ts`
- Modify: `src/lib/email/sendgrid.ts`

- [ ] **Step 1: Create email template**

Create `src/lib/email/templates/ads-briefing.ts` — dark-themed, terminal-readout style:

```typescript
/**
 * Google Ads Intelligence Briefing — Email Template
 * Dark theme, dense, scannable. Act on it or click through.
 */
import type { AdBriefing } from "@/lib/admin/briefing-types";

function formatDelta(value: number): string {
  const pct = (value * 100).toFixed(1);
  return value > 0 ? `↑${pct}%` : value < 0 ? `↓${Math.abs(Number(pct))}%` : "→ flat";
}

function priorityColor(p: string): string {
  return p === "high" ? "#93321A" : p === "medium" ? "#C4A868" : "#6B6B6B";
}

export function adsBriefingTemplate(briefing: AdBriefing): string {
  const perf = briefing.performance_data;
  const actions = briefing.action_items.slice(0, 3);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#0D0D0D;font-family:'Courier New',monospace;color:#E5E5E5;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;">

    <div style="border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:16px;margin-bottom:24px;">
      <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#6B6B6B;">
        OPS INTEL // GOOGLE ADS WEEKLY
      </span>
      <br/>
      <span style="font-size:12px;color:#6B6B6B;">
        ${briefing.period_start} — ${briefing.period_end}
      </span>
    </div>

    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:4px;padding:16px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;line-height:1.5;color:#E5E5E5;">
        ${briefing.summary ?? "Briefing summary unavailable."}
      </p>
    </div>

    <div style="margin-bottom:24px;">
      <p style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#6B6B6B;margin:0 0 12px 0;">
        THIS WEEK'S ACTIONS
      </p>
      ${actions.map((a, i) => `
        <div style="margin-bottom:8px;padding:8px 12px;border-left:2px solid ${priorityColor(a.priority)};">
          <span style="font-size:13px;color:#E5E5E5;">
            ${i + 1}. <span style="color:${priorityColor(a.priority)};text-transform:uppercase;font-size:11px;">[${a.priority}]</span>
            ${a.action}
          </span>
          <br/>
          <span style="font-size:11px;color:#6B6B6B;">${a.expectedImpact} · ${a.effort}</span>
        </div>
      `).join("")}
    </div>

    ${perf ? `
    <div style="margin-bottom:24px;">
      <p style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#6B6B6B;margin:0 0 12px 0;">
        KEY METRICS
      </p>
      <table style="width:100%;font-size:13px;border-collapse:collapse;">
        <tr>
          <td style="padding:4px 8px;color:#6B6B6B;">Spend</td>
          <td style="padding:4px 8px;color:#E5E5E5;">$${perf.current.spend.toFixed(0)}</td>
          <td style="padding:4px 8px;color:#A0A0A0;">${formatDelta(perf.deltas.spend)}</td>
        </tr>
        <tr>
          <td style="padding:4px 8px;color:#6B6B6B;">CPA</td>
          <td style="padding:4px 8px;color:#E5E5E5;">$${perf.current.cpa.toFixed(2)}</td>
          <td style="padding:4px 8px;color:#A0A0A0;">${formatDelta(perf.deltas.cpa)}</td>
        </tr>
        <tr>
          <td style="padding:4px 8px;color:#6B6B6B;">Conv.</td>
          <td style="padding:4px 8px;color:#E5E5E5;">${perf.current.conversions}</td>
          <td style="padding:4px 8px;color:#A0A0A0;">${formatDelta(perf.deltas.conversions)}</td>
        </tr>
      </table>
    </div>
    ` : ""}

    <div style="text-align:center;margin-top:32px;">
      <a href="${appUrl}/admin/google-ads/briefings/${briefing.id}"
         style="display:inline-block;padding:10px 24px;background:#6F94B0;color:#E5E5E5;text-decoration:none;font-size:13px;border-radius:4px;text-transform:uppercase;letter-spacing:0.05em;">
        View Full Briefing
      </a>
    </div>

    <div style="margin-top:32px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
      <span style="font-size:10px;color:#444444;">OPS LTD · Automated Intelligence Briefing</span>
    </div>

  </div>
</body>
</html>`;
}
```

- [ ] **Step 2: Add sendAdsBriefing to sendgrid.ts**

Add to `src/lib/email/sendgrid.ts`:

```typescript
import { adsBriefingTemplate } from "./templates/ads-briefing";
import type { AdBriefing } from "@/lib/admin/briefing-types";

export async function sendAdsBriefing(params: {
  recipientEmails: string[];
  briefing: AdBriefing;
}): Promise<void> {
  ensureInitialized();
  const html = adsBriefingTemplate(params.briefing);
  const subject = `[OPS Intel] Google Ads Weekly — ${params.briefing.period_start} to ${params.briefing.period_end}`;

  await Promise.all(
    params.recipientEmails.map((email) =>
      sgMail.send({
        to: email,
        from: getFromEmail(),
        subject,
        html,
      })
    )
  );
}
```

- [ ] **Step 3: Create deliver step**

Create `src/lib/admin/briefing-steps/deliver.ts`:

```typescript
/**
 * Briefing Step 5: Store results + send email.
 */
import { completeBriefing, markEmailSent } from "../briefing-queries";
import { getAdminEmails } from "../admin-queries";
import { sendAdsBriefing } from "@/lib/email/sendgrid";
import { getBriefingById } from "../briefing-queries";
import type {
  PerformanceSnapshot,
  CompetitorSnapshot,
  SentimentTheme,
  BriefingOutput,
} from "../briefing-types";

export async function deliverBriefing(
  briefingId: string,
  performanceData: PerformanceSnapshot,
  competitorIntel: CompetitorSnapshot[],
  marketSentiment: SentimentTheme[],
  aiOutput: BriefingOutput
): Promise<void> {
  // Store in Supabase
  await completeBriefing(briefingId, {
    summary: aiOutput.summary,
    performance_data: performanceData,
    competitor_intel: competitorIntel,
    market_sentiment: marketSentiment,
    insights: aiOutput.insights,
    ad_suggestions: aiOutput.adSuggestions,
    keyword_recs: aiOutput.keywordRecs,
    ab_test_proposals: aiOutput.abTestProposals,
    action_items: aiOutput.actionItems,
  });

  // Send email
  try {
    const adminEmails = await getAdminEmails();
    if (adminEmails.length > 0) {
      const briefing = await getBriefingById(briefingId);
      if (briefing) {
        await sendAdsBriefing({ recipientEmails: adminEmails, briefing });
        await markEmailSent(briefingId);
      }
    }
  } catch (err) {
    // Email failure should not fail the briefing
    console.error("[ads-briefing] Email delivery failed:", err);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/admin/briefing-steps/deliver.ts src/lib/email/templates/ads-briefing.ts src/lib/email/sendgrid.ts
git commit -m "feat(briefing): add Step 5 — store results + send email"
```

---

## Task 10: Pipeline Orchestrator

**Files:**
- Create: `src/lib/admin/briefing-agent.ts`

- [ ] **Step 1: Create the orchestrator**

This ties all 5 steps together with progress tracking and error handling.

```typescript
/**
 * OPS Admin — Google Ads Intelligence Briefing Agent
 *
 * 5-step pipeline:
 * 1. Pull Google Ads performance data
 * 2. Research competitor ads (Tavily)
 * 3. Scan market sentiment (Tavily)
 * 4. AI analysis + generation (OpenAI)
 * 5. Store in Supabase + send email
 */
import {
  createBriefing,
  getActiveBriefing,
  updateBriefingProgress,
  failBriefing,
  getLatestBriefing,
} from "./briefing-queries";
import { pullAdsData } from "./briefing-steps/pull-ads-data";
import { getCompetitorSearchContent } from "./briefing-steps/competitor-research";
import { getMarketSentimentContent } from "./briefing-steps/market-sentiment";
import { generateBriefingAnalysis } from "./briefing-steps/ai-analysis";
import { deliverBriefing } from "./briefing-steps/deliver";
import type { BriefingProgress } from "./briefing-types";

async function updateProgress(
  briefingId: string,
  step: number,
  label: string,
  completedSteps: string[]
): Promise<void> {
  const progress: BriefingProgress = { step, total: 5, label, completedSteps };
  await updateBriefingProgress(briefingId, progress);
}

/**
 * Run the full briefing pipeline. Returns the briefing ID.
 * If a briefing is already generating, returns that ID (idempotency).
 */
export async function generateBriefing(
  triggeredBy: "cron" | "manual"
): Promise<string> {
  // Idempotency guard
  const active = await getActiveBriefing();
  if (active) return active;

  const briefingId = await createBriefing(triggeredBy);
  const completed: string[] = [];

  try {
    // Step 1: Pull ads data
    await updateProgress(briefingId, 1, "Pulling ad performance data...", completed);
    const performanceData = await pullAdsData();
    completed.push("Ad performance data pulled");

    // Step 2: Competitor research
    await updateProgress(briefingId, 2, "Researching competitor ads...", completed);
    const competitorContent = await getCompetitorSearchContent();
    completed.push("Competitor research complete");

    // Step 3: Market sentiment
    await updateProgress(briefingId, 3, "Scanning market sentiment...", completed);
    const sentimentContent = await getMarketSentimentContent();
    completed.push("Market sentiment scanned");

    // Step 4: AI analysis
    await updateProgress(briefingId, 4, "Generating insights and recommendations...", completed);
    const isFirstBriefing = (await getLatestBriefing()) === null;
    const aiOutput = await generateBriefingAnalysis(
      performanceData,
      competitorContent,
      sentimentContent,
      isFirstBriefing
    );
    completed.push("AI analysis complete");

    // Step 5: Store + email
    await updateProgress(briefingId, 5, "Delivering briefing...", completed);
    await deliverBriefing(
      briefingId,
      performanceData,
      aiOutput.competitorIntel,  // AI extracts structured competitor data from raw search content
      aiOutput.marketSentiment,  // AI extracts structured sentiment themes from raw search content
      aiOutput
    );
    completed.push("Briefing delivered");

    return briefingId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failBriefing(briefingId, message);
    throw err;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/admin/briefing-agent.ts
git commit -m "feat(briefing): add pipeline orchestrator (5-step agent)"
```

---

## Task 11: API Routes (cron + manual + polling)

**Files:**
- Create: `src/app/api/cron/ads-briefing/route.ts`
- Create: `src/app/api/admin/google-ads/briefing/generate/route.ts`
- Create: `src/app/api/admin/google-ads/briefing/[id]/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Create cron route**

Create `src/app/api/cron/ads-briefing/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { generateBriefing } from "@/lib/admin/briefing-agent";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const id = await generateBriefing("cron");
    return NextResponse.json({ id, status: "started" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Create manual trigger route**

Create `src/app/api/admin/google-ads/briefing/generate/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/api-auth";
import { generateBriefing } from "@/lib/admin/briefing-agent";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (err) {
    if (err instanceof NextResponse) return err;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const id = await generateBriefing("manual");
    return NextResponse.json({ id, status: "started" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Create polling route**

Create `src/app/api/admin/google-ads/briefing/[id]/route.ts`. Note: cannot use `withAdmin` wrapper here because it does not pass through the `params` argument. Use `requireAdmin` inline instead (matching `src/app/api/admin/app-messages/[id]/route.ts` pattern):

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/api-auth";
import { getBriefingById } from "@/lib/admin/briefing-queries";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
  } catch (err) {
    if (err instanceof NextResponse) return err;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const briefing = await getBriefingById(id);
  if (!briefing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(briefing);
}
```

- [ ] **Step 4: Add cron entry to vercel.json**

Add to the existing `crons` array in `vercel.json`:

```json
{
  "path": "/api/cron/ads-briefing",
  "schedule": "0 12 * * 1"
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/ads-briefing/route.ts src/app/api/admin/google-ads/briefing/ vercel.json
git commit -m "feat(briefing): add API routes — cron, manual trigger, polling"
```

---

## Task 12: UI — Generation Progress Component

**Files:**
- Create: `src/app/admin/google-ads/briefings/_components/generation-progress.tsx`

- [ ] **Step 1: Create generation progress component**

Client component that polls for status and shows step-by-step progress.

```typescript
"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { BriefingProgress } from "@/lib/admin/briefing-types";

interface GenerationProgressProps {
  onComplete: () => void;
}

const STEPS = [
  "Pulling ad performance data",
  "Researching competitor ads",
  "Scanning market sentiment",
  "Generating insights and recommendations",
  "Delivering briefing",
];

export function GenerationProgress({ onComplete }: GenerationProgressProps) {
  const [briefingId, setBriefingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<BriefingProgress | null>(null);
  const [status, setStatus] = useState<"idle" | "generating" | "complete" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback((id: string) => {
    startTimeRef.current = Date.now();

    const poll = async () => {
      try {
        const res = await fetch(`/api/admin/google-ads/briefing/${id}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === "complete") {
          setStatus("complete");
          setProgress(null);
          onComplete();
          return; // stop polling
        } else if (data.status === "failed") {
          setStatus("failed");
          setError(data.error);
          return; // stop polling
        } else if (data.progress) {
          setProgress(data.progress);
        }
      } catch { /* silent */ }

      // Schedule next poll — back off from 3s to 5s after 30 seconds
      const delay = Date.now() - startTimeRef.current > 30000 ? 5000 : 3000;
      pollRef.current = setTimeout(poll, delay);
    };

    poll(); // immediate first call
  }, [onComplete]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleGenerate = useCallback(async () => {
    setStatus("generating");
    setError(null);
    try {
      const res = await fetch("/api/admin/google-ads/briefing/generate", { method: "POST" });
      if (!res.ok) throw new Error("Failed to start briefing");
      const { id } = await res.json();
      setBriefingId(id);
      startPolling(id);
    } catch (err) {
      setStatus("failed");
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [startPolling]);

  if (status === "idle") {
    return (
      <button
        onClick={handleGenerate}
        className="font-mohave text-[13px] uppercase tracking-wider px-4 py-2 border border-[#6F94B0] text-[#6F94B0] rounded hover:bg-[#6F94B0]/10 transition-colors"
      >
        Generate Briefing Now
      </button>
    );
  }

  return (
    <div className="space-y-2">
      {STEPS.map((label, i) => {
        const stepNum = i + 1;
        const isDone = progress ? stepNum < progress.step : status === "complete";
        const isActive = progress?.step === stepNum;

        return (
          <div key={i} className="flex items-center gap-3 font-mohave text-[13px]">
            <span className={isDone ? "text-[#9DB582]" : isActive ? "text-[#6F94B0]" : "text-[#444444]"}>
              {isDone ? "✓" : isActive ? "●" : "○"}
            </span>
            <span className={isDone ? "text-[#6B6B6B]" : isActive ? "text-[#E5E5E5]" : "text-[#444444]"}>
              Step {stepNum}/5: {label}
            </span>
          </div>
        );
      })}

      {status === "failed" && error && (
        <div className="mt-3 p-3 border border-[#93321A]/30 rounded bg-[#93321A]/5">
          <p className="font-mohave text-[13px] text-[#93321A]">{error}</p>
          <button onClick={handleGenerate} className="font-mohave text-[12px] text-[#A0A0A0] mt-2 hover:text-[#E5E5E5]">
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/admin/google-ads/briefings/_components/generation-progress.tsx
git commit -m "feat(briefing): add real-time generation progress component"
```

---

## Task 13: UI — Action Items + Ad Preview + A/B Comparison

**Files:**
- Create: `src/app/admin/google-ads/briefings/_components/action-items.tsx`
- Create: `src/app/admin/google-ads/briefings/_components/ad-preview.tsx`
- Create: `src/app/admin/google-ads/briefings/_components/ab-comparison.tsx`

- [ ] **Step 1: Create action items component**

The primary UI element — ranked, scannable in under 10 seconds.

```typescript
"use client";

import type { ActionItem } from "@/lib/admin/briefing-types";

const PRIORITY_STYLES: Record<string, { border: string; text: string }> = {
  high: { border: "border-l-[#93321A]", text: "text-[#93321A]" },
  medium: { border: "border-l-[#C4A868]", text: "text-[#C4A868]" },
  low: { border: "border-l-[#6B6B6B]", text: "text-[#6B6B6B]" },
};

export function ActionItems({ items }: { items: ActionItem[] }) {
  if (items.length === 0) return null;

  return (
    <div>
      <h2 className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-4">
        Action Items
      </h2>
      <div className="space-y-2">
        {items.map((item, i) => {
          const style = PRIORITY_STYLES[item.priority] ?? PRIORITY_STYLES.low;
          return (
            <div key={i} className={`border-l-2 ${style.border} pl-3 py-2`}>
              <div className="flex items-start gap-2">
                <span className="font-mohave text-[14px] text-[#E5E5E5] shrink-0">{i + 1}.</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-mohave text-[11px] uppercase ${style.text}`}>
                      [{item.priority}]
                    </span>
                    <span className="font-mohave text-[14px] text-[#E5E5E5]">{item.action}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="font-kosugi text-[11px] text-[#6B6B6B]">{item.expectedImpact}</span>
                    <span className="font-mohave text-[11px] text-[#444444] bg-white/[0.04] px-2 py-0.5 rounded">
                      {item.effort}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create ad preview component**

Google search ad mockup cards + keyword recommendations.

```typescript
"use client";

import type { AdSuggestion, KeywordRec } from "@/lib/admin/briefing-types";

const BASED_ON_LABELS: Record<string, string> = {
  competitor_gap: "Competitor Gap",
  sentiment_insight: "Market Insight",
  performance_data: "Performance Data",
};

export function AdPreview({ suggestions, keywords }: { suggestions: AdSuggestion[]; keywords: KeywordRec[] }) {
  const headlines = suggestions.filter((s) => s.type === "headline");
  const descriptions = suggestions.filter((s) => s.type === "description");
  const addKeywords = keywords.filter((k) => k.action === "add");
  const negativeKeywords = keywords.filter((k) => k.action === "negative");

  return (
    <div className="space-y-6">
      <h2 className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B]">
        Ad Suggestions
      </h2>

      {/* Ad mockup cards */}
      <div className="space-y-3">
        {headlines.map((h, i) => (
          <div key={i} className="border border-white/[0.08] rounded p-4 bg-white/[0.02]">
            <p className="font-kosugi text-[10px] text-[#6B6B6B] mb-1">Ad · opsapp.co</p>
            <p className="font-mohave text-[16px] text-[#6F94B0]">{h.text}</p>
            {descriptions[i] && (
              <p className="font-mohave text-[13px] text-[#A0A0A0] mt-1">{descriptions[i].text}</p>
            )}
            <div className="mt-2">
              <span className="font-kosugi text-[10px] text-[#444444] bg-white/[0.04] px-2 py-0.5 rounded">
                {BASED_ON_LABELS[h.basedOn] ?? h.basedOn}
              </span>
            </div>
            <p className="font-kosugi text-[11px] text-[#6B6B6B] mt-2">{h.rationale}</p>
          </div>
        ))}
      </div>

      {/* Keyword recommendations */}
      {(addKeywords.length > 0 || negativeKeywords.length > 0) && (
        <div className="grid grid-cols-2 gap-4">
          {addKeywords.length > 0 && (
            <div>
              <p className="font-kosugi text-[10px] uppercase tracking-wider text-[#9DB582] mb-2">Add These</p>
              {addKeywords.map((k, i) => (
                <div key={i} className="py-1.5 border-b border-white/[0.06]">
                  <p className="font-mohave text-[13px] text-[#E5E5E5]">{k.keyword}</p>
                  <p className="font-kosugi text-[10px] text-[#6B6B6B]">[{k.matchType}] {k.rationale}</p>
                </div>
              ))}
            </div>
          )}
          {negativeKeywords.length > 0 && (
            <div>
              <p className="font-kosugi text-[10px] uppercase tracking-wider text-[#93321A] mb-2">Block These</p>
              {negativeKeywords.map((k, i) => (
                <div key={i} className="py-1.5 border-b border-white/[0.06]">
                  <p className="font-mohave text-[13px] text-[#E5E5E5]">{k.keyword}</p>
                  <p className="font-kosugi text-[10px] text-[#6B6B6B]">{k.rationale}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create A/B comparison component**

```typescript
"use client";

import type { ABTestProposal } from "@/lib/admin/briefing-types";

export function ABComparison({ proposals }: { proposals: ABTestProposal[] }) {
  if (proposals.length === 0) return null;

  return (
    <div>
      <h2 className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-4">
        A/B Test Proposals
      </h2>
      <div className="space-y-4">
        {proposals.map((p, i) => (
          <div key={i} className="border border-white/[0.08] rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-white/[0.02] border-b border-white/[0.06]">
              <p className="font-mohave text-[13px] text-[#E5E5E5]">{p.name}</p>
            </div>
            <div className="grid grid-cols-2">
              {/* Current */}
              <div className="p-4 border-r border-white/[0.06]">
                <p className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-2">Current</p>
                <p className="font-mohave text-[14px] text-[#A0A0A0]">{p.currentAd.headline}</p>
                <p className="font-mohave text-[12px] text-[#6B6B6B] mt-1">{p.currentAd.description}</p>
              </div>
              {/* Proposed */}
              <div className="p-4 border-l border-[#6F94B0]/20">
                <p className="font-kosugi text-[10px] uppercase tracking-wider text-[#6F94B0] mb-2">Proposed</p>
                <p className="font-mohave text-[14px] text-[#E5E5E5]">{p.proposedAd.headline}</p>
                <p className="font-mohave text-[12px] text-[#A0A0A0] mt-1">{p.proposedAd.description}</p>
              </div>
            </div>
            <div className="px-4 py-3 bg-white/[0.01] border-t border-white/[0.06]">
              <p className="font-kosugi text-[11px] text-[#6B6B6B]">
                <span className={`uppercase text-[10px] ${p.confidence === "high" ? "text-[#9DB582]" : "text-[#C4A868]"}`}>
                  [{p.confidence}]
                </span>
                {" "}{p.hypothesis}
              </p>
              <p className="font-kosugi text-[10px] text-[#444444] mt-1">Track: {p.metricToWatch}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/google-ads/briefings/_components/action-items.tsx src/app/admin/google-ads/briefings/_components/ad-preview.tsx src/app/admin/google-ads/briefings/_components/ab-comparison.tsx
git commit -m "feat(briefing): add action items, ad preview, and A/B comparison components"
```

---

## Task 14: UI — Competitor Intel + Market Pulse Components

**Files:**
- Create: `src/app/admin/google-ads/briefings/_components/competitor-card.tsx`
- Create: `src/app/admin/google-ads/briefings/_components/market-pulse.tsx`

- [ ] **Step 1: Create competitor intel card**

Collapsible cards per competitor showing ad copy, offers, weaknesses.

```typescript
"use client";

import { useState } from "react";
import type { CompetitorSnapshot } from "@/lib/admin/briefing-types";

function CompetitorCard({ competitor }: { competitor: CompetitorSnapshot }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-white/[0.08] rounded bg-white/[0.02]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <span className="font-mohave text-[14px] text-[#E5E5E5]">{competitor.name}</span>
        <span className="font-mohave text-[12px] text-[#6B6B6B]">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/[0.06]">
          {competitor.adCopy.length > 0 && (
            <div>
              <p className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mt-3 mb-1">Their Ads</p>
              {competitor.adCopy.map((ad, i) => (
                <div key={i} className="py-1">
                  <p className="font-mohave text-[13px] text-[#A0A0A0]">{ad.headline}</p>
                  <p className="font-mohave text-[12px] text-[#6B6B6B]">{ad.description}</p>
                </div>
              ))}
            </div>
          )}
          {competitor.offers.length > 0 && (
            <div>
              <p className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-1">Offers</p>
              {competitor.offers.map((offer, i) => (
                <p key={i} className="font-mohave text-[13px] text-[#A0A0A0]">• {offer}</p>
              ))}
            </div>
          )}
          {competitor.landingPageAngle && (
            <div>
              <p className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-1">Their Angle</p>
              <p className="font-mohave text-[13px] text-[#A0A0A0]">{competitor.landingPageAngle}</p>
            </div>
          )}
          {competitor.weaknesses.length > 0 && (
            <div>
              <p className="font-kosugi text-[10px] uppercase tracking-wider text-[#6F94B0] mb-1">OPS Opportunity</p>
              {competitor.weaknesses.map((w, i) => (
                <p key={i} className="font-mohave text-[13px] text-[#E5E5E5]">→ {w}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CompetitorIntel({ competitors }: { competitors: CompetitorSnapshot[] }) {
  if (competitors.length === 0) return null;

  return (
    <div>
      <h2 className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-4">
        Competitor Intel
      </h2>
      <div className="space-y-2">
        {competitors.map((c, i) => (
          <CompetitorCard key={i} competitor={c} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create market pulse component**

```typescript
"use client";

import type { SentimentTheme } from "@/lib/admin/briefing-types";

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "text-[#9DB582]",
  negative: "text-[#93321A]",
  neutral: "text-[#6B6B6B]",
};

export function MarketPulse({ themes }: { themes: SentimentTheme[] }) {
  if (themes.length === 0) return null;

  return (
    <div>
      <h2 className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-4">
        Market Pulse
      </h2>
      <div className="space-y-4">
        {themes.map((theme, i) => (
          <div key={i} className="border border-white/[0.08] rounded p-4 bg-white/[0.02]">
            <div className="flex items-center gap-2 mb-2">
              <span className={`font-mohave text-[11px] uppercase ${SENTIMENT_COLORS[theme.sentiment]}`}>
                [{theme.sentiment}]
              </span>
              <span className="font-mohave text-[14px] text-[#E5E5E5]">{theme.theme}</span>
            </div>
            {theme.quotes.length > 0 && (
              <div className="space-y-1 mb-2">
                {theme.quotes.map((quote, qi) => (
                  <p key={qi} className="font-kosugi text-[12px] text-[#A0A0A0] italic border-l border-white/[0.06] pl-3">
                    &ldquo;{quote}&rdquo;
                  </p>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              {theme.sources.map((src, si) => (
                <span key={si} className="font-kosugi text-[10px] text-[#444444] bg-white/[0.04] px-1.5 py-0.5 rounded">
                  {src}
                </span>
              ))}
            </div>
            {theme.opportunity && (
              <p className="font-mohave text-[13px] text-[#6F94B0] mt-2">→ {theme.opportunity}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/google-ads/briefings/_components/competitor-card.tsx src/app/admin/google-ads/briefings/_components/market-pulse.tsx
git commit -m "feat(briefing): add competitor intel and market pulse UI components"
```

---

## Task 15: UI — Briefing Hero + Detail Page + Archive

**Files:**
- Create: `src/app/admin/google-ads/briefings/_components/briefing-hero.tsx`
- Create: `src/app/admin/google-ads/briefings/[id]/page.tsx`
- Create: `src/app/admin/google-ads/briefings/page.tsx`
- Modify: `src/app/admin/google-ads/page.tsx`

- [ ] **Step 1: Create briefing hero component**

Displayed at top of the main Google Ads page — latest briefing summary + top action items.

**Architecture:** BriefingHero is a server component that fetches the latest briefing, but the Generate button needs client interactivity. We split this into a server component (data fetching + static rendering) that passes serializable data to a client wrapper (handles generation + refresh).

Create `src/app/admin/google-ads/briefings/_components/briefing-hero.tsx`:

```typescript
import { getLatestBriefing } from "@/lib/admin/briefing-queries";
import { BriefingHeroClient } from "./briefing-hero-client";
import type { AdBriefing } from "@/lib/admin/briefing-types";

export async function BriefingHero() {
  const briefing = await getLatestBriefing();
  return <BriefingHeroClient briefing={briefing} />;
}
```

Create `src/app/admin/google-ads/briefings/_components/briefing-hero-client.tsx`:

```typescript
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { GenerationProgress } from "./generation-progress";
import type { AdBriefing } from "@/lib/admin/briefing-types";

export function BriefingHeroClient({ briefing }: { briefing: AdBriefing | null }) {
  const router = useRouter();
  const handleComplete = useCallback(() => router.refresh(), [router]);

  return (
    <div className="border border-white/[0.08] rounded-lg bg-white/[0.02] p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B]">
            Latest Intelligence Briefing
          </h2>
          {briefing && (
            <p className="font-kosugi text-[11px] text-[#444444] mt-1">
              [{briefing.period_start} — {briefing.period_end}]
            </p>
          )}
        </div>
        <GenerationProgress onComplete={handleComplete} />
      </div>

      {briefing ? (
        <>
          <p className="font-mohave text-[14px] text-[#E5E5E5] leading-relaxed mb-4">
            {briefing.summary}
          </p>

          {briefing.action_items.slice(0, 3).map((item, i) => (
            <div key={i} className="flex items-start gap-2 py-1.5">
              <span className="font-mohave text-[13px] text-[#6B6B6B] shrink-0">{i + 1}.</span>
              <span className={`font-mohave text-[11px] uppercase shrink-0 ${
                item.priority === "high" ? "text-[#93321A]" : item.priority === "medium" ? "text-[#C4A868]" : "text-[#6B6B6B]"
              }`}>[{item.priority}]</span>
              <span className="font-mohave text-[13px] text-[#E5E5E5]">{item.action}</span>
            </div>
          ))}

          <Link
            href={`/admin/google-ads/briefings/${briefing.id}`}
            className="inline-block mt-4 font-kosugi text-[11px] text-[#6F94B0] hover:text-[#E5E5E5] transition-colors"
          >
            View full briefing →
          </Link>
        </>
      ) : (
        <p className="font-mohave text-[14px] text-[#6B6B6B]">
          No briefings yet. Generate your first one to get started.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create briefing detail page**

Create `src/app/admin/google-ads/briefings/[id]/page.tsx`:

```typescript
import { notFound } from "next/navigation";
import { getBriefingById } from "@/lib/admin/briefing-queries";
import { AdminPageHeader } from "../../../_components/admin-page-header";
import { StatCard } from "../../../_components/stat-card";
import { ActionItems } from "../_components/action-items";
import { AdPreview } from "../_components/ad-preview";
import { ABComparison } from "../_components/ab-comparison";
import { CompetitorIntel } from "../_components/competitor-card";
import { MarketPulse } from "../_components/market-pulse";
import type { ChartDataPoint } from "@/lib/admin/types";

function formatDelta(value: number): string {
  const pct = Math.abs(value * 100).toFixed(1);
  if (value > 0.005) return `↑ ${pct}%`;
  if (value < -0.005) return `↓ ${pct}%`;
  return "→ flat";
}

function deltaTrend(value: number): { direction: "up" | "down" | "flat"; value: string } {
  const pct = `${Math.abs(value * 100).toFixed(1)}%`;
  if (value > 0.005) return { direction: "up", value: pct };
  if (value < -0.005) return { direction: "down", value: pct };
  return { direction: "flat", value: "flat" };
}

export default async function BriefingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const briefing = await getBriefingById(id);
  if (!briefing || briefing.status !== "complete") return notFound();

  const perf = briefing.performance_data;
  const sparklineData: ChartDataPoint[] = perf?.dailySpend.map((d) => ({
    label: d.date,
    value: d.spend,
  })) ?? [];

  return (
    <div>
      <AdminPageHeader
        title="Intelligence Briefing"
        caption={`${briefing.period_start} — ${briefing.period_end} · ${briefing.triggered_by}`}
      />

      <div className="p-8 space-y-8">
        {/* Summary */}
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[16px] text-[#E5E5E5] leading-relaxed">
            {briefing.summary}
          </p>
        </div>

        {/* Action Items — THE primary section */}
        <ActionItems items={briefing.action_items} />

        {/* Performance Snapshot */}
        {perf && (
          <div>
            <h2 className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-4">
              Performance Snapshot
            </h2>
            <div className="grid grid-cols-3 gap-4">
              <StatCard
                label="Spend"
                value={`$${perf.current.spend.toFixed(0)}`}
                trend={deltaTrend(perf.deltas.spend)}
                sparklineData={sparklineData}
              />
              <StatCard
                label="CPA"
                value={`$${perf.current.cpa.toFixed(2)}`}
                trend={deltaTrend(perf.deltas.cpa)}
              />
              <StatCard
                label="Conversions"
                value={String(perf.current.conversions)}
                trend={deltaTrend(perf.deltas.conversions)}
              />
            </div>
          </div>
        )}

        {/* Ad Suggestions + Keywords */}
        <AdPreview
          suggestions={briefing.ad_suggestions}
          keywords={briefing.keyword_recs}
        />

        {/* A/B Test Proposals */}
        <ABComparison proposals={briefing.ab_test_proposals} />

        {/* Insights */}
        {briefing.insights.length > 0 && (
          <div>
            <h2 className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-4">
              Insights
            </h2>
            <div className="space-y-3">
              {briefing.insights
                .sort((a, b) => b.impactScore - a.impactScore)
                .map((insight, i) => (
                  <div key={i} className="border border-white/[0.08] rounded p-4 bg-white/[0.02]">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`font-mohave text-[11px] uppercase ${
                        insight.severity === "high" ? "text-[#93321A]" :
                        insight.severity === "medium" ? "text-[#C4A868]" : "text-[#6B6B6B]"
                      }`}>[{insight.severity}]</span>
                      <span className="font-mohave text-[14px] text-[#E5E5E5]">{insight.title}</span>
                      <span className="font-kosugi text-[10px] text-[#444444] bg-white/[0.04] px-1.5 py-0.5 rounded ml-auto">
                        {insight.impactScore}/10
                      </span>
                    </div>
                    <p className="font-mohave text-[13px] text-[#A0A0A0] mb-1">{insight.explanation}</p>
                    <p className="font-mohave text-[13px] text-[#6F94B0]">{insight.recommendation}</p>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Competitor Intel */}
        <CompetitorIntel competitors={briefing.competitor_intel} />

        {/* Market Pulse */}
        <MarketPulse themes={briefing.market_sentiment} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create briefing archive page**

Create `src/app/admin/google-ads/briefings/page.tsx`:

```typescript
import Link from "next/link";
import { listBriefings } from "@/lib/admin/briefing-queries";
import { AdminPageHeader } from "../../_components/admin-page-header";

export default async function BriefingsArchivePage() {
  const briefings = await listBriefings(20);

  return (
    <div>
      <AdminPageHeader title="Briefing Archive" caption="past intelligence briefings" />
      <div className="p-8">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.08]">
              <th className="py-2 text-left font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] pr-3">Period</th>
              <th className="py-2 text-left font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] pr-3">Summary</th>
              <th className="py-2 text-left font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] pr-3">Status</th>
              <th className="py-2 text-left font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] pr-3">Trigger</th>
              <th className="py-2 text-left font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]"></th>
            </tr>
          </thead>
          <tbody>
            {briefings.map((b) => (
              <tr key={b.id} className="border-b border-white/[0.08] hover:bg-white/[0.02] transition-colors duration-100">
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#E5E5E5]">
                  {b.period_start} — {b.period_end}
                </td>
                <td className="py-3 pr-3 font-mohave text-[13px] text-[#A0A0A0] max-w-[300px] truncate">
                  {b.summary ?? "—"}
                </td>
                <td className="py-3 pr-3">
                  <span className={`font-mohave text-[11px] uppercase px-2 py-0.5 rounded ${
                    b.status === "complete" ? "bg-[#9DB582]/20 text-[#9DB582]" :
                    b.status === "generating" ? "bg-[#6F94B0]/20 text-[#6F94B0]" :
                    "bg-[#93321A]/20 text-[#93321A]"
                  }`}>{b.status}</span>
                </td>
                <td className="py-3 pr-3 font-kosugi text-[11px] text-[#6B6B6B]">{b.triggered_by}</td>
                <td className="py-3">
                  {b.status === "complete" && (
                    <Link
                      href={`/admin/google-ads/briefings/${b.id}`}
                      className="font-kosugi text-[11px] text-[#6F94B0] hover:text-[#E5E5E5] transition-colors"
                    >
                      View →
                    </Link>
                  )}
                </td>
              </tr>
            ))}
            {briefings.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center font-mohave text-[14px] text-[#6B6B6B]">
                  No briefings yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update main Google Ads page to add briefing hero**

In `src/app/admin/google-ads/page.tsx`, add the BriefingHero above the existing GoogleAdsContent. Import and render it:

```typescript
// Add import at top:
import { BriefingHero } from "./briefings/_components/briefing-hero";

// In the JSX, add before <GoogleAdsContent>:
<div className="p-8 pb-0">
  <BriefingHero />
</div>
```

- [ ] **Step 5: Verify build**

```bash
cd /c/OPS/ops-web && npx tsc --noEmit 2>&1 | grep "briefing" | head -10
```

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/google-ads/briefings/ src/app/admin/google-ads/page.tsx
git commit -m "feat(briefing): add briefing hero, detail page, and archive UI"
```

---

## Task 16: Supabase Migration

- [ ] **Step 1: Create the `ad_briefings` table**

Run this SQL in the Supabase dashboard (SQL Editor) or via migration:

```sql
CREATE TABLE ad_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'generating',
  progress jsonb,
  summary text,
  performance_data jsonb,
  competitor_intel jsonb DEFAULT '[]'::jsonb,
  market_sentiment jsonb DEFAULT '[]'::jsonb,
  insights jsonb DEFAULT '[]'::jsonb,
  ad_suggestions jsonb DEFAULT '[]'::jsonb,
  keyword_recs jsonb DEFAULT '[]'::jsonb,
  ab_test_proposals jsonb DEFAULT '[]'::jsonb,
  action_items jsonb DEFAULT '[]'::jsonb,
  email_sent boolean NOT NULL DEFAULT false,
  triggered_by text NOT NULL DEFAULT 'manual',
  error text
);

-- Index for fast "latest complete" lookups
CREATE INDEX idx_ad_briefings_status_created ON ad_briefings (status, created_at DESC);

-- RLS: admin-only via service role (no policies needed — service role bypasses RLS)
ALTER TABLE ad_briefings ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Verify table exists**

```sql
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'ad_briefings' ORDER BY ordinal_position;
```

---

## Task 17: Final Verification

- [ ] **Step 1: TypeScript check**

```bash
cd /c/OPS/ops-web && npx tsc --noEmit
```

Expected: Zero errors.

- [ ] **Step 2: Verify all new files exist**

```bash
find src/lib/admin/briefing-steps -type f && find src/app/admin/google-ads/briefings -type f && ls src/app/api/cron/ads-briefing/route.ts src/app/api/admin/google-ads/briefing/generate/route.ts
```

- [ ] **Step 3: Final commit**

```bash
git status
# Stage only the specific files that were missed in prior commits
git commit -m "feat(briefing): complete Google Ads Intelligence Briefing implementation

Weekly AI agent that:
- Pulls Google Ads performance data with prior-period comparison
- Researches competitor ads via Tavily web search
- Scans market sentiment from Reddit/forums
- Generates actionable insights, ad suggestions, and A/B test proposals via OpenAI
- Delivers via email and admin panel

Includes: cron trigger (Monday 7am), manual trigger, real-time generation
progress, mission-briefing UI, briefing archive, email delivery."
```

---

## Post-Implementation Checklist

1. **Supabase:** Run the migration SQL (Task 15)
2. **Tavily:** Sign up at tavily.com, get free API key, add to Vercel: `vercel env add TAVILY_API_KEY production` (repeat for preview/development)
3. **Google Ads access:** Ensure Firebase service account has been granted access (should already be done)
4. **Test manually:** Click "Generate Briefing Now" in the admin panel and watch it build
5. **Verify email:** Check that the briefing email arrives
6. **Verify cron:** After deploy, the first Monday run will generate automatically

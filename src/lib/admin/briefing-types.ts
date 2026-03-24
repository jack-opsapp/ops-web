/**
 * OPS Admin — Google Ads Intelligence Briefing Types
 *
 * Zod schemas for OpenAI structured output validation + TypeScript interfaces for the UI.
 * Maps 1:1 to the `ad_briefings` Supabase table.
 */
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

export interface MetricSet {
  spend: number;
  cpa: number;
  ctr: number;
  clicks: number;
  impressions: number;
  conversions: number;
}

export interface PerformanceSnapshot {
  current: MetricSet;
  prior: MetricSet;
  deltas: MetricSet; // percentage change (-0.18 = 18% decrease)
  topCampaign: { name: string; conversions: number; cpa: number };
  worstCampaign: { name: string; spend: number; conversions: number; cpa: number };
  dailySpend: { date: string; spend: number }[];
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

// --- Full briefing row (maps to ad_briefings table) ---

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

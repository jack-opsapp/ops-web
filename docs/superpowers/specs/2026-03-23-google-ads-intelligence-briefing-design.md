# Google Ads Intelligence Briefing — Design Spec

**Date:** 2026-03-23
**Status:** Reviewed
**Depends on:** Google Ads Admin Integration (complete)

---

## Overview

An AI agent that runs weekly (Monday 7am) and on-demand, generating a comprehensive Google Ads intelligence briefing. Combines ad performance analysis, competitor research, and market sentiment into actionable insights with AI-generated ad suggestions and A/B test proposals.

**UX Philosophy:** The briefing is not a report you read — it's a decision engine you act on. The user opens it, sees exactly what to do, and does it. Every pixel serves that goal. No decoration. No filler. No "interesting but unactionable" insights.

**The "hell yeah" moments:**
- Opening the Google Ads tab and seeing "CPA dropped 18% — here's why and how to push it further"
- A ready-to-paste headline that exploits a competitor weakness you didn't know about
- "ServiceTitan users are complaining about pricing on Reddit — here's an ad targeting that pain point"
- Hitting "Generate Briefing" and watching it build in real-time, step by step

---

## 1. Data Model

### Supabase Table: `ad_briefings`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid (PK, default gen_random_uuid) | Briefing ID |
| `created_at` | timestamptz (default now) | Generation timestamp |
| `period_start` | date | Analysis period start |
| `period_end` | date | Analysis period end |
| `status` | text | `generating`, `complete`, `failed` |
| `progress` | jsonb | Step-by-step progress for real-time UI (`{ step: 2, label: "Scanning competitors..." }`) |
| `summary` | text | 2-3 sentence executive summary — the TL;DR |
| `performance_data` | jsonb | Current + prior period Google Ads metrics snapshot |
| `competitor_intel` | jsonb | Competitor ad copy, offers, messaging analysis |
| `market_sentiment` | jsonb | Reddit/forum/X themes, pain points, opportunities |
| `insights` | jsonb | Scored insights array: `[{ category, severity, title, explanation, recommendation, impact_score }]` |
| `ad_suggestions` | jsonb | Headlines, descriptions, sitelinks |
| `keyword_recs` | jsonb | Keyword additions and negative keyword recommendations |
| `ab_test_proposals` | jsonb | Current vs proposed variants with hypotheses |
| `action_items` | jsonb | Ranked action list: `[{ priority, action, expected_impact, category, effort }]` |
| `email_sent` | boolean (default false) | Whether email was delivered |
| `triggered_by` | text | `cron` or `manual` |
| `error` | text | Error message if status is `failed` |

**Why jsonb:** Weekly snapshots, not relational data. Each briefing is self-contained. Schema can evolve without migrations as the AI output improves.

**RLS:** Admin-only access (service role for writes, admin check for reads).

---

## 2. Agent Pipeline

### Routes (two separate routes, following existing project conventions)

**Cron route:** `GET /api/cron/ads-briefing` — `CRON_SECRET` header auth (matches `/api/cron/email-sync`, `/api/cron/auto-send` pattern)

**Manual trigger:** `POST /api/admin/google-ads/briefing/generate` — `withAdmin` auth (matches `/api/admin/*` pattern)

Both routes call the same `generateBriefing()` function from `briefing-agent.ts`. The cron route sets `triggered_by: "cron"`, the manual route sets `triggered_by: "manual"`.

**Idempotency guard:** Before starting, check for an existing briefing with `status = 'generating'` created within the last 10 minutes. If found, return its ID instead of creating a duplicate.

**Response:** Returns `{ id }` immediately. Client polls `/api/admin/google-ads/briefing/[id]` every 3 seconds (backs off to 5s after 30s) for status updates.

**Max duration:** Both routes must declare `export const maxDuration = 300;` (5 minutes, matching existing cron routes). The pipeline is estimated at 3-4 minutes but web searches can be variable.

### Five Steps

**Step 1: Pull Google Ads Performance (30s)**
- Uses existing functions from `google-ads-client.ts` for current 7-day period
- **New function needed:** `getMetricsForDateRange(startDate, endDate)` using explicit GAQL date filters (`segments.date BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'`) for the prior 7-day period. The existing `DURING LAST_7_DAYS` cannot express "the 7 days before that."
- Computes period-over-period deltas (CPA change, spend change, CTR change, etc.)
- Computes per-campaign and per-keyword deltas
- Updates briefing progress: `{ step: 1, total: 5, label: "Pulling ad performance data..." }`

**Step 2: Competitor Ad Research (60-90s)**
- **Mechanism:** OpenAI `gpt-4o` with web browsing tool (the project already uses raw `openai` package). Alternative: install `@anthropic-ai/sdk` and use Claude with web search tool, OR install a dedicated search API package (Tavily `tavily` npm package — $0/mo for 1000 searches, purpose-built for AI agents).
- **Recommended:** Install `tavily` package ($0 free tier, 1000 searches/month, returns structured JSON perfect for AI consumption). Queries:
  - `"field service management software" Google Ads competitor ads`
  - `Jobber vs ServiceTitan vs Housecall Pro ads 2026`
  - Competitor landing page copy and offers
- Extracts: headlines, descriptions, CTAs, offers, landing page angles
- Updates progress: `{ step: 2, total: 5, label: "Researching competitor ads..." }`

**Step 3: Market Sentiment Scan (60-90s)**
- **Same mechanism as Step 2** (Tavily search API):
  - `site:reddit.com "field service software" OR "scheduling app" electrician plumber HVAC`
  - `site:reddit.com r/smallbusiness contractor software complaints`
  - Trade software sentiment Twitter/X
- Extracts: themes, specific quotes, pain points, unmet needs, sentiment shifts
- Updates progress: `{ step: 3, total: 5, label: "Scanning market sentiment..." }`

**Step 4: AI Analysis + Generation (30-60s)**
- **Uses existing `openai` package** (already installed) with structured output via `response_format: { type: "json_schema", json_schema: {...} }`
- Model: `gpt-4o` via existing OpenAI client (or Claude via `@anthropic-ai/sdk` if preferred — would need to install)
- Input: all data from steps 1-3 + OPS product context (what OPS does, pricing, differentiators)
- Prompt structure:

```
You are an expert PPC analyst and ad strategist for OPS, a field service management
platform for trade workers (electricians, plumbers, HVAC, contractors, roofers).

Given:
1. PERFORMANCE DATA: [7-day metrics + period-over-period comparison]
2. COMPETITOR INTELLIGENCE: [competitor ad copy and landing page analysis]
3. MARKET SENTIMENT: [Reddit/forum/Twitter findings about trade software]

Generate a comprehensive briefing with:
- Executive summary (2-3 sentences, lead with the most important finding)
- Insights scored 1-10 by impact, categorized: Cost Efficiency, Keywords, Creative, Competitive, Market
- Ad copy suggestions: 5 headlines (30 chars), 3 descriptions (90 chars), keyword additions, negative keywords
- A/B test proposals: 2-3 tests comparing current best ads vs proposed variants with hypothesis
- Action items: ranked by expected impact × ease of implementation
```

- Output validated against Zod schema
- Updates progress: `{ step: 4, total: 5, label: "Generating insights and recommendations..." }`

**Step 5: Store + Email (5s)**
- Updates briefing row in Supabase (status → `complete`, populate all jsonb columns)
- Sends email via SendGrid
- Updates progress: `{ step: 5, total: 5, label: "Delivering briefing..." }`

**Error handling:** If any step fails, set status to `failed` with error message. Prior steps' data is preserved — partial briefings are still useful. The UI shows what succeeded and what didn't.

---

## 3. Type Definitions

### File: `src/lib/admin/briefing-types.ts`

Zod schemas for AI output validation + TypeScript types for the UI.

```typescript
// Competitor ad snapshot from Step 2
interface CompetitorSnapshot {
  name: string;             // "Jobber", "ServiceTitan", etc.
  adCopy: { headline: string; description: string }[];
  offers: string[];         // "Free trial", "50% off first month"
  landingPageAngle: string; // Summary of their value proposition
  weaknesses: string[];     // Identified gaps OPS can exploit
}

// Market sentiment theme from Step 3
interface SentimentTheme {
  theme: string;            // "Frustrated with contract lock-in"
  sentiment: "positive" | "negative" | "neutral";
  sources: string[];        // "r/electricians", "r/smallbusiness"
  quotes: string[];         // Anonymized direct quotes
  opportunity: string;      // How OPS can leverage this in ads
}

// Performance snapshot with period-over-period comparison
interface PerformanceSnapshot {
  current: {
    spend: number; cpa: number; ctr: number; clicks: number;
    impressions: number; conversions: number;
  };
  prior: {
    spend: number; cpa: number; ctr: number; clicks: number;
    impressions: number; conversions: number;
  };
  deltas: {
    spend: number; cpa: number; ctr: number; clicks: number;
    impressions: number; conversions: number;
  }; // percentage change (-0.18 = 18% decrease)
  topCampaign: { name: string; conversions: number; cpa: number };
  worstCampaign: { name: string; spend: number; conversions: number; cpa: number };
  dailySpend: { date: string; spend: number }[];
}

// Insight from the AI analysis
interface BriefingInsight {
  category: "cost" | "keywords" | "creative" | "competitive" | "market";
  severity: "high" | "medium" | "low";
  title: string;           // e.g. "Campaign 'Brand Search' CPA spiked 34%"
  explanation: string;     // What happened and why
  recommendation: string;  // What to do about it
  impactScore: number;     // 1-10
}

// AI-generated ad suggestion
interface AdSuggestion {
  type: "headline" | "description" | "sitelink";
  text: string;
  rationale: string;       // Why this will work (based on competitor gap or sentiment)
  basedOn: string;         // "competitor_gap" | "sentiment_insight" | "performance_data"
}

// Keyword recommendation
interface KeywordRec {
  keyword: string;
  matchType: "exact" | "phrase" | "broad";
  action: "add" | "negative";
  rationale: string;
  estimatedImpact: string; // "Save ~$X/week" or "Capture X more clicks"
}

// A/B test proposal
interface ABTestProposal {
  name: string;            // "Brand Search Headline Test"
  currentAd: { headline: string; description: string };
  proposedAd: { headline: string; description: string };
  hypothesis: string;      // "Emphasizing 'no contracts' should reduce CPA by..."
  metricToWatch: string;   // "CPA over 14 days"
  confidence: "high" | "medium"; // How confident the AI is
}

// Action item
interface ActionItem {
  priority: "high" | "medium" | "low";
  action: string;          // Specific, imperative: "Pause keyword 'free scheduling app'"
  expectedImpact: string;  // "Save ~$45/week in wasted spend"
  category: string;        // "keywords" | "bidding" | "creative" | "targeting"
  effort: "5min" | "30min" | "1hr"; // How long to implement
}

// Full briefing (maps 1:1 to ad_briefings table columns)
interface AdBriefing {
  id: string;
  createdAt: string;
  periodStart: string;
  periodEnd: string;
  status: "generating" | "complete" | "failed";
  progress: { step: number; total: number; label: string; completedSteps: string[] } | null;
  summary: string | null;
  performanceData: PerformanceSnapshot | null;
  insights: BriefingInsight[];
  adSuggestions: AdSuggestion[];
  keywordRecs: KeywordRec[];
  abTestProposals: ABTestProposal[];
  actionItems: ActionItem[];
  competitorIntel: CompetitorSnapshot[];
  marketSentiment: SentimentTheme[];
  triggeredBy: "cron" | "manual";
  emailSent: boolean;
  error: string | null;
}
```

---

## 4. Admin Panel UX

### 4.1 Google Ads Tab Redesign

The current Google Ads tab shows raw data tables. The briefing transforms it into an **intelligence hub.**

**New layout — two-zone approach:**

**Top zone: Latest Briefing Hero**
The most recent briefing's summary and action items are displayed prominently at the top of the Google Ads page — NOT behind a sub-route. This is what you see first when you click "GOOGLE ADS" in the sidebar.

- Latest briefing date + "Generate New Briefing" button
- Executive summary in a highlighted card
- Top 3 action items rendered inline with priority badges and effort estimates
- "View Full Briefing →" link to the detail page

**Bottom zone: Live Data**
The existing KPI cards, campaign table, keyword table, search terms table live below the briefing hero. This is the raw data layer — useful for drill-down but secondary to the briefing.

**The UX insight:** You don't open this page to stare at tables. You open it to answer "what should I do?" The briefing answers that. The tables are there when you need to verify or dig deeper.

### 4.2 Briefing Detail Page (`/admin/google-ads/briefings/[id]`)

**URL:** Accessible from "View Full Briefing →" or from the briefing archive.

**Layout — vertical scroll, mission-briefing style:**

**Section 1: Header + Summary**
- Period: "Mar 17 — Mar 23, 2026"
- Generated: timestamp
- Trigger: "Scheduled" or "Manual"
- Summary card: 2-3 sentences, prominent, the first thing you read

**Section 2: Action Items (THE primary section)**
- Rendered as a numbered list with visual hierarchy
- Each item: priority badge (red/amber/green), the action in imperative voice, expected impact in brackets, effort estimate pill
- Example:
  ```
  1. [HIGH] Pause keyword "free scheduling app" — wasting $67/week with 0 conversions [5 min]
  2. [HIGH] Add negative keyword "free" to Brand campaign — 23% of spend, 0% conversion [5 min]
  3. [MED] Test headline "No Contracts. No Setup Fees." against current — competitors don't offer this [30 min]
  ```
- This section should be scannable in under 10 seconds

**Section 3: Performance Snapshot**
- 6 KPI cards in a grid: Spend, CPA, CTR, Conversions, Best Campaign, Worst Campaign
- Each card shows: current value, prior period value, delta arrow + percentage
- Sparkline for daily trend (reuse existing Sparkline component)
- Color coding: green for improvements, red for regressions, neutral for flat

**Section 4: Ad Suggestions**
- **Google Ad Preview Cards** — mock Google search ad format:
  ```
  Ad · opsapp.co
  No Contracts. Built for Trade Crews.
  The only field service app designed for how you actually work. Try free for 14 days.
  ```
- Each suggestion has a rationale badge: "Competitor Gap", "Market Insight", "Performance Data"
- Keyword recommendations in two columns: "Add These" (green) and "Block These" (red)
- Each keyword has a one-line rationale

**Section 5: A/B Test Proposals**
- Side-by-side comparison cards: "Current" (left, muted) vs "Proposed" (right, accent border)
- Hypothesis text below the comparison
- Confidence badge: High (green) or Medium (amber)
- "Metric to watch" line at bottom

**Section 6: Competitor Intel**
- Collapsible cards per competitor (Jobber, ServiceTitan, Housecall Pro, etc.)
- Each shows: their current ad copy, their offer/CTA, their landing page angle, identified weaknesses
- OPS opportunity highlighted for each: "They don't mention X — we should"

**Section 7: Market Pulse**
- Themes with source indicators (Reddit icon, X icon)
- Direct quotes from trade workers (anonymized)
- Sentiment summary: "Positive about scheduling tools, frustrated with pricing and contracts"
- Messaging opportunities highlighted

### 4.3 Briefing Archive (`/admin/google-ads/briefings`)

Simple list page:
- Table: Date range, summary preview (truncated), status badge, triggered by, "View" link
- Most recent first
- Used to track whether past recommendations worked

### 4.4 Generation UI

When "Generate Briefing Now" is clicked:
- Button changes to disabled state with progress indicator
- Step-by-step status updates below the button:
  ```
  ✓ Step 1/5: Ad performance data pulled
  ✓ Step 2/5: Competitor research complete
  ● Step 3/5: Scanning market sentiment...
  ○ Step 4/5: AI analysis
  ○ Step 5/5: Delivery
  ```
- Polls `/api/admin/google-ads/briefing/[id]` every 2 seconds for progress
- On completion: page refreshes to show the new briefing

---

## 5. Email

### Template: `src/lib/email/templates/ads-briefing.ts`

Uses existing SendGrid integration. Dark-themed HTML email matching OPS brand.

**Subject:** `[OPS Intel] Google Ads Weekly — Mar 17-23`

**Body structure:**
```
EXECUTIVE SUMMARY
[2-3 sentences — the most important thing that happened]

THIS WEEK'S ACTIONS
1. [HIGH] [Action] — [Expected impact] [Effort]
2. [HIGH] [Action] — [Expected impact] [Effort]
3. [MED] [Action] — [Expected impact] [Effort]

KEY METRICS
Spend: $X,XXX (↑12%)  |  CPA: $XX.XX (↓8%)  |  Conv: XX (↑15%)

[VIEW FULL BRIEFING →]
```

**Design:** Minimal, monospace-feeling, dark background. Looks like a terminal readout, not a marketing email. No images, no fancy formatting — just information density that respects the reader's time.

**Recipient:** Admin email(s) from the `admins` Supabase table.

---

## 6. Cron Configuration

**vercel.json addition** (add to existing `crons` array):
```json
{
  "path": "/api/cron/ads-briefing",
  "schedule": "0 12 * * 1"
}
```

(12:00 UTC = 7:00 AM EST every Monday. Follows existing `/api/cron/*` convention.)

**Cron auth:** Route checks `Authorization: Bearer ${CRON_SECRET}` header — same pattern as `/api/cron/accounting-sync`, `/api/cron/email-sync`, etc.

---

## 7. File Inventory

### New Files

| File | Type | Purpose |
|------|------|---------|
| `src/lib/admin/briefing-types.ts` | Shared | Zod schemas + TypeScript interfaces |
| `src/lib/admin/briefing-agent.ts` | Server | 5-step pipeline (data → research → sentiment → AI → store) |
| `src/lib/admin/briefing-queries.ts` | Server | Supabase CRUD for `ad_briefings` table |
| `src/app/api/cron/ads-briefing/route.ts` | API | Cron trigger (CRON_SECRET auth, GET) |
| `src/app/api/admin/google-ads/briefing/generate/route.ts` | API | Manual trigger (withAdmin auth, POST) |
| `src/app/api/admin/google-ads/briefing/[id]/route.ts` | API | GET briefing by ID (for polling) |
| `src/app/admin/google-ads/briefings/page.tsx` | Server | Briefing archive list |
| `src/app/admin/google-ads/briefings/[id]/page.tsx` | Server | Full briefing detail page |
| `src/app/admin/google-ads/briefings/_components/action-items.tsx` | Client | Ranked action item list |
| `src/app/admin/google-ads/briefings/_components/ad-preview.tsx` | Client | Google Ad mockup card |
| `src/app/admin/google-ads/briefings/_components/ab-comparison.tsx` | Client | Side-by-side A/B test card |
| `src/app/admin/google-ads/briefings/_components/insight-cards.tsx` | Client | Scored insight cards |
| `src/app/admin/google-ads/briefings/_components/competitor-card.tsx` | Client | Collapsible competitor analysis |
| `src/app/admin/google-ads/briefings/_components/market-pulse.tsx` | Client | Sentiment themes + quotes |
| `src/app/admin/google-ads/briefings/_components/performance-snapshot.tsx` | Client | KPI grid with deltas |
| `src/app/admin/google-ads/briefings/_components/generation-progress.tsx` | Client | Step-by-step generation UI |
| `src/app/admin/google-ads/briefings/_components/briefing-hero.tsx` | Client | Latest briefing summary for main page |
| `src/lib/email/templates/ads-briefing.ts` | Server | Email template |

### Modified Files

| File | Change |
|------|--------|
| `src/app/admin/google-ads/page.tsx` | Add briefing hero section above existing data tables |
| `src/lib/analytics/google-ads-client.ts` | Add `getMetricsForDateRange()` for prior-period queries |
| `src/lib/admin/admin-queries.ts` | Add `getAdminEmails()` function |
| `vercel.json` | Add cron entry to existing `crons` array |
| `package.json` | Add `tavily` dependency |
| `.env.example` | Add `TAVILY_API_KEY` |

### Supabase Migration

- Create `ad_briefings` table with columns per Section 1
- Enable RLS, add admin-only policies

---

## 8. Dependencies

### New Package
- `tavily` — web search API for AI agents. Free tier: 1,000 searches/month. Returns structured JSON with relevance scores. Used for competitor ad research (Step 2) and market sentiment scanning (Step 3). Requires `TAVILY_API_KEY` env var (free at tavily.com).

### Existing (no new packages needed)
- `openai` (^6.27.0) — structured output via `response_format: { type: "json_schema" }` for Step 4 AI generation
- `zod` — schema validation (convert Zod to JSON Schema for OpenAI structured output)
- `google-auth-library` — Google Ads API (existing service account)
- SendGrid — email delivery (existing)

### New Environment Variables
- `TAVILY_API_KEY` — free tier API key from tavily.com

### New Query Functions Needed
- `getMetricsForDateRange(startDate, endDate)` in `google-ads-client.ts` — explicit GAQL date range queries for prior-period comparison
- `getAdminEmails()` in `admin-queries.ts` — retrieve all admin emails from the `admins` table for email delivery

---

## 9. What Makes This Better Than Existing Tools

| Existing Tools | OPS Intelligence Briefing |
|---------------|--------------------------|
| Optmyzr ($249-499/mo): optimizes bids and budgets, no market context | Combines ad data WITH competitor intel AND user sentiment |
| Adalysis ($149/mo): 47-point audit, Google Ads only, dated UI | Mission-briefing UX designed for speed, not audit depth |
| Google Ads Advisor: conversational Q&A, reactive (you ask, it answers) | Proactive — delivers insights before you ask |
| n8n workflows: score campaigns 0-100, alert via Slack | Goes beyond scoring to generate specific ad copy and test proposals |
| Narrative BI: automated reports with charts | Reports show WHAT happened — briefings tell you WHAT TO DO |

**Our unique value:** No tool on the market combines Google Ads performance data + live competitor ad research + Reddit/forum trade worker sentiment into a single actionable briefing with ready-to-use ad copy. The closest is Adsroid (open-source AI agent), but it's a conversational tool — you still have to ask the right questions. Our briefing answers the questions you didn't know to ask.

---

## 10. Out of Scope (v1)

- Automatic implementation of recommendations (no auto-pausing keywords or changing bids)
- Multi-account support (single Google Ads account only)
- Historical trend analysis across briefings (compare this week vs 4 weeks ago)
- Custom competitor list configuration (hardcoded for v1)
- Slack delivery (email + admin only for v1)
- Budget recommendations (focus on keywords, creative, targeting first)
- Retry/backfill for failed cron runs (admin can trigger manually to compensate)

### Edge Cases Handled in v1
- **First briefing (no prior period):** AI prompt handles gracefully — omits period-over-period comparison, focuses on absolute metrics and competitor/market insights. UI shows "First briefing — no comparison data yet" instead of misleading N/A deltas.
- **Google Ads API down:** Step 1 fails, briefing status set to `failed` with error. Steps 2-3 data (competitor/sentiment) is still valuable — future enhancement could generate partial briefings.
- **Tavily quota exceeded:** Fallback to reduced search (fewer queries) or skip market research with a note in the briefing.
- **Duplicate trigger:** Idempotency guard prevents concurrent generation (returns existing briefing ID).

# Google Ads API — Design Documentation

## Company Name

OPS (opsapp.co)

## Business Model

OPS is a field service management (FSM) platform built for trade businesses — electricians, plumbers, HVAC technicians, roofers, and general contractors. We operate a SaaS web application at app.opsapp.co where trade businesses manage jobs, scheduling, invoicing, and crew coordination. Our marketing website is at www.opsapp.co.

We run Google Ads campaigns to acquire new customers for our own SaaS product. We advertise only for our own company (OPS) and do not manage ads for any third parties. All Google Ads accounts accessed through the API are owned by our company.

## Tool Access/Use

Our tool is an **internal admin dashboard** used exclusively by OPS employees and marketing team members to monitor Google Ads performance. The tool is accessible only to authenticated admin users at app.opsapp.co/admin/google-ads. Access is restricted via Firebase authentication and an admin allowlist — only verified OPS employees can access the dashboard.

**The tool is used for two purposes:**

1. **Performance Reporting Dashboard:** Our admin dashboard displays Google Ads performance metrics (spend, clicks, impressions, conversions, CPA, CTR) at the account, campaign, and keyword level. Authorized employees can view performance across configurable date ranges (7, 14, 30, or 90 days). The dashboard also shows search term reports and conversion breakdowns.

2. **AI-Powered Weekly Briefings:** Once per week, an automated process pulls the latest 7-day performance data from the API and feeds it to an AI analysis engine that generates an actionable intelligence briefing with recommendations. These briefings are viewable by admin users in the dashboard.

**No external parties have direct access to the tool.** The dashboard is behind authentication and only OPS employees can log in.

## Tool Design

Our tool follows a **sync-to-database architecture**:

1. **Daily Sync (Automated):** A scheduled cron job runs once daily at 8:00 UTC. It calls the Google Ads API to fetch the previous day's finalized performance data and stores it in our Supabase (PostgreSQL) database. This results in 2 API calls per day (one for account-level metrics, one for campaign-level metrics).

2. **Historical Backfill (Manual, One-Time):** An admin can trigger a one-time historical import that fetches past performance data in 30-day chunks and stores it in the database. This is a one-time operation to populate historical data.

3. **Dashboard UI:** The admin dashboard reads all data from our Supabase database — it does **not** call the Google Ads API directly. This means the dashboard loads instantly regardless of how many users are viewing it, and API usage is limited to the daily sync.

4. **Weekly Briefing:** Once per week, the briefing system makes 4 API calls (current 7-day account summary, prior 7-day account summary, campaign performance, daily spend breakdown) to generate the AI briefing.

**Total estimated API usage:** ~20 operations per day (2 daily sync + occasional briefing queries). Well within Basic Access limits.

### Data Flow Diagram

```
Google Ads API
      |
      | (Daily cron: 2 API calls/day)
      v
Supabase Database (PostgreSQL)
      |
      | (Reads only — no API calls)
      v
Admin Dashboard UI (app.opsapp.co/admin/google-ads)
      |
      v
Authenticated OPS Employees Only
```

## API Services Called

All API calls are **read-only**. We do not create, modify, or delete any ads, campaigns, or other resources via the API.

### 1. Customer Resource (Account-Level Metrics)

Used to pull account-level performance summaries.

```sql
SELECT
  metrics.cost_micros,
  metrics.clicks,
  metrics.impressions,
  metrics.conversions,
  metrics.cost_per_conversion,
  metrics.ctr
FROM customer
WHERE segments.date >= '2026-01-01' AND segments.date <= '2026-01-31'
```

### 2. Campaign Resource (Campaign-Level Metrics)

Used to pull performance data broken down by campaign.

```sql
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
WHERE segments.date >= '2026-01-01' AND segments.date <= '2026-01-31'
  AND campaign.status != 'REMOVED'
ORDER BY metrics.cost_micros DESC
```

### 3. Keyword View (Keyword-Level Metrics)

Used to pull performance data for individual keywords.

```sql
SELECT
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.historical_quality_score
FROM keyword_view
WHERE segments.date DURING LAST_30_DAYS
ORDER BY metrics.cost_micros DESC
LIMIT 50
```

### 4. Search Term View (Search Term Reports)

Used to see what actual search queries triggered our ads.

```sql
SELECT
  search_term_view.search_term,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions
FROM search_term_view
WHERE segments.date DURING LAST_30_DAYS
ORDER BY metrics.impressions DESC
LIMIT 50
```

### 5. Conversion Action Segments (Conversion Breakdown)

Used to see CPA broken down by conversion action type.

```sql
SELECT
  segments.conversion_action_name,
  metrics.conversions,
  metrics.cost_per_conversion,
  metrics.cost_micros
FROM customer
WHERE segments.date DURING LAST_30_DAYS
  AND segments.conversion_action_name IS NOT NULL
```

**Summary of API Resources Used:**
- `customer` (read-only) — Account-level metrics
- `campaign` (read-only) — Campaign-level metrics
- `keyword_view` (read-only) — Keyword performance
- `search_term_view` (read-only) — Search term reports

**No write/mutate operations are performed.** We do not use AdGroupAdService, CampaignService, or any other service to create or modify ads.

## Tool Mockups

### Dashboard — Main View

The admin dashboard displays four KPI cards at the top (Total Spend, Cost per Signup, Cost per Install, Avg CTR) followed by detailed tables for campaigns, keywords, and search terms. A date range selector allows switching between 7d, 14d, 30d, and 90d views.

```
+------------------------------------------------------------------+
| GOOGLE ADS                        [synced through 2026-03-23]    |
|                                                                  |
| [7d] [14d] [30d] [90d]                              [Refresh]   |
|                                                                  |
| +---------------+ +---------------+ +---------------+ +--------+ |
| | TOTAL SPEND   | | COST/SIGNUP   | | COST/INSTALL  | | AVG CTR| |
| | $2,847        | | $42.50        | | $18.30        | | 4.2%   | |
| | [sparkline]   | | 67 conversions| | 155 installs  | | 2.1k   | |
| +---------------+ +---------------+ +---------------+ +--------+ |
|                                                                  |
| CAMPAIGNS                                                        |
| +--------------------------------------------------------------+ |
| | Campaign          | Status  | Spend   | Clicks | Conv | CPA  | |
| |-------------------+---------+---------+--------+------+------| |
| | Brand - Exact     | ENABLED | $892.40 | 423    | 38   |$23.5 | |
| | Service Areas     | ENABLED | $634.20 | 287    | 15   |$42.3 | |
| | Competitor Terms  | PAUSED  | $421.80 | 198    | 8    |$52.7 | |
| +--------------------------------------------------------------+ |
|                                                                  |
| KEYWORDS                                                         |
| +--------------------------------------------------------------+ |
| | Keyword               | Match | Spend   | Clicks | Conv     | |
| |-----------------------+-------+---------+--------+----------| |
| | field service software| EXACT | $234.50 | 89     | 12       | |
| | plumber scheduling app| PHRASE| $187.30 | 67     | 8        | |
| +--------------------------------------------------------------+ |
|                                                                  |
| SEARCH TERMS                                                     |
| +--------------------------------------------------------------+ |
| | Search Term           | Impressions | Clicks | Cost   | Conv | |
| |-----------------------+-------------+--------+--------+------| |
| | ops field service     | 1,245       | 89     | $67.20 | 12   | |
| | hvac scheduling app   | 987         | 45     | $34.10 | 5    | |
| +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

### Sync Status Bar

When historical data import is running, a progress bar appears below the page header.

```
+------------------------------------------------------------------+
| [synced through 2026-03-23]    47% — 2025-08-15    Import History|
| [=============================                  ]                 |
+------------------------------------------------------------------+
```

### Weekly Intelligence Briefing

The briefing section shows an AI-generated summary card with key insights.

```
+------------------------------------------------------------------+
| INTELLIGENCE BRIEFING              [Mar 17 - Mar 23, 2026]       |
|                                                                  |
| "CPA dropped 18% week-over-week to $38.40, driven by the        |
|  Brand - Exact campaign which saw a 24% increase in conversions. |
|  Recommend increasing budget allocation to brand terms."         |
|                                                                  |
| [View Full Briefing]                         [Generate New]      |
+------------------------------------------------------------------+
```

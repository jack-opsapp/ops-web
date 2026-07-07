import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { getGA4Client, getPropertyId } from "@/lib/analytics/ga4-client";
import type {
  SpecAdCampaignRow,
  SpecAnalyticsPayload,
  SpecDailySpendPoint,
  SpecEventLedgerRow,
  SpecFunnelStep,
  SpecSearchTermRow,
  SpecWebMetrics,
} from "./spec-analytics-types";

const BUDGET_CAP_CENTS = 150_000;
const DEFAULT_CAMPAIGN_FILTER = "SPEC";

const FUNNEL_EVENTS = [
  "page_view",
  "spec_card_expand",
  "pay_deposit_click",
  "billing_address_submitted",
  "stripe_checkout_opened",
  "stripe_checkout_completed",
  "intake_submitted",
  "discovery_booked",
] as const;

const FUNNEL_LABELS: Record<(typeof FUNNEL_EVENTS)[number], string> = {
  page_view: "LANDING VIEW",
  spec_card_expand: "CARD EXPAND",
  pay_deposit_click: "DEPOSIT CLICK",
  billing_address_submitted: "ADDRESS SUBMITTED",
  stripe_checkout_opened: "CHECKOUT OPENED",
  stripe_checkout_completed: "DEPOSIT PAID",
  intake_submitted: "INTAKE SUBMITTED",
  discovery_booked: "DISCOVERY BOOKED",
};

interface ConversionEventRow {
  id: string;
  event_name: string;
  payload: unknown;
  status: string;
  created_at: string;
}

interface AdsDailyCampaignRow {
  date: string;
  campaign_name: string;
  spend: number | string;
  clicks: number | string;
  impressions: number | string;
  conversions: number | string;
  cpa: number | string;
  ctr: number | string;
}

interface AdsDailySearchTermRow {
  search_term: string;
  campaign_name: string;
  ad_group_name: string | null;
  spend: number | string;
  clicks: number | string;
  impressions: number | string;
  conversions: number | string;
  cpa: number | string;
  ctr: number | string;
  waste_flag: string | null;
}

function db() {
  return getAdminSupabase();
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function dollarsToCents(value: unknown): number {
  return Math.round(asNumber(value) * 100);
}

function readDate(value: string, suffix: "start" | "end"): string {
  return suffix === "start"
    ? `${value}T00:00:00.000Z`
    : `${value}T23:59:59.999Z`;
}

function campaignFilter(): string {
  return (process.env.SPEC_GOOGLE_ADS_CAMPAIGN_FILTER ?? DEFAULT_CAMPAIGN_FILTER).trim();
}

function campaignMatches(name: string, filter: string): boolean {
  if (!filter) return true;
  return name.toLowerCase().includes(filter.toLowerCase());
}

function increment(map: Map<string, number>, key: string, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

async function loadConversionRows(from: string, to: string): Promise<ConversionEventRow[]> {
  const { data, error } = await db()
    .from("conversion_event_outbox")
    .select("id,event_name,payload,status,created_at")
    .gte("created_at", readDate(from, "start"))
    .lte("created_at", readDate(to, "end"))
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) throw new Error(`conversion_event_outbox analytics failed: ${error.message}`);
  return (data ?? []) as ConversionEventRow[];
}

async function loadCampaignRows(from: string, to: string): Promise<AdsDailyCampaignRow[]> {
  const { data, error } = await db()
    .from("ads_daily_campaign")
    .select("date,campaign_name,spend,clicks,impressions,conversions,cpa,ctr")
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true });

  if (error) throw new Error(`ads_daily_campaign analytics failed: ${error.message}`);
  return (data ?? []) as AdsDailyCampaignRow[];
}

async function loadSearchTermRows(from: string, to: string): Promise<AdsDailySearchTermRow[]> {
  const { data, error } = await db()
    .from("ads_daily_search_term")
    .select("search_term,campaign_name,ad_group_name,spend,clicks,impressions,conversions,cpa,ctr,waste_flag")
    .gte("date", from)
    .lte("date", to)
    .order("spend", { ascending: false })
    .limit(250);

  if (error) throw new Error(`ads_daily_search_term analytics failed: ${error.message}`);
  return (data ?? []) as AdsDailySearchTermRow[];
}

async function loadGa4SpecMetrics(
  from: string,
  to: string,
): Promise<{ configured: boolean; web: SpecWebMetrics; eventCounts: Map<string, number> }> {
  const empty = {
    configured: false,
    web: { activeUsers: 0, sessions: 0, pageViews: 0 },
    eventCounts: new Map<string, number>(),
  };

  if (!process.env.GA4_PROPERTY_ID) return empty;

  try {
    const client = getGA4Client();
    const pageFilter = {
      filter: {
        fieldName: "pagePath",
        stringFilter: { matchType: "BEGINS_WITH" as const, value: "/spec" },
      },
    };

    const [[webResponse], [eventsResponse]] = await Promise.all([
      client.runReport({
        property: getPropertyId(),
        metrics: [
          { name: "activeUsers" },
          { name: "sessions" },
          { name: "screenPageViews" },
        ],
        dimensionFilter: pageFilter,
        dateRanges: [{ startDate: from, endDate: to }],
      }),
      client.runReport({
        property: getPropertyId(),
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: {
          andGroup: {
            expressions: [
              pageFilter,
              {
                filter: {
                  fieldName: "eventName",
                  inListFilter: { values: [...FUNNEL_EVENTS, "spec_default_ops_signup_completed"] },
                },
              },
            ],
          },
        },
        dateRanges: [{ startDate: from, endDate: to }],
      }),
    ]);

    const metrics = webResponse.rows?.[0]?.metricValues ?? [];
    const eventCounts = new Map<string, number>();
    for (const row of eventsResponse.rows ?? []) {
      const name = row.dimensionValues?.[0]?.value;
      if (!name) continue;
      eventCounts.set(name, Number(row.metricValues?.[0]?.value ?? 0));
    }

    return {
      configured: true,
      web: {
        activeUsers: Number(metrics[0]?.value ?? 0),
        sessions: Number(metrics[1]?.value ?? 0),
        pageViews: Number(metrics[2]?.value ?? 0),
      },
      eventCounts,
    };
  } catch (err) {
    console.error("[spec-analytics] GA4 SPEC metrics unavailable:", err);
    return empty;
  }
}

function buildEvents(rows: ConversionEventRow[]): SpecEventLedgerRow[] {
  return rows.map((row) => {
    const payload = toRecord(row.payload);
    return {
      id: row.id,
      eventName: row.event_name,
      specProjectId: asString(payload.spec_project_id),
      tier: asString(payload.tier),
      status: row.status,
      createdAt: row.created_at,
      valueCents: typeof payload.value_cents === "number" ? payload.value_cents : null,
      campaign: asString(payload.utm_campaign),
      source: asString(payload.utm_source),
    };
  });
}

function buildCampaigns(rows: AdsDailyCampaignRow[], filter: string): SpecAdCampaignRow[] {
  const byCampaign = new Map<string, SpecAdCampaignRow>();
  for (const row of rows) {
    if (!campaignMatches(row.campaign_name, filter)) continue;
    const existing = byCampaign.get(row.campaign_name);
    const spendCents = dollarsToCents(row.spend);
    const conversions = asNumber(row.conversions);
    if (existing) {
      existing.spendCents += spendCents;
      existing.clicks += asNumber(row.clicks);
      existing.impressions += asNumber(row.impressions);
      existing.conversions += conversions;
      existing.cpaCents = existing.conversions > 0
        ? Math.round(existing.spendCents / existing.conversions)
        : null;
      existing.ctr = existing.impressions > 0 ? existing.clicks / existing.impressions : 0;
    } else {
      const clicks = asNumber(row.clicks);
      const impressions = asNumber(row.impressions);
      byCampaign.set(row.campaign_name, {
        campaignName: row.campaign_name,
        spendCents,
        clicks,
        impressions,
        conversions,
        cpaCents: conversions > 0 ? Math.round(spendCents / conversions) : null,
        ctr: impressions > 0 ? clicks / impressions : 0,
      });
    }
  }
  return Array.from(byCampaign.values()).sort((a, b) => b.spendCents - a.spendCents);
}

function buildSearchTerms(rows: AdsDailySearchTermRow[], filter: string): SpecSearchTermRow[] {
  return rows
    .filter((row) => campaignMatches(row.campaign_name, filter))
    .map((row) => {
      const spendCents = dollarsToCents(row.spend);
      const conversions = asNumber(row.conversions);
      return {
        searchTerm: row.search_term,
        campaignName: row.campaign_name,
        adGroupName: row.ad_group_name || null,
        spendCents,
        clicks: asNumber(row.clicks),
        impressions: asNumber(row.impressions),
        conversions,
        cpaCents: conversions > 0 ? Math.round(spendCents / conversions) : null,
        ctr: asNumber(row.ctr),
        wasteFlag: row.waste_flag,
      };
    })
    .sort((a, b) => b.spendCents - a.spendCents)
    .slice(0, 50);
}

function buildDailySpend(rows: AdsDailyCampaignRow[], filter: string): SpecDailySpendPoint[] {
  const byDate = new Map<string, SpecDailySpendPoint>();
  for (const row of rows) {
    if (!campaignMatches(row.campaign_name, filter)) continue;
    const existing = byDate.get(row.date);
    if (existing) {
      existing.spendCents += dollarsToCents(row.spend);
      existing.clicks += asNumber(row.clicks);
      existing.conversions += asNumber(row.conversions);
    } else {
      byDate.set(row.date, {
        date: row.date,
        spendCents: dollarsToCents(row.spend),
        clicks: asNumber(row.clicks),
        conversions: asNumber(row.conversions),
      });
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function buildFunnel(counts: Map<string, number>): SpecFunnelStep[] {
  return FUNNEL_EVENTS.map((eventName, index) => {
    const count = counts.get(eventName) ?? 0;
    const previous = index === 0 ? null : counts.get(FUNNEL_EVENTS[index - 1]) ?? 0;
    return {
      eventName,
      label: FUNNEL_LABELS[eventName],
      count,
      rateFromPrevious: previous && previous > 0 ? count / previous : null,
    };
  });
}

export async function getSpecAnalyticsPayload(from: string, to: string): Promise<SpecAnalyticsPayload> {
  const filter = campaignFilter();
  const [conversionRows, campaignRows, searchTermRows, ga4] = await Promise.all([
    loadConversionRows(from, to),
    loadCampaignRows(from, to),
    loadSearchTermRows(from, to),
    loadGa4SpecMetrics(from, to),
  ]);

  const events = buildEvents(conversionRows);
  const counts = new Map<string, number>();
  for (const event of events) increment(counts, event.eventName);

  for (const [eventName, count] of ga4.eventCounts) {
    counts.set(eventName, Math.max(counts.get(eventName) ?? 0, count));
  }
  counts.set("page_view", Math.max(counts.get("page_view") ?? 0, ga4.web.pageViews));

  const campaigns = buildCampaigns(campaignRows, filter);
  const searchTerms = buildSearchTerms(searchTermRows, filter);
  const dailySpend = buildDailySpend(campaignRows, filter);
  const spendCents = campaigns.reduce((sum, row) => sum + row.spendCents, 0);
  const paidDeposits = counts.get("stripe_checkout_completed") ?? 0;
  const checkoutOpens = counts.get("stripe_checkout_opened") ?? 0;
  const payDepositClicks = counts.get("pay_deposit_click") ?? 0;
  const pageViews = counts.get("page_view") ?? 0;
  const defaultOpsSignups = counts.get("spec_default_ops_signup_completed") ?? 0;
  const depositRevenueCents = conversionRows.reduce((sum, row) => {
    if (row.event_name !== "stripe_checkout_completed") return sum;
    const payload = toRecord(row.payload);
    return sum + (typeof payload.value_cents === "number" ? payload.value_cents : 0);
  }, 0);

  return {
    range: { from, to },
    summary: {
      spendCents,
      budgetCapCents: BUDGET_CAP_CENTS,
      paidDeposits,
      checkoutOpens,
      payDepositClicks,
      pageViews,
      defaultOpsSignups,
      depositRevenueCents,
      costPerDepositCents: paidDeposits > 0 ? Math.round(spendCents / paidDeposits) : null,
      bookingRate: pageViews > 0 ? paidDeposits / pageViews : null,
      budgetSpentRate: BUDGET_CAP_CENTS > 0 ? spendCents / BUDGET_CAP_CENTS : 0,
      adCampaignFilter: filter || "ALL",
      ga4Configured: ga4.configured,
    },
    web: ga4.web,
    funnel: buildFunnel(counts),
    campaigns,
    searchTerms,
    dailySpend,
    events,
  };
}

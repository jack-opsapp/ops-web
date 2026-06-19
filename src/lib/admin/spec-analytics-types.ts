export interface SpecAnalyticsSummary {
  spendCents: number;
  budgetCapCents: number;
  paidDeposits: number;
  checkoutOpens: number;
  payDepositClicks: number;
  pageViews: number;
  defaultOpsSignups: number;
  depositRevenueCents: number;
  costPerDepositCents: number | null;
  bookingRate: number | null;
  budgetSpentRate: number;
  adCampaignFilter: string;
  ga4Configured: boolean;
}

export interface SpecFunnelStep {
  eventName: string;
  label: string;
  count: number;
  rateFromPrevious: number | null;
}

export interface SpecEventLedgerRow {
  id: string;
  eventName: string;
  specProjectId: string | null;
  tier: string | null;
  status: string;
  createdAt: string;
  valueCents: number | null;
  campaign: string | null;
  source: string | null;
}

export interface SpecAdCampaignRow {
  campaignName: string;
  spendCents: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpaCents: number | null;
  ctr: number;
}

export interface SpecSearchTermRow {
  searchTerm: string;
  campaignName: string;
  adGroupName: string | null;
  spendCents: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpaCents: number | null;
  ctr: number;
  wasteFlag: string | null;
}

export interface SpecDailySpendPoint {
  date: string;
  spendCents: number;
  clicks: number;
  conversions: number;
}

export interface SpecWebMetrics {
  activeUsers: number;
  sessions: number;
  pageViews: number;
}

export interface SpecAnalyticsPayload {
  range: { from: string; to: string };
  summary: SpecAnalyticsSummary;
  web: SpecWebMetrics;
  funnel: SpecFunnelStep[];
  campaigns: SpecAdCampaignRow[];
  searchTerms: SpecSearchTermRow[];
  dailySpend: SpecDailySpendPoint[];
  events: SpecEventLedgerRow[];
}

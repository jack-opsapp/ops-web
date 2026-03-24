/**
 * OPS Admin — Google Ads API Types
 *
 * SERVER + CLIENT. Safe to import from any component.
 */

/** Constrained day range matching GAQL DURING clause literals */
export type AdsDayRange = 7 | 14 | 30;

export interface GoogleAdsAccountSummary {
  totalSpend: number;       // dollars (converted from micros)
  totalClicks: number;
  totalImpressions: number;
  totalConversions: number;
  avgCpa: number;           // dollars
  avgCtr: number;           // 0-1 decimal
}

export interface CampaignPerformance {
  name: string;
  status: "ENABLED" | "PAUSED" | "REMOVED";
  impressions: number;
  clicks: number;
  ctr: number;              // 0-1 decimal
  cost: number;             // dollars
  conversions: number;
  cpa: number;              // dollars
}

export interface KeywordPerformance {
  keyword: string;
  matchType: "EXACT" | "PHRASE" | "BROAD";
  impressions: number;
  clicks: number;
  cost: number;             // dollars
  conversions: number;
  qualityScore: number | null;
}

export interface SearchTermData {
  searchTerm: string;
  impressions: number;
  clicks: number;
  cost: number;             // dollars
  conversions: number;
}

export interface ConversionBreakdown {
  actionName: string;
  conversions: number;
  cpa: number;              // dollars
  cost: number;             // dollars
}

export interface DailySpend {
  date: string;             // YYYY-MM-DD
  spend: number;            // dollars
  clicks: number;
  conversions: number;
}

/** Full data payload for the Google Ads admin page */
export interface GoogleAdsPageData {
  adsAvailable: boolean;
  summary: GoogleAdsAccountSummary | null;
  campaigns: CampaignPerformance[];
  keywords: KeywordPerformance[];
  searchTerms: SearchTermData[];
  dailySpend: DailySpend[];
  conversions: ConversionBreakdown[];
}

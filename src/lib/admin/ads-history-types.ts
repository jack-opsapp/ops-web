/**
 * OPS Admin — Google Ads History Sync Types
 * Maps to ads_daily_account, ads_daily_campaign, ads_daily_keyword Supabase tables.
 */

export interface AdsDailyAccount {
  date: string;           // YYYY-MM-DD
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpa: number;
  ctr: number;
  synced_at: string;
}

export interface AdsDailyCampaign {
  date: string;
  campaign_name: string;
  campaign_status: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpa: number;
  ctr: number;
  synced_at: string;
}

export interface AdsDailyKeyword {
  date: string;
  keyword: string;
  match_type: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  quality_score: number | null;
  synced_at: string;
}

export interface AdsSyncStatus {
  id: string;
  status: "idle" | "running" | "complete" | "failed";
  last_synced_date: string | null;
  backfill_progress: {
    currentDate: string;
    startDate: string;
    endDate: string;
    totalDays: number;
    completedDays: number;
  } | null;
  error: string | null;
  updated_at: string;
}

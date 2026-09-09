/**
 * OPS Admin — Google Ads History Sync Types
 * Maps to the ads_daily_* warehouse tables plus ads_entities and ads_click_map.
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

/** Keyword grain: one row per day, ad group, and criterion (a keyword can live in several ad groups). */
export interface AdsDailyKeyword {
  date: string;
  campaign_id: string;
  campaign_name: string;
  ad_group_id: string;
  ad_group_name: string;
  criterion_id: string;
  keyword: string;
  match_type: string;
  status: string;
  quality_score: number | null;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  average_cpc: number | null;
  synced_at: string;
}

export interface AdsDailyAdGroup {
  date: string;
  campaign_id: string;
  campaign_name: string;
  ad_group_id: string;
  ad_group_name: string;
  status: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  ctr: number;
  synced_at: string;
}

export interface AdsDailyAd {
  date: string;
  ad_group_id: string;
  ad_id: string;
  ad_type: string;
  status: string;
  ad_strength: string | null;
  approval_status: string | null;
  review_status: string | null;
  final_url: string | null;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  ctr: number;
  synced_at: string;
}

export interface AdsDailyAsset {
  date: string;
  ad_id: string;
  asset_id: string;
  field_type: string;
  performance_label: string | null;
  pinned_field: string | null;
  text: string | null;
  impressions: number;
  clicks: number;
  conversions: number;
  synced_at: string;
}

/** Daily snapshot of the live account structure, keyed by Google resource name. */
export interface AdsEntity {
  resource_name: string;
  entity_type:
    | "campaign"
    | "campaign_budget"
    | "ad_group"
    | "ad"
    | "keyword"
    | "negative_keyword"
    | "shared_set"
    | "shared_criterion"
    | "label";
  parent_resource_name: string | null;
  name: string;
  status: string;
  payload: Record<string, unknown>;
  labels: string[];
  snapshot_at: string;
}

/** gclid → what was clicked; filled from click_view daily, kept forever. */
export interface AdsClickMap {
  gclid: string;
  click_date: string;
  campaign_id: string | null;
  ad_group_id: string | null;
  ad_id: string | null;
  criterion_id: string | null;
  keyword: string | null;
  synced_at: string;
}

export interface AdsDailySearchTerm {
  date: string;
  search_term: string;
  campaign_name: string;
  ad_group_name: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpa: number;
  ctr: number;
  waste_flag: string | null;
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

/**
 * OPS Admin — Google Ads History Supabase Queries
 * SERVER ONLY. Uses admin client (service role, bypasses RLS).
 */
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { CronDatabaseOperationError } from "@/lib/api/services/cron-workload-control-service";
import type {
  AdsDailyAccount,
  AdsDailyCampaign,
  AdsDailyKeyword,
  AdsDailySearchTerm,
  AdsSyncStatus,
} from "./ads-history-types";
import type {
  GoogleAdsAccountSummary,
  CampaignPerformance,
  KeywordPerformance,
  DailySpend,
  SearchTermData,
} from "@/lib/analytics/google-ads-types";

const db = () => getAdminSupabase();

function throwAdsHistoryDatabaseError(
  operation: string,
  error: unknown
): void {
  if (error) {
    throw new CronDatabaseOperationError(
      `ads history ${operation} failed`,
      { cause: error }
    );
  }
}

// ─── Upserts (used by sync) ──────────────────────────────────────────────────

export async function upsertDailyAccount(row: Omit<AdsDailyAccount, "synced_at">): Promise<void> {
  const { error } = await db()
    .from("ads_daily_account")
    .upsert({ ...row, synced_at: new Date().toISOString() }, { onConflict: "date" });
  throwAdsHistoryDatabaseError("daily account upsert", error);
}

export async function upsertDailyAccountBatch(rows: Omit<AdsDailyAccount, "synced_at">[]): Promise<void> {
  if (rows.length === 0) return;
  const withTimestamp = rows.map((r) => ({ ...r, synced_at: new Date().toISOString() }));
  const { error } = await db()
    .from("ads_daily_account")
    .upsert(withTimestamp, { onConflict: "date" });
  throwAdsHistoryDatabaseError("daily account batch upsert", error);
}

export async function upsertDailyCampaigns(rows: Omit<AdsDailyCampaign, "synced_at">[]): Promise<void> {
  if (rows.length === 0) return;
  const withTimestamp = rows.map((r) => ({ ...r, synced_at: new Date().toISOString() }));
  const { error } = await db()
    .from("ads_daily_campaign")
    .upsert(withTimestamp, { onConflict: "date,campaign_name" });
  throwAdsHistoryDatabaseError("daily campaign upsert", error);
}

export async function upsertDailyKeywords(rows: Omit<AdsDailyKeyword, "synced_at">[]): Promise<void> {
  if (rows.length === 0) return;
  const withTimestamp = rows.map((r) => ({ ...r, synced_at: new Date().toISOString() }));
  const { error } = await db()
    .from("ads_daily_keyword")
    .upsert(withTimestamp, { onConflict: "date,keyword" });
  throwAdsHistoryDatabaseError("daily keyword upsert", error);
}

export async function upsertDailySearchTerms(rows: Omit<AdsDailySearchTerm, "synced_at">[]): Promise<void> {
  if (rows.length === 0) return;
  const withTimestamp = rows.map((row) => ({ ...row, synced_at: new Date().toISOString() }));
  const { error } = await db()
    .from("ads_daily_search_term")
    .upsert(withTimestamp, { onConflict: "date,search_term,campaign_name,ad_group_name" });
  throwAdsHistoryDatabaseError("daily search-term upsert", error);
}

// ─── Reads (used by admin page) ──────────────────────────────────────────────

export async function getAccountSummaryFromHistory(
  startDate: string,
  endDate: string
): Promise<GoogleAdsAccountSummary | null> {
  const { data } = await db()
    .from("ads_daily_account")
    .select("*")
    .gte("date", startDate)
    .lte("date", endDate);

  if (!data || data.length === 0) return null;

  const totals = (data as AdsDailyAccount[]).reduce(
    (acc, row) => ({
      totalSpend: acc.totalSpend + Number(row.spend),
      totalClicks: acc.totalClicks + Number(row.clicks),
      totalImpressions: acc.totalImpressions + Number(row.impressions),
      totalConversions: acc.totalConversions + Number(row.conversions),
    }),
    { totalSpend: 0, totalClicks: 0, totalImpressions: 0, totalConversions: 0 }
  );

  return {
    ...totals,
    avgCpa: totals.totalConversions > 0 ? totals.totalSpend / totals.totalConversions : 0,
    avgCtr: totals.totalImpressions > 0 ? totals.totalClicks / totals.totalImpressions : 0,
  };
}

export async function getCampaignsFromHistory(
  startDate: string,
  endDate: string
): Promise<CampaignPerformance[]> {
  const { data } = await db()
    .from("ads_daily_campaign")
    .select("*")
    .gte("date", startDate)
    .lte("date", endDate);

  if (!data || data.length === 0) return [];

  // Aggregate by campaign name across the date range
  const byCampaign = new Map<string, { status: string; spend: number; clicks: number; impressions: number; conversions: number }>();
  for (const row of data as AdsDailyCampaign[]) {
    const existing = byCampaign.get(row.campaign_name);
    if (existing) {
      existing.spend += Number(row.spend);
      existing.clicks += Number(row.clicks);
      existing.impressions += Number(row.impressions);
      existing.conversions += Number(row.conversions);
    } else {
      byCampaign.set(row.campaign_name, {
        status: row.campaign_status,
        spend: Number(row.spend),
        clicks: Number(row.clicks),
        impressions: Number(row.impressions),
        conversions: Number(row.conversions),
      });
    }
  }

  return Array.from(byCampaign.entries())
    .map(([name, d]) => ({
      name,
      status: d.status as CampaignPerformance["status"],
      impressions: d.impressions,
      clicks: d.clicks,
      ctr: d.impressions > 0 ? d.clicks / d.impressions : 0,
      cost: d.spend,
      conversions: d.conversions,
      cpa: d.conversions > 0 ? d.spend / d.conversions : 0,
    }))
    .sort((a, b) => b.cost - a.cost);
}

export async function getKeywordsFromHistory(
  startDate: string,
  endDate: string,
  limit = 50
): Promise<KeywordPerformance[]> {
  const { data } = await db()
    .from("ads_daily_keyword")
    .select("*")
    .gte("date", startDate)
    .lte("date", endDate);

  if (!data || data.length === 0) return [];

  // Aggregate by keyword across the date range
  const byKeyword = new Map<string, { matchType: string; spend: number; clicks: number; impressions: number; conversions: number; qualityScore: number | null }>();
  for (const row of data as AdsDailyKeyword[]) {
    const existing = byKeyword.get(row.keyword);
    if (existing) {
      existing.spend += Number(row.spend);
      existing.clicks += Number(row.clicks);
      existing.impressions += Number(row.impressions);
      existing.conversions += Number(row.conversions);
      if (row.quality_score != null) existing.qualityScore = row.quality_score;
    } else {
      byKeyword.set(row.keyword, {
        matchType: row.match_type,
        spend: Number(row.spend),
        clicks: Number(row.clicks),
        impressions: Number(row.impressions),
        conversions: Number(row.conversions),
        qualityScore: row.quality_score,
      });
    }
  }

  return Array.from(byKeyword.entries())
    .map(([keyword, d]) => ({
      keyword,
      matchType: d.matchType as KeywordPerformance["matchType"],
      impressions: d.impressions,
      clicks: d.clicks,
      cost: d.spend,
      conversions: d.conversions,
      qualityScore: d.qualityScore,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, limit);
}

export async function getSearchTermsFromHistory(
  startDate: string,
  endDate: string,
  limit = 50
): Promise<SearchTermData[]> {
  const { data } = await db()
    .from("ads_daily_search_term")
    .select("*")
    .gte("date", startDate)
    .lte("date", endDate);

  if (!data || data.length === 0) return [];

  const bySearchTerm = new Map<string, {
    searchTerm: string;
    campaignName: string;
    adGroupName: string | null;
    spend: number;
    clicks: number;
    impressions: number;
    conversions: number;
  }>();

  for (const row of data as AdsDailySearchTerm[]) {
    const key = `${row.search_term}\u0000${row.campaign_name}\u0000${row.ad_group_name}`;
    const existing = bySearchTerm.get(key);
    if (existing) {
      existing.spend += Number(row.spend);
      existing.clicks += Number(row.clicks);
      existing.impressions += Number(row.impressions);
      existing.conversions += Number(row.conversions);
    } else {
      bySearchTerm.set(key, {
        searchTerm: row.search_term,
        campaignName: row.campaign_name,
        adGroupName: row.ad_group_name || null,
        spend: Number(row.spend),
        clicks: Number(row.clicks),
        impressions: Number(row.impressions),
        conversions: Number(row.conversions),
      });
    }
  }

  return Array.from(bySearchTerm.values())
    .map((row) => ({
      searchTerm: row.searchTerm,
      campaignName: row.campaignName,
      adGroupName: row.adGroupName,
      impressions: row.impressions,
      clicks: row.clicks,
      cost: row.spend,
      conversions: row.conversions,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, limit);
}

export async function getDailySpendFromHistory(
  startDate: string,
  endDate: string
): Promise<DailySpend[]> {
  const { data } = await db()
    .from("ads_daily_account")
    .select("date, spend, clicks, conversions")
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });

  return (data ?? []).map((row) => ({
    date: row.date,
    spend: Number(row.spend),
    clicks: Number(row.clicks),
    conversions: Number(row.conversions),
  }));
}

/**
 * First and last day with real ad activity in the warehouse (spend, clicks,
 * or impressions above zero). Null until history has been imported. Drives
 * the "all" range preset and the paused-state line on the ads page.
 */
export async function getHistoryBounds(): Promise<{ firstDay: string; lastDay: string } | null> {
  const activity = "spend.gt.0,clicks.gt.0,impressions.gt.0";

  const [{ data: first }, { data: last }] = await Promise.all([
    db()
      .from("ads_daily_account")
      .select("date")
      .or(activity)
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    db()
      .from("ads_daily_account")
      .select("date")
      .or(activity)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!first?.date || !last?.date) return null;
  return { firstDay: String(first.date), lastDay: String(last.date) };
}

/** Check if we have synced data for a given date range. */
export async function hasHistoryData(startDate: string, endDate: string): Promise<boolean> {
  const { count } = await db()
    .from("ads_daily_account")
    .select("*", { count: "exact", head: true })
    .gte("date", startDate)
    .lte("date", endDate);
  return (count ?? 0) > 0;
}

// ─── Sync Status ─────────────────────────────────────────────────────────────

export async function getSyncStatus(id: "daily-sync" | "backfill"): Promise<AdsSyncStatus | null> {
  const { data } = await db()
    .from("ads_sync_status")
    .select("*")
    .eq("id", id)
    .single();
  return data as AdsSyncStatus | null;
}

export async function updateSyncStatus(
  id: "daily-sync" | "backfill",
  update: Partial<Omit<AdsSyncStatus, "id">>
): Promise<void> {
  const { error } = await db()
    .from("ads_sync_status")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", id);
  throwAdsHistoryDatabaseError("sync status update", error);
}

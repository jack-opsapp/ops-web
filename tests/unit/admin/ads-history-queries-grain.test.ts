/**
 * The new warehouse upserts must target the natural keys the migration
 * declares — a wrong onConflict silently duplicates or rejects rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const upserts: Array<{ table: string; rows: unknown[]; options: unknown }> = [];
vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => ({
    from(table: string) {
      return {
        upsert: async (rows: unknown[], options: unknown) => {
          upserts.push({ table, rows, options });
          return { error: null };
        },
      };
    },
  }),
}));

import {
  upsertDailyAdGroups,
  upsertDailyAds,
  upsertDailyAssets,
  upsertDailyKeywords,
  upsertClickMap,
  upsertEntitySnapshot,
} from "@/lib/admin/ads-history-queries";

beforeEach(() => {
  upserts.length = 0;
});

describe("warehouse grain upserts", () => {
  it("target the declared natural keys and stamp synced_at", async () => {
    await upsertDailyAdGroups([{ date: "2026-09-01", campaign_id: "c", campaign_name: "C", ad_group_id: "g", ad_group_name: "G", status: "ENABLED", spend: 1, clicks: 1, impressions: 1, conversions: 0, ctr: 1 }]);
    await upsertDailyAds([{ date: "2026-09-01", ad_group_id: "g", ad_id: "a", ad_type: "RESPONSIVE_SEARCH_AD", status: "ENABLED", ad_strength: "GOOD", approval_status: "APPROVED", review_status: "REVIEWED", final_url: "https://try.opsapp.co/", spend: 1, clicks: 1, impressions: 1, conversions: 0, ctr: 1 }]);
    await upsertDailyAssets([{ date: "2026-09-01", ad_id: "a", asset_id: "s", field_type: "HEADLINE", performance_label: "BEST", pinned_field: null, text: "Job management your crew will use", impressions: 1, clicks: 1, conversions: 0 }]);
    await upsertDailyKeywords([{ date: "2026-09-01", campaign_id: "c", campaign_name: "C", ad_group_id: "g", ad_group_name: "G", criterion_id: "k", keyword: "jobber alternative", match_type: "PHRASE", status: "ENABLED", quality_score: 7, spend: 1, clicks: 1, impressions: 1, conversions: 0, average_cpc: 1 }]);
    await upsertClickMap([{ gclid: "x", click_date: "2026-09-01", campaign_id: "c", ad_group_id: "g", ad_id: "a", criterion_id: "k", keyword: "jobber alternative" }]);
    await upsertEntitySnapshot([{ resource_name: "customers/1/campaigns/1", entity_type: "campaign", parent_resource_name: null, name: "C", status: "PAUSED", payload: { a: 1 }, labels: [] }]);

    expect(upserts.map((u) => [u.table, (u.options as { onConflict: string }).onConflict])).toEqual([
      ["ads_daily_ad_group", "date,ad_group_id"],
      ["ads_daily_ad", "date,ad_id"],
      ["ads_daily_asset", "date,ad_id,asset_id,field_type"],
      ["ads_daily_keyword", "date,ad_group_id,criterion_id"],
      ["ads_click_map", "gclid"],
      ["ads_entities", "resource_name"],
    ]);
    for (const u of upserts) {
      const row = u.rows[0] as Record<string, unknown>;
      const stamp = u.table === "ads_entities" ? row.snapshot_at : row.synced_at;
      expect(typeof stamp).toBe("string");
    }
  });

  it("skip the round trip on empty input", async () => {
    await upsertDailyAdGroups([]);
    await upsertClickMap([]);
    await upsertEntitySnapshot([]);
    expect(upserts).toEqual([]);
  });
});

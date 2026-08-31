import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260831040000_analytics_source_replace_rpc.sql"
  ),
  "utf8"
);

describe("analytics source replacement migration", () => {
  it("keeps both replacement functions service-role only", () => {
    expect(sql).toMatch(/replace_search_console_daily[\s\S]*security definer/);
    expect(sql).toMatch(/replace_ga4_daily_acquisition[\s\S]*security definer/);
    expect(sql).toMatch(
      /revoke all on function public\.replace_search_console_daily[\s\S]*from public, anon, authenticated/
    );
    expect(sql).toMatch(
      /grant execute on function public\.replace_search_console_daily[\s\S]*to service_role/
    );
    expect(sql).toMatch(
      /revoke all on function public\.replace_ga4_daily_acquisition[\s\S]*from public, anon, authenticated/
    );
  });

  it("replaces raw and normalized rows in one database transaction", () => {
    expect(sql).toMatch(
      /delete from public\.search_console_daily[\s\S]*insert into public\.search_console_daily[\s\S]*delete from public\.channel_metrics[\s\S]*insert into public\.channel_metrics/
    );
    expect(sql).toMatch(
      /delete from public\.ga4_daily_acquisition[\s\S]*insert into public\.ga4_daily_acquisition[\s\S]*delete from public\.channel_metrics[\s\S]*insert into public\.channel_metrics/
    );
  });

  it("seeds one ordered channel map instead of embedding dashboard labels", () => {
    expect(sql).toContain("'ga4', 'Organic Search'");
    expect(sql).toContain("'ga4', 'Paid Search', 'google'");
    expect(sql).toContain("'ga4', null, null, null, 'other'");
    expect(sql).toContain("on conflict (source_system, raw_channel, raw_source, raw_medium)");
  });
});

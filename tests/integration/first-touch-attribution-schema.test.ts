import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260831011800_first_touch_attribution_rpc.sql"
);
const sql = readFileSync(migrationPath, "utf8").toLowerCase();

describe("first-touch attribution database contract", () => {
  it("updates the seeded attribution and inserts its touchpoint in one RPC", () => {
    expect(sql).toContain(
      "create or replace function public.record_first_touch_attribution"
    );
    expect(sql).toContain("from public.trial_attributions");
    expect(sql).toContain("for update");
    expect(sql).toContain("update public.trial_attributions");
    expect(sql).toContain("insert into public.touchpoints");
    expect(sql).toContain("'trial_attribution_not_seeded'");
  });

  it("preserves first touch and makes retry deduplication explicit", () => {
    expect(sql).toContain("'first_touch_preserved'");
    expect(sql).toContain("'duplicate_ignored'");
    expect(sql).toContain("dedupe_key");
    expect(sql).toContain("order by occurred_at asc, created_at asc");
  });

  it("stores only allowlisted source fields and canonical paths", () => {
    expect(sql).toContain("strpos(v_landing_path, '?') > 0");
    expect(sql).toContain("strpos(v_landing_path, '#') > 0");
    expect(sql).not.toMatch(/p_touch\s*->>\s*'(email|phone|name|user_id)'/);
    expect(sql).toContain("'utm_source', v_utm_source");
    expect(sql).toContain("'utm_term', v_utm_term");
  });

  it("keeps browser roles out and limits execution to the service role", () => {
    expect(sql).toContain(
      "revoke all on function public.record_first_touch_attribution(uuid, jsonb)"
    );
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain(
      "grant execute on function public.record_first_touch_attribution(uuid, jsonb)"
    );
    expect(sql).toContain("to service_role");
  });

  it("scrubs raw click IDs after 30 days while retaining classification", () => {
    expect(sql).toContain(
      "create or replace function public.expire_attribution_click_ids"
    );
    expect(sql).toContain("set gclid = null");
    expect(sql).toContain("fbclid = null");
    expect(sql).toContain("set click_ids = '{}'::jsonb");
    expect(sql).toContain("v_occurred_at < now() - interval '30 days'");
    expect(sql).not.toMatch(/set\s+attributed_channel\s*=\s*null/);
  });
});

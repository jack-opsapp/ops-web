import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260609181500_create_notification_if_new_deep_link_type.sql"
  ),
  "utf8"
);

describe("create_notification_if_new deep_link_type migration", () => {
  it("is transaction-wrapped and sentinel-guarded", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(sql).toContain("create_notification_if_new_deep_link_sentinel");
    expect(sql).toContain("raise exception");
  });

  it("sentinel proves the COLUMN is written (not just the parameter) and the absent-function guard is live", () => {
    // Live missing-function guard: to_regprocedure returns NULL instead of throwing.
    expect(sql).toContain("to_regprocedure");
    // Column-vs-parameter check: the regex only matches `deep_link_type` when it
    // is not part of the `p_deep_link_type` parameter name.
    expect(sql).toContain("[^_]deep_link_type");
  });

  it("drops the legacy 9-arg signature so the new arg cannot create an overload", () => {
    expect(sql).toContain(
      "drop function if exists public.create_notification_if_new(text, text, text, text, text, boolean, text, text, text)"
    );
  });

  it("recreates the RPC with a trailing p_deep_link_type arg that writes the column", () => {
    expect(sql).toContain("create or replace function public.create_notification_if_new");
    expect(sql).toContain("p_deep_link_type text default null");
    expect(sql).toContain("deep_link_type");
    expect(sql.toLowerCase()).toContain("on conflict do nothing");
    // The dedupe behaviour is unchanged — no hard-coded conflict target.
    expect(sql).not.toContain("ON CONFLICT (user_id, company_id, type, title)");
  });

  it("re-grants execute after the drop so clients keep their grant", () => {
    expect(sql).toContain("grant execute on function public.create_notification_if_new");
    expect(sql).toContain("to anon, authenticated, service_role");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260831020500_reconcile_self_reported_attribution.sql"
);
const sql = readFileSync(migrationPath, "utf8").toLowerCase();

describe("self-reported attribution database contract", () => {
  it("stamps inserts and later iOS referral updates", () => {
    expect(sql).toContain(
      "create or replace function public.stamp_company_self_reported_attribution"
    );
    expect(sql).toContain("after insert on public.companies");
    expect(sql).toContain("after update of referral_method on public.companies");
    expect(sql).toContain("set self_reported_source = v_source");
  });

  it("maps only stable slugs in storage", () => {
    for (const slug of [
      "instagram",
      "facebook",
      "youtube",
      "google",
      "app_store",
      "word_of_mouth",
      "other",
    ]) {
      expect(sql).toContain(`when '${slug}' then`);
    }
    expect(sql).not.toContain("when 'internet advertisement' then");
    expect(sql).toContain("'self_reported_unmapped'");
  });

  it("never replaces deterministic attribution", () => {
    expect(sql).toContain(
      "ta.attribution_basis not in ('unknown', 'self_reported')"
    );
    expect(sql).toContain("then ta.attributed_channel");
    expect(sql).toContain("then ta.attribution_basis");
  });

  it("keeps blank answers unknown rather than inventing Direct", () => {
    expect(sql).toContain("when v_source is null then 'self_reported_blank'");
    expect(sql).toContain("when v_channel is null then 'unknown'");
  });

  it("cannot be called by browser roles", () => {
    expect(sql).toContain(
      "revoke all on function public.stamp_company_self_reported_attribution()"
    );
    expect(sql).toContain("from public, anon, authenticated");
  });
});

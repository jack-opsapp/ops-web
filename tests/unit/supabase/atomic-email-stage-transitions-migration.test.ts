import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260713202000_atomic_email_stage_transitions.sql"
  ),
  "utf8"
);

describe("atomic email stage transition migration", () => {
  it("is service-role only and locks before an atomic update plus audit insert", () => {
    expect(migration).toMatch(/auth\.role\(\)[\s\S]*?service_role/i);
    expect(migration).toMatch(/from public\.opportunities[\s\S]*?for update/i);
    expect(migration).toMatch(
      /update public\.opportunities[\s\S]*?insert into public\.stage_transitions/i
    );
    expect(migration).toMatch(
      /revoke all on function public\.apply_email_opportunity_stage_transition[\s\S]*?from public, anon, authenticated/i
    );
  });

  it("is retry-safe and refuses manual or terminal opportunity stages", () => {
    expect(migration).toMatch(
      /v_stage_manually_set[\s\S]*?v_from_stage in \('won', 'lost', 'discarded'\)[\s\S]*?v_from_stage = p_to_stage[\s\S]*?select false/i
    );
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260903210500_lifecycle_decision_evidence_high_water.sql"
);

function migration(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("lifecycle decision evidence high-water migration", () => {
  it("adds the high-water columns before redefining the function", () => {
    const sql = migration();
    const alter = sql.indexOf(
      "alter table public.opportunity_lifecycle_decisions"
    );
    const fn = sql.indexOf(
      "create or replace function public.record_opportunity_lifecycle_decision("
    );
    expect(alter).toBeGreaterThan(-1);
    expect(fn).toBeGreaterThan(alter);
    expect(sql).toMatch(
      /add column if not exists evidence_event_ids_high_water uuid\[\]/i
    );
    expect(sql).toMatch(
      /add column if not exists evidence_message_ids_high_water text\[\]/i
    );
    expect(sql).toMatch(
      /add column if not exists evidence_high_water_at timestamptz/i
    );
  });

  it("backfills existing receipts so the union is well defined", () => {
    expect(migration()).toMatch(
      /update public\.opportunity_lifecycle_decisions\s+set evidence_event_ids_high_water = evidence_event_ids/i
    );
  });

  it("still conflicts on every conclusion field", () => {
    const sql = migration();
    for (const field of [
      "company_id",
      "proposed_stage",
      "proposed_outcome",
      "confidence",
      "reason",
      "initial_status",
      "initial_review_reason",
    ]) {
      expect(sql).toContain(`v_existing.${field} is distinct from`);
    }
    expect(sql).toMatch(
      /raise exception 'lifecycle_decision_replay_conflict' using errcode = '23505';/i
    );
  });

  it("never treats an evidence difference as a conflict", () => {
    const sql = migration();
    const conflictBlock = sql.slice(
      sql.indexOf("if v_existing.company_id is distinct from p_company_id"),
      sql.indexOf("raise exception 'lifecycle_decision_replay_conflict'")
    );
    expect(conflictBlock).not.toContain("evidence_event_ids");
    expect(conflictBlock).not.toContain("evidence_message_ids");
  });

  it("never rewrites the as-decided evidence", () => {
    const sql = migration();
    const updateBlock = sql.slice(
      sql.indexOf("update public.opportunity_lifecycle_decisions decision")
    );
    expect(updateBlock).toContain(
      "set evidence_event_ids_high_water = v_event_union"
    );
    expect(updateBlock).not.toMatch(/set[\s\S]{0,200}?\bevidence_event_ids =/);
    expect(updateBlock).not.toMatch(/\bevidence_message_ids =[^_]/);
  });

  it("locks the receipt for the read-modify-write and names the impossible state", () => {
    const sql = migration();
    expect(sql).toMatch(
      /and decision\.decision_key = btrim\(p_decision_key\)\s+for update;/i
    );
    expect(sql).toMatch(
      /raise exception 'lifecycle_decision_receipt_missing' using errcode = 'P0002';/i
    );
  });

  it("preserves the service-role boundary and the source-in-evidence precondition", () => {
    const sql = migration();
    expect(sql).toMatch(/language plpgsql\s+security definer/i);
    expect(sql).toMatch(/set search_path = ''/i);
    expect(sql).toMatch(
      /if coalesce\(auth\.role\(\), ''\) <> 'service_role' then\s+raise exception 'access_denied' using errcode = '42501';/i
    );
    expect(sql).toMatch(
      /not \(p_source_event_id = any\(coalesce\(p_evidence_event_ids, '\{\}'::uuid\[\]\)\)\)/i
    );
    expect(sql).toMatch(
      /raise exception 'invalid_lifecycle_decision' using errcode = '22023';/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_opportunity_lifecycle_decision\(\s*uuid, uuid, uuid, text, text, text, text, numeric, uuid\[\], text\[\], text, text, text\s*\)\s*to service_role;/i
    );
  });
});

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase/migrations");
const migrationName = readdirSync(migrationsDir).find((name) =>
  name.endsWith("_phase_c_workload_fk_indexes.sql")
);
const migrationPath = join(migrationsDir, migrationName ?? "missing.sql");
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";

describe("Phase C workload foreign-key indexes migration", () => {
  it("covers every relationship the production advisor identified", () => {
    for (const definition of [
      "on public.opportunity_phase_c_work (company_id, opportunity_id)",
      "on public.opportunity_phase_c_work (company_id, required_event_id)",
      "on public.opportunity_phase_c_work (required_activity_id)",
      "on public.opportunity_phase_c_work (summary_completed_event_id)",
      "on public.opportunity_phase_c_work (lifecycle_completed_event_id)",
      "on public.opportunity_phase_c_work (commercial_completed_event_id)",
      "on public.opportunity_phase_c_work (event_handoff_completed_event_id)",
      "on public.opportunity_lifecycle_decisions (company_id, opportunity_id)",
      "on public.opportunity_lifecycle_decisions (company_id, source_event_id)",
      "on public.phase_c_bilateral_event_handoffs (decision_id)",
      "on public.phase_c_bilateral_event_handoffs (company_id, opportunity_id)",
      "on public.phase_c_bilateral_event_handoffs (company_id, proposal_event_id)",
      "on public.phase_c_bilateral_event_handoffs (company_id, acceptance_event_id)",
      "on public.phase_c_bilateral_event_handoffs (requested_owner_user_id)",
    ]) {
      expect(source).toContain(definition);
    }
  });

  it("uses additive idempotent indexes only", () => {
    expect(source).toContain("begin;");
    expect(source).toContain("commit;");
    expect(source.match(/create index if not exists/gi)).toHaveLength(14);
    expect(source).not.toMatch(/\b(drop|delete|update|insert|alter table)\b/i);
  });
});

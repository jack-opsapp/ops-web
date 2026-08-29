import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const claimMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260830113000_phase_c_claim_null_safe.sql"
);

function claimMigration(): string {
  return readFileSync(claimMigrationPath, "utf8");
}

describe("phase c work claim null-safety migration", () => {
  it("claims a row whenever any component marker differs from the required event", () => {
    const sql = claimMigration();

    expect(sql).toMatch(
      /and \(\s+work\.summary_completed_event_id is distinct from work\.required_event_id\s+or work\.lifecycle_completed_event_id is distinct from work\.required_event_id\s+or work\.commercial_completed_event_id is distinct from work\.required_event_id\s+or work\.event_handoff_completed_event_id is distinct from work\.required_event_id\s+\)/i
    );
  });

  it("drops the null-sensitive exclusion that stranded fresh queue rows", () => {
    const sql = claimMigration();

    expect(sql).not.toMatch(/and not \(/i);
    expect(sql).not.toMatch(
      /work\.summary_completed_event_id = work\.required_event_id/i
    );
  });

  it("keeps the claim gates that bound the queue", () => {
    const sql = claimMigration();

    expect(sql).toMatch(/where work\.completed_at is null/i);
    expect(sql).toMatch(/and work\.next_attempt_at <= now\(\)/i);
    expect(sql).toMatch(
      /and \(work\.lease_expires_at is null or work\.lease_expires_at <= now\(\)\)/i
    );
    expect(sql).toMatch(/for update skip locked/i);
    expect(sql).toMatch(/attempt_count = work\.attempt_count \+ 1/i);
  });

  it("preserves the service-role boundary", () => {
    const sql = claimMigration();

    expect(sql).toMatch(/language plpgsql\s+security definer/i);
    expect(sql).toMatch(/set search_path = ''/i);
    expect(sql).toMatch(
      /if coalesce\(auth\.role\(\), ''\) <> 'service_role' then\s+raise exception 'access_denied' using errcode = '42501';/i
    );
    expect(sql).toMatch(
      /revoke all on function public\.claim_opportunity_phase_c_work\(text, integer, integer\)\s+from public, anon, authenticated;/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.claim_opportunity_phase_c_work\(text, integer, integer\)\s+to service_role;/i
    );
  });
});

const learningApplyMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260830113300_apply_email_outbound_learning_public_vector_resource.sql"
);

function learningApplyMigration(): string {
  return readFileSync(learningApplyMigrationPath, "utf8");
}

/** Executable SQL only — the header comment names the cast it replaced. */
function learningApplyStatements(): string {
  return learningApplyMigration()
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

describe("learning apply function public.vector re-source migration", () => {
  it("casts the stored embedding through the schema the type actually lives in", () => {
    const sql = learningApplyStatements();

    expect(sql).toMatch(
      /\(v_fact_json -> 'embedding'\)::text::public\.vector\(1536\)/
    );
    expect(sql).not.toMatch(/extensions\.vector/);
  });

  it("replaces the renamed legacy body, not the public wrapper", () => {
    const sql = learningApplyStatements();

    expect(sql).toMatch(
      /create or replace function public\.apply_email_outbound_learning_legacy_internal\(\s*p_job_id uuid,\s*p_lease_token uuid\s*\)/
    );
    expect(sql).toMatch(/returns public\.email_outbound_learning_queue/);
    expect(sql).not.toMatch(
      /create or replace function public\.apply_email_outbound_learning\(/
    );
  });

  it("keeps the lease boundary and the grant boundary", () => {
    const sql = learningApplyMigration();

    expect(sql).toMatch(/language plpgsql\s+security definer/i);
    expect(sql).toMatch(/set search_path = pg_catalog, pg_temp/i);
    expect(sql).toMatch(/outbound learning application lost lease ownership/);
    expect(sql).toMatch(
      /revoke all on function public\.apply_email_outbound_learning_legacy_internal\(\s*uuid, uuid\s*\) from public, anon, authenticated, service_role;/
    );
  });
});

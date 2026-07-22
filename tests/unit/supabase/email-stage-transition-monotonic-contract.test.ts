import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const FUNCTION_MARKER =
  "create or replace function public.apply_email_opportunity_stage_transition";

function latestStageTransitionMigration(): {
  filename: string;
  sql: string;
  functionBody: string;
} {
  const definitions = readdirSync(MIGRATIONS_DIR)
    .filter((filename) => filename.endsWith(".sql"))
    .sort()
    .map((filename) => ({
      filename,
      sql: readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8"),
    }))
    .filter(({ sql }) => sql.toLowerCase().includes(FUNCTION_MARKER));

  const latest = definitions.at(-1);
  if (!latest) {
    throw new Error(
      "No migration defines apply_email_opportunity_stage_transition"
    );
  }

  const functionStart = latest.sql.toLowerCase().lastIndexOf(FUNCTION_MARKER);
  const functionEnd = latest.sql.indexOf("$function$;", functionStart);
  if (functionEnd === -1) {
    throw new Error(
      `${latest.filename} does not terminate the stage-transition function`
    );
  }

  return {
    ...latest,
    functionBody: latest.sql.slice(
      functionStart,
      functionEnd + "$function$;".length
    ),
  };
}

const latest = latestStageTransitionMigration();
const compactBody = latest.functionBody.replace(/\s+/g, " ").toLowerCase();

describe(`latest email stage-transition contract (${latest.filename})`, () => {
  it("rejects new_lead regression while allowing snapshot-guarded active lifecycle loops", () => {
    expect(compactBody).toMatch(/p_to_stage is null or p_to_stage not in \(/);
    expect(compactBody).toMatch(
      /p_expected_stage is null[\s\S]*?p_expected_assignment_version is null/
    );
    expect(compactBody).toMatch(
      /v_from_stage is distinct from p_expected_stage[\s\S]*?'snapshot_mismatch'/
    );
    expect(compactBody).toMatch(
      /v_assignment_version is distinct from p_expected_assignment_version[\s\S]*?'assignment_snapshot_mismatch'/
    );
    expect(compactBody).toMatch(
      /p_to_stage = 'new_lead'[\s\S]*?v_from_stage <> 'new_lead'[\s\S]*?return query select false/i
    );
    expect(compactBody).not.toContain("v_from_stage_rank");
    expect(compactBody).not.toContain("v_to_stage_rank");

    const lockIndex = compactBody.indexOf("for update");
    const regressionGuardIndex = compactBody.indexOf("p_to_stage = 'new_lead'");
    const updateIndex = compactBody.indexOf("update public.opportunities");
    expect(lockIndex).toBeGreaterThan(-1);
    expect(regressionGuardIndex).toBeGreaterThan(lockIndex);
    expect(updateIndex).toBeGreaterThan(regressionGuardIndex);
  });

  it("locks the opportunity before its correspondence child row", () => {
    const marker =
      "create or replace function public.apply_opportunity_correspondence_event";
    const start = latest.sql.toLowerCase().lastIndexOf(marker);
    const end = latest.sql.indexOf("$function$;", start);
    const correspondenceBody = latest.sql
      .slice(start, end + "$function$;".length)
      .replace(/\s+/g, " ")
      .toLowerCase();
    const opportunityLock = correspondenceBody.indexOf(
      "from public.opportunities opportunity"
    );
    const eventLock = correspondenceBody.indexOf(
      "from public.opportunity_correspondence_events event"
    );
    expect(opportunityLock).toBeGreaterThan(-1);
    expect(eventLock).toBeGreaterThan(opportunityLock);
  });

  it("serializes correspondence insertion on the canonical opportunity lock", () => {
    const marker =
      "create or replace function private.lock_opportunity_for_correspondence_insert";
    const start = latest.sql.toLowerCase().lastIndexOf(marker);
    const end = latest.sql.indexOf("$function$;", start);
    const insertLockBody = latest.sql
      .slice(start, end + "$function$;".length)
      .replace(/\s+/g, " ")
      .toLowerCase();
    const compactMigration = latest.sql.replace(/\s+/g, " ").toLowerCase();

    expect(start).toBeGreaterThan(-1);
    expect(insertLockBody).toMatch(
      /new\.opportunity_id[\s\S]*?new\.company_id[\s\S]*?for update/
    );
    expect(insertLockBody).toContain("return new");
    expect(compactMigration).toMatch(
      /create trigger opportunity_correspondence_events_lock_opportunity_insert before insert on public\.opportunity_correspondence_events[\s\S]*?private\.lock_opportunity_for_correspondence_insert\(\)/
    );
    expect(compactMigration).toMatch(
      /revoke all on function private\.lock_opportunity_for_correspondence_insert\(\)[\s\S]*?service_role/
    );
  });

  it("preserves a manual stage override and returns without mutating it", () => {
    expect(compactBody).toMatch(
      /coalesce\(v_stage_manually_set, false\)[\s\S]*?return query select false, v_from_stage, v_stage_manually_set/i
    );

    const updateStart = compactBody.indexOf("update public.opportunities");
    const transitionInsert = compactBody.indexOf(
      "insert into public.stage_transitions"
    );
    const updateClause = compactBody.slice(updateStart, transitionInsert);
    expect(updateClause).not.toMatch(/stage_manually_set\s*=/i);
  });

  it("keeps reassignment and manual overrides authoritative while making an exact-stage retry idempotent", () => {
    expect(compactBody).toMatch(
      /v_from_stage\s*=\s*p_to_stage[\s\S]*?return query select false, v_from_stage, v_stage_manually_set/i
    );

    const assignmentGuardIndex = compactBody.indexOf(
      "if v_assignment_version is distinct from p_expected_assignment_version"
    );
    const manualGuardIndex = compactBody.indexOf(
      "if coalesce(v_stage_manually_set, false)"
    );
    const retryGuardIndex = compactBody.indexOf("if v_from_stage = p_to_stage");
    const stageSnapshotGuardIndex = compactBody.indexOf(
      "if v_from_stage is distinct from p_expected_stage"
    );
    const updateIndex = compactBody.indexOf("update public.opportunities");
    const transitionInsertIndex = compactBody.indexOf(
      "insert into public.stage_transitions"
    );
    expect(assignmentGuardIndex).toBeGreaterThan(-1);
    expect(manualGuardIndex).toBeGreaterThan(assignmentGuardIndex);
    expect(retryGuardIndex).toBeGreaterThan(manualGuardIndex);
    expect(stageSnapshotGuardIndex).toBeGreaterThan(retryGuardIndex);
    expect(updateIndex).toBeGreaterThan(retryGuardIndex);
    expect(transitionInsertIndex).toBeGreaterThan(updateIndex);
  });

  it("never changes assignment ownership through the lifecycle transition", () => {
    const opportunityUpdate = compactBody.slice(
      compactBody.indexOf("update public.opportunities"),
      compactBody.indexOf("insert into public.stage_transitions")
    );

    expect(opportunityUpdate).not.toMatch(/assigned_to\s*=/);
    expect(compactBody).toContain("assignment_snapshot_mismatch");
  });
});

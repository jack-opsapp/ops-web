import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_NAME =
  "20260812120000_agent_operational_schedule_readiness.sql";
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations", MIGRATION_NAME),
  "utf8"
).toLowerCase();

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const COMPACT_MIGRATION = compact(MIGRATION);

function functionDefinition(name: string): string {
  const marker = `create or replace function ${name}(`;
  const start = MIGRATION.lastIndexOf(marker);
  if (start < 0) return "";
  const source = MIGRATION.slice(start);
  const delimiter = /\bas\s+(\$[a-z0-9_]*\$)/.exec(source)?.[1];
  if (!delimiter) return "";
  const end = source.indexOf(`${delimiter};`);
  return end < 0 ? "" : source.slice(0, end + delimiter.length + 1);
}

const RPC = compact(
  functionDefinition("public.read_agent_scheduled_jobs_as_system")
);
const CONFIRMATION_TRIGGER = compact(
  functionDefinition("private.bump_project_task_schedule_version")
);
const CONFIRM = compact(
  functionDefinition("public.confirm_project_task_schedule_as_system")
);
const AUTO_CONFIRM = compact(
  functionDefinition("public.confirm_automatic_project_task_schedule_as_system")
);
const UNCONFIRM = compact(
  functionDefinition("public.unconfirm_project_task_schedule_as_system")
);
const WALL_TIME_PARSER = compact(
  functionDefinition("private.agent_parse_schedule_wall_time")
);
const CIVIL_DATE_START = compact(
  functionDefinition("private.agent_civil_date_start")
);

describe("scheduled jobs fixed RPC contract", () => {
  it("is one transactional service-role-only function with a fixed search path", () => {
    expect(MIGRATION).toMatch(/^--[\s\S]*?\nbegin;/);
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
    expect(RPC).toContain(
      "language plpgsql stable security definer set search_path = pg_catalog, public, private, extensions, pg_temp"
    );
    expect(RPC).toContain("auth.role() is distinct from 'service_role'");
    expect(MIGRATION).toMatch(
      /revoke all on function public\.read_agent_scheduled_jobs_as_system\([\s\S]*?from public, anon, authenticated, service_role;/
    );
    expect(MIGRATION).toMatch(
      /grant execute on function public\.read_agent_scheduled_jobs_as_system\([\s\S]*?to service_role;/
    );
  });

  it("pins the v4 capability, complete registry proof, exact scopes, and current actor revision", () => {
    expect(RPC).toContain("p_registered_permission_keys text[]");
    expect(RPC).toContain("p_permission_snapshot_revision text");
    expect(RPC).toContain(
      "p_capability_id is distinct from 'list_scheduled_jobs'"
    );
    expect(RPC).toContain("'list_scheduled_jobs:2026-08-07.v1'");
    expect(RPC).toContain("'2026-08-12.capability-manifest.v4'");
    expect(RPC).toMatch(
      /p_required_oauth_scopes is distinct from\s+array\['ops\.jobs\.read', 'ops\.schedule\.read'\]::text\[\]/
    );
    for (const permission of ["calendar.view", "projects.view", "tasks.view"]) {
      expect(RPC).toContain(
        `'${permission}' = any(p_registered_permission_keys)`
      );
      expect(RPC).toContain(
        `permission.value ->> 'permission' = '${permission}'`
      );
    }
    expect(RPC).toContain(
      "private.resolve_agent_actor_authority( p_actor_user_id, p_company_id, p_registered_permission_keys )"
    );
    expect(RPC).toContain(
      "authority.permission_snapshot_revision = p_permission_snapshot_revision"
    );
    expect(RPC).toContain(
      "select count(distinct registry.permission_key) from unnest(p_registered_permission_keys)"
    );
  });

  it("intersects calendar, task, and project scopes with direct operational assignment", () => {
    expect(RPC).toContain(
      "private.agent_user_can_access_entity( p_actor_user_id, p_company_id, 'project', project.id, 'view' )"
    );
    expect(RPC).toContain(
      "private.agent_user_can_access_entity( p_actor_user_id, p_company_id, 'task', task.id, 'view' )"
    );
    expect(RPC).toMatch(
      /context\.calendar_scope = 'own'[\s\S]{0,180}p_actor_user_id::text = any\(\s*coalesce\(task\.team_member_ids/
    );
    expect(RPC).toMatch(
      /context\.tasks_scope = 'all' or p_actor_user_id::text = any\(\s*coalesce\(task\.team_member_ids/
    );
    expect(RPC).toMatch(
      /context\.projects_scope = 'all' or exists \( select 1 from public\.project_tasks project_assignment[\s\S]{0,420}project_assignment\.status = 'active'[\s\S]{0,180}p_actor_user_id::text = any/
    );
  });

  it("uses only current project tasks and prompt-safe task/project/user columns", () => {
    expect(RPC).toContain("join public.project_tasks task");
    expect(RPC).toContain("join public.projects project");
    expect(RPC).toContain("left join public.task_types task_type");
    expect(RPC).toContain("join public.users crew_user");
    expect(RPC).toContain("task.deleted_at is null");
    expect(RPC).toContain("project.deleted_at is null");
    expect(RPC).not.toContain("site_visits");
    expect(RPC).not.toContain("project_photos");
    expect(RPC).not.toContain("email");
    expect(RPC).not.toContain("phone");
    expect(RPC).not.toContain("crew_user.role");
  });

  it("bounds source work, keyset rows, crew materialization, and every aggregate", () => {
    const boundedSource = RPC.slice(
      RPC.indexOf("authorized_task_candidate as materialized"),
      RPC.indexOf("authorized_task as materialized")
    );
    const sourceLimit = RPC.indexOf("limit 2501");
    const pageLimit = RPC.indexOf("limit p_limit + 1");
    const firstPageWindow = RPC.indexOf("row_number() over", pageLimit);
    const firstJsonAggregate = RPC.indexOf("jsonb_agg(");
    expect(RPC).toContain("p_limit is null");
    expect(RPC).toContain("p_limit > 50");
    expect(RPC).toContain("p_cursor_start_utc");
    expect(RPC).toContain("p_cursor_task_id");
    expect(RPC).toContain("p_cursor_source_revision");
    expect(RPC).toContain("p_read_as_of");
    expect(sourceLimit).toBeGreaterThan(0);
    expect(boundedSource).toContain(
      "order by task.start_date, task.id limit 2501"
    );
    expect(pageLimit).toBeGreaterThan(sourceLimit);
    expect(firstPageWindow).toBeGreaterThan(pageLimit);
    expect(firstJsonAggregate).toBeGreaterThan(pageLimit);
    expect(RPC).toContain("[1:100]");
    expect(RPC).toContain("crew.crew_rank <= 50");
    expect(RPC).toContain("running_raw_assignment_count <= 100");
    expect(RPC).not.toContain("candidate_total");
    expect(RPC).not.toContain("occurrence_total");
    expect(RPC).toContain("'returned_occurrence_count'");
    expect(RPC).not.toMatch(/\boffset\s+p_/);
    expect(RPC).not.toMatch(/\bselect\s+\*/);
  });

  it("preserves UTC date carriers, overnight timed tasks, and fails gaps/folds closed", () => {
    expect(RPC).toContain("task.start_date at time zone 'utc'");
    expect(RPC).not.toContain("private.agent_parse_schedule_wall_time(task.");
    expect(RPC).toContain("task.start_time is null");
    expect(RPC).toContain("task.end_time is null");
    expect(WALL_TIME_PARSER).toContain("language plpgsql immutable strict");
    expect(WALL_TIME_PARSER).toContain("if p_value !~");
    expect(WALL_TIME_PARSER).toContain("return null");
    expect(WALL_TIME_PARSER).toContain("return p_value::time");
    expect(RPC).not.toMatch(/task\.(?:start_time|end_time)\s*!?~/);
    expect(RPC).toContain("private.agent_unambiguous_local_instant(");
    expect(RPC).toContain("private.agent_civil_date_start(");
    expect(CIVIL_DATE_START).toContain("select min(match.instant)");
    expect(CIVIL_DATE_START).toContain(
      "(guessed.instant at time zone p_timezone)::date = p_date"
    );
    expect(CIVIL_DATE_START).toContain("else null");
    expect(MIGRATION).not.toContain("generate_series(");
    expect(RPC).toContain("invalid_resolved_source as materialized");
    expect(RPC).toContain("agent_scheduled_jobs_source_data_invalid");
    expect(RPC).toContain("'source_data_invalid'");
    expect(RPC).toContain("'source_query_bound'");
    expect(RPC).toContain("private.agent_rfc3339_utc(");
    expect(MIGRATION).toContain('\'yyyy-mm-dd"t"hh24:mi:ss.ms"z"\'');
  });

  it("does not let a bad unreturned sentinel suppress a valid current page", () => {
    expect(RPC).toContain(
      "select 1 from retained_page seed where seed.assignment_source_bound"
    );
    expect(RPC).toContain(
      "select 1 from retained_page seed where seed.assignment_source_invalid"
    );
    expect(RPC).not.toContain(
      "select 1 from page_seed seed where seed.assignment_source_bound"
    );
  });

  it("returns one recomputable projection proof per occurrence and a source fence", () => {
    expect(RPC).toContain("'scheduled_job_occurrence_projection'");
    expect(RPC).toContain(
      "'scheduled-job-occurrence-projection:v1:' || hashed.source_content_hash"
    );
    expect(RPC).toContain("'occurrence_proofs'");
    expect(RPC).toContain("'projection', item.projection");
    expect(RPC).toContain("private.canonical_agent_projection_json(");
    expect(RPC).toContain("extensions.digest(");
    expect(RPC).toContain("'operational_read_revision'");
    expect(RPC).toContain("'occurred_at'");
    expect(RPC).toContain("'relationship', 'supports'");
    expect(RPC).toContain("'trust', 'authoritative_ops'");
    expect(RPC).not.toContain("'excerpt'");
    expect(MIGRATION).toContain(
      "agent_projection_negative_zero_normalization_mismatch"
    );
    expect(MIGRATION).toContain(
      "a09675457eaaf2363adab2ed25209060361e9b8cf523782a4d2cd62b6a9844a2"
    );
  });

  it("fences every output source with a private safe-integer tenant revision", () => {
    expect(MIGRATION).toContain(
      "create table if not exists private.agent_operational_read_revisions"
    );
    expect(MIGRATION).toContain(
      "check (source_revision between 0 and 9007199254740991)"
    );
    expect(MIGRATION).toContain("agent_operational_read_revision_exhausted");
    expect(MIGRATION).toContain(
      "pg_input_is_valid(old.company_id::text, 'uuid')"
    );
    expect(MIGRATION).toContain(
      "pg_input_is_valid(new.company_id::text, 'uuid')"
    );
    for (const table of [
      "companies",
      "project_tasks",
      "projects",
      "users",
      "clients",
      "project_photos",
      "task_types",
    ]) {
      expect(MIGRATION).toContain(
        `create trigger ${table}_bump_agent_operational_read_revision`
      );
    }
    expect(COMPACT_MIGRATION).toContain(
      "revoke all on table private.agent_operational_read_revisions from public, anon, authenticated, service_role"
    );
  });

  it("freezes confirmation identity and makes each sanctioned writer purpose-bound and idempotent", () => {
    expect(CONFIRMATION_TRIGGER).toContain(
      "new.schedule_confirmed_at := old.schedule_confirmed_at"
    );
    expect(CONFIRMATION_TRIGGER).toContain(
      "new.schedule_confirmed_by := old.schedule_confirmed_by"
    );
    expect(CONFIRMATION_TRIGGER).toContain(
      "new.confirmed_schedule_version := old.confirmed_schedule_version"
    );
    expect(CONFIRMATION_TRIGGER).toContain(
      "ops.authorized_schedule_confirmation_action"
    );
    expect(CONFIRMATION_TRIGGER).toContain("= 'confirm'");
    expect(CONFIRMATION_TRIGGER).toContain("= 'unconfirm'");
    expect(CONFIRM).toContain("for update");
    expect(CONFIRM).toContain("feature.feature_key = 'phase_c'");
    expect(CONFIRM).toContain("'newly_confirmed', false");
    expect(CONFIRM).toContain("'newly_confirmed', true");
    expect(AUTO_CONFIRM).toContain("for update");
    expect(AUTO_CONFIRM).toContain("confirm_mode}' = 'automatic'");
    expect(AUTO_CONFIRM).toContain("'newly_confirmed', false");
    expect(UNCONFIRM).toContain("for update");
    expect(UNCONFIRM).toContain("'newly_unconfirmed', false");
    expect(UNCONFIRM).toContain("'newly_unconfirmed', true");
    expect(UNCONFIRM).toContain("'previous_schedule_confirmed_at'");
    expect(MIGRATION).toContain("get diagnostics v_updated_count = row_count");
    expect(MIGRATION).toContain(
      "set schedule_confirmed_at = date_trunc(\n        'milliseconds', statement_timestamp()"
    );
  });

  it("keeps old readers public only through v4 wrappers", () => {
    expect(MIGRATION).toContain(
      "rename to read_agent_job_conversation_context_v3_impl"
    );
    expect(MIGRATION).toContain(
      "rename to read_agent_correspondence_evidence_v3_impl"
    );
    expect(MIGRATION).toContain("set schema private");
    expect(COMPACT_MIGRATION).toContain(
      "p_capability_manifest_revision is distinct from '2026-08-12.capability-manifest.v4'"
    );
    expect(MIGRATION).toMatch(
      /revoke all on function private\.read_agent_job_conversation_context_v3_impl\([\s\S]*?service_role;/
    );
    expect(MIGRATION).toMatch(
      /revoke all on function private\.read_agent_correspondence_evidence_v3_impl\([\s\S]*?service_role;/
    );
  });
});

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260903194613_agent_weather_reschedule_preview.sql"
);
const replayMigrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260903194749_agent_weather_reschedule_preview.sql"
);

function migration(): string {
  return fs.readFileSync(migrationPath, "utf8");
}

describe("weather reschedule SQL contract", () => {
  it("mirrors both production ledger entries byte-for-byte", () => {
    expect(fs.readFileSync(replayMigrationPath)).toEqual(
      fs.readFileSync(migrationPath)
    );
  });

  it("creates only a stable source snapshot and exact final assertion", () => {
    const sql = migration();
    expect(sql).toContain(
      "create or replace function public.read_agent_weather_reschedule_as_system"
    );
    expect(sql).toContain(
      "create or replace function public.assert_agent_weather_reschedule_authority_as_system"
    );
    expect(sql).toContain("language plpgsql\nstable\nsecurity definer");
    expect(sql).not.toMatch(
      /create\s+(?:or\s+replace\s+)?function\s+public\.(?:create|commit|persist|apply|move|reschedule|publish|send|update)_/i
    );
    expect(sql).not.toMatch(
      /^\s*(?:insert\s+into|update|delete\s+from)\s+(?:public|private)\./gim
    );
  });

  it("pins the dormant v17, v11, v6 authority envelope", () => {
    const sql = migration();
    for (const revision of [
      "2026-09-03.capability-manifest.v17",
      "2026-09-03.mcp-exposure.v11",
      "2026-09-03.mcp-consent-catalog.v6",
      "prepare_weather_reschedule:2026-09-03.v1",
    ]) {
      expect(sql).toContain(`'${revision}'`);
    }
    for (const scope of [
      "ops.communications.prepare",
      "ops.company.read",
      "ops.customer_contacts.read",
      "ops.customers.read",
      "ops.jobs.read",
      "ops.schedule.prepare",
      "ops.schedule.read",
    ]) {
      expect(sql).toContain(`'${scope}'`);
    }
    for (const permission of [
      "calendar.edit",
      "calendar.view",
      "clients.view",
      "inbox.send",
      "inbox.view",
      "projects.edit",
      "projects.view",
      "tasks.edit",
      "tasks.view",
    ]) {
      expect(sql).toContain(`'${permission}'`);
    }
    expect(sql).toContain(
      "Prepare exact client schedule-update drafts for approval"
    );
    expect(sql).toContain(
      "Prepare exact weather reschedule proposals for approval"
    );
  });

  it("uses explicit settings, current cached numbers, and exact tenant sources", () => {
    const sql = migration();
    for (const relation of [
      "public.companies",
      "public.project_tasks",
      "public.projects",
      "public.task_types",
      "public.weather_forecasts",
      "public.clients",
      "public.sub_clients",
      "public.email_suppressions",
      "public.users",
    ]) {
      expect(sql).toContain(relation);
    }
    expect(sql).toContain("schedule_settings -> 'outdoor_task_type_ids'");
    expect(sql).toContain("schedule_settings -> 'weather_awareness'");
    expect(sql).toContain("schedule_settings ->> 'optimization_window_days'");
    expect(sql).toContain("is distinct from 'boolean'");
    expect(sql).toContain("is distinct from 'number'");
    expect(sql).toContain("member.id::uuid::text");
    expect(sql).toContain(
      "candidate_member.id::uuid::text = any(v_target_assignee_ids)"
    );
    expect(sql).toContain("source_forecast.source = 'open-meteo'");
    expect(sql).toContain(
      "source_forecast.retrieved_at >= p_observed_at - interval '12 hours'"
    );
    expect(sql).toContain(
      "source_forecast.precipitation_probability between 0 and 100"
    );
    expect(sql).not.toMatch(/custom_title\s+(?:ilike|~\*?|similar)/i);
    expect(sql).not.toMatch(/conditions\s+(?:ilike|~\*?|similar)/i);
  });

  it("fails closed on ambiguous schedules, crews, dependencies, and recipients", () => {
    const sql = migration();
    expect(sql).toContain("p_task_limit is distinct from 101");
    expect(sql).toContain("p_project_limit is distinct from 26");
    expect(sql).toContain("p_conflict_limit is distinct from 501");
    expect(sql).toContain("task.recurrence_id is not null");
    expect(sql).toContain("task.paired_from_task_id is not null");
    expect(sql).toContain("task.schedule_locked is true");
    expect(sql).toContain("task_type_dependency_count");
    expect(sql).toContain("dependency_override_count");
    expect(sql).toContain("recipient_owner_count");
    expect(sql).toContain("parent_client.merged_into_client_id is null");
    expect(sql).toContain("parent_client_updated_at");
    expect(sql).toContain("suppression.list = 'global'");
    expect(sql).toContain(
      "pg_catalog.jsonb_array_length(v_tasks) <> v_task_count"
    );
    expect(sql).toContain(
      "(candidate.end_date at time zone 'UTC')::date >= p_target_date + 1"
    );
    expect(sql).toContain("private.agent_user_can_access_entity(");
    expect(sql).toContain(
      "p_actor_user_id, p_company_id, p_registered_permission_keys"
    );
    expect(sql).not.toContain(
      "p_actor_user_id, p_company_id, v_required_permissions"
    );
    expect(sql).toContain("AGENT_WEATHER_RESCHEDULE_SOURCE_BOUND");
    expect(sql).toContain("AGENT_WEATHER_RESCHEDULE_SOURCE_STALE");
  });

  it("hashes every source and replays the same observed snapshot before return", () => {
    const sql = migration();
    expect(sql).toContain("extensions.digest(");
    expect(sql).toContain("p_expected_source_revision !~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("p_observed_at");
    expect(sql).toContain("p_target_date");
    expect(sql).toContain("p_task_limit");
    expect(sql).toContain("p_project_limit");
    expect(sql).toContain("p_conflict_limit");
    expect(sql).toContain(
      "v_snapshot->>'source_revision' is distinct from\n       p_expected_source_revision"
    );
    expect(sql).toMatch(/\)\s*>\s*1000000/);
  });

  it("keeps helpers private and exposes exactly two service-role RPCs", () => {
    const sql = migration();
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain(
      "revoke all on function private.build_agent_weather_reschedule_snapshot"
    );
    expect(sql).toContain(
      "grant execute on function public.read_agent_weather_reschedule_as_system"
    );
    expect(sql).toContain(
      "grant execute on function public.assert_agent_weather_reschedule_authority_as_system"
    );
    expect(sql.match(/\) to service_role;/g)).toHaveLength(2);
    expect(sql).toContain("AGENT_WEATHER_RESCHEDULE_FUNCTION_ACL_INVALID");
    expect(sql).toContain("AGENT_WEATHER_RESCHEDULE_FUNCTION_SHAPE_INVALID");
  });
});

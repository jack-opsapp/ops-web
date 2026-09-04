import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260903220000_agent_crew_callout_recovery_preview.sql"
);

function migration(): string {
  return fs.readFileSync(migrationPath, "utf8");
}

describe("crew call-out recovery SQL contract", () => {
  it("creates only a stable source snapshot and exact replay assertion", () => {
    const sql = migration();
    expect(sql).toContain(
      "create or replace function public.read_agent_crew_callout_recovery_as_system"
    );
    expect(sql).toContain(
      "create or replace function public.assert_agent_crew_callout_recovery_authority_as_system"
    );
    expect(sql).toContain("language plpgsql\nstable\nsecurity definer");
    expect(sql).not.toMatch(
      /create\s+(?:or\s+replace\s+)?function\s+public\.(?:create|commit|persist|apply|assign|move|reschedule|publish|send|update)_/i
    );
    expect(sql).not.toMatch(
      /^\s*(?:insert\s+into|update|delete\s+from)\s+(?:public|private)\./gim
    );
  });

  it("pins the dormant v18, v12, v7 authority envelope", () => {
    const sql = migration();
    for (const revision of [
      "2026-09-03.capability-manifest.v18",
      "2026-09-03.mcp-exposure.v12",
      "2026-09-03.mcp-consent-catalog.v7",
      "prepare_crew_callout_recovery:2026-09-03.v1",
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
      "ops.site_visits.read",
      "ops.tasks.read",
      "ops.team.read",
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
      "tasks.assign",
      "tasks.edit",
      "tasks.view",
      "team.view",
    ]) {
      expect(sql).toContain(`'${permission}'`);
    }
    expect(sql).toContain(
      "Prepare exact client schedule-update and crew recovery messages for approval"
    );
    expect(sql).toContain(
      "Prepare exact weather and crew recovery schedule proposals for approval"
    );
  });

  it("reads the exact authoritative crew, schedule, role, history, and recipient sources", () => {
    const sql = migration();
    for (const relation of [
      "public.calendar_user_events",
      "public.clients",
      "public.companies",
      "public.project_tasks",
      "public.projects",
      "public.roles",
      "public.site_visits",
      "public.sub_clients",
      "public.task_types",
      "public.user_roles",
      "public.users",
    ]) {
      expect(sql).toContain(relation);
    }
    expect(sql).toContain("task.status = 'completed'");
    expect(sql).toContain("calendar.type = 'time_off'");
    expect(sql).toContain("calendar.type = 'personal'");
    expect(sql).toContain("private.agent_unambiguous_local_instant(");
    expect(sql).toContain("private.agent_user_can_access_entity(");
    expect(sql).not.toMatch(
      /(?:licen[cs]e|certificat)[_a-z]*\s+(?:from|join)\s+/i
    );
  });

  it("fails closed on ambiguous identity, malformed schedules, and bounded populations", () => {
    const sql = migration();
    expect(sql).toContain("p_item_limit is distinct from 26");
    expect(sql).toContain("p_candidate_limit is distinct from 251");
    expect(sql).toContain("p_schedule_source_limit is distinct from 501");
    expect(sql).toContain("AGENT_CREW_CALLOUT_MEMBER_AMBIGUOUS");
    expect(sql).toContain("AGENT_CREW_CALLOUT_SOURCE_BOUND");
    expect(sql).toContain("AGENT_CREW_CALLOUT_SOURCE_STALE");
    expect(sql).toContain("schedule_locked");
    expect(sql).toContain("recurrence_id");
    expect(sql).toContain("paired_from_task_id");
    expect(sql).toContain("dependency_override_count");
    expect(sql).toContain("recipient_owner_count");
    expect(sql).toContain("parent_client.merged_into_client_id is null");
  });

  it("hashes every source and replays the same observed snapshot before return", () => {
    const sql = migration();
    expect(sql).toContain("extensions.digest(");
    expect(sql).toContain("p_expected_source_revision !~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("p_observed_at");
    expect(sql).toContain("p_crew_member_name");
    expect(sql).toContain("p_target_date");
    expect(sql).toContain(
      "v_snapshot->>'source_revision' is distinct from\n       p_expected_source_revision"
    );
    expect(sql).toMatch(/\)\s*>\s*2000000/);
  });

  it("keeps helpers private and exposes exactly two service-role RPCs", () => {
    const sql = migration();
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain(
      "revoke all on function private.build_agent_crew_callout_recovery_snapshot"
    );
    expect(sql).toContain(
      "grant execute on function public.read_agent_crew_callout_recovery_as_system"
    );
    expect(sql).toContain(
      "grant execute on function public.assert_agent_crew_callout_recovery_authority_as_system"
    );
    expect(sql.match(/\) to service_role;/g)).toHaveLength(2);
    expect(sql).toContain("AGENT_CREW_CALLOUT_FUNCTION_ACL_INVALID");
    expect(sql).toContain("AGENT_CREW_CALLOUT_FUNCTION_SHAPE_INVALID");
  });
});

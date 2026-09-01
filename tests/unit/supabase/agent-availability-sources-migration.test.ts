import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_availability_sources.sql";
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith(SUFFIX));
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations", migrationNames[0] ?? "MISSING"),
  "utf8"
);
const BODY = readFileSync(
  join(
    process.cwd(),
    "src/lib/agent-control-plane/services/p2/availability/sql/agent_availability_sources.body.sql"
  ),
  "utf8"
);
const SQL = MIGRATION.toLowerCase();
const COMPACT = SQL.replace(/\s+/g, " ").trim();

describe("P2 team-availability source fence migration", () => {
  it("uses one generated, byte-identical, transactional migration", () => {
    expect(migrationNames).toHaveLength(1);
    expect(migrationNames[0]).toMatch(
      /^\d{14}_agent_availability_sources\.sql$/
    );
    expect(MIGRATION).toBe(BODY);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("do $prerequisites$");
    expect(SQL).toContain("do $source_shape$");
    expect(SQL).toContain("do $postflight$");
  });

  it("advances only the closed availability domain without replacing the existing domain fences", () => {
    for (const table of [
      "companies",
      "calendar_user_events",
      "project_tasks",
      "site_visits",
    ]) {
      expect(COMPACT).toContain(
        `create trigger ${table}_bump_agent_availability_revision`
      );
      expect(COMPACT).toContain(
        "execute function private.bump_agent_read_domain_revision( 'availability',"
      );
    }
    for (const existingTrigger of [
      "project_tasks_bump_agent_task_revision",
      "project_tasks_bump_agent_site_visit_revision",
      "site_visits_bump_agent_site_visit_revision",
      "users_bump_agent_team_revision",
    ]) {
      expect(COMPACT).not.toContain(
        `drop trigger if exists ${existingTrigger}`
      );
    }
  });

  it("pins the exact schedule settings and capacity source shape", () => {
    for (const column of [
      "timezone",
      "default_work_start",
      "default_work_end",
      "skip_weekends_in_auto_schedule",
      "user_id",
      "type",
      "start_date",
      "end_date",
      "all_day",
      "status",
      "team_member_ids",
      "assignee_ids",
      "scheduled_at",
      "duration_minutes",
      "booked_at",
    ]) {
      expect(COMPACT).toContain(`, '${column}',`);
    }
    expect(COMPACT).toContain(
      "after insert or delete or update of deleted_at, timezone, default_work_start, default_work_end, skip_weekends_in_auto_schedule on public.companies"
    );
  });

  it("provides only bounded availability keysets and grants no source access", () => {
    for (const indexName of [
      "idx_calendar_user_events_agent_availability_v1",
      "idx_project_tasks_agent_availability_v1",
      "idx_site_visits_agent_availability_v1",
    ]) {
      expect(COMPACT).toContain(`create index if not exists ${indexName}`);
    }
    for (const forbidden of [
      "grant select",
      "grant all",
      "create or replace function public.",
      "drop trigger if exists project_tasks_bump_agent_task_revision",
      "drop trigger if exists site_visits_bump_agent_site_visit_revision",
    ]) {
      expect(COMPACT).not.toContain(forbidden);
    }
  });
});

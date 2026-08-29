import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_team_availability_read.sql";
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
    "src/lib/agent-control-plane/services/p2/availability/sql/agent_team_availability_read.body.sql"
  ),
  "utf8"
);
const SQL = MIGRATION.toLowerCase();
const COMPACT = SQL.replace(/\s+/g, " ").trim();

describe("P2 team-availability read migration", () => {
  it("uses one generated, byte-identical, transactional migration", () => {
    expect(migrationNames).toHaveLength(1);
    expect(migrationNames[0]).toMatch(
      /^\d{14}_agent_team_availability_read\.sql$/
    );
    expect(MIGRATION).toBe(BODY);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("do $prerequisites$");
    expect(SQL).toContain("do $canonical_acl$");
    expect(SQL).toContain("do $postflight$");
  });

  it("keeps the capacity projection private and grants only one fixed RPC", () => {
    expect(COMPACT).toContain(
      "create or replace function private.agent_p2_availability_summary_v1("
    );
    expect(COMPACT).toContain(
      "create or replace function public.read_agent_team_availability_as_system("
    );
    expect(COMPACT).toContain(
      "language plpgsql stable security definer set search_path = ''"
    );
    expect(COMPACT).toContain(
      "grant execute on function public.read_agent_team_availability_as_system("
    );
    expect(COMPACT).toContain(
      "revoke all on function private.agent_p2_availability_summary_v1("
    );
    expect(COMPACT.match(/grant execute on function/g)).toHaveLength(1);
    for (const forbidden of [
      "grant select",
      "set role",
      "current_setting(",
      "security definer set search_path to 'public'",
    ]) {
      expect(COMPACT).not.toContain(forbidden);
    }
  });

  it("enforces exact OAuth and the closed company/self authority branches", () => {
    for (const expected of [
      "array['ops.team.read']::text[]",
      "p_view not in ('company', 'self')",
      "p_view = 'company' and ( p_team_scope is distinct from 'all' or p_calendar_scope is distinct from 'all' )",
      "p_view = 'self' and ( p_team_scope is not null or p_calendar_scope not in ('own', 'all') )",
      "authority.team_scope is not distinct from p_team_scope",
      "authority.calendar_scope = p_calendar_scope",
      "actor.deleted_at is null",
      "actor.is_active is true",
      "grant_row.scopes = p_granted_scope_ceiling",
      "grant_row.revoked_at is null",
      "oauth_client.disabled_at is null",
    ]) {
      expect(COMPACT).toContain(expected);
    }
  });

  it("pins civil windows, 10/11/501 bounds, C ordering, and stale-cursor fencing", () => {
    for (const expected of [
      "p_ends_on - p_starts_on not between 0 and 30",
      "p_member_source_limit is distinct from 501",
      "p_schedule_source_limit is distinct from 501",
      "p_item_limit not between 1 and 10",
      "p_page_fetch_limit is distinct from p_item_limit + 1",
      'source.display_name collate "c"',
      "p_cursor_source_revisions = pg_catalog.jsonb_build_array(",
      "'domain', 'availability'",
      "'domain', 'site_visits'",
      "'domain', 'tasks'",
      "'domain', 'team'",
      "raise exception 'agent_availability_snapshot_stale' using errcode = '40001'",
      "raise exception 'agent_availability_member_source_query_bound' using errcode = '54000'",
      "raise exception 'agent_availability_schedule_source_query_bound' using errcode = '54000'",
    ]) {
      expect(COMPACT).toContain(expected);
    }
  });

  it("aggregates only safe schedule sources inside authoritative local working windows", () => {
    for (const expected of [
      "company.timezone",
      "company.default_work_start",
      "company.default_work_end",
      "company.skip_weekends_in_auto_schedule",
      "task.start_date at time zone 'utc'",
      "task.status <> 'cancelled'",
      "visit.booked_at is not null",
      "visit.status in ('scheduled', 'in_progress')",
      "event.type = 'personal' and event.status = 'none'",
      "event.type = 'time_off' and event.status in ('approved', 'none')",
      "event.status not in ('pending', 'denied')",
      "pg_catalog.range_agg(",
      "'working_minutes'",
      "'committed_minutes'",
      "'available_minutes'",
      "'available'",
      "'limited'",
      "'committed'",
      "'unavailable'",
    ]) {
      expect(COMPACT).toContain(expected);
    }
  });

  it("returns only active display identity, capacity days, and recomputable proofs", () => {
    for (const expected of [
      "'member_ref'",
      "'display_name'",
      "'days'",
      "'date'",
      "'state'",
      "'content_kind', 'untrusted_business_data'",
      "'proof_kind', 'team_availability_entity'",
      "'proof_kind', 'team_availability_evidence'",
      "'proof_kind', 'team_availability_collection'",
      "'ranking_revision', 'availability-member-order:2026-08-22.v1'",
      "private.canonical_agent_projection_json(",
    ]) {
      expect(COMPACT).toContain(expected);
    }
    for (const forbidden of [
      "'title'",
      "'notes'",
      "'event_type'",
      "'source_type'",
      "'provider_id'",
      "'location'",
      "'leave_reason'",
      "'project_ref'",
      "'customer_ref'",
      "'event_count'",
      "'appointment_title'",
      "'appointment_location'",
      "'google_calendar_event_id'",
    ]) {
      expect(COMPACT).not.toContain(forbidden);
    }
  });
});

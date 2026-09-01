import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_team_members_read.sql";
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
    "src/lib/agent-control-plane/services/p2/team/sql/agent_team_members_read.body.sql"
  ),
  "utf8"
);
const SQL = MIGRATION.toLowerCase();
const COMPACT = SQL.replace(/\s+/g, " ").trim();

function replaceExactly(
  value: string,
  oldFragment: string,
  newFragment: string,
  expectedCount: number
) {
  expect(value.split(oldFragment).length - 1).toBe(expectedCount);
  return value.split(oldFragment).join(newFragment);
}

describe("P2 team-directory read migration", () => {
  it("keeps the generated reservation immutable and derives the current body exactly", () => {
    expect(migrationNames).toHaveLength(1);
    expect(migrationNames[0]).toMatch(/^\d{14}_agent_team_members_read\.sql$/);
    expect(MIGRATION).not.toBe(BODY);
    expect(
      replaceExactly(
        MIGRATION,
        "    select pg_catalog.array_agg(scope.value order by scope.value)",
        '    select pg_catalog.array_agg(\n      scope.value order by scope.value collate "C"\n    )',
        1
      )
    ).toBe(BODY);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("do $prerequisites$");
    expect(SQL).toContain("do $canonical_acl$");
    expect(SQL).toContain("do $postflight$");
  });

  it("keeps the private projection closed and grants only one fixed RPC", () => {
    expect(COMPACT).toContain(
      "create or replace function private.agent_p2_team_summary_v1("
    );
    expect(COMPACT).toContain(
      "create or replace function public.read_agent_team_members_as_system("
    );
    expect(COMPACT).toContain(
      "language plpgsql stable security definer set search_path = ''"
    );
    expect(COMPACT).toContain(
      "grant execute on function public.read_agent_team_members_as_system("
    );
    expect(COMPACT).toContain(
      "revoke all on function private.agent_p2_team_summary_v1("
    );
    expect(COMPACT.match(/grant execute on function/g)).toHaveLength(1);
    for (const forbidden of [
      "grant select",
      "execute format",
      "set role",
      "current_setting(",
      "pg_catalog.coalesce(",
      "pg_catalog.nullif(",
    ]) {
      expect(COMPACT).not.toContain(forbidden);
    }
  });

  it("enforces exact OAuth, team authority, active membership, and same-snapshot pagination", () => {
    for (const expected of [
      "array['ops.team.read']::text[]",
      "authority.team_scope = p_team_scope",
      "grant_row.scopes = p_granted_scope_ceiling",
      "grant_row.revoked_at is null",
      "oauth_client.disabled_at is null",
      "member.deleted_at is null",
      "member.is_active is true",
      "p_source_limit is distinct from 501",
      "p_page_fetch_limit is distinct from p_item_limit + 1",
      "p_cursor_source_revisions = pg_catalog.jsonb_build_array(",
      "raise exception 'agent_team_snapshot_stale' using errcode = '40001'",
      "raise exception 'agent_team_source_query_bound' using errcode = '54000'",
    ]) {
      expect(COMPACT).toContain(expected);
    }
  });

  it("returns only display-safe fields with recomputable item, evidence, and collection proofs", () => {
    for (const expected of [
      "'member_ref'",
      "'display_name'",
      "'state', 'active'",
      "'display_image'",
      "'display_color'",
      "'team_label'",
      "'content_kind', 'untrusted_business_data'",
      "'proof_kind', 'team_member_entity'",
      "'proof_kind', 'team_member_evidence'",
      "'proof_kind', 'team_member_collection'",
      "'ranking_revision', 'team-member-order:2026-08-22.v1'",
      "private.canonical_agent_projection_json(",
    ]) {
      expect(COMPACT).toContain(expected);
    }
    for (const forbidden of [
      "'email'",
      "'phone'",
      "'auth_id'",
      "'firebase_uid'",
      "'device_token'",
      "'role_id'",
      "'special_permissions'",
      "'is_company_admin'",
      "'latitude'",
      "'longitude'",
    ]) {
      expect(COMPACT).not.toContain(forbidden);
    }
  });
});

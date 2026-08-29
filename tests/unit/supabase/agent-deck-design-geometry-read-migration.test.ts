import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_NAME = "20260829011319_agent_deck_design_geometry_read.sql";
const BODY_PATH = join(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/deck-design/sql/agent_deck_design_geometry_read.body.sql"
);
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  MIGRATION_NAME
);
const RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-deck-design-geometry-runtime.sql"
);
const REPLAY_RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-deck-design-geometry-replay-runtime.sql"
);

function read(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function compact(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function definition(sql: string, name: string) {
  const marker = `create or replace function ${name}(`;
  const start = sql.lastIndexOf(marker);
  if (start < 0) return "";
  const tail = sql.slice(start);
  const delimiter = /\bas\s+(\$[a-z0-9_]*\$)/.exec(tail)?.[1];
  if (!delimiter) return "";
  const end = tail.indexOf(`${delimiter};`);
  return end < 0 ? "" : tail.slice(0, end + delimiter.length + 1);
}

const BODY_EXACT = read(BODY_PATH);
const MIGRATION_EXACT = read(MIGRATION_PATH);
const SQL = BODY_EXACT.toLowerCase();
const COMPACT = compact(BODY_EXACT);
const PRIVATE_READ = compact(
  definition(SQL, "private.agent_p2_deck_design_geometry_v1")
);
const PUBLIC_READ = compact(
  definition(SQL, "public.read_agent_deck_design_geometry_as_system")
);
const CANONICAL_JSON = compact(
  definition(SQL, "private.agent_p2_deck_geometry_canonical_json")
);
const RUNTIME = compact(read(RUNTIME_PATH));
const REPLAY_RUNTIME = compact(read(REPLAY_RUNTIME_PATH));
const RESERVED_MIGRATIONS = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith("_agent_deck_design_geometry_read.sql"));

describe("P2 deck-design geometry read SQL body", () => {
  it("is the single CLI-generated reservation and byte-matches its guarded sidecar", () => {
    expect(RESERVED_MIGRATIONS).toEqual([MIGRATION_NAME]);
    expect(BODY_EXACT).not.toBe("");
    expect(MIGRATION_EXACT).toBe(BODY_EXACT);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("task 13 canonical deck-design geometry read body");
    expect(SQL).toContain("do $prerequisites$");
    expect(SQL).toContain("do $postflight$");
  });

  it("defines one private fixed projection and one service-role-only public RPC", () => {
    expect(PRIVATE_READ).not.toBe("");
    expect(PRIVATE_READ).toContain("stable");
    expect(PRIVATE_READ).toContain("security invoker");
    expect(PRIVATE_READ).toContain("set search_path = ''");
    expect(PUBLIC_READ).not.toBe("");
    expect(PUBLIC_READ).toContain("stable");
    expect(PUBLIC_READ).toContain("security definer");
    expect(PUBLIC_READ).toContain("set search_path = ''");
    expect(PUBLIC_READ).toContain(
      "auth.role() is distinct from 'service_role'"
    );
    expect(
      COMPACT.match(/create or replace function public\.read_agent_/g)
    ).toHaveLength(1);
    expect(COMPACT).toContain(
      "grant execute on function public.read_agent_deck_design_geometry_as_system"
    );
    expect(COMPACT).toContain("to service_role");
    expect(COMPACT).not.toContain(
      "grant execute on function private.agent_p2_deck_design_geometry_v1"
    );
  });

  it("re-proves exact OAuth, actor, manifest, policy, and satisfied-group bytes in the same statement", () => {
    for (const binding of [
      "private.mcp_oauth_grants",
      "private.mcp_oauth_clients",
      "p_oauth_grant_id",
      "p_oauth_client_id",
      "p_grant_revision",
      "revoked_at is null",
      "disabled_at is null",
      "p_granted_scope_ceiling",
      "p_authorization_candidates",
      "consent_catalog_revision",
      "exposure_revision",
      "private.resolve_agent_actor_authority(",
      "authority.permission_snapshot_revision = p_permission_snapshot_revision",
      "v_current_resolved_scopes",
      "v_expected_satisfied_groups",
      "2026-08-22.capability-manifest.v8",
      "get_deck_design_geometry:2026-08-22.v1",
    ]) {
      expect(PRIVATE_READ).toContain(binding);
    }
    for (const variant of [
      "job_artifact_opportunity",
      "job_artifact_project",
      "site_visit_artifact_linked",
      "site_visit_artifact_unlinked",
    ]) {
      expect(PRIVATE_READ).toContain(variant);
    }
    for (const retiredArgument of [
      "p_required_oauth_scopes",
      "p_resolved_permission_scopes",
      "p_satisfied_permission_group_indexes",
      "p_calendar_scope",
      "p_clients_scope",
      "p_deck_builder_scope",
      "p_pipeline_scope",
      "p_projects_scope",
    ]) {
      expect(PRIVATE_READ).not.toContain(retiredArgument);
      expect(PUBLIC_READ).not.toContain(retiredArgument);
    }
    for (const permission of [
      "calendar.view",
      "clients.view",
      "deck_builder.view",
      "pipeline.view",
      "projects.view",
    ]) {
      expect(PRIVATE_READ).toContain(permission);
    }
    expect(PRIVATE_READ).toContain(
      "when 'calendar.view' then permission.value ->> 'scope' in ('all', 'own')"
    );
    expect(PRIVATE_READ).toContain(
      "v_candidate_variant = 'site_visit_artifact_unlinked'"
    );
  });

  it("accepts only exact job or visit anchors and re-proves every active tenant-equal relationship", () => {
    for (const binding of [
      "p_source in ('job_artifact', 'site_visit_artifact')",
      "public.deck_designs",
      "public.site_visit_artifacts",
      "public.site_visits",
      "public.opportunities",
      "public.projects",
      "deleted_at is null",
      "artifact.kind = 'deck_design'",
      "artifact.source = 'deck_builder'",
      "private.agent_user_can_access_entity(",
      "'opportunity'",
      "'project'",
      "v_deck_builder_scope",
      "v_pipeline_scope",
      "v_projects_scope",
      "v_calendar_scope",
      "v_clients_scope",
    ]) {
      expect(PRIVATE_READ).toContain(binding);
    }
    expect(PRIVATE_READ).toContain("site_visit_linked");
    expect(PRIVATE_READ).toContain("site_visit_unlinked");
    expect(PRIVATE_READ).toContain("job_opportunity");
    expect(PRIVATE_READ).toContain("job_project");
    expect(PRIVATE_READ).not.toContain("auth.uid()");
    expect(PRIVATE_READ).not.toContain("current_user_can_view_deck_design");
  });

  it("binds the exact four-domain source vector and leaves frozen legacy revisions read-only", () => {
    for (const domain of [
      "'artifacts'",
      "'deck_designs'",
      "'legacy_operational'",
      "'site_visits'",
    ]) {
      expect(PRIVATE_READ).toContain(domain);
    }
    expect(PRIVATE_READ).toContain("private.agent_read_domain_revisions");
    expect(PRIVATE_READ).toContain("private.agent_operational_read_revisions");
    expect(PRIVATE_READ).not.toContain(
      "update private.agent_operational_read_revisions"
    );
    expect(PRIVATE_READ).not.toContain(
      "insert into private.agent_operational_read_revisions"
    );
  });

  it("returns canonical geometry JSON and its exact SHA-256 content hash under the 1 MiB/501 fences", () => {
    expect(CANONICAL_JSON).not.toBe("");
    expect(CANONICAL_JSON).toContain("jsonb_array_elements");
    expect(CANONICAL_JSON).toContain("jsonb_each");
    expect(CANONICAL_JSON).toContain('order by member.key collate "c"');
    expect(CANONICAL_JSON).toContain("pg_catalog.trim_scale(");
    expect(CANONICAL_JSON).not.toContain(
      "agent_projection_number_not_safe_integer"
    );
    expect(PRIVATE_READ).toContain("p_source_limit is distinct from 501");
    expect(PRIVATE_READ).toContain("limit 501");
    expect(PRIVATE_READ).toContain("pg_catalog.octet_length(");
    expect(PRIVATE_READ).toContain("1048576");
    expect(PRIVATE_READ).toContain("extensions.digest(");
    expect(PRIVATE_READ).toContain("'sha256:'");
    expect(PRIVATE_READ).toContain("agent_deck_geometry_source_bound");
  });

  it("projects only the repository contract and no raw provider, storage, material, pricing, or private fields", () => {
    for (const key of [
      "'company_id'",
      "'actor_user_id'",
      "'oauth_grant_id'",
      "'oauth_client_id'",
      "'grant_revision'",
      "'granted_scope_ceiling'",
      "'permission_snapshot_revision'",
      "'capability_manifest_revision'",
      "'capability_id'",
      "'capability_revision'",
      "'selected_authorization_variant'",
      "'required_oauth_scopes'",
      "'resolved_permission_scopes'",
      "'satisfied_permission_group_indexes'",
      "'query'",
      "'read_at'",
      "'source_revisions'",
      "'source_inspected'",
      "'authority_path'",
      "'visit_opportunity_id'",
      "'design_parents'",
      "'design_id'",
      "'deck_design_ref'",
      "'title_text'",
      "'drawing_source'",
      "'drawing_content_hash'",
    ]) {
      expect(PRIVATE_READ).toContain(key);
    }
    expect(PRIVATE_READ).not.toContain("'design_parent'");
    for (const forbidden of [
      "'thumbnail_url'",
      "'created_by'",
      "'asset_url'",
      "'rendered_asset_url'",
      "'provider_id'",
      "'storage_path'",
      "'price'",
      "'cost'",
      "'components'",
      "'internal_notes'",
    ]) {
      expect(PRIVATE_READ).not.toContain(forbidden);
    }
  });

  it("catalog-audits exact ownership, attributes, and ACLs and supplies a rollback-only PG17 runtime/replay proof", () => {
    expect(COMPACT).toContain("pg_catalog.pg_proc");
    expect(COMPACT).toContain("pg_catalog.aclexplode(");
    expect(COMPACT).toContain("agent_deck_geometry_acl_invalid");
    expect(COMPACT).toContain("alter function");
    expect(RUNTIME.startsWith("begin;")).toBe(true);
    expect(RUNTIME.endsWith("rollback;")).toBe(true);
    for (const proof of [
      "authenticated execute",
      "wrong tenant geometry leaked",
      "revoked grant accepted",
      "stale actor policy accepted",
      "inactive design leaked",
      "inactive bridge leaked",
      "parentless assigned design leaked",
      "inaccessible conflicting parent accepted",
      "unlinked authorization snapshot mismatch",
      "unlinked candidate authorized a linked visit",
      "linked candidate authorized an unlinked visit",
      "duplicate authorization candidate accepted",
      "noncanonical authorization candidate order accepted",
      "malformed authorization candidate accepted",
      "literal-policy-invalid authorization accepted",
      "disallowed optional pipeline scope hid base job read",
      "disallowed optional projects scope hid base job read",
      "disallowed optional projects scope hid linked visit",
      "disallowed optional projects scope hid unlinked visit",
      "content hash mismatch",
      "source byte bound not enforced",
      "source revision vector mismatch",
      "migration replay acl mismatch",
    ]) {
      expect(RUNTIME).toContain(proof);
    }
    expect(REPLAY_RUNTIME.startsWith("begin;")).toBe(true);
    expect(REPLAY_RUNTIME.endsWith("rollback;")).toBe(true);
    expect(REPLAY_RUNTIME).toContain("pg_monitor with grant option");
    expect(REPLAY_RUNTIME).toContain("migration replay acl mismatch");
  });
});

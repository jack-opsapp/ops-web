import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getCapabilityManifestEntry,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import type { CapabilityAuthorizationVariant } from "@/lib/agent-control-plane/registry/capability-types";

const MIGRATION_NAME =
  "20260812120000_agent_operational_schedule_readiness.sql";
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations", MIGRATION_NAME),
  "utf8"
).toLowerCase();

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function functionDefinition(source: string, name: string): string {
  const marker = `create or replace function ${name}(`;
  const start = source.lastIndexOf(marker);
  if (start < 0) return "";
  const remainder = source.slice(start);
  const delimiter = /\bas\s+(\$[a-z0-9_]*\$)/.exec(remainder)?.[1];
  if (!delimiter) return "";
  const end = remainder.indexOf(`${delimiter};`);
  return end < 0 ? "" : remainder.slice(0, end + delimiter.length + 1);
}

const RPC = compact(
  functionDefinition(
    MIGRATION,
    "public.read_agent_job_readiness_issues_as_system"
  )
);
const COMPACT_MIGRATION = compact(MIGRATION);
const WALL_TIME_PARSER = compact(
  functionDefinition(MIGRATION, "private.agent_parse_schedule_wall_time")
);
const CIVIL_DATE_START = compact(
  functionDefinition(MIGRATION, "private.agent_civil_date_start")
);
const ALL_MIGRATIONS = readdirSync(join(process.cwd(), "supabase/migrations"))
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) =>
    readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8")
  )
  .join("\n")
  .toLowerCase();

const WINDOW = Object.freeze({
  from: "2026-08-17T00:00:00.000Z",
  to: "2026-08-31T00:00:00.000Z",
});

function variants(
  ruleCodes?: readonly string[]
): readonly CapabilityAuthorizationVariant[] {
  const input = {
    ...WINDOW,
    ...(ruleCodes ? { rule_codes: [...ruleCodes] } : {}),
  };
  expect(
    getCapabilityManifestEntry(
      "list_job_readiness_issues"
    ).inputSchema.safeParse(input).success
  ).toBe(true);
  return resolveCapabilityAuthorization("list_job_readiness_issues", input)
    .variants;
}

function authorityUnion(
  selected: readonly CapabilityAuthorizationVariant[]
): Readonly<{ oauth: readonly string[]; permissions: readonly string[] }> {
  return {
    oauth: Array.from(
      new Set(selected.flatMap((item) => item.policy.requiredOAuthScopes))
    ).sort(),
    permissions: Array.from(
      new Set(
        selected.flatMap((item) =>
          item.policy.permissionRequirementGroups.flatMap((group) =>
            group.map((requirement) => requirement.permission)
          )
        )
      )
    ).sort(),
  };
}

describe("job readiness fixed RPC contract", () => {
  it("registers a least-privilege base plus conditional photo and customer variants", () => {
    const base = variants([
      "SCHEDULE_UNCONFIRMED",
      "CREW_UNASSIGNED",
      "ADDRESS_INCOMPLETE",
    ]);
    expect(base.map((item) => item.key)).toEqual(["readiness_base"]);
    expect(authorityUnion(base)).toEqual({
      oauth: ["ops.jobs.read", "ops.schedule.read"],
      permissions: ["calendar.view", "projects.view", "tasks.view"],
    });

    const photos = variants(["SITE_PHOTOS_MISSING"]);
    expect(photos.map((item) => item.key)).toEqual([
      "readiness_base",
      "readiness_site_photos",
    ]);
    expect(authorityUnion(photos)).toEqual({
      oauth: ["ops.jobs.read", "ops.photos.read", "ops.schedule.read"],
      permissions: [
        "calendar.view",
        "photos.view",
        "projects.view",
        "tasks.view",
      ],
    });

    const customer = variants(["CUSTOMER_RECORD_UNRESOLVED"]);
    expect(customer.map((item) => item.key)).toEqual([
      "readiness_base",
      "readiness_customer",
    ]);
    expect(authorityUnion(customer)).toEqual({
      oauth: ["ops.customers.read", "ops.jobs.read", "ops.schedule.read"],
      permissions: [
        "calendar.view",
        "clients.view",
        "projects.view",
        "tasks.view",
      ],
    });
    expect(authorityUnion(variants()).oauth).toEqual([
      "ops.customers.read",
      "ops.jobs.read",
      "ops.photos.read",
      "ops.schedule.read",
    ]);
    expect(COMPACT_MIGRATION).not.toContain("ops.customer_contacts.read");
  });

  it("is transactional, fixed-search-path, and executable only by service_role", () => {
    expect(MIGRATION).toMatch(/^--[\s\S]*?\nbegin;/);
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
    expect(RPC).toContain(
      "language plpgsql stable security definer set search_path = pg_catalog, public, private, extensions, pg_temp"
    );
    expect(RPC).toContain("auth.role() is distinct from 'service_role'");
    expect(COMPACT_MIGRATION).toMatch(
      /revoke all on function public\.read_agent_job_readiness_issues_as_system\([\s\S]*?from public, anon, authenticated, service_role;/
    );
    expect(COMPACT_MIGRATION).toMatch(
      /grant execute on function public\.read_agent_job_readiness_issues_as_system\([\s\S]*?to service_role;/
    );
  });

  it("binds v4 capability, full permission registry, dynamic scopes, and current authority", () => {
    expect(RPC).toContain(
      "p_capability_id is distinct from 'list_job_readiness_issues'"
    );
    expect(RPC).toContain("'list_job_readiness_issues:2026-08-07.v1'");
    expect(RPC).toContain("'2026-08-12.capability-manifest.v4'");
    expect(RPC).toContain(
      "select array_agg(requested.scope order by requested.scope)"
    );
    for (const scope of [
      "ops.jobs.read",
      "ops.schedule.read",
      "ops.photos.read",
      "ops.customers.read",
    ]) {
      expect(RPC).toContain(`'${scope}'::text`);
    }
    expect(RPC).toContain(
      "p_required_oauth_scopes is distinct from v_expected_oauth_scopes"
    );
    for (const permission of [
      "calendar.view",
      "clients.view",
      "photos.view",
      "projects.view",
      "tasks.view",
    ]) {
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
      "permission.value ->> 'permission' = 'clients.view' and 'customer_record_unresolved' = any(p_rule_codes)"
    );
    expect(RPC).toContain(
      "permission.value ->> 'permission' = 'photos.view' and 'site_photos_missing' = any(p_rule_codes)"
    );
    expect(RPC).toContain(
      "p_clients_scope is null or authority.clients_scope = p_clients_scope"
    );
    expect(RPC).toContain(
      "p_photos_scope is null or authority.photos_scope = p_photos_scope"
    );
  });

  it("intersects tenant visibility with direct operational assignment", () => {
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
      /context\.projects_scope = 'all' or exists \( select 1 from public\.project_tasks project_assignment[\s\S]{0,420}project_assignment\.status = 'active'/
    );
    expect(RPC).toMatch(
      /context\.photos_scope = 'all' or exists \( select 1 from public\.project_tasks assigned_task[\s\S]{0,420}assigned_task\.status = 'active'[\s\S]{0,220}p_actor_user_id::text = any/
    );
  });

  it("uses only active project-task work and revision-fences every output source", () => {
    expect(RPC).toContain("join public.project_tasks task");
    expect(RPC).toContain("join public.projects project");
    expect(RPC).toContain("task.status = 'active'");
    expect(RPC).toContain(
      "project.status in ('rfq', 'estimated', 'accepted', 'in_progress')"
    );
    expect(RPC).not.toContain("site_visits");
    for (const table of [
      "companies",
      "project_tasks",
      "projects",
      "users",
      "clients",
      "project_photos",
      "task_types",
    ]) {
      expect(COMPACT_MIGRATION).toContain(
        `create trigger ${table}_bump_agent_operational_read_revision`
      );
    }
    expect(COMPACT_MIGRATION).toContain(
      "check (source_revision between 0 and 9007199254740991)"
    );
    expect(RPC).toContain("agent_operational_read_cursor_stale");
  });

  it("prebounds source tasks, job pages, per-job facts, photos, and legacy fallback", () => {
    const boundedSource = RPC.slice(
      RPC.indexOf("eligible_task_candidate as materialized"),
      RPC.indexOf("eligible_task as materialized")
    );
    const sourceLimit = RPC.indexOf("limit 2501");
    const pageLimit = RPC.indexOf("limit p_scan_limit + 1");
    const retainedTaskLimit = RPC.indexOf("limit 51", pageLimit);
    const firstAggregate = RPC.indexOf("jsonb_agg(");
    expect(RPC).toContain("p_scan_limit is null");
    expect(RPC).toContain("p_scan_limit > 50");
    expect(sourceLimit).toBeGreaterThan(0);
    expect(boundedSource).toContain(
      "order by task.start_date, task.id limit 2501"
    );
    expect(pageLimit).toBeGreaterThan(sourceLimit);
    expect(retainedTaskLimit).toBeGreaterThan(pageLimit);
    expect(firstAggregate).toBeGreaterThan(pageLimit);
    expect(RPC).toContain("limit 1001");
    expect(RPC).toContain("[1:100]");
    expect(RPC).toContain("photo.structured_row_count = 0");
    const broadCandidates = RPC.slice(
      RPC.indexOf("eligible_task_candidate as materialized"),
      RPC.indexOf("retained_project as materialized")
    );
    expect(broadCandidates).not.toContain("project_images");
    const retainedProjects = RPC.indexOf("retained_project as materialized");
    const photoPartition = RPC.indexOf("photo_partition as materialized");
    const lateLegacySource = RPC.indexOf("select source.project_images");
    expect(lateLegacySource).toBeGreaterThan(photoPartition);
    expect(lateLegacySource).toBeGreaterThan(retainedProjects);
    expect(RPC.slice(photoPartition, lateLegacySource + 800)).toContain(
      "'site_photos_missing' = any(p_rule_codes)"
    );
    expect(RPC.slice(photoPartition, lateLegacySource + 800)).toContain(
      "photo.structured_row_count = 0"
    );
    expect(RPC).toContain(
      "when source.legacy_count <= 100 then coalesce(source.project_images, array[]::text[])[1:100]"
    );
    expect(RPC).toContain("coalesce(legacy.source_query_bound, false)");
    expect(RPC).toContain("coalesce(legacy.source_data_invalid, false)");
    for (const urlSource of ["photo.url", "legacy.url"]) {
      expect(RPC).toContain(`octet_length(${urlSource})`);
      expect(RPC).toContain(`left(${urlSource}, 2048)`);
    }
    expect(RPC).not.toMatch(/(?:photo|legacy)\.url\s*~\*\s*'\^https/);
    expect(RPC).not.toContain("candidate_total");
    expect(RPC).not.toContain("p_include_clear");
    expect(RPC).not.toMatch(/\boffset\s+p_/);
    expect(RPC).not.toMatch(/\bselect\s+\*/);
  });

  it("returns authorized raw facts and leaves issue decisions to TypeScript", () => {
    for (const key of [
      "'site_photos'",
      "'customer_record'",
      "'schedule'",
      "'crew'",
      "'address'",
      "'structured_row_count'",
      "'tombstone_count'",
      "'malformed_or_local_count'",
      "'legacy_remote_count'",
      "'active_remote_by_source'",
      "'eligible_occurrence_count'",
      "'unconfirmed_occurrence_refs'",
      "'unassigned_occurrence_refs'",
    ]) {
      expect(RPC).toContain(key);
    }
    expect(RPC).not.toContain("'active_photo_count'");
    expect(RPC).not.toContain("'severity'");
    expect(RPC).not.toContain("'issue_state'");
    expect(RPC).not.toContain("'copy'");
    expect(RPC).not.toMatch(/'url'\s*,/);
    expect(RPC).not.toMatch(/'caption'\s*,/);
    expect(RPC).not.toMatch(/'email'\s*,/);
    expect(RPC).not.toMatch(/'phone'\s*,/);
  });

  it("distinguishes unresolved current customer records from inaccessible current records", () => {
    expect(RPC).toMatch(
      /left join public\.clients client[\s\S]{0,300}client\.company_id = p_company_id[\s\S]{0,220}client\.deleted_at is null[\s\S]{0,220}client\.merged_into_client_id is null/
    );
    const customerJoin = RPC.slice(
      RPC.indexOf("left join public.clients client"),
      RPC.indexOf("raw_candidate as materialized")
    );
    expect(customerJoin).not.toMatch(
      /left join public\.clients client[\s\S]*?and private\.agent_user_can_access_entity/
    );
    expect(RPC).toContain("when client.id is null then true");
    expect(RPC).toContain(
      "else private.agent_user_can_access_entity( p_actor_user_id, p_company_id, 'client', client.id, 'view' )"
    );
    expect(RPC).toContain("'resolved', customer.resolved");
  });

  it("uses exact confirmation-version proof and ranks each issue-ref subset independently", () => {
    expect(RPC).toContain(
      "task.confirmed_schedule_version is distinct from task.schedule_version"
    );
    expect(RPC).toContain("unconfirmed_ranked as materialized");
    expect(RPC).toContain("unassigned_ranked as materialized");
    expect(RPC).toContain("task.issue_rank <= 50");
    expect(RPC).toContain("task.has_valid_assignment is false");
    expect(RPC).toContain("as assignment_source_invalid");
    expect(RPC).toContain("bool_or(task.assignment_source_invalid)");
    expect(RPC).toMatch(
      /where member\.user_id is null or not pg_input_is_valid\(member\.user_id, 'uuid'\) or crew_user\.id is null/
    );
    expect(RPC).toMatch(
      /when project\.assignment_source_invalid then jsonb_build_object\( 'status', 'not_evaluated', 'gap_code', 'source_data_invalid', 'source_kind', 'task_assignments' \)/
    );
    expect(RPC).toContain("crew_user.company_id = p_company_id");
    expect(RPC).toContain("crew_user.deleted_at is null");
    expect(RPC).toContain("coalesce(crew_user.is_active, false)");
    expect(RPC).not.toContain("private.agent_parse_schedule_wall_time(task.");
    expect(RPC).toContain("private.agent_civil_date_start(");
    expect(CIVIL_DATE_START).toContain("select min(match.instant)");
    expect(CIVIL_DATE_START).toContain(
      "(guessed.instant at time zone p_timezone)::date = p_date"
    );
    expect(RPC).toContain("task.start_time is null");
    expect(RPC).toContain("task.end_time is null");
    expect(WALL_TIME_PARSER).toContain("language plpgsql immutable strict");
    expect(WALL_TIME_PARSER).toContain("if p_value !~");
    expect(WALL_TIME_PARSER).toContain("return p_value::time");
    expect(RPC).not.toMatch(/task\.(?:start_time|end_time)\s*!?~/);
  });

  it("returns one recomputable projection proof per candidate plus the source fence", () => {
    expect(RPC).toContain("'job_readiness_projection'");
    expect(RPC).toContain(
      "'job-readiness-projection:v1:' || hashed.source_content_hash"
    );
    expect(RPC).toContain("'projection_proof'");
    expect(RPC).toContain("'projection', item.projection");
    expect(RPC).toContain("'requested_rule_codes', to_jsonb(p_rule_codes)");
    expect(RPC).toContain("'first_scheduled_start_utc'");
    expect(RPC).toContain("private.canonical_agent_projection_json(");
    expect(RPC).toContain("'operational_read_revision'");
    expect(RPC).toContain("'relationship', 'supports'");
    expect(RPC).toContain("'trust', 'authoritative_ops'");
    expect(RPC).not.toContain("'excerpt'");

    for (const reader of [
      "public.read_agent_job_conversation_context_as_system",
      "public.read_agent_correspondence_evidence_as_system",
      "public.read_agent_scheduled_jobs_as_system",
      "public.read_agent_job_readiness_issues_as_system",
    ]) {
      const active = compact(functionDefinition(ALL_MIGRATIONS, reader));
      expect(active, `${reader} must have an active definition`).not.toBe("");
      expect(active).toContain("'2026-08-14.capability-manifest.v6'");
      expect(active).not.toContain("'2026-08-12.capability-manifest.v4'");
      expect(active).not.toContain("'2026-08-11.capability-manifest.v3'");
    }
  });
});

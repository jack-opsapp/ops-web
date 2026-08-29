import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_task_reads.sql";
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith(SUFFIX));
const MIGRATION = join(
  process.cwd(),
  "supabase/migrations",
  migrationNames[0] ?? "MISSING"
);
const RUNTIME = join(process.cwd(), "tests/sql/agent-task-reads-runtime.sql");
function read(path: string) {
  try {
    return readFileSync(path, "utf8").toLowerCase();
  } catch {
    return "";
  }
}
function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
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
function materializedCte(sql: string, name: string, nextName: string) {
  const marker = `${name} as materialized (`;
  const start = sql.indexOf(marker);
  if (start < 0) return "";
  const end = sql.indexOf(
    nextName
      ? `), ${nextName} as materialized (`
      : ") select pg_catalog.jsonb_build_object(",
    start
  );
  return end < 0 ? "" : sql.slice(start, end);
}

const SQL = read(MIGRATION);
const COMPACT = compact(SQL);
const LIST_PRIVATE = compact(definition(SQL, "private.agent_p2_task_list_v1"));
const DETAIL_PRIVATE = compact(
  definition(SQL, "private.agent_p2_task_context_v1")
);
const ATTENTION_PRIVATE = compact(
  definition(SQL, "private.agent_p2_task_attention_v1")
);
const LIST_COLLECTION_PROOF_INPUT = materializedCte(
  LIST_PRIVATE,
  "collection_proof_input",
  "final_projection"
);
const LIST_PROOF_CONTEXT = materializedCte(
  LIST_PRIVATE,
  "proof_context",
  "packaged_rows"
);
const LIST_PACKAGED_ROWS = materializedCte(
  LIST_PRIVATE,
  "packaged_rows",
  "aggregate_rows"
);
const LIST_TASK_SOURCE = materializedCte(
  LIST_PRIVATE,
  "task_source_gate",
  "task_source_state"
);
const LIST_FILTERED_TASK_SOURCE = materializedCte(
  LIST_PRIVATE,
  "filtered_task_source",
  "raw_source_gate"
);
const LIST_AUTHORIZED_SOURCE = materializedCte(
  LIST_PRIVATE,
  "authorized_source",
  "source_bound"
);
const DETAIL_SELECTED_TASK_SOURCE = materializedCte(
  DETAIL_PRIVATE,
  "selected_task_source",
  "financial_origin"
);
const DETAIL_FINANCIAL_ORIGIN = materializedCte(
  DETAIL_PRIVATE,
  "financial_origin",
  "selected_task"
);
const DETAIL_SELECTED_TASK = materializedCte(
  DETAIL_PRIVATE,
  "selected_task",
  "assignment_source"
);
const DETAIL_DEPENDENCY_DEFINITION_SOURCE = materializedCte(
  DETAIL_PRIVATE,
  "dependency_definition_source",
  "dependency_definition"
);
const DETAIL_DEPENDENCY_SOURCE = materializedCte(
  DETAIL_PRIVATE,
  "dependency_task_source",
  "dependency_projection"
);
const DETAIL_DEPENDENCY_GATE = materializedCte(
  DETAIL_PRIVATE,
  "dependency_task_source_gate",
  "dependency_task_source_state"
);
const DETAIL_DEPENDENCY_GUARD = materializedCte(
  DETAIL_PRIVATE,
  "dependency_task_source_guard",
  "dependency_task_source"
);
const DETAIL_MATERIAL_GATE = materializedCte(
  DETAIL_PRIVATE,
  "material_source_gate",
  "material_source_state"
);
const DETAIL_MATERIAL_STATE = materializedCte(
  DETAIL_PRIVATE,
  "material_source_state",
  "material_source_guard"
);
const DETAIL_MATERIAL_GUARD = materializedCte(
  DETAIL_PRIVATE,
  "material_source_guard",
  "material_source"
);
const DETAIL_MATERIAL_SOURCE = materializedCte(
  DETAIL_PRIVATE,
  "material_source",
  "material_projection"
);
const DETAIL_BASE_PROJECTION = materializedCte(
  DETAIL_PRIVATE,
  "base_projection",
  "public_task"
);
const DETAIL_EVIDENCE_SOURCE_GATE = materializedCte(
  DETAIL_PRIVATE,
  "task_evidence_source_gate",
  "task_evidence_source_state"
);
const DETAIL_EVIDENCE_SOURCE_STATE = materializedCte(
  DETAIL_PRIVATE,
  "task_evidence_source_state",
  "task_evidence_source"
);
const DETAIL_EVIDENCE_SOURCE = materializedCte(
  DETAIL_PRIVATE,
  "task_evidence_source",
  "task_evidence_projection"
);
const DETAIL_EVIDENCE_PROJECTION = materializedCte(
  DETAIL_PRIVATE,
  "task_evidence_projection",
  "material_source_gate"
);
const ATTENTION_AUTHORIZED_SOURCE = materializedCte(
  ATTENTION_PRIVATE,
  "authorized_source",
  "bounded_source"
);
const ATTENTION_RAW_SOURCE = materializedCte(
  ATTENTION_PRIVATE,
  "raw_source_gate",
  "raw_source_state"
);
const ATTENTION_RAW_GUARD = materializedCte(
  ATTENTION_PRIVATE,
  "raw_source_guard",
  "attention_source"
);
const ATTENTION_FILTERED_SOURCE = materializedCte(
  ATTENTION_PRIVATE,
  "attention_source",
  "authorized_source"
);
const DETAIL_PROOF_PROJECTION = materializedCte(
  DETAIL_PRIVATE,
  "proof_projection",
  ""
);
const DETAIL_PROOF_CONTEXT = materializedCte(
  DETAIL_PRIVATE,
  "proof_context",
  "proof_projection"
);
const LIST_PUBLIC = compact(
  definition(SQL, "public.read_agent_tasks_as_system")
);
const DETAIL_PUBLIC = compact(
  definition(SQL, "public.read_agent_task_context_as_system")
);
const RUNTIME_SQL = compact(read(RUNTIME));

describe("P2 task read migration", () => {
  it("uses one officially generated guarded migration with fixed private projections and two public RPCs", () => {
    expect(migrationNames).toHaveLength(1);
    expect(migrationNames[0]).toMatch(/^\d{14}_agent_task_reads\.sql$/);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("do $prerequisites$");
    expect(COMPACT).toContain("('table', 'private.mcp_oauth_clients')");
    expect(COMPACT).toContain(
      "('function', 'private.mcp_oauth_labels_for_scopes(text[],text)')"
    );
    for (const definition of [
      LIST_PRIVATE,
      DETAIL_PRIVATE,
      ATTENTION_PRIVATE,
      LIST_PUBLIC,
      DETAIL_PUBLIC,
    ]) {
      expect(definition).not.toBe("");
    }
    expect(LIST_PUBLIC).toContain(
      "language plpgsql stable security definer set search_path = ''"
    );
    expect(DETAIL_PUBLIC).toContain(
      "language plpgsql stable security definer set search_path = ''"
    );
    expect(COMPACT).toContain(
      "grant execute on function public.read_agent_tasks_as_system"
    );
    expect(COMPACT).toContain(
      "grant execute on function public.read_agent_task_context_as_system"
    );
    expect(COMPACT).not.toContain(
      "grant execute on function private.agent_p2_task_list_v1"
    );
    for (const signature of [
      "private.agent_p2_task_uuid_from_text(text)",
      "private.agent_p2_task_date_from_text(text)",
      "private.agent_p2_task_list_v1(",
      "private.agent_p2_task_context_v1(",
      "private.agent_p2_task_attention_v1(",
      "public.read_agent_tasks_as_system(",
      "public.read_agent_task_context_as_system(",
    ]) {
      expect(COMPACT).toContain(`alter function ${signature}`);
    }
    expect(COMPACT).toContain("owner to current_user");
    expect(COMPACT).toContain("do $canonical_acl$");
    expect(COMPACT).toContain("pg_catalog.aclexplode(");
    expect(COMPACT).toContain("agent_task_function_signature_set_failed");
    expect(COMPACT).toContain("agent_task_function_shape_failed");
    expect(COMPACT).toContain("agent_task_function_acl_failed");
    expect(COMPACT).toContain("service_role:execute:false");
  });

  it("re-proves exact current grant, actor, company, permission, and source revisions inside each source statement", () => {
    for (const value of [LIST_PRIVATE, DETAIL_PRIVATE]) {
      expect(value).toContain("private.mcp_oauth_grants grant_row");
      expect(value).toContain("grant_row.revoked_at is null");
      expect(value).toContain("grant_row.id = p_oauth_grant_id");
      expect(value).toContain("grant_row.user_id = p_actor_user_id");
      expect(value).toContain("grant_row.company_id = p_company_id");
      expect(value).toContain("grant_row.client_id = p_oauth_client_id");
      expect(value).toContain("grant_row.revision = p_grant_revision");
      expect(value).toContain(
        "grant_row.accepted_labels = private.mcp_oauth_labels_for_scopes("
      );
      expect(value).toContain("private.mcp_oauth_clients oauth_client");
      expect(value).toContain("oauth_client.disabled_at is null");
      expect(value).toContain("grant_row.scopes <@ oauth_client.scope_ceiling");
      expect(value).toContain(
        "grant_row.consent_catalog_revision = oauth_client.consent_catalog_revision"
      );
      expect(value).toContain(
        "grant_row.exposure_revision = oauth_client.exposure_revision"
      );
      expect(value).toContain("private.resolve_agent_actor_authority(");
      expect(value).toContain(
        "authority.permission_snapshot_revision = p_permission_snapshot_revision"
      );
      expect(value).toContain("private.agent_read_domain_revisions");
      expect(value).toContain("private.agent_operational_read_revisions");
      expect(value).toContain("private.agent_user_can_access_entity(");
    }
  });

  it("enforces the tasks/projects AND-intersection, schedule branch, and financial-origin branch before source projection", () => {
    for (const value of [LIST_PRIVATE, DETAIL_PRIVATE]) {
      expect(value).toContain("authority.tasks_scope = p_tasks_scope");
      expect(value).toContain("authority.projects_scope = p_projects_scope");
      expect(value).toContain("'task', task.id, 'view'");
      expect(value).toContain("'project', project.id, 'view'");
    }
    expect(LIST_PRIVATE).toContain("context.calendar_scope = 'all'");
    expect(DETAIL_PRIVATE).toContain(
      "('schedule' = any(p_sections)) is distinct from (p_calendar_scope is not null)"
    );
    expect(DETAIL_PRIVATE).toContain(
      "('financial_origin' = any(p_sections)) is distinct from (p_estimates_scope is not null)"
    );
    expect(DETAIL_PRIVATE).toContain(
      "context.project_financials_scope = 'all'"
    );
  });

  it("pins all eight list views, 25/26 paging, 501 physical bounds, canonical ordering, and cursor echo", () => {
    for (const view of [
      "all",
      "job",
      "assignee",
      "status",
      "schedule_window",
      "overdue",
      "unassigned",
      "actionable",
    ]) {
      expect(LIST_PRIVATE).toContain(`'${view}'`);
    }
    expect(LIST_PRIVATE).toContain(
      "p_page_fetch_limit is distinct from p_item_limit + 1"
    );
    expect(LIST_PRIVATE).toContain("p_item_limit not between 1 and 25");
    expect(LIST_PRIVATE).toContain("p_source_limit is distinct from 501");
    expect(LIST_PRIVATE).toContain("limit 501");
    expect(LIST_PRIVATE).toContain("agent_task_source_query_bound");
    expect(LIST_PRIVATE).toContain("order by");
    expect(LIST_PRIVATE).toContain("task.id");
    expect(LIST_PRIVATE).toContain("'cursor_source_revisions'");
    expect(LIST_PRIVATE).toContain("'cursor_predecessor'");
  });

  it("bounds the canonical ordered task source before every selector so an empty or selective filter cannot scan past 501", () => {
    expect(LIST_TASK_SOURCE).not.toBe("");
    expect(LIST_FILTERED_TASK_SOURCE).not.toBe("");
    expect(LIST_TASK_SOURCE).toContain("limit 501");
    expect(LIST_TASK_SOURCE).not.toContain("p_view_kind");
    expect(LIST_TASK_SOURCE).not.toContain("p_assignee_user_id");
    expect(LIST_TASK_SOURCE).not.toContain("p_window_starts_at");
    expect(LIST_FILTERED_TASK_SOURCE).toContain("from task_source_gate task");
    expect(LIST_FILTERED_TASK_SOURCE).toContain(
      "cross join task_source_state task_state"
    );
    expect(LIST_FILTERED_TASK_SOURCE).toContain(
      "where task_state.source_count < 501"
    );
    for (const view of [
      "job",
      "assignee",
      "status",
      "schedule_window",
      "overdue",
      "unassigned",
      "actionable",
    ]) {
      expect(LIST_FILTERED_TASK_SOURCE).toContain(`'${view}'`);
    }
  });

  it("freezes every multi-row task source at 501 before row-level authority", () => {
    const listTaskSource = LIST_TASK_SOURCE;
    const listRaw = materializedCte(
      LIST_PRIVATE,
      "raw_source_gate",
      "raw_source_state"
    );
    const listAuthorized = materializedCte(
      LIST_PRIVATE,
      "authorized_source",
      "source_bound"
    );
    const attentionRaw = materializedCte(
      ATTENTION_PRIVATE,
      "raw_source_gate",
      "raw_source_state"
    );
    const attentionAuthorized = materializedCte(
      ATTENTION_PRIVATE,
      "authorized_source",
      "bounded_source"
    );
    const dependencyRaw = materializedCte(
      DETAIL_PRIVATE,
      "dependency_task_source_gate",
      "dependency_task_source_state"
    );
    const dependencyAuthorized = materializedCte(
      DETAIL_PRIVATE,
      "dependency_task_source",
      "dependency_projection"
    );
    const attentionGuard = materializedCte(
      ATTENTION_PRIVATE,
      "raw_source_guard",
      "attention_source"
    );
    const dependencyGuard = materializedCte(
      DETAIL_PRIVATE,
      "dependency_task_source_guard",
      "dependency_task_source"
    );

    for (const raw of [listTaskSource, attentionRaw, dependencyRaw]) {
      expect(raw).toContain("limit 501");
      expect(raw).not.toContain("private.agent_user_can_access_entity(");
    }
    expect(listTaskSource).toContain("from cursor_guard context");
    expect(listTaskSource).toContain("join public.project_tasks task");
    expect(listTaskSource).not.toContain("join public.projects project");
    expect(listTaskSource).not.toContain("join public.task_types task_type");
    expect(listRaw).toContain("from filtered_task_source task");
    expect(listRaw).toContain("task_state.source_count < 501");
    expect(listRaw).toContain("join public.projects project");
    expect(listRaw).toContain("join public.task_types task_type");
    for (const authorized of [
      listAuthorized,
      attentionAuthorized,
      dependencyAuthorized,
    ]) {
      expect(authorized).toContain("private.agent_user_can_access_entity(");
    }
    expect(listAuthorized).toContain("raw_state.source_count < 501");
    for (const guard of [attentionGuard, dependencyGuard]) {
      expect(guard).toContain("raw_state.source_count < 501");
      expect(guard).not.toContain("private.agent_user_can_access_entity(");
    }
  });

  it("uses canonical task/project entity helpers and independently authorizes assigned estimate projects", () => {
    for (const value of [
      LIST_AUTHORIZED_SOURCE,
      DETAIL_SELECTED_TASK_SOURCE,
      DETAIL_DEPENDENCY_SOURCE,
      ATTENTION_AUTHORIZED_SOURCE,
    ]) {
      expect(value).not.toBe("");
      expect(value).toContain("private.agent_user_can_access_entity(");
      expect(value).not.toContain("tasks_scope = 'all'");
      expect(value).not.toContain("projects_scope = 'all'");
      expect(value).not.toContain("project_assignment.status = 'active'");
    }
    expect(DETAIL_SELECTED_TASK_SOURCE).not.toContain(
      "or context.estimates_scope = 'assigned'"
    );
    expect(DETAIL_FINANCIAL_ORIGIN).toContain(
      "selected.estimates_scope = 'assigned'"
    );
    expect(DETAIL_FINANCIAL_ORIGIN).toContain(
      "from public.project_tasks estimate_assignment"
    );
    expect(DETAIL_FINANCIAL_ORIGIN).toContain(
      "join public.projects estimate_project"
    );
    expect(DETAIL_FINANCIAL_ORIGIN).toContain(
      "estimate_assignment.deleted_at is null"
    );
    expect(DETAIL_FINANCIAL_ORIGIN).toContain("p_actor_user_id::text = any");
    expect(DETAIL_FINANCIAL_ORIGIN).not.toContain(
      "estimate_assignment.status = 'active'"
    );
    expect(DETAIL_FINANCIAL_ORIGIN).not.toContain("public.project_notes");
    expect(DETAIL_SELECTED_TASK).toContain("origin.authorized");
  });

  it("raw-gates attention, dependency-by-task-type, and task-material sources on their physical keysets before joins, filters, and sorts", () => {
    expect(ATTENTION_RAW_SOURCE).toContain(
      "idx_project_tasks_agent_attention_gate_v1"
    );
    expect(ATTENTION_RAW_SOURCE).toContain("order by task.id");
    expect(ATTENTION_RAW_SOURCE).toContain("limit 501");
    expect(ATTENTION_RAW_SOURCE).not.toContain("join public.projects");
    expect(ATTENTION_RAW_SOURCE).not.toContain("join public.task_types");
    expect(ATTENTION_RAW_SOURCE).not.toContain("cardinality(");
    expect(ATTENTION_RAW_GUARD).toContain(
      "cross join raw_source_state raw_state"
    );
    expect(ATTENTION_RAW_GUARD).toContain("where raw_state.source_count < 501");
    expect(ATTENTION_RAW_GUARD).not.toContain("join public.projects");
    expect(ATTENTION_FILTERED_SOURCE).toContain("join public.projects");

    expect(DETAIL_DEPENDENCY_GATE).toContain(
      "idx_project_tasks_agent_dependency_gate_v1"
    );
    expect(DETAIL_DEPENDENCY_GATE).toContain("limit 501");
    expect(DETAIL_DEPENDENCY_GATE).not.toContain("distinct on");
    expect(DETAIL_DEPENDENCY_GATE).toContain("join lateral");
    expect(DETAIL_DEPENDENCY_GATE).toContain("order by candidate.id");
    expect(DETAIL_DEPENDENCY_GATE).toContain(") <= p_dependency_limit");
    expect(DETAIL_DEPENDENCY_GATE).not.toContain("join public.task_types");
    expect(DETAIL_DEPENDENCY_GUARD).toContain(
      "cross join dependency_task_source_state raw_state"
    );
    expect(DETAIL_DEPENDENCY_GUARD).toContain(
      "where raw_state.source_count < 501"
    );

    expect(DETAIL_MATERIAL_GATE).toContain(
      "idx_task_materials_agent_task_gate_v1"
    );
    expect(DETAIL_MATERIAL_GATE).toContain("order by material.id");
    expect(DETAIL_MATERIAL_GATE).toContain("limit p_source_limit");
    expect(DETAIL_MATERIAL_GATE).not.toContain("public.catalog_variants");
    expect(DETAIL_MATERIAL_GATE).not.toContain(
      "public.company_inventory_settings"
    );
    expect(DETAIL_MATERIAL_STATE).toContain(
      "pg_catalog.count(*)::integer as raw_source_count"
    );
    expect(DETAIL_MATERIAL_GUARD).toContain(
      "cross join material_source_state raw_state"
    );
    expect(DETAIL_MATERIAL_GUARD).toContain(
      "where raw_state.raw_source_count < p_source_limit"
    );
    expect(DETAIL_MATERIAL_GUARD).not.toContain("public.catalog_variants");
    expect(DETAIL_MATERIAL_SOURCE).toContain("public.catalog_variants");
  });

  it("projects bounded immutable task-completion evidence without exposing event payloads", () => {
    expect(DETAIL_EVIDENCE_SOURCE_GATE).not.toBe("");
    expect(DETAIL_EVIDENCE_SOURCE_STATE).not.toBe("");
    expect(DETAIL_EVIDENCE_SOURCE).not.toBe("");
    expect(DETAIL_EVIDENCE_PROJECTION).not.toBe("");
    expect(DETAIL_EVIDENCE_SOURCE_GATE).toContain(
      "join public.task_mutation_events event"
    );
    expect(DETAIL_EVIDENCE_SOURCE_GATE).toContain(
      "event.task_id = selected.id"
    );
    expect(DETAIL_EVIDENCE_SOURCE_GATE).toContain(
      "selected.project_id as expected_project_id"
    );
    expect(DETAIL_EVIDENCE_SOURCE_GATE).toContain(
      "order by event.event_sequence"
    );
    expect(DETAIL_EVIDENCE_SOURCE_GATE).toContain("limit p_source_limit");
    expect(DETAIL_EVIDENCE_SOURCE_STATE).toContain(
      "pg_catalog.count(*)::integer as raw_source_count"
    );
    expect(DETAIL_EVIDENCE_SOURCE).toContain(
      "raw_state.raw_source_count < p_source_limit"
    );
    expect(DETAIL_EVIDENCE_SOURCE).toContain("event.company_id = p_company_id");
    expect(DETAIL_EVIDENCE_SOURCE).toContain(
      "event.project_id = event.expected_project_id"
    );
    expect(DETAIL_EVIDENCE_SOURCE).toContain(
      "event.event_type = 'task_completed'"
    );
    expect(DETAIL_EVIDENCE_PROJECTION).toContain(
      "pg_catalog.count(*)::integer as evidence_count"
    );
    expect(DETAIL_EVIDENCE_PROJECTION).toContain("raw.raw_source_count");
    expect(DETAIL_EVIDENCE_PROJECTION).toContain(
      "event.company_id is distinct from p_company_id"
    );
    expect(DETAIL_PRIVATE).toContain("'state', 'recorded'");
    expect(DETAIL_PRIVATE).toContain(
      "'evidence_count', task.task_evidence_count"
    );
    expect(DETAIL_PRIVATE).toContain(
      "section.task_evidence_raw_source_count >= p_source_limit"
    );
    expect(DETAIL_PRIVATE).toContain(
      "'task_evidence', projection.task_evidence_raw_source_count"
    );
    for (const forbidden of [
      "before_snapshot",
      "after_snapshot",
      "actor_user_id",
    ]) {
      expect(DETAIL_EVIDENCE_SOURCE_GATE).not.toContain(forbidden);
      expect(DETAIL_EVIDENCE_SOURCE).not.toContain(forbidden);
      expect(DETAIL_EVIDENCE_PROJECTION).not.toContain(forbidden);
    }
  });

  it("uses task dependency overrides as the effective array before type defaults", () => {
    expect(DETAIL_SELECTED_TASK_SOURCE).toContain("task.dependency_overrides");
    expect(DETAIL_DEPENDENCY_DEFINITION_SOURCE).toContain("coalesce(");
    expect(DETAIL_DEPENDENCY_DEFINITION_SOURCE).toContain(
      "pg_catalog.jsonb_typeof(selected.dependency_overrides) = 'array'"
    );
    expect(DETAIL_DEPENDENCY_DEFINITION_SOURCE).toContain(
      "pg_catalog.jsonb_typeof(selected.task_type_dependencies) = 'array'"
    );
    expect(
      DETAIL_DEPENDENCY_DEFINITION_SOURCE.indexOf(
        "then selected.dependency_overrides"
      )
    ).toBeLessThan(
      DETAIL_DEPENDENCY_DEFINITION_SOURCE.indexOf(
        "then selected.task_type_dependencies"
      )
    );
    expect(DETAIL_DEPENDENCY_DEFINITION_SOURCE).toContain("'[]'::jsonb");
  });

  it("projects only current safe team display, dependency state, material readiness, opt-in notes, and authorized financial origin", () => {
    expect(DETAIL_PRIVATE).toContain("task.deleted_at is null");
    expect(DETAIL_PRIVATE).toContain("project.deleted_at is null");
    expect(DETAIL_PRIVATE).toContain("member.deleted_at is null");
    expect(DETAIL_PRIVATE).toContain("member.is_active is true");
    expect(DETAIL_PRIVATE).toContain("member.first_name");
    expect(DETAIL_PRIVATE).toContain("member.last_name");
    expect(DETAIL_PRIVATE).toContain("task_type.dependencies");
    expect(DETAIL_PRIVATE).toContain("task.dependency_overrides");
    expect(DETAIL_PRIVATE).toContain("public.task_materials");
    expect(DETAIL_PRIVATE).toContain("material.source");
    expect(DETAIL_PRIVATE).toContain("material.inventory_item_id");
    expect(DETAIL_PRIVATE).toContain(
      "coalesce( material.catalog_variant_id, material.inventory_item_id )"
    );
    expect(DETAIL_PRIVATE).toContain("public.catalog_variants");
    expect(DETAIL_PRIVATE).toContain("public.company_inventory_settings");
    expect(DETAIL_PRIVATE).toContain(
      "'content_kind', 'untrusted_business_data'"
    );
    expect(DETAIL_PRIVATE).toContain("'notes' = any(p_sections)");
    expect(DETAIL_PRIVATE).toContain("'financial_origin' = any(p_sections)");
    expect(DETAIL_PRIVATE).toContain("selected.source_estimate_id ~");
    expect(DETAIL_PRIVATE).toContain("selected.source_line_item_id ~");
    expect(DETAIL_FINANCIAL_ORIGIN).toContain("estimate.project_ref");
    expect(DETAIL_FINANCIAL_ORIGIN).toContain(
      "private.agent_p2_task_uuid_from_text(estimate.project_id)"
    );
    expect(DETAIL_FINANCIAL_ORIGIN).toContain("estimate.project_ref is null");
    expect(DETAIL_FINANCIAL_ORIGIN).toContain(
      "is distinct from estimate.project_ref"
    );
    expect(DETAIL_FINANCIAL_ORIGIN).toContain("canonical_project_id");
    expect(DETAIL_SELECTED_TASK).toContain("origin.authorized");
    expect(DETAIL_SELECTED_TASK).toContain("origin.value as financial_origin");
    expect(DETAIL_BASE_PROJECTION).not.toContain("financial_origin origin");
    expect(DETAIL_FINANCIAL_ORIGIN).not.toContain(
      "estimate.project_id = selected.project_id"
    );
    expect(DETAIL_PRIVATE).not.toContain("member.email");
    expect(DETAIL_PRIVATE).not.toContain("member.phone");
    expect(DETAIL_PRIVATE).not.toContain("inventory_deducted");
    expect(DETAIL_PRIVATE).not.toContain("unit_cost");
    expect(DETAIL_PRIVATE).not.toContain("unit_price");
  });

  it("treats only stock-sourced cut-list rows as stock requirements while validating and physically bounding every material row", () => {
    expect(DETAIL_PRIVATE).toContain(
      "pg_catalog.count(*) filter ( where source.source = 'stock' )::integer as required_count"
    );
    expect(DETAIL_PRIVATE).toContain(
      "where source.source = 'stock' and source.inventory_mode = 'tracked'"
    );
    expect(DETAIL_PRIVATE).toContain(
      "source.source is null or source.source not in ('stock', 'order')"
    );
    expect(DETAIL_PRIVATE).toContain(
      "material.raw_source_count >= p_source_limit"
    );
    expect(DETAIL_PRIVATE).toContain(
      "'materials', projection.material_raw_source_count"
    );
  });

  it("binds collection proof identity to the complete canonical authority and query snapshot", () => {
    expect(LIST_PROOF_CONTEXT).not.toBe("");
    for (const binding of [
      "'capability_id', 'list_tasks'",
      "'capability_revision', 'list_tasks:2026-08-22.v1'",
      "'ranking_revision', 'task-ranking:2026-08-22.v1'",
      "'actor_user_id', p_actor_user_id",
      "'company_id', p_company_id",
      "'oauth_grant_id', p_oauth_grant_id",
      "'oauth_client_id', p_oauth_client_id",
      "'grant_revision', p_grant_revision",
      "'granted_scope_ceiling', pg_catalog.to_jsonb(p_granted_scope_ceiling)",
      "'required_oauth_scopes', pg_catalog.to_jsonb(p_required_oauth_scopes)",
      "'permission_snapshot_revision', p_permission_snapshot_revision",
      "'tasks_scope', p_tasks_scope",
      "'projects_scope', p_projects_scope",
      "'calendar_scope', p_calendar_scope",
      "'view'",
      "'item_limit', p_item_limit",
      "'cursor_read_at'",
      "'cursor_source_revisions', p_cursor_source_revisions",
      "'cursor_predecessor'",
      "'read_at'",
      "'source_revisions'",
      "'source_inspected'",
      "'source_has_more'",
    ]) {
      expect(LIST_PROOF_CONTEXT).toContain(binding);
    }
  });

  it("binds every entity and evidence hash to the full normalized authority, query, source fence, and exact projection", () => {
    for (const value of [
      `${LIST_PROOF_CONTEXT} ${LIST_PACKAGED_ROWS}`,
      `${DETAIL_PROOF_CONTEXT} ${DETAIL_PROOF_PROJECTION}`,
    ]) {
      for (const binding of [
        "'oauth_client_id', p_oauth_client_id",
        "'grant_revision', p_grant_revision",
        "'granted_scope_ceiling'",
        "'capability_manifest_revision'",
        "'required_oauth_scopes'",
        "'tasks_scope', p_tasks_scope",
        "'projects_scope', p_projects_scope",
        "'read_at'",
        "'source_revisions'",
        "'source_inspected'",
      ]) {
        expect(value).toContain(binding);
      }
      expect(value).toContain("'proof_kind'");
    }
    expect(LIST_PACKAGED_ROWS).toContain("'task_list_entity'");
    expect(LIST_PACKAGED_ROWS).toContain("'task_list_evidence'");
    expect(LIST_PROOF_CONTEXT).toContain("'source_has_more'");
    expect(LIST_PROOF_CONTEXT).toContain("'cursor_predecessor'");
    expect(LIST_PACKAGED_ROWS).toContain("'task_ref'");
    expect(LIST_PACKAGED_ROWS).toContain("row.priority_rank::text");
    expect(DETAIL_PROOF_PROJECTION).toContain("'task_context_entity'");
    expect(DETAIL_PROOF_PROJECTION).toContain("'task_context_evidence'");
    expect(DETAIL_PROOF_CONTEXT).toContain("'selected_sections'");
    expect(DETAIL_PROOF_PROJECTION).toContain("validated.priority_rank::text");
    expect(COMPACT).toContain("'priority_rank_proof_text'");
  });

  it("binds the SQL collection proof to returned children while leaving result-budget reproof possible", () => {
    for (const binding of [
      "'proof_kind', 'task_list_collection'",
      "'returned_count'",
      "'has_more'",
      "'children'",
      "'task_ref'",
      "'proof_ref'",
      "'evidence_ref'",
    ]) {
      expect(LIST_COLLECTION_PROOF_INPUT).toContain(binding);
    }
  });

  it("mints exact task and legacy revision proofs without exposing private source identifiers", () => {
    for (const value of [LIST_PRIVATE, DETAIL_PRIVATE]) {
      expect(value).toContain("'domain', 'tasks'");
      expect(value).toContain("'domain', 'legacy_operational'");
      expect(value).toContain("'ops_proof:v1:'");
      expect(value).toContain("'ops_evidence:v1:'");
      expect(value).toContain("private.canonical_agent_projection_json(");
    }
    expect(COMPACT).not.toContain("as $function$ as $function$");
    for (const parserOnlyForm of [
      "nullif",
      "coalesce",
      "greatest",
      "least",
      "substring",
    ]) {
      expect(COMPACT).not.toContain(`pg_catalog.${parserOnlyForm}(`);
    }
    for (const forbidden of [
      "'deleted_at'",
      "'source_estimate_id'",
      "'source_line_item_id'",
      "'provider_id'",
      "'internal_notes'",
      "'raw_payload'",
    ]) {
      expect(LIST_PRIVATE).not.toContain(forbidden);
      expect(DETAIL_PRIVATE).not.toContain(forbidden);
    }
  });

  it("ships a rollback-only PG17 runtime fixture for ACL, authority intersections, soft deletes, paging/bounds, cursor staleness, readiness, and trigger churn", () => {
    expect(RUNTIME_SQL.startsWith("begin;")).toBe(true);
    expect(RUNTIME_SQL.endsWith("rollback;")).toBe(true);
    expect(RUNTIME_SQL).toContain("set local role authenticated");
    expect(RUNTIME_SQL).toContain("has_function_privilege");
    expect(RUNTIME_SQL).toContain("read_agent_tasks_as_system");
    expect(RUNTIME_SQL).toContain("read_agent_task_context_as_system");
    expect(RUNTIME_SQL).toContain("agent_task_runtime_failed");
    expect(RUNTIME_SQL).toContain("assigned intersection leaked");
    expect(RUNTIME_SQL).toContain("soft-deleted task leaked");
    expect(RUNTIME_SQL).toContain("source bound not enforced");
    expect(RUNTIME_SQL).toContain("revoked grant accepted");
    expect(RUNTIME_SQL).toContain(
      "assert_task_authority_rejected('disabled_client')"
    );
    expect(RUNTIME_SQL).toContain(
      "assert_task_authority_rejected('stale_client_ceiling')"
    );
    expect(RUNTIME_SQL).toContain(
      "assert_task_authority_rejected('stale_consent_revision')"
    );
    expect(RUNTIME_SQL).toContain(
      "assert_task_authority_rejected('stale_exposure_revision')"
    );
    expect(RUNTIME_SQL).toContain(
      "assert_task_authority_rejected('invalid_accepted_labels')"
    );
    expect(RUNTIME_SQL).toContain("task revision did not advance");
    expect(RUNTIME_SQL).toContain("idx_project_tasks_agent_list_order_v1");
    expect(RUNTIME_SQL).toContain("task list keyset plan did not use index");
    expect(RUNTIME_SQL).toContain("task list keyset plan exceeded 501 rows");
    expect(RUNTIME_SQL).toContain("with task_source_gate as materialized");
    for (const view of [
      "job",
      "assignee",
      "status",
      "schedule_window",
      "overdue",
      "unassigned",
      "actionable",
      "assigned_noise",
    ]) {
      expect(RUNTIME_SQL).toContain(`task plan ${view}`);
    }
    expect(RUNTIME_SQL).toContain("rows removed by filter");
    expect(RUNTIME_SQL).toContain("canonical project visibility missing");
    for (const surface of ["list", "detail", "attention"]) {
      expect(RUNTIME_SQL).toContain(
        `canonical task ${surface} visibility widened`
      );
    }
    expect(RUNTIME_SQL).toContain("recorded task evidence missing");
    expect(RUNTIME_SQL).toContain("task evidence payload leaked");
    expect(RUNTIME_SQL).toContain("task evidence binding invalid accepted");
    expect(RUNTIME_SQL).toContain("task evidence source bound not enforced");
    expect(RUNTIME_SQL).toContain("production column type mismatch");
    expect(RUNTIME_SQL).toContain("dependency null override did not fall back");
    expect(RUNTIME_SQL).toContain(
      "empty dependency override did not suppress defaults"
    );
    expect(RUNTIME_SQL).toContain(
      "nonempty dependency override did not replace defaults"
    );
    expect(RUNTIME_SQL).toContain(
      "dependency override revision did not advance"
    );
    expect(RUNTIME_SQL).toContain(
      "dependency override source bound not enforced"
    );
    expect(RUNTIME_SQL).toContain(
      "canonical estimate project_ref was not primary"
    );
    expect(RUNTIME_SQL).toContain("legacy estimate project fallback failed");
    expect(RUNTIME_SQL).toContain("estimate project conflict accepted");
    expect(RUNTIME_SQL).toContain("assigned financial project access missing");
    expect(RUNTIME_SQL).toContain(
      "unrelated assigned financial project leaked"
    );
    expect(RUNTIME_SQL).toContain("mixed-scope assigned estimate leaked");
    expect(RUNTIME_SQL).toContain(
      "mixed-scope unrelated estimate or line refs disclosed"
    );
    expect(RUNTIME_SQL).toContain(
      "project-note-only estimate assignment leaked"
    );
    for (const mutation of [
      "project note add mention cursor",
      "project note remove mention cursor",
      "project note soft delete cursor",
      "project note hard delete cursor",
      "project note reparent cursor",
      "project note tenant move revisions",
    ]) {
      expect(RUNTIME_SQL).toContain(mutation);
    }
    for (const source of ["attention", "dependency", "material"]) {
      expect(RUNTIME_SQL).toContain(`task ${source} hostile plan`);
    }
    for (const metric of [
      "actual rows",
      "rows removed by filter",
      "actual loops",
      "heap fetches",
      "exact heap blocks",
      "shared hit blocks",
      "shared read blocks",
    ]) {
      expect(RUNTIME_SQL).toContain(metric);
    }
    for (const parserOnlyForm of [
      "nullif",
      "coalesce",
      "greatest",
      "least",
      "substring",
    ]) {
      expect(RUNTIME_SQL).not.toContain(`pg_catalog.${parserOnlyForm}(`);
    }
  });
});

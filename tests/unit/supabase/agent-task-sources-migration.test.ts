import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_task_sources.sql";
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith(SUFFIX));
const SQL = (() => {
  try {
    return readFileSync(
      join(
        process.cwd(),
        "supabase/migrations",
        migrationNames[0] ?? "MISSING"
      ),
      "utf8"
    ).toLowerCase();
  } catch {
    return "";
  }
})();
const COMPACT = SQL.replace(/\s+/g, " ").trim();

describe("P2 task source-fence migration", () => {
  it("uses one officially generated guarded migration with only checked-in prerequisites", () => {
    expect(migrationNames).toHaveLength(1);
    expect(migrationNames[0]).toMatch(/^\d{14}_agent_task_sources\.sql$/);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("do $prerequisites$");
    for (const prerequisite of [
      "private.agent_read_domain_revisions",
      "private.bump_agent_read_domain_revision()",
      "private.advance_agent_read_domain_revisions(uuid[],text)",
      "public.project_tasks",
      "public.task_mutation_events",
      "public.projects",
      "public.project_notes",
      "public.task_types",
      "public.users",
      "public.task_materials",
      "public.catalog_variants",
      "public.company_inventory_settings",
      "public.estimates",
      "public.line_items",
    ]) {
      expect(SQL).toContain(prerequisite);
    }
  });

  it("advances only the closed tasks domain for task, safe-team, readiness, and financial-origin dependencies", () => {
    for (const table of [
      "project_tasks",
      "task_mutation_events",
      "projects",
      "project_notes",
      "task_types",
      "users",
      "catalog_variants",
      "company_inventory_settings",
      "estimates",
      "line_items",
    ]) {
      expect(COMPACT).toContain(
        `on public.${table} for each row execute function private.bump_agent_read_domain_revision('tasks', 'company_id')`
      );
    }
    expect(COMPACT).toContain("private.bump_agent_task_material_revision()");
    expect(COMPACT).toContain("on public.task_materials");
    expect(COMPACT).toContain(
      "private.advance_agent_read_domain_revisions( v_company_ids, 'tasks' )"
    );
    expect(COMPACT).toContain(
      "on public.task_mutation_events for each row execute function private.bump_agent_read_domain_revision('tasks', 'company_id')"
    );
    expect(COMPACT).not.toContain("'team', 'company_id'");
    expect(COMPACT).not.toContain("'catalog', 'company_id'");
  });

  it("keeps custom trigger helpers private, fixed-search-path, and inaccessible to application roles", () => {
    expect(COMPACT).toContain(
      "language plpgsql security definer set search_path = ''"
    );
    expect(COMPACT).toContain(
      "revoke all on function private.bump_agent_task_material_revision() from public, anon, authenticated, service_role"
    );
    expect(COMPACT).not.toContain("grant execute");
    expect(COMPACT).not.toContain("grant select");
    expect(COMPACT).toContain(
      "create index if not exists idx_project_tasks_agent_list_order_v1 on public.project_tasks"
    );
    expect(COMPACT).toContain(
      "coalesce( case when start_date is not null and pg_catalog.isfinite(start_date)"
    );
    expect(COMPACT).toContain(
      "where deleted_at is null and status in ('active', 'cancelled', 'completed')"
    );
    expect(COMPACT).toContain("agent_task_list_order_index_shape_failed");
    for (const [indexName, table, keys, predicate] of [
      [
        "idx_project_tasks_agent_attention_gate_v1",
        "project_tasks",
        "company_id, id",
        "where deleted_at is null and status = 'active'",
      ],
      [
        "idx_project_tasks_agent_dependency_gate_v1",
        "project_tasks",
        "company_id, project_id, task_type_id, id",
        "where deleted_at is null and status <> 'cancelled'",
      ],
      [
        "idx_task_materials_agent_task_gate_v1",
        "task_materials",
        "task_id, id",
        "",
      ],
    ]) {
      expect(COMPACT).toContain(
        `create index if not exists ${indexName} on public.${table} ( ${keys} )${predicate ? ` ${predicate}` : ""}`
      );
      expect(COMPACT).toContain(indexName);
    }
    expect(COMPACT).toContain("agent_task_source_index_shape_failed");
    expect(COMPACT).toContain(
      "alter function private.bump_agent_task_material_revision() owner to current_user"
    );
    expect(COMPACT).toContain("do $canonical_acl$");
    expect(COMPACT).toContain("pg_catalog.aclexplode(");
    expect(COMPACT).toContain("agent_task_material_function_shape_failed");
    expect(COMPACT).toContain("agent_task_material_function_acl_failed");
    expect(COMPACT).toContain("trigger_row.tgtype = 29");
    for (const parserOnlyForm of ["nullif", "coalesce", "greatest", "least"]) {
      expect(COMPACT).not.toContain(`pg_catalog.${parserOnlyForm}(`);
    }
  });
});

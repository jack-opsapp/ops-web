import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260715160500_lead_assignment_scoped_rls.sql"
);

function sql(): string {
  return readFileSync(migrationPath, "utf8");
}

function functionBody(source: string, name: string): string {
  const marker = `create or replace function ${name}`;
  const lower = source.toLowerCase();
  const start = lower.indexOf(marker);
  expect(start, `${name} missing`).toBeGreaterThanOrEqual(0);
  const next = lower.indexOf(
    "create or replace function ",
    start + marker.length
  );
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

function policyStatement(source: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(
      `create\\s+policy\\s+${escapedName}\\s+on\\s+public\\.opportunities[\\s\\S]*?;`,
      "i"
    )
  );
  expect(match, `${name} policy missing`).not.toBeNull();
  return match?.[0] ?? "";
}

const actorAwareFunctions = [
  "private.effective_pipeline_scope_for_user",
  "private.user_can_create_opportunity",
  "private.user_can_view_opportunity",
  "private.user_can_edit_opportunity",
  "private.user_can_assign_opportunity",
  "private.user_can_convert_opportunity",
] as const;

const currentUserFunctions = [
  "private.current_user_can_create_opportunity",
  "private.current_user_can_view_opportunity",
  "private.current_user_can_edit_opportunity",
  "private.current_user_can_assign_opportunity",
  "private.current_user_can_convert_opportunity",
] as const;

describe("canonical lead authorization helper contracts", () => {
  it("creates the exact actor-aware and current-user signatures", () => {
    const source = sql();

    expect(source).toMatch(
      /create or replace function private\.effective_pipeline_scope_for_user\(\s*p_actor_user_id uuid,\s*p_actor_company_id uuid,\s*p_permission text\s*\) returns text/i
    );

    for (const action of ["view", "edit", "assign", "convert"]) {
      expect(source).toMatch(
        new RegExp(
          `create or replace function private\\.user_can_${action}_opportunity\\(\\s*p_actor_user_id uuid,\\s*p_opportunity_id uuid\\s*\\) returns boolean`,
          "i"
        )
      );
      expect(source).toMatch(
        new RegExp(
          `create or replace function private\\.current_user_can_${action}_opportunity\\(\\s*p_opportunity_id uuid\\s*\\) returns boolean`,
          "i"
        )
      );
    }

    expect(source).toMatch(
      /create or replace function private\.user_can_create_opportunity\(\s*p_actor_user_id uuid,\s*p_company_id uuid\s*\) returns boolean/i
    );
    expect(source).toMatch(
      /create or replace function private\.current_user_can_create_opportunity\(\s*\)\s+returns boolean/i
    );
  });

  it("makes every private authorization function stable, definer-owned, and fixed-path", () => {
    const source = sql();

    for (const name of [...actorAwareFunctions, ...currentUserFunctions]) {
      const body = functionBody(source, name);
      expect(body, name).toMatch(/stable\s+security definer/i);
      expect(body, name).toMatch(
        /set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'/i
      );
    }

    for (const name of actorAwareFunctions) {
      expect(source, name).toMatch(
        new RegExp(
          `revoke all on function ${name.replace(".", "\\.")}\\([\\s\\S]*?from public, anon, authenticated, service_role`,
          "i"
        )
      );
    }

    for (const name of currentUserFunctions) {
      const escaped = name.replace(".", "\\.");
      expect(source, name).toMatch(
        new RegExp(
          `revoke all on function ${escaped}\\([\\s\\S]*?from public, anon, authenticated, service_role[\\s\\S]*?grant execute on function ${escaped}\\([\\s\\S]*?to anon, authenticated`,
          "i"
        )
      );
    }
  });

  it("resolves granular scope through the override-aware engine without revoke widening", () => {
    const body = functionBody(
      sql(),
      "private.effective_pipeline_scope_for_user"
    );

    expect(body).toMatch(
      /p_permission not in \(\s*'pipeline\.create',\s*'pipeline\.view',\s*'pipeline\.edit',\s*'pipeline\.assign',\s*'pipeline\.convert'\s*\)/i
    );
    expect(body).toMatch(
      /from public\.users[\s\S]*?id = p_actor_user_id[\s\S]*?company_id = p_actor_company_id[\s\S]*?deleted_at is null[\s\S]*?coalesce\((?:[a-z]+\.)?is_active, false\)/i
    );
    expect(body).toMatch(
      /public\.has_permission\(\s*p_actor_user_id,\s*p_permission,\s*'all'/i
    );
    expect(body).toMatch(
      /public\.has_permission\(\s*p_actor_user_id,\s*p_permission,\s*'assigned'/i
    );
    expect(body).toMatch(
      /private\.should_use_pipeline_manage_compat\(\s*p_actor_user_id,\s*p_actor_company_id,\s*p_permission/i
    );
    expect(body).toMatch(/v_raw_scope not in \('all', 'assigned'\)/i);
    expect(body).not.toMatch(/'own'\s+then\s+return/i);
  });

  it("intersects edit, assignment, conversion, and creation with prerequisites", () => {
    const body = functionBody(
      sql(),
      "private.effective_pipeline_scope_for_user"
    );

    expect(body).toMatch(
      /when 'pipeline\.edit'[\s\S]*?effective_pipeline_scope_for_user\([\s\S]*?'pipeline\.view'[\s\S]*?least_permissive_pipeline_scope/i
    );
    expect(body).toMatch(
      /when 'pipeline\.assign'[\s\S]*?effective_pipeline_scope_for_user\([\s\S]*?'pipeline\.edit'[\s\S]*?least_permissive_pipeline_scope/i
    );
    expect(body).toMatch(
      /when 'pipeline\.convert'[\s\S]*?effective_pipeline_scope_for_user\([\s\S]*?'pipeline\.edit'[\s\S]*?least_permissive_pipeline_scope/i
    );
    expect(body).toMatch(
      /when 'pipeline\.create'[\s\S]*?v_raw_scope is distinct from 'all'[\s\S]*?effective_pipeline_scope_for_user\([\s\S]*?'pipeline\.view'[\s\S]*?return 'all'/i
    );
  });

  it("enforces same-company row lookup plus all/assigned behavior", () => {
    const source = sql();

    for (const action of ["view", "edit", "assign", "convert"]) {
      const body = functionBody(
        source,
        `private.user_can_${action}_opportunity`
      );
      expect(body, action).toMatch(
        /from public\.opportunities[\s\S]*?id = p_opportunity_id[\s\S]*?deleted_at is null/i
      );
      expect(body, action).toMatch(
        new RegExp(
          `effective_pipeline_scope_for_user\\([\\s\\S]*?v_opportunity\\.company_id[\\s\\S]*?'pipeline\\.${action}'`,
          "i"
        )
      );
      expect(body, action).toMatch(/v_scope = 'all'/i);
      expect(body, action).toMatch(
        /v_scope = 'assigned'[\s\S]*?v_opportunity\.assigned_to = p_actor_user_id/i
      );
      expect(body, action).not.toMatch(/opportunity_assignment_suggestions/i);
    }

    const create = functionBody(source, "private.user_can_create_opportunity");
    expect(create).toMatch(
      /effective_pipeline_scope_for_user\(\s*p_actor_user_id,\s*p_company_id,\s*'pipeline\.create'/i
    );
    expect(create).toMatch(/= 'all'/i);
  });

  it("derives canonical current-user IDs and preserves non-pipeline scope behavior", () => {
    const source = sql();

    for (const action of ["view", "edit", "assign", "convert"]) {
      const body = functionBody(
        source,
        `private.current_user_can_${action}_opportunity`
      );
      expect(body, action).toMatch(/private\.get_current_user_id\(\)/i);
      expect(body, action).toMatch(
        new RegExp(`private\\.user_can_${action}_opportunity`, "i")
      );
    }

    const create = functionBody(
      source,
      "private.current_user_can_create_opportunity"
    );
    expect(create).toMatch(/private\.get_current_user_id\(\)/i);
    expect(create).toMatch(/private\.get_user_company_id\(\)/i);
    expect(create).toMatch(/private\.user_can_create_opportunity/i);

    const scope = functionBody(source, "private.current_user_scope_for");
    expect(scope).toMatch(/stable\s+security definer/i);
    expect(scope).toMatch(
      /set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'/i
    );
    expect(scope).toMatch(
      /p_permission in \(\s*'pipeline\.create',\s*'pipeline\.view',\s*'pipeline\.edit',\s*'pipeline\.assign',\s*'pipeline\.convert'\s*\)[\s\S]*?effective_pipeline_scope_for_user/i
    );
    expect(scope).toMatch(/public\.user_permission_overrides/i);
    expect(scope).toMatch(/upo\.company_id = me\.company_id/i);
    expect(scope).toMatch(/public\.user_roles/i);
    expect(scope).toMatch(/public\.role_permissions/i);
    expect(scope).toMatch(
      /when exists \(select 1 from o where not granted\)[\s\S]*?then null/i
    );
    expect(scope).toMatch(
      /when exists \(select 1 from o where granted and scope is not null\)[\s\S]*?then \(select scope from o\)/i
    );
  });
});

describe("service authorization bridge", () => {
  it("is service-only, exact-action allowlisted, and delegates to private helpers", () => {
    const source = sql();
    const body = functionBody(
      source,
      "public.authorize_opportunity_action_as_system"
    );

    expect(source).toMatch(
      /create or replace function public\.authorize_opportunity_action_as_system\(\s*p_actor_user_id uuid,\s*p_opportunity_id uuid,\s*p_action text\s*\) returns boolean/i
    );
    expect(body).toMatch(/stable\s+security definer/i);
    expect(body).toMatch(
      /set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'/i
    );
    expect(body).toMatch(/auth\.role\(\)[\s\S]*?'service_role'/i);
    expect(body).toMatch(
      /p_action not in \('view', 'edit', 'assign', 'convert'\)/i
    );
    for (const action of ["view", "edit", "assign", "convert"]) {
      expect(body, action).toMatch(
        new RegExp(
          `when '${action}' then return private\\.user_can_${action}_opportunity`,
          "i"
        )
      );
    }
    expect(source).toMatch(
      /revoke all on function public\.authorize_opportunity_action_as_system\(uuid, uuid, text\)\s+from public, anon, authenticated, service_role/i
    );
    expect(source).toMatch(
      /grant execute on function public\.authorize_opportunity_action_as_system\(uuid, uuid, text\)\s+to service_role/i
    );
  });
});

describe("scoped opportunity RLS and assignment delivery invalidation", () => {
  it("replaces each restrictive opportunity policy with only its canonical wrapper", () => {
    const source = sql();
    const expectations = [
      ["role_scope_read", "select", "current_user_can_view_opportunity"],
      ["role_scope_insert", "insert", "current_user_can_create_opportunity"],
      ["role_scope_update", "update", "current_user_can_edit_opportunity"],
      ["role_scope_delete", "delete", "current_user_can_edit_opportunity"],
    ] as const;

    for (const [name, operation, wrapper] of expectations) {
      expect(source).toMatch(
        new RegExp(
          `drop policy if exists ${name} on public\\.opportunities`,
          "i"
        )
      );
      const policy = policyStatement(source, name);
      expect(policy, name).toMatch(/as restrictive/i);
      expect(policy, name).toMatch(
        new RegExp(`for ${operation}\\s+to public`, "i")
      );
      expect(policy, name).toMatch(new RegExp(`private\\.${wrapper}\\(`, "i"));
      expect(policy, name).not.toMatch(
        /current_user_has_permission|has_permission|pipeline\.manage|pipeline\.(?:view|edit|create|assign|convert)/i
      );
    }

    expect(policyStatement(source, "role_scope_update")).toMatch(
      /using\s*\(\s*private\.current_user_can_edit_opportunity\(id\)\s*\)[\s\S]*?with check\s*\(\s*private\.current_user_can_edit_opportunity\(id\)\s*\)/i
    );
    expect(source).not.toMatch(/drop policy[^;]*company_isolation/i);
  });

  it("keeps direct assignment guarded and fails if the foundation trigger is absent", () => {
    const source = sql();

    expect(source).not.toMatch(
      /drop trigger[^;]*trg_opportunities_guard_assignment_mutation/i
    );
    expect(source).not.toMatch(
      /drop function[^;]*guard_opportunity_assignment_mutation/i
    );
    expect(source).toMatch(
      /from pg_catalog\.pg_trigger[\s\S]*?trg_opportunities_guard_assignment_mutation[\s\S]*?private[\s\S]*?guard_opportunity_assignment_mutation[\s\S]*?raise exception 'lead_assignment_guard_missing'/i
    );
  });

  it("adds addressed assignment deliveries to Realtime idempotently", () => {
    const source = sql();

    expect(source).toMatch(
      /from pg_catalog\.pg_publication[\s\S]*?pubname = 'supabase_realtime'/i
    );
    expect(source).toMatch(
      /from pg_catalog\.pg_publication_tables[\s\S]*?pubname = 'supabase_realtime'[\s\S]*?schemaname = 'public'[\s\S]*?tablename = 'opportunity_assignment_deliveries'/i
    );
    expect(source).toMatch(
      /alter publication supabase_realtime add table public\.opportunity_assignment_deliveries/i
    );
  });
});

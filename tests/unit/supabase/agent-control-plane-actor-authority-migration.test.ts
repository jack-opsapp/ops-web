import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_SUFFIX = "_agent_control_plane_actor_authority.sql";

function migrationSql(): string {
  const directory = join(process.cwd(), "supabase/migrations");
  const matches = readdirSync(directory)
    .filter((file) => file.endsWith(MIGRATION_SUFFIX))
    .sort();

  expect(
    matches,
    `expected exactly one migration ending in ${MIGRATION_SUFFIX}`
  ).toHaveLength(1);

  return matches.length === 1
    ? readFileSync(join(directory, matches[0]), "utf8")
    : "";
}

function functionBody(source: string, name: string): string {
  const escaped = name.replaceAll(".", "\\.");
  const match = source.match(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+${escaped}\\s*\\([\\s\\S]*?\\)\\s*(?:returns|return)[\\s\\S]*?as\\s+\\$[a-z_]*\\$([\\s\\S]*?)\\$[a-z_]*\\$\\s*;`,
      "i"
    )
  );

  expect(match, `${name} is missing`).toBeTruthy();
  return match?.[1] ?? "";
}

function policyDefinition(
  source: string,
  table: string,
  policyName: string
): string {
  const escapedTable = table.replaceAll(".", "\\.");
  const escapedPolicy = policyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(
      `create\\s+policy\\s+(?:"${escapedPolicy}"|${escapedPolicy})\\s+on\\s+public\\.${escapedTable}([\\s\\S]*?);`,
      "i"
    )
  );

  expect(match, `${table}.${policyName} is missing`).toBeTruthy();
  return match?.[1] ?? "";
}

describe("agent control-plane actor authority migration", () => {
  it("fails closed when the live identity, permission, or assignment prerequisites drift", () => {
    const source = migrationSql();

    for (const signature of [
      "public.has_permission(uuid,text,text)",
      "private.current_user_scope_for(text)",
      "private.effective_pipeline_scope_for_user(uuid,uuid,text)",
      "private.effective_inbox_scope_for_user(uuid,uuid,text)",
      "private.user_can_view_project(uuid,uuid)",
      "private.user_can_edit_project(uuid,uuid)",
      "private.user_can_view_task(uuid,uuid)",
      "private.user_can_edit_task(uuid,uuid)",
      "private.user_can_change_task_status(uuid,uuid)",
      "private.user_can_view_opportunity(uuid,uuid)",
      "private.user_can_edit_opportunity(uuid,uuid)",
    ]) {
      expect(source).toContain(`'${signature}'`);
    }
    expect(source).toContain("to_regprocedure(v_signature)");

    expect(source).toMatch(
      /raise exception[\s\S]*?'agent_control_plane_actor_authority_prerequisite_missing/i
    );
    expect(source).toMatch(
      /user_permission_overrides[\s\S]*?user_roles[\s\S]*?role_permissions/i
    );
  });

  it("removes the authenticated cross-user permission oracle while preserving current-user RLS", () => {
    const source = migrationSql();
    const wrapper = functionBody(
      source,
      "private.current_user_has_permission_scoped"
    );

    expect(wrapper).toContain("private.get_current_user_id()");
    expect(wrapper).toContain("public.has_permission(");
    expect(source).toMatch(
      /revoke all on function public\.has_permission\(\s*uuid,\s*text,\s*text\s*\)[\s\S]*?from public, anon, authenticated, service_role/i
    );
    expect(source).toMatch(
      /grant execute on function public\.has_permission\(\s*uuid,\s*text,\s*text\s*\)[\s\S]*?to service_role/i
    );
    expect(source).not.toMatch(
      /grant execute on function public\.has_permission\(\s*uuid,\s*text,\s*text\s*\)[\s\S]*?to (?:anon|authenticated)/i
    );
    expect(source).toMatch(
      /grant execute on function private\.current_user_has_permission_scoped\(\s*text,\s*text\s*\)[\s\S]*?to anon, authenticated, service_role/i
    );

    const rewrittenPolicies = [
      [
        "accounting_connections",
        "read company accounting_connections with accounting view",
      ],
      ["expense_batches", "expense_batches_approve_scope"],
      ["opportunity_views", "admins manage company opportunity views"],
      ["opportunity_views", "read company and own opportunity views"],
      ["opportunity_views", "users manage own opportunity views"],
      ["project_views", "admins manage company views"],
      ["project_views", "users manage own views"],
      ["project_views", "users read company and own views"],
      ["projects", "project_archive_write_scope"],
      [
        "qbo_customer_matches",
        "read company qbo_customer_matches with accounting view",
      ],
      [
        "qbo_estimate_opportunity_links",
        "read company qbo_estimate_opportunity_links with accounting vie",
      ],
      ["qbo_import_runs", "read company qbo_import_runs with accounting view"],
      [
        "qbo_item_product_mappings",
        "read company qbo_item_product_mappings with accounting view",
      ],
      [
        "qbo_staging_customers",
        "read company qbo_staging_customers with accounting view",
      ],
      [
        "qbo_staging_estimates",
        "read company qbo_staging_estimates with accounting view",
      ],
      [
        "qbo_staging_invoices",
        "read company qbo_staging_invoices with accounting view",
      ],
      [
        "qbo_staging_line_items",
        "read company qbo_staging_line_items with accounting view",
      ],
      [
        "qbo_staging_payments",
        "read company qbo_staging_payments with accounting view",
      ],
    ] as const;

    for (const [table, policyName] of rewrittenPolicies) {
      const definition = policyDefinition(source, table, policyName);
      expect(definition).toContain(
        "private.current_user_has_permission_scoped("
      );
      expect(definition).not.toMatch(/(?:public\.)?has_permission\s*\(/i);
      expect(source).toContain(`'${table}|${policyName}|`);
    }
  });

  it("rewrites security-invoker catalog callers before revoking app-role permission execution", () => {
    const source = migrationSql();

    for (const signature of [
      "public.catalog_guided_setup_archive_variant(uuid,text)",
      "public.catalog_guided_setup_begin_commit(uuid,text)",
      "public.catalog_guided_setup_finish_commit(uuid,uuid,boolean,jsonb,jsonb)",
      "public.catalog_inventory_import_commit(uuid)",
    ]) {
      expect(source).toContain(`'${signature}'`);
    }
    expect(source).toContain("pg_get_functiondef");
    expect(source).toContain("private.current_user_has_permission_scoped(");
    expect(source).toMatch(
      /catalog\.run_setup[\s\S]*?inventory\.manage[\s\S]*?catalog_permission_rewrite_failed/i
    );
    expect(source).toMatch(
      /not\s+procedure\.prosecdef[\s\S]*?has_function_privilege\('anon'[\s\S]*?has_function_privilege\('authenticated'/i
    );
    expect(source).toMatch(
      /direct has_permission invoker count[\s\S]*?prosecdef[\s\S]*?proowner/i
    );
  });

  it("keeps the gmail owner-snapshot trigger functional through an owner-only definer boundary", () => {
    const source = migrationSql();

    expect(source).toContain("'private.set_email_analysis_owner_snapshot()'");
    expect(source).toContain(
      "'private.resolve_email_connection_identity(uuid)'"
    );
    expect(source).toContain("gmail_scan_jobs_set_owner_snapshot");
    expect(source).toMatch(
      /pg_catalog\.pg_trigger[\s\S]*?gmail_scan_jobs[\s\S]*?tgtype[\s\S]*?set_email_analysis_owner_snapshot/i
    );
    expect(source).toMatch(
      /set_email_analysis_owner_snapshot[\s\S]*?new\.requested_by_user_id[\s\S]*?settings\.integrations[\s\S]*?new\.connection_owner_user_id/i
    );
    expect(source).toMatch(
      /alter function private\.set_email_analysis_owner_snapshot\(\)[\s\S]*?security definer/i
    );
    expect(source).toMatch(
      /revoke all on function private\.set_email_analysis_owner_snapshot\(\)[\s\S]*?from public, anon, authenticated, service_role/i
    );
  });

  it("centralizes actor-parameterized role and override scope without trusting stale membership", () => {
    const source = migrationSql();
    const rawScope = functionBody(
      source,
      "private.raw_permission_scope_for_user"
    );
    const effectiveScope = functionBody(
      source,
      "private.effective_permission_scope_for_user"
    );

    expect(rawScope).toMatch(
      /users[\s\S]*?id\s*=\s*p_actor_user_id[\s\S]*?company_id\s*=\s*p_actor_company_id[\s\S]*?deleted_at\s+is\s+null[\s\S]*?is_active/i
    );
    expect(rawScope).toMatch(/companies[\s\S]*?deleted_at\s+is\s+null/i);
    expect(rawScope).toMatch(
      /user_permission_overrides[\s\S]*?company_id\s*=\s*p_actor_company_id[\s\S]*?not\s+v_override_granted[\s\S]*?return null/i
    );
    expect(rawScope).toMatch(
      /granted[\s\S]*?scope\s+is\s+not\s+null[\s\S]*?return/i
    );
    expect(rawScope).toMatch(
      /user_roles[\s\S]*?roles[\s\S]*?role_permissions/i
    );
    expect(rawScope).toMatch(
      /role\.is_preset[\s\S]*?role\.company_id\s*=\s*p_actor_company_id/i
    );
    expect(rawScope).toMatch(
      /scope\s+in\s*\(\s*'all'\s*,\s*'assigned'\s*,\s*'own'\s*\)/i
    );

    expect(effectiveScope).toMatch(
      /pipeline\.create[\s\S]*?private\.effective_pipeline_scope_for_user/i
    );
    expect(effectiveScope).toMatch(
      /inbox\.view[\s\S]*?inbox\.send[\s\S]*?private\.effective_inbox_scope_for_user/i
    );
    expect(effectiveScope).toContain("private.raw_permission_scope_for_user(");

    const hasPermission = functionBody(source, "public.has_permission");
    expect(hasPermission).toContain("private.raw_permission_scope_for_user(");
    expect(hasPermission).toMatch(
      /private\.user_is_company_admin[\s\S]*?return true/i
    );

    const currentScope = functionBody(source, "private.current_user_scope_for");
    expect(currentScope).toContain(
      "private.effective_permission_scope_for_user("
    );
  });

  it("resolves every trusted registry key and versions configured plus raw authority provenance", () => {
    const source = migrationSql();
    const body = functionBody(source, "private.resolve_agent_actor_authority");

    expect(source).toMatch(
      /resolve_agent_actor_authority\([\s\S]*?p_registered_permission_keys text\[\][\s\S]*?returns table\s*\([\s\S]*?actor_user_id uuid[\s\S]*?company_id uuid[\s\S]*?is_active boolean[\s\S]*?is_admin boolean[\s\S]*?role_ids uuid\[\][\s\S]*?configured_permissions text\[\][\s\S]*?effective_permissions jsonb[\s\S]*?permission_snapshot_revision text/i
    );
    expect(body).toMatch(
      /cardinality\(p_registered_permission_keys\)[\s\S]*?(?:256|agent_permission_registry_too_large)/i
    );
    expect(body).toMatch(
      /unnest\(p_registered_permission_keys\)[\s\S]*?btrim[\s\S]*?array_agg\(distinct[\s\S]*?order by/i
    );
    expect(body).toMatch(/invalid_agent_permission_registry/i);
    expect(body).toMatch(
      /users[\s\S]*?company_id\s*=\s*p_company_id[\s\S]*?deleted_at\s+is\s+null[\s\S]*?is_active/i
    );
    expect(body).toMatch(/array_agg\([\s\S]*?order by[\s\S]*?role_id/i);
    expect(body).toMatch(
      /role_grants[\s\S]*?role_id[\s\S]*?permission[\s\S]*?scope[\s\S]*?role_is_valid/i
    );
    expect(body).toContain("from public.user_permission_overrides override");
    expect(body).toMatch(
      /'permission', override\.permission[\s\S]*?'scope', override\.scope[\s\S]*?'granted', override\.granted/i
    );
    expect(body).toMatch(
      /configured_permissions[\s\S]*?role_permissions[\s\S]*?user_permission_overrides/i
    );
    expect(body).toMatch(
      /jsonb_agg\([\s\S]*?permission[\s\S]*?scope[\s\S]*?order by[\s\S]*?permission/i
    );
    expect(body).toContain("private.effective_permission_scope_for_user(");
    expect(body).toMatch(
      /is_company_admin_flag[\s\S]*?is_account_holder[\s\S]*?is_admin_list_member/i
    );
    expect(body).toMatch(
      /coalesce\(actor\.id::text\s*=\s*company\.account_holder_id,\s*false\)/i
    );
    for (const revisionFact of [
      "registered_permission_keys",
      "role_ids",
      "role_grants",
      "overrides",
      "configured_permissions",
      "effective_permissions",
    ]) {
      expect(body).toContain(`'${revisionFact}'`);
    }
    expect(body).toMatch(
      /sha256:[\s\S]*?extensions\.digest\([\s\S]*?'sha256'/i
    );
    expect(body).not.toMatch(/auth_id|firebase_uid|email|phone/i);
    expect(
      body.match(/v_registered_permission_keys\s+text\[\]/gi)
    ).toHaveLength(1);
  });

  it("keeps both authority entry points service-only and resolves a verified subject in one RPC", () => {
    const source = migrationSql();
    const mcpBody = functionBody(
      source,
      "public.resolve_agent_actor_authority_as_system"
    );
    const internalBody = functionBody(
      source,
      "public.resolve_agent_actor_authority_for_subject_as_system"
    );

    expect(mcpBody).toMatch(/auth\.role\(\)[\s\S]*?'service_role'/i);
    expect(mcpBody).toContain("private.resolve_agent_actor_authority(");
    expect(internalBody).toMatch(/auth\.role\(\)[\s\S]*?'service_role'/i);
    expect(internalBody).toMatch(
      /p_firebase_subject[\s\S]*?btrim[\s\S]*?(?:128|invalid_agent_firebase_subject)/i
    );
    expect(internalBody).toMatch(
      /where actor\.auth_id\s*=\s*p_firebase_subject[\s\S]*?if not found[\s\S]*?where actor\.firebase_uid\s*=\s*p_firebase_subject/i
    );
    expect(internalBody).toContain("private.resolve_agent_actor_authority(");
    expect(internalBody).not.toMatch(/\bemail\b/i);
    expect(internalBody).not.toMatch(/\b(?:insert|update|delete)\b/i);

    expect(source).toMatch(
      /revoke all on function public\.resolve_agent_actor_authority_as_system\(\s*uuid,\s*uuid,\s*text\[\]\s*\)[\s\S]*?from public, anon, authenticated, service_role/i
    );
    expect(source).toMatch(
      /grant execute on function public\.resolve_agent_actor_authority_as_system\(\s*uuid,\s*uuid,\s*text\[\]\s*\)[\s\S]*?to service_role/i
    );
    expect(source).toMatch(
      /revoke all on function public\.resolve_agent_actor_authority_for_subject_as_system\(\s*text,\s*text\[\]\s*\)[\s\S]*?from public, anon, authenticated, service_role/i
    );
    expect(source).toMatch(
      /grant execute on function public\.resolve_agent_actor_authority_for_subject_as_system\(\s*text,\s*text\[\]\s*\)[\s\S]*?to service_role/i
    );
  });

  it("provides a privacy-safe entity predicate for same-statement domain reads", () => {
    const source = migrationSql();
    const privateBody = functionBody(
      source,
      "private.agent_user_can_access_entity"
    );
    const publicBody = functionBody(
      source,
      "public.authorize_agent_entity_as_system"
    );

    expect(privateBody).toMatch(
      /p_entity_kind\s+is\s+null[\s\S]*?p_entity_kind\s+not in\s*\([\s\S]*?'opportunity'[\s\S]*?'project'[\s\S]*?'task'[\s\S]*?'client'[\s\S]*?'sub_client'[\s\S]*?'calendar_event'[\s\S]*?'calendar_user_event'[\s\S]*?\)/i
    );
    expect(privateBody).toMatch(/invalid_agent_entity_(?:kind|action)/i);
    expect(privateBody).toContain("private.user_can_view_project(");
    expect(privateBody).toContain("private.user_can_edit_project(");
    expect(privateBody).toContain("private.user_can_view_opportunity(");
    expect(privateBody).toContain("private.user_can_edit_opportunity(");
    expect(privateBody).toContain("private.user_can_view_task(");
    expect(privateBody).toContain("private.user_can_edit_task(");
    expect(privateBody).toContain("private.user_can_change_task_status(");
    expect(privateBody).toContain("private.user_can_view_client(");
    expect(privateBody).toContain("private.user_can_view_sub_client(");
    expect(privateBody).toContain("private.user_can_view_calendar_event(");
    expect(privateBody).toContain("private.user_can_view_calendar_user_event(");
    expect(privateBody).toMatch(
      /when 'calendar_user_event'[\s\S]*?private\.user_is_active_company_member\([\s\S]*?p_actor_user_id[\s\S]*?p_actor_company_id/i
    );

    expect(publicBody).toMatch(/auth\.role\(\)[\s\S]*?'service_role'/i);
    expect(publicBody).toContain("private.agent_user_can_access_entity(");
    expect(publicBody).not.toMatch(/raise exception[^;]*not_found/i);
    expect(source).toMatch(
      /authorize_agent_entity_as_system[\s\S]*?standalone boolean[\s\S]*?same (?:sql )?statement/i
    );

    expect(source).toMatch(
      /revoke all on function public\.authorize_agent_entity_as_system\(\s*uuid,\s*uuid,\s*text,\s*uuid,\s*text\s*\)[\s\S]*?from public, anon, authenticated, service_role/i
    );
    expect(source).toMatch(
      /grant execute on function public\.authorize_agent_entity_as_system\(\s*uuid,\s*uuid,\s*text,\s*uuid,\s*text\s*\)[\s\S]*?to service_role/i
    );
  });

  it("keeps client and sub-client visibility on live project assignment, never note mention", () => {
    const source = migrationSql();
    const clientView = functionBody(source, "private.user_can_view_client");
    const subClientView = functionBody(
      source,
      "private.user_can_view_sub_client"
    );

    expect(clientView).toMatch(/clients\.view[\s\S]*?'all'[\s\S]*?'assigned'/i);
    expect(clientView).toContain("from public.projects project");
    expect(clientView).toContain("join public.project_tasks task");
    expect(clientView).toMatch(/project\.client_id\s*=\s*p_client_id/i);
    expect(clientView).toMatch(/project\.deleted_at\s+is\s+null/i);
    expect(clientView).toMatch(/task\.deleted_at\s+is\s+null/i);
    expect(clientView).toMatch(/task\.team_member_ids/i);
    expect(clientView).not.toMatch(/project_notes|mentioned_user_ids/i);

    expect(subClientView).toMatch(
      /sub_clients[\s\S]*?client_id[\s\S]*?company_id\s*=\s*p_actor_company_id[\s\S]*?deleted_at\s+is\s+null/i
    );
    expect(subClientView).toContain("private.user_can_view_client(");
  });

  it("preserves calendar all, own, team, linked-project, and time-off reviewer visibility", () => {
    const source = migrationSql();
    const calendarEvent = functionBody(
      source,
      "private.user_can_view_calendar_event"
    );
    const userEvent = functionBody(
      source,
      "private.user_can_view_calendar_user_event"
    );
    const editUserEvent = functionBody(
      source,
      "private.user_can_edit_calendar_user_event"
    );

    expect(calendarEvent).toMatch(/calendar\.view[\s\S]*?tasks\.view/i);
    expect(calendarEvent).toMatch(/team_member_ids/i);
    expect(calendarEvent).toContain("private.user_can_view_project(");
    expect(calendarEvent).toMatch(/deleted_at\s+is\s+null/i);

    expect(userEvent).toMatch(/calendar\.view[\s\S]*?tasks\.view/i);
    expect(userEvent).toMatch(
      /v_event\.user_id\s*=\s*p_actor_user_id::text[\s\S]*?team_member_ids[\s\S]*?return true/i
    );
    expect(userEvent).toContain("'time_off.approve'");
    expect(userEvent).toMatch(/v_event\.type\s*=\s*'time_off'/i);
    expect(userEvent).toMatch(/deleted_at\s+is\s+null/i);
    expect(editUserEvent).toMatch(
      /v_event\.user_id\s*=\s*p_actor_user_id::text[\s\S]*?return true/i
    );
  });

  it("makes project, task, client, sub-client, and calendar read guards intersect company isolation", () => {
    const source = migrationSql();

    // This established wrapper is consumed by several unrelated project
    // photo/reference policies. Keep its shipped membership/mention contract
    // intact and route only the repaired project policy through a new wrapper.
    expect(source).not.toMatch(
      /create\s+or\s+replace\s+function\s+private\.current_user_can_view_project\s*\(/i
    );
    expect(source).toMatch(
      /create\s+policy\s+role_scope_read\s+on\s+public\.projects[\s\S]*?current_user_can_view_project_scoped\(projects\.id\)/i
    );

    for (const table of [
      "projects",
      "project_tasks",
      "clients",
      "sub_clients",
    ] as const) {
      expect(source).toMatch(
        new RegExp(
          `create\\s+policy\\s+role_scope_read\\s+on\\s+public\\.${table}\\s+as\\s+restrictive\\s+for\\s+select`,
          "i"
        )
      );
    }

    expect(source).toMatch(
      /create policy calendar_event_read_scope_guard[\s\S]*?on public\.calendar_events[\s\S]*?as restrictive[\s\S]*?for select/i
    );
    expect(source).toMatch(
      /create policy calendar_user_event_read_scope_guard[\s\S]*?on public\.calendar_user_events[\s\S]*?as restrictive[\s\S]*?for select/i
    );
    expect(source).not.toMatch(
      /drop policy(?: if exists)?\s+["']?company_isolation["']?\s+on\s+public\.(?:projects|project_tasks|clients|sub_clients|calendar_events)/i
    );
    expect(source).not.toMatch(
      /drop policy(?: if exists)?\s+["']?Users manage own events["']?\s+on\s+public\.calendar_user_events/i
    );
  });

  it("keeps actor-parameterized helpers private and grants only current-user wrappers to app roles", () => {
    const source = migrationSql();

    for (const name of [
      "raw_permission_scope_for_user",
      "effective_permission_scope_for_user",
      "user_is_company_admin",
      "user_can_view_opportunity",
      "user_can_edit_opportunity",
      "user_can_view_client",
      "user_can_edit_client",
      "user_can_view_sub_client",
      "user_can_edit_sub_client",
      "user_can_view_calendar_event",
      "user_can_edit_calendar_event",
      "user_can_view_calendar_user_event",
      "user_can_edit_calendar_user_event",
      "agent_user_can_access_entity",
    ]) {
      expect(source).toMatch(
        new RegExp(
          `revoke\\s+all\\s+on\\s+function\\s+private\\.${name}\\([\\s\\S]*?from\\s+public,\\s*anon,\\s*authenticated,\\s*service_role`,
          "i"
        )
      );
    }

    for (const name of [
      "current_user_can_view_project_scoped",
      "current_user_can_view_task",
      "current_user_can_view_client",
      "current_user_can_view_sub_client",
      "current_user_can_view_calendar_event",
      "current_user_can_view_calendar_user_event",
    ]) {
      expect(source).toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+private\\.${name}\\([\\s\\S]*?to\\s+anon,\\s*authenticated`,
          "i"
        )
      );
    }
  });
});

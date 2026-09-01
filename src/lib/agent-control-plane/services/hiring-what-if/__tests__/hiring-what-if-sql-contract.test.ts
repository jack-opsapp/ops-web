import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260901045000_agent_hiring_what_if_read.sql"
  ),
  "utf8"
);
const normalized = migration.replace(/\s+/g, " ");

describe("hiring what-if SQL contract", () => {
  it("preflights every source and keeps the migration atomic", () => {
    expect(normalized).toContain("begin;");
    expect(normalized).toContain("commit;");
    for (const relation of [
      "public.calendar_user_events",
      "public.companies",
      "public.expense_project_allocations",
      "public.expenses",
      "public.invoices",
      "public.payments",
      "public.project_tasks",
      "public.projects",
      "public.roles",
      "public.site_visits",
      "public.user_roles",
      "public.users",
      "private.agent_read_domain_revisions",
      "private.mcp_oauth_clients",
      "private.mcp_oauth_grants",
    ]) {
      expect(migration).toContain(`'${relation}'`);
    }
    expect(normalized).toContain("('site_visits', 'status', 'USER-DEFINED')");
    expect(normalized).toContain(
      "('function', 'private.agent_currency_minor_exponent(text)')"
    );
  });

  it("re-proves the exact current v11/v5 tenant, grant, scopes, and all-scope permissions", () => {
    for (const fragment of [
      "auth.role() is distinct from 'service_role'",
      "grant_record.user_id = p_actor_user_id",
      "grant_record.company_id = p_company_id",
      "grant_record.client_id = p_oauth_client_id",
      "grant_record.revision = p_grant_revision",
      "grant_record.scopes = p_granted_scope_ceiling",
      "grant_record.revoked_at is null",
      "grant_record.exposure_revision = '2026-08-31.mcp-exposure.v5'",
      "client_record.disabled_at is null",
      "v_required_scopes <@ grant_record.scopes",
      "authority.effective_permissions @> v_required_permissions",
      "p_capability_manifest_revision is distinct from '2026-08-31.capability-manifest.v11'",
      "p_permission_snapshot_revision is not distinct from authority.permission_snapshot_revision",
    ]) {
      expect(normalized).toContain(fragment);
    }
    for (const scope of [
      "ops.company.read",
      "ops.expenses.read",
      "ops.financial_documents.read",
      "ops.financials.read",
      "ops.jobs.read",
      "ops.payments.read",
      "ops.schedule.read",
      "ops.site_visits.read",
      "ops.tasks.read",
      "ops.team.read",
    ]) {
      expect(migration).toContain(`'${scope}'`);
    }
    for (const permission of [
      "calendar.view",
      "expenses.view",
      "invoices.view",
      "projects.view",
      "projects.view_financials",
      "reports.view",
      "settings.company",
      "tasks.view",
      "team.view",
    ]) {
      expect(migration).toContain(
        `jsonb_build_object('permission', '${permission}', 'scope', 'all')`
      );
    }
  });

  it("owns the role, time, productivity, and cost definitions inside OPS", () => {
    for (const fragment of [
      "lower(btrim(role_source.name)) = lower(btrim(p_role))",
      "v_window_weeks constant integer := 13",
      "v_min_usable_weeks constant integer := 8",
      "v_min_financial_projects constant integer := 3",
      "extract(isodow from capacity_day.day_date) < 6",
      "calendar.type = 'time_off'",
      "select team.member_id from pg_catalog.unnest( coalesce(calendar.team_member_ids, array[]::text[]) ) team(member_id) where calendar.type = 'personal'",
      "task.project_id is null",
      "visit.project_ref, private.agent_read_domain_uuid_from_text(visit.project_id)",
      "visit.booked_at is not null",
      "visit.status <> 'cancelled'",
      "payment.voided_at is null",
      "expense.status = any( array['submitted', 'approved', 'reimbursed']::text[] )",
      "upper(pg_catalog.btrim(source.currency)) = v_currency",
      "source.allocation_amount is not null",
      "source.currency is not null",
      "coalesce( source.allocation_amount is not null",
      "greatest(range_source.starts_at, range_source.work_starts_at)",
      "least(range_source.ends_at, range_source.work_ends_at)",
      "sum(merged_range.ends_at - merged_range.starts_at)",
      "source.project_role_minutes / source.project_all_minutes",
    ]) {
      expect(normalized).toContain(fragment);
    }
    expect(normalized).not.toContain("p_payroll_burden");
    expect(normalized).not.toContain("p_ramp_period");
    expect(normalized).not.toContain("p_productive_statuses");
    expect(normalized).toMatch(
      /visit\.scheduled_at > private\.agent_unambiguous_local_instant\( v_window_start::timestamp, v_timezone \) - interval '1 day'/
    );
  });

  it("fails closed at every population bound and reports exact omissions", () => {
    for (const fragment of [
      "p_window_weeks is distinct from v_window_weeks",
      "p_member_limit is distinct from 25",
      "p_schedule_source_limit is distinct from 5001",
      "p_financial_source_limit is distinct from 5001",
      "p_project_limit is distinct from 251",
      "p_supporting_record_limit is distinct from 100",
      "'source_bound_exceeded'",
      "'invalid_schedule_source'",
      "'invalid_currency_expense'",
      "'insufficient_usable_weeks'",
      "'insufficient_financial_projects'",
      "'non_positive_revenue'",
      "'non_positive_contribution'",
      "'supporting_records'",
      "'invalid_schedule_records'",
      "'invalid_currency_expenses'",
    ]) {
      expect(normalized).toContain(fragment);
    }
  });

  it("is a service-role analytical read with one exact source index and no durable business state", () => {
    expect(normalized).toContain(
      "create or replace function public.read_agent_hiring_what_if_as_system"
    );
    expect(normalized).toContain("security definer set search_path = ''");
    expect(normalized).toContain(
      "revoke all on function public.read_agent_hiring_what_if_as_system"
    );
    expect(normalized).toContain(
      "from public, anon, authenticated, service_role;"
    );
    expect(normalized).toContain(
      "grant execute on function public.read_agent_hiring_what_if_as_system"
    );
    expect(normalized).not.toMatch(
      /\b(insert|update|delete|merge)\s+(into\s+|from\s+)?(public|private)\./i
    );
    expect(normalized).not.toMatch(/create\s+table/i);
    expect(normalized).toContain(
      "create index if not exists idx_site_visits_agent_hiring_history_v1 on public.site_visits (company_id, scheduled_at, id) include ( project_ref, project_id, duration_minutes, assignee_ids, status, booked_at ) where deleted_at is null and booked_at is not null and status <> 'cancelled'"
    );
    expect(normalized.match(/create\s+(?:unique\s+)?index/gi)).toHaveLength(1);
    expect(normalized).toContain(
      "v_attribute_names is distinct from array[ 'company_id', 'scheduled_at', 'id', 'project_ref', 'project_id', 'duration_minutes', 'assignee_ids', 'status', 'booked_at' ]::text[]"
    );
    expect(normalized).toContain(
      "agent_hiring_what_if_history_index_shape_invalid"
    );
    expect(normalized).toContain(
      "'deleted_atisnullandbooked_atisnotnullandstatus<>''cancelled'''"
    );
    expect(normalized).toContain("'CDF', 'CHF', 'CHE'");
    expect(normalized).toContain("'WST', 'XCD', 'XCG', 'YER'");
    expect(normalized).toContain("'ZAR', 'ZMW', 'ZWL', 'ZWG' then return 2");
    expect(normalized).not.toMatch(
      /agent_actions|notifications|result_snapshot|scenario_snapshot|hiring_snapshot/i
    );
  });
});

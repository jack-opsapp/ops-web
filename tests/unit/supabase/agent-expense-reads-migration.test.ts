import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_NAME = "20260829040046_agent_expense_reads.sql";
const BODY_PATH = join(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/expenses/sql/agent_expense_reads.body.sql"
);
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  MIGRATION_NAME
);
const RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-expense-reads-runtime.sql"
);
const REPLAY_PATH = join(
  process.cwd(),
  "tests/sql/agent-expense-reads-replay-runtime.sql"
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

function replaceExactly(
  value: string,
  oldFragment: string,
  newFragment: string,
  expectedCount: number
) {
  expect(value.split(oldFragment).length - 1).toBe(expectedCount);
  return value.split(oldFragment).join(newFragment);
}

function currentBodyFromReservation(value: string) {
  const ceilingOrdered = replaceExactly(
    value,
    "       select pg_catalog.array_agg(scope.value order by scope.value)",
    '       select pg_catalog.array_agg(\n         scope.value order by scope.value collate "C"\n       )',
    1
  );
  return replaceExactly(
    ceilingOrdered,
    "           pg_catalog.array_agg(scope.value order by scope.value),",
    '           pg_catalog.array_agg(\n             scope.value order by scope.value collate "C"\n           ),',
    1
  );
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
const LIST = compact(definition(SQL, "private.agent_p2_expense_list_v1"));
const DETAIL = compact(definition(SQL, "private.agent_p2_expense_context_v1"));
const ATTENTION = compact(
  definition(SQL, "private.agent_p2_expense_attention_v1")
);
const LIST_PUBLIC = compact(
  definition(SQL, "public.read_agent_expenses_as_system")
);
const DETAIL_PUBLIC = compact(
  definition(SQL, "public.read_agent_expense_context_as_system")
);
const RUNTIME = compact(read(RUNTIME_PATH));
const REPLAY = compact(read(REPLAY_PATH));
const RESERVED = readdirSync(join(process.cwd(), "supabase/migrations")).filter(
  (name) => name.endsWith("_agent_expense_reads.sql")
);

describe("P2 expense read SQL", () => {
  it("keeps its generated reservation immutable and derives the current body exactly", () => {
    expect(RESERVED).toEqual([MIGRATION_NAME]);
    expect(BODY_EXACT).not.toBe("");
    expect(MIGRATION_EXACT).not.toBe(BODY_EXACT);
    expect(currentBodyFromReservation(MIGRATION_EXACT)).toBe(BODY_EXACT);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("task 16 canonical expense read body");
    expect(SQL).toContain("do $prerequisites$");
    expect(SQL).toContain("do $postflight$");
  });

  it("defines fixed invoker projections and exactly two service-only public readers", () => {
    for (const value of [LIST, DETAIL, ATTENTION]) {
      expect(value).not.toBe("");
      expect(value).toContain("stable");
      expect(value).toContain("security invoker");
      expect(value).toContain("set search_path = ''");
    }
    for (const value of [LIST_PUBLIC, DETAIL_PUBLIC]) {
      expect(value).not.toBe("");
      expect(value).toContain("stable");
      expect(value).toContain("security definer");
      expect(value).toContain("set search_path = ''");
      expect(value).toContain("auth.role() is distinct from 'service_role'");
    }
    expect(
      COMPACT.match(/create or replace function public\.read_agent_/g)
    ).toHaveLength(2);
    expect(COMPACT).toContain("to service_role");
    expect(COMPACT).not.toContain(
      "grant execute on function private.agent_p2_expense"
    );
  });

  it("re-proves current grant, client, labels, actor permissions, and the exact expense revision", () => {
    for (const value of [LIST, DETAIL]) {
      expect(value).toContain("private.agent_p2_expense_read_context_v1(");
      expect(value).toContain("p_oauth_grant_id");
      expect(value).toContain("p_oauth_client_id");
      expect(value).toContain("p_grant_revision");
      expect(value).toContain("p_permission_snapshot_revision");
      expect(value).toContain("p_authorization_candidate");
      expect(value).toContain("private.agent_read_domain_revisions");
      expect(value).toContain("agent_expense_read_stale");
    }
    expect(COMPACT).toContain("private.mcp_oauth_grants");
    expect(COMPACT).toContain("private.mcp_oauth_clients");
    expect(COMPACT).toContain("('function', 'auth.role()')");
    expect(COMPACT).toContain("('function', 'extensions.digest(bytea,text)')");
    expect(COMPACT).toContain("revoked_at is null");
    expect(COMPACT).toContain("disabled_at is null");
    expect(COMPACT).toContain("private.resolve_agent_actor_authority(");
    expect(COMPACT).toContain("'domain', 'expenses'");
  });

  it("pins all five views and exact own/all/assigned approval authority", () => {
    for (const view of [
      "mine",
      "company",
      "job",
      "pending_approval",
      "reimbursement_batches",
    ]) {
      expect(LIST).toContain(`'${view}'`);
    }
    expect(COMPACT).toContain(
      "private.agent_p2_expense_expected_candidate_v1("
    );
    expect(COMPACT).toContain("'expenses.view', v_view_scope");
    expect(COMPACT).toContain("'expenses.approve', v_approve_scope");
    expect(COMPACT).toContain("'projects.view', v_projects_scope");
    expect(COMPACT).toContain("private.agent_p2_expense_assigned_approver_v1(");
    expect(COMPACT).toContain(
      "with bounded_allocations as materialized ( select allocation.id"
    );
    expect(COMPACT).toContain("limit 26 ), evaluated as (");
    expect(COMPACT).toContain("evaluated.source_count between 1 and 25");
    expect(COMPACT).toContain("with bounded_expenses as materialized (");
    expect(COMPACT).toContain("evaluated.source_count between 1 and 500");
    expect(COMPACT).toContain("public.project_tasks task");
    expect(COMPACT).toContain("task.deleted_at is null");
    expect(COMPACT).toContain("p_actor_user_id::text = any(");
    expect(COMPACT).not.toContain("project_notes");
  });

  it("projects only safe money, category, merchant, allocation, and batch state", () => {
    expect(COMPACT).toContain("private.agent_p2_expense_money_v1(");
    expect(COMPACT).toContain("private.agent_money_to_minor_units(");
    expect(COMPACT).toContain("'category_ref'");
    expect(COMPACT).toContain("'merchant_name'");
    expect(COMPACT).toContain("'percentage_basis_points'");
    expect(COMPACT).toContain("'reimbursement_amount'");
    expect(COMPACT).not.toContain("'receipt_state'");
    expect(COMPACT).not.toContain("'receipt_image_url'");
    expect(COMPACT).not.toContain("'receipt_thumbnail_url'");
    for (const forbiddenKey of [
      "'ocr_data'",
      "'payment_method'",
      "'accounting_id'",
      "'accounting_sync_status'",
      "'approved_by'",
      "'paid_by'",
      "'email'",
      "'phone'",
      "'expense_count'",
      "'employee_count'",
    ]) {
      expect(COMPACT).not.toContain(forbiddenKey);
    }
  });

  it("pins 25/26/501, canonical date/ID keysets, safe hidden errors, and bounded review reason", () => {
    expect(LIST).toContain("p_item_limit not between 1 and 25");
    expect(LIST).toContain(
      "p_page_fetch_limit is distinct from p_item_limit + 1"
    );
    expect(LIST).toContain("p_page_fetch_limit not between 2 and 26");
    expect(LIST).toContain("p_source_limit is distinct from 501");
    expect(LIST).toContain("limit 501");
    expect(LIST).toContain("order_date desc");
    expect(LIST).toContain("expense.id > p_after_id");
    expect(LIST).toContain("batch.id > p_after_id");
    expect(DETAIL).toContain("p_allocation_limit is distinct from 25");
    expect(DETAIL).toContain("p_allocation_fetch_limit is distinct from 26");
    expect(DETAIL).toContain(
      "p_review_reason_character_limit is distinct from 1000"
    );
    expect(DETAIL).toContain("agent_expense_not_found_or_not_visible");
    expect(COMPACT).toContain("agent_expense_source_query_bound");
    expect(COMPACT).toContain("order by expense.id limit 501");
    expect(COMPACT).toContain("v_expense_count >= 501");
    expect(COMPACT).toContain("agent_expense_source_data_invalid");
  });

  it("delivers bounded attention cards without cross-employee aggregate counts", () => {
    expect(ATTENTION).toContain("p_limit not between 1 and 25");
    expect(ATTENTION).toContain("p_source_limit is distinct from 501");
    expect(ATTENTION).toContain("'pending_approval'");
    expect(ATTENTION).toContain("'reimbursement_batches'");
    expect(ATTENTION).toContain("'authorization_candidate'");
    expect(ATTENTION).toContain("'source_revisions'");
    expect(ATTENTION).toContain("'cards'");
    expect(ATTENTION).not.toContain("'expense_count'");
    expect(ATTENTION).not.toContain("'employee_count'");
    expect(ATTENTION).not.toContain("'source_inspected'");
  });

  it("has a checked-in runtime/replay proof for ACL, bounds, authority, and no writes", () => {
    expect(RUNTIME).not.toBe("");
    expect(REPLAY).not.toBe("");
    for (const marker of [
      "expense_runtime_acl_ok",
      "expense_runtime_own_all_ok",
      "expense_runtime_assigned_allocation_ok",
      "expense_runtime_bounds_ok",
      "expense_runtime_no_writes_ok",
    ]) {
      expect(RUNTIME).toContain(marker);
    }
    expect(REPLAY).toContain("expense_runtime_replay_ok");
    expect(REPLAY).toContain("to pg_monitor with grant option");
    expect(REPLAY).toContain("pg_catalog.pg_get_functiondef(");
  });
});

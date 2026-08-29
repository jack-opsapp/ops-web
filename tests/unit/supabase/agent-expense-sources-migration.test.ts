import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_NAME = "20260829040045_agent_expense_reimbursement_sources.sql";
const BODY_PATH = join(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/expenses/sql/agent_expense_reimbursement_sources.body.sql"
);
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  MIGRATION_NAME
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

const BODY_EXACT = read(BODY_PATH);
const MIGRATION_EXACT = read(MIGRATION_PATH);
const SQL = BODY_EXACT.toLowerCase();
const COMPACT = compact(BODY_EXACT);
const RESERVED = readdirSync(join(process.cwd(), "supabase/migrations")).filter(
  (name) => name.endsWith("_agent_expense_reimbursement_sources.sql")
);

describe("P2 expense source-fence SQL", () => {
  it("uses one generated reservation byte-identical to its guarded body", () => {
    expect(RESERVED).toEqual([MIGRATION_NAME]);
    expect(BODY_EXACT).not.toBe("");
    expect(MIGRATION_EXACT).toBe(BODY_EXACT);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain(
      "task 16 canonical expense and reimbursement source body"
    );
    expect(COMPACT).toContain("set local timezone = 'utc'");
    expect(SQL).toContain("do $prerequisites$");
    expect(SQL).toContain("do $postflight$");
  });

  it("pins only the exact projected and approval-authority source graph", () => {
    for (const source of [
      "public.expenses",
      "public.expense_project_allocations",
      "public.expense_categories",
      "public.expense_batches",
      "public.users",
      "public.projects",
      "public.project_tasks",
    ]) {
      expect(SQL).toContain(source);
    }
    expect(COMPACT).not.toContain("project_notes");
    expect(COMPACT).not.toContain("accounting_connections");
    expect(COMPACT).not.toContain("payment_methods");
  });

  it("advances the expenses fence only for relevant field changes and old/new tenants", () => {
    expect(COMPACT).toContain(
      "create or replace function private.bump_agent_expense_source_revision()"
    );
    expect(COMPACT).toContain("security definer set search_path = ''");
    expect(COMPACT).toContain(
      "v_old_row -> field.value is distinct from v_new_row -> field.value"
    );
    expect(COMPACT).toContain(
      "private.advance_agent_read_domain_revisions( v_company_ids, 'expenses' )"
    );
    expect(COMPACT).toContain("'flag_comment', 'flagged_at'");
    expect(COMPACT).not.toContain("'flag_reason'");
    expect(COMPACT).not.toContain("'is_flagged'");
    expect(COMPACT).not.toContain("'is_active'");
    for (const table of [
      "expenses",
      "expense_project_allocations",
      "expense_categories",
      "expense_batches",
      "users",
      "projects",
      "project_tasks",
    ]) {
      expect(COMPACT).toContain(
        `create trigger ${table}_bump_agent_expense_revision after insert or update or delete on public.${table}`
      );
    }
    expect(COMPACT).toContain(
      "where expense.id in ( private.agent_read_domain_uuid_from_text(v_old_row ->> 'expense_id'), private.agent_read_domain_uuid_from_text(v_new_row ->> 'expense_id') )"
    );
  });

  it("adds exactly the four proven company/status/date, own/date, batch/period, and allocation keysets", () => {
    expect(COMPACT).toContain(
      "create index if not exists idx_expenses_agent_company_status_date_v1 on public.expenses ( company_id, status, expense_date desc, id ) where deleted_at is null"
    );
    expect(COMPACT).toContain(
      "create index if not exists idx_expenses_agent_own_date_v1 on public.expenses ( company_id, submitted_by, expense_date desc, id ) where deleted_at is null"
    );
    expect(COMPACT).toContain(
      "create index if not exists idx_expense_batches_agent_period_v1 on public.expense_batches ( company_id, period_end desc, id )"
    );
    expect(COMPACT).toContain(
      "create index if not exists idx_expense_allocations_agent_project_v1 on public.expense_project_allocations ( project_id, expense_id, id )"
    );
    expect(COMPACT.match(/create index if not exists /g)).toHaveLength(4);
  });

  it("keeps the trigger helper private and does not mutate frozen manifests or exposure", () => {
    expect(COMPACT).toContain(
      "revoke all on function private.bump_agent_expense_source_revision() from public, anon, authenticated, service_role"
    );
    expect(COMPACT).toContain("do $canonical_acl$");
    expect(COMPACT).toContain("pg_catalog.aclexplode(");
    expect(COMPACT).not.toContain("grant execute on function private.");
    expect(COMPACT).not.toContain("capability_manifest");
    expect(COMPACT).not.toContain("mcp_exposure_catalog");
    expect(COMPACT).not.toContain("create or replace function public.");
  });
});

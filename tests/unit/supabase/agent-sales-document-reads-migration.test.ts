import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_NAME = "20260829024749_agent_sales_document_reads.sql";
const BODY_PATH = join(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/sales/sql/agent_sales_document_reads.body.sql"
);
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  MIGRATION_NAME
);
const RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-sales-document-reads-runtime.sql"
);
const REPLAY_PATH = join(
  process.cwd(),
  "tests/sql/agent-sales-document-reads-replay-runtime.sql"
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

const BODY = read(BODY_PATH);
const MIGRATION = read(MIGRATION_PATH);
const SQL = BODY.toLowerCase();
const COMPACT = compact(BODY);
const LIST_PRIVATE = compact(
  definition(SQL, "private.agent_p2_sales_document_list_v1")
);
const DETAIL_PRIVATE = compact(
  definition(SQL, "private.agent_p2_sales_document_detail_v1")
);
const ATTENTION_PRIVATE = compact(
  definition(SQL, "private.agent_p2_sales_document_attention_v1")
);
const CONTEXT_PRIVATE = compact(
  definition(SQL, "private.agent_p2_sales_read_context_v1")
);
const EXPECTED_CANDIDATE_PRIVATE = compact(
  definition(SQL, "private.agent_p2_sales_expected_candidate_v1")
);
const AUTHORITY_PRIVATE = compact(
  definition(SQL, "private.agent_p2_sales_authorized_path_v1")
);
const HEADER_PRIVATE = compact(
  definition(SQL, "private.agent_p2_sales_document_header_source_v1")
);
const MONEY_PRIVATE = compact(
  definition(SQL, "private.agent_p2_sales_money_minor_or_null_v1")
);
const TIMESTAMP_PRIVATE = compact(
  definition(SQL, "private.agent_p2_sales_rfc3339_or_null_v1")
);
const LINES_PRIVATE = compact(
  definition(SQL, "private.agent_p2_sales_document_lines_v1")
);
const MILESTONES_PRIVATE = compact(
  definition(SQL, "private.agent_p2_sales_document_milestones_v1")
);
const LIST_PUBLIC = compact(
  definition(SQL, "public.read_agent_sales_documents_as_system")
);
const DETAIL_PUBLIC = compact(
  definition(SQL, "public.read_agent_sales_document_as_system")
);
const RUNTIME = compact(read(RUNTIME_PATH));
const REPLAY = compact(read(REPLAY_PATH));
const RESERVED = readdirSync(join(process.cwd(), "supabase/migrations")).filter(
  (name) => name.endsWith("_agent_sales_document_reads.sql")
);

describe("P2 sales-document read SQL", () => {
  it("byte-matches its one generated reservation", () => {
    expect(RESERVED).toEqual([MIGRATION_NAME]);
    expect(BODY).not.toBe("");
    expect(MIGRATION).toBe(BODY);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("task 14 canonical sales-document read body");
    expect(SQL).toContain("do $prerequisites$");
    expect(SQL).toContain("do $postflight$");
  });

  it("defines fixed private list/detail/attention projections and two service-only public RPCs", () => {
    for (const value of [
      LIST_PRIVATE,
      DETAIL_PRIVATE,
      ATTENTION_PRIVATE,
      LIST_PUBLIC,
      DETAIL_PUBLIC,
    ]) {
      expect(value).not.toBe("");
      expect(value).toContain("stable");
      expect(value).toContain("set search_path = ''");
    }
    for (const value of [LIST_PRIVATE, DETAIL_PRIVATE, ATTENTION_PRIVATE]) {
      expect(value).toContain("security invoker");
    }
    for (const value of [LIST_PUBLIC, DETAIL_PUBLIC]) {
      expect(value).toContain("security definer");
      expect(value).toContain("auth.role() is distinct from 'service_role'");
    }
    expect(
      COMPACT.match(/create or replace function public\.read_agent_/g)
    ).toHaveLength(2);
    expect(COMPACT).toContain(
      "grant execute on function public.read_agent_sales_documents_as_system"
    );
    expect(COMPACT).toContain(
      "grant execute on function public.read_agent_sales_document_as_system"
    );
    expect(COMPACT).not.toContain(
      "grant execute on function private.agent_p2_sales_document"
    );
  });

  it("re-proves OAuth, current actor policy, job authority, project financials, and exact revisions", () => {
    for (const value of [LIST_PRIVATE, DETAIL_PRIVATE, ATTENTION_PRIVATE]) {
      expect(value).toContain("private.agent_p2_sales_read_context_v1(");
      expect(value).toContain("private.agent_p2_sales_authorized_path_v1(");
      expect(value).toContain("permission_snapshot_revision");
      expect(value).toContain("authorization_candidates");
    }
    expect(CONTEXT_PRIVATE).toContain("private.mcp_oauth_grants");
    expect(CONTEXT_PRIVATE).toContain("private.mcp_oauth_clients");
    expect(CONTEXT_PRIVATE).toContain("private.resolve_agent_actor_authority(");
    expect(EXPECTED_CANDIDATE_PRIVATE).toContain("projects.view_financials");
    expect(CONTEXT_PRIVATE).toContain("'legacy_operational'");
    expect(CONTEXT_PRIVATE).toContain("'sales_documents'");
    expect(AUTHORITY_PRIVATE).toContain(
      "private.agent_user_can_access_entity("
    );
    expect(AUTHORITY_PRIVATE).toContain("'project'");
    expect(AUTHORITY_PRIVATE).toContain("'projectfinancialsscope' = 'all'");
    expect(COMPACT).not.toContain("projects.view_financials' = 'assigned'");
    expect(COMPACT).not.toContain("projects.view_financials' = 'own'");
  });

  it("uses canonical money, strict child bounds, physical 501/keyset sentinels, and opaque proofs", () => {
    for (const value of [LIST_PRIVATE, DETAIL_PRIVATE, ATTENTION_PRIVATE]) {
      expect(value).toContain(
        "private.agent_p2_sales_document_header_source_v1("
      );
    }
    expect(CONTEXT_PRIVATE).toContain(
      "private.agent_currency_minor_exponent_or_null("
    );
    expect(HEADER_PRIVATE).toContain(
      "private.agent_p2_sales_money_minor_or_null_v1("
    );
    expect(MONEY_PRIVATE).toContain("private.agent_money_to_minor_units(");
    expect(TIMESTAMP_PRIVATE).toContain("private.agent_rfc3339_utc(");
    expect(TIMESTAMP_PRIVATE).toContain("not between 1 and 9999");
    expect(LINES_PRIVATE).toContain("private.agent_money_to_minor_units(");
    expect(MILESTONES_PRIVATE).toContain("private.agent_money_to_minor_units(");
    expect(HEADER_PRIVATE.match(/limit p_source_limit/g) ?? []).toHaveLength(3);
    expect(LIST_PRIVATE).toContain("source.document_header is not null");
    expect(LIST_PRIVATE).toContain("p_page_fetch_limit");
    expect(LIST_PRIVATE).toContain("p_after_updated_at");
    expect(LIST_PRIVATE).toContain("p_after_document_kind");
    expect(LIST_PRIVATE).toContain("p_after_document_id");
    expect(DETAIL_PRIVATE).toContain("p_line_fetch_limit");
    expect(DETAIL_PRIVATE).toContain("p_milestone_fetch_limit");
    expect(LINES_PRIVATE).toContain("order by line.sort_order, line.id");
    expect(MILESTONES_PRIVATE).toContain(
      "order by milestone.sort_order, milestone.id"
    );
    expect(COMPACT).toContain("private.canonical_agent_projection_json(");
    expect(COMPACT).toContain("ops_proof:v1:");
    expect(COMPACT).toContain("ops_evidence:v1:");
  });

  it("excludes forbidden notes/provider/cost/configuration fields from every projection", () => {
    for (const forbidden of [
      "internal_notes",
      "pdf_storage_path",
      "qb_id",
      "sage_id",
      "unit_cost",
      "product_id",
      "configured_selections",
      "pricing_rule_snapshot",
      "parent_line_item_id",
      "task_type_ref",
    ]) {
      expect(LIST_PRIVATE).not.toContain(`'${forbidden}',`);
      expect(DETAIL_PRIVATE).not.toContain(`'${forbidden}',`);
      expect(ATTENTION_PRIVATE).not.toContain(`'${forbidden}',`);
    }
  });

  it("pins runtime ACL, unlike-currency, 501, project-financial, keyset, detail, attention, and replay proofs", () => {
    for (const marker of [
      "list_estimate_and_invoice",
      "customer_and_job_filters",
      "project_financials_all_required",
      "assigned_membership_required",
      "keyset_has_no_duplicates",
      "source_501_fails_closed",
      "unlike_currency_fails_closed",
      "noncanonical_dates_fail_closed",
      "ordered_lines_and_milestones",
      "attention_is_bounded",
      "private_acl",
    ]) {
      expect(RUNTIME).toContain(marker);
    }
    for (const marker of [
      "task14_forward_ledger",
      "task14_replay_source",
      "task14_replay_reads",
      "function_acl_stable",
    ]) {
      expect(REPLAY).toContain(marker);
    }
  });
});

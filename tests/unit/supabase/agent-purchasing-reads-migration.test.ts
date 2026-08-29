import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_NAME = "20260829091329_agent_purchase_order_reads.sql";
const BODY_PATH = join(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/purchasing/sql/agent_purchase_order_reads.body.sql"
);
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  MIGRATION_NAME
);
const RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-purchase-order-reads-runtime.sql"
);
const REPLAY_PATH = join(
  process.cwd(),
  "tests/sql/agent-purchase-order-reads-replay-runtime.sql"
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
  definition(SQL, "private.agent_p2_purchase_order_list_v1")
);
const DETAIL_PRIVATE = compact(
  definition(SQL, "private.agent_p2_purchase_order_detail_v1")
);
const ATTENTION_PRIVATE = compact(
  definition(SQL, "private.agent_p2_purchase_order_attention_v1")
);
const ITEM_PRIVATE = compact(
  definition(SQL, "private.agent_p2_purchase_order_item_v1")
);
const CONTEXT_PRIVATE = compact(
  definition(SQL, "private.agent_p2_purchase_order_read_context_v1")
);
const COST_WITNESS_PRIVATE = compact(
  definition(SQL, "private.agent_p2_purchase_order_cost_witness_v1")
);
const LIST_PUBLIC = compact(
  definition(SQL, "public.read_agent_purchase_orders_as_system")
);
const DETAIL_PUBLIC = compact(
  definition(SQL, "public.read_agent_purchase_order_as_system")
);
const RUNTIME = compact(read(RUNTIME_PATH));
const REPLAY = compact(read(REPLAY_PATH));
const RESERVED = readdirSync(join(process.cwd(), "supabase/migrations")).filter(
  (name) => name.endsWith("_agent_purchase_order_reads.sql")
);

describe("P2 purchase-order read SQL", () => {
  it("byte-matches its one generated reservation", () => {
    expect(RESERVED).toEqual([MIGRATION_NAME]);
    expect(BODY).not.toBe("");
    expect(MIGRATION).toBe(BODY);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("task 19 canonical purchase-order read body");
    expect(SQL).toContain("do $prerequisites$");
    expect(SQL).toContain("do $postflight$");
  });

  it("defines fixed private projections and exactly two service-only public RPCs", () => {
    for (const value of [LIST_PRIVATE, DETAIL_PRIVATE, ATTENTION_PRIVATE]) {
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
  });

  it("re-proves current grant, permission, candidate, and selected revision authority", () => {
    expect(CONTEXT_PRIVATE).toContain("private.mcp_oauth_grants");
    expect(CONTEXT_PRIVATE).toContain("private.mcp_oauth_clients");
    expect(CONTEXT_PRIVATE).toContain("private.resolve_agent_actor_authority(");
    expect(CONTEXT_PRIVATE).toContain("private.mcp_oauth_labels_for_scopes(");
    expect(CONTEXT_PRIVATE).toContain("'ops.purchasing.read'");
    expect(CONTEXT_PRIVATE).toContain("'ops.catalog_costs.read'");
    expect(CONTEXT_PRIVATE).toContain("'purchasing'");
    expect(CONTEXT_PRIVATE).toContain("'catalog'");
    expect(COMPACT).toContain("'catalog.orders.view'");
    expect(COMPACT).toContain("'catalog.products.view'");
    expect(COMPACT).toContain("'finances.view'");
  });

  it("pins closed selectors, exact 366 and 25/26/501/51 bounds", () => {
    expect(LIST_PRIVATE).toContain("p_item_limit not between 1 and 25");
    expect(LIST_PRIVATE).toContain("p_page_fetch_limit not between 2 and 26");
    expect(LIST_PRIVATE).toContain("p_source_limit is distinct from 501");
    expect(LIST_PRIVATE).toContain("p_line_fetch_limit is distinct from 51");
    expect(LIST_PRIVATE).toContain(
      "p_delivery_ends_on - p_delivery_starts_on > 366"
    );
    expect(LIST_PRIVATE).toContain(
      "'cancelled', 'draft', 'fulfilled', 'sent', 'suggested'"
    );
    expect(LIST_PRIVATE).toContain("p_supplier_label");
    expect(LIST_PRIVATE).toContain("limit p_page_fetch_limit");
    expect(ATTENTION_PRIVATE).toContain(
      "p_attention_kind not in ('overdue', 'due_soon')"
    );
    expect(ATTENTION_PRIVATE).toContain("p_due_soon_days not between 1 and 31");
    expect(ATTENTION_PRIVATE).toContain("limit p_page_fetch_limit");
    expect(ATTENTION_PRIVATE).not.toContain("limit p_item_limit");
  });

  it("validates every in-scope order before filtering and fails malformed legacy lines", () => {
    expect(LIST_PRIVATE).toContain(
      "foreach v_order_id in array v_order_ids loop"
    );
    expect(LIST_PRIVATE).toContain(
      "v_all_items := v_all_items || pg_catalog.jsonb_build_array(v_item)"
    );
    expect(LIST_PRIVATE.indexOf("foreach v_order_id")).toBeLessThan(
      LIST_PRIVATE.indexOf("where item.value ->> 'status' = any(p_statuses)")
    );
    expect(ITEM_PRIVATE).toContain("v_quantity_milliunits <= 0");
    expect(ITEM_PRIVATE).toContain("v_line_count is distinct from");
    expect(ITEM_PRIVATE).toContain("v_line_count >= p_line_fetch_limit");
    expect(ITEM_PRIVATE).toContain("v_line.cost_per_unit < 0");
    expect(ITEM_PRIVATE).toContain(
      "not pg_catalog.isfinite(v_order.expected_delivery_date)"
    );
    expect(ITEM_PRIVATE).toMatch(
      /pg_catalog\.date_part\(\s*'year', v_order\.expected_delivery_date\s*\) not between 1 and 9999/
    );
    expect(ITEM_PRIVATE).toMatch(
      /pg_catalog\.date_part\(\s*'year', v_order\.created_at at time zone 'utc'\s*\) not between 1 and 9999/
    );
    expect(ITEM_PRIVATE).toMatch(
      /pg_catalog\.date_part\(\s*'year', v_order\.cancelled_at at time zone 'utc'\s*\) not between 1 and 9999/
    );
    expect(ITEM_PRIVATE).toContain("private.agent_p2_purchase_order_money_v1(");
    expect(COMPACT).toContain("private.agent_money_to_minor_units(");
  });

  it("couples selected costs to a bounded current catalogue witness", () => {
    expect(COST_WITNESS_PRIVATE).toContain(
      "public.catalog_supplier_cost_profiles"
    );
    expect(COST_WITNESS_PRIVATE).toContain("limit 501");
    expect(COST_WITNESS_PRIVATE).toContain("v_count >= p_source_limit");
    expect(COST_WITNESS_PRIVATE).toContain("'sha256:'");
    expect(LIST_PRIVATE).toContain(
      "private.agent_p2_purchase_order_cost_witness_v1("
    );
    expect(DETAIL_PRIVATE).toContain(
      "private.agent_p2_purchase_order_cost_witness_v1("
    );
    expect(ATTENTION_PRIVATE).toContain(
      "private.agent_p2_purchase_order_cost_witness_v1("
    );
    expect(LIST_PRIVATE).toContain(
      "'company_currency', v_context ->> 'currency_code'"
    );
    expect(DETAIL_PRIVATE).toContain(
      "'company_currency', v_context ->> 'currency_code'"
    );
  });

  it("binds canonical proofs while excluding contact, notes, provider, source, and payment data", () => {
    expect(COMPACT).toContain("private.canonical_agent_projection_json(");
    expect(COMPACT).toContain("ops_proof:v1:");
    expect(COMPACT).toContain("ops_evidence:v1:");
    for (const forbidden of [
      "'supplier_contact',",
      "'notes',",
      "'payment',",
      "'provider',",
      "'source',",
      "'source_json',",
      "'created_by_id',",
    ]) {
      expect(LIST_PRIVATE).not.toContain(forbidden);
      expect(DETAIL_PRIVATE).not.toContain(forbidden);
      expect(ATTENTION_PRIVATE).not.toContain(forbidden);
    }
  });

  it("ships rollback-only PostgreSQL 17 behavior and replay proof", () => {
    for (const marker of [
      "runtime_requires_postgresql_17",
      "base_purchase_order_authority",
      "cost_purchase_order_authority",
      "costs_redacted_by_default",
      "zero_line_subtotal_uses_company_currency",
      "delivery_window_366_boundary",
      "delivery_window_reversed_rejected",
      "invalid_legacy_quantity_fails_whole_projection",
      "invalid_legacy_lifecycle_fails_whole_projection",
      "infinite_delivery_date_fails_whole_projection",
      "out_of_range_timestamp_fails_whole_projection",
      "source_501_fails_closed",
      "page_25_26",
      "keyset_has_no_duplicates",
      "exact_money_rejects_fractional_minor",
      "attention_is_bounded",
      "proof_binding",
      "private_acl",
    ]) {
      expect(RUNTIME).toContain(marker);
    }
    for (const marker of [
      "task19_forward_ledger",
      "task19_replay_source",
      "task19_replay_reads",
      "function_acl_stable",
    ]) {
      expect(REPLAY).toContain(marker);
    }
  });
});

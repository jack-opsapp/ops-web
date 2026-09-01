import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_NAME = "20260829091311_agent_purchasing_sources.sql";
const BODY_PATH = join(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/purchasing/sql/agent_purchasing_sources.body.sql"
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

const BODY = read(BODY_PATH);
const MIGRATION = read(MIGRATION_PATH);
const SQL = BODY.toLowerCase();
const COMPACT = compact(BODY);
const RUNTIME = compact(read(RUNTIME_PATH));
const RESERVED = readdirSync(join(process.cwd(), "supabase/migrations")).filter(
  (name) => name.endsWith("_agent_purchasing_sources.sql")
);

describe("P2 purchasing source SQL", () => {
  it("byte-matches its one generated reservation", () => {
    expect(RESERVED).toEqual([MIGRATION_NAME]);
    expect(BODY).not.toBe("");
    expect(MIGRATION).toBe(BODY);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("task 19 canonical purchase-order source body");
    expect(SQL).toContain("do $prerequisites$");
    expect(SQL).toContain("do $postflight$");
  });

  it("advances purchasing for every order fact and safe catalogue line label dependency", () => {
    for (const table of [
      "catalog_orders",
      "catalog_order_items",
      "catalog_variants",
      "catalog_items",
      "catalog_units",
      "catalog_options",
      "catalog_option_values",
      "catalog_variant_option_values",
    ]) {
      expect(SQL).toContain(`'${table}'`);
      expect(COMPACT).toContain(
        `create trigger ${table}_bump_agent_purchasing_revision`
      );
    }
    expect(COMPACT).toContain(
      "private.advance_agent_read_domain_revisions( v_company_ids, 'purchasing' )"
    );
    for (const field of [
      "status",
      "title",
      "supplier_name",
      "expected_delivery_date",
      "sent_at",
      "fulfilled_at",
      "cancelled_at",
      "catalog_variant_id",
      "quantity_requested",
      "cost_per_unit",
      "sku",
      "display",
      "abbreviation",
      "value",
      "sort_order",
    ]) {
      expect(SQL).toContain(`'${field}'`);
    }
    for (const forbidden of [
      "'supplier_contact',",
      "'notes',",
      "'created_by_id',",
      "'activation_rule',",
      "'source',",
    ]) {
      expect(SQL).not.toContain(forbidden);
    }
  });

  it("adds only the EXPLAIN-proven delivery and line-order indexes", () => {
    expect(COMPACT).toContain(
      "create index if not exists idx_catalog_orders_agent_delivery_v1"
    );
    expect(COMPACT).toContain(
      "create index if not exists idx_catalog_order_items_agent_order_id_v1"
    );
    expect(COMPACT.match(/create index if not exists /g)).toHaveLength(2);
  });

  it("keeps the source helper dark and requires PG17 runtime trigger/index proof", () => {
    expect(COMPACT).not.toContain("grant execute");
    for (const marker of [
      "runtime_requires_postgresql_17",
      "purchasing_sources_bump",
      "purchasing_irrelevant_private_update_does_not_bump",
      "purchasing_old_new_company_fanout",
      "purchasing_delivery_index",
      "purchasing_line_order_index",
      "purchasing_source_private_acl",
    ]) {
      expect(RUNTIME).toContain(marker);
    }
  });
});

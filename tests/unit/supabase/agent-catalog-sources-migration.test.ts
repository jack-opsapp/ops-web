import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_NAME = "20260829061203_agent_catalog_sources.sql";
const BODY_PATH = join(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/catalog/sql/agent_catalog_sources.body.sql"
);
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  MIGRATION_NAME
);
const RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-catalog-sources-runtime.sql"
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
  (name) => name.endsWith("_agent_catalog_sources.sql")
);

describe("P2 catalogue source SQL", () => {
  it("byte-matches its one generated reservation", () => {
    expect(RESERVED).toEqual([MIGRATION_NAME]);
    expect(BODY).not.toBe("");
    expect(MIGRATION).toBe(BODY);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("task 18 canonical catalogue source body");
    expect(SQL).toContain("do $prerequisites$");
    expect(SQL).toContain("do $postflight$");
  });

  it("pins every projected source and advances only the catalogue domain", () => {
    for (const prerequisite of [
      "private.agent_read_domain_revisions",
      "private.advance_agent_read_domain_revisions(uuid[],text)",
      "public.companies",
      "public.catalog_categories",
      "public.catalog_items",
      "public.catalog_variants",
      "public.catalog_options",
      "public.catalog_option_values",
      "public.catalog_variant_option_values",
      "public.catalog_tags",
      "public.catalog_item_tags",
      "public.catalog_units",
      "public.catalog_stock_units",
      "public.catalog_supplier_cost_profiles",
      "public.products",
      "public.product_materials",
    ]) {
      expect(SQL).toContain(prerequisite);
    }
    expect(COMPACT).toContain(
      "create or replace function private.bump_agent_catalog_source_revision()"
    );
    expect(COMPACT).toContain(
      "private.advance_agent_read_domain_revisions( v_company_ids, 'catalog' )"
    );
    expect(COMPACT).not.toContain("'purchasing'");
  });

  it("covers projected old/new parent fan-out and ignores forbidden-only updates", () => {
    for (const field of [
      "currency_code",
      "default_critical_threshold",
      "default_warning_threshold",
      "description",
      "image_url",
      "price_override",
      "quantity",
      "sku",
      "warning_threshold",
      "critical_threshold",
      "sort_order",
      "option_value_id",
      "tag_id",
      "display",
      "abbreviation",
      "location",
      "lot_code",
      "quantity_value",
      "status",
      "unit_kind",
      "currency_code",
      "is_default",
      "label",
      "unit_cost",
      "linked_catalog_item_id",
      "catalog_item_id",
      "catalog_variant_id",
      "quantity_per_unit",
    ]) {
      expect(SQL).toContain(`'${field}'`);
    }
    expect(SQL).not.toContain("'notes',");
    expect(SQL).not.toContain("'external_id',");
    expect(SQL).not.toContain("'external_source',");
    expect(SQL).not.toContain("'activation_rule',");
    expect(SQL).not.toContain("'source',");
    expect(SQL).not.toContain("'profile_key',");
  });

  it("adds only the EXPLAIN-proven normalized family/tag and current-cost indexes", () => {
    for (const index of [
      "idx_catalog_items_agent_normalized_name_v1",
      "idx_catalog_tags_agent_normalized_name_v1",
      "idx_catalog_supplier_cost_profiles_agent_current_v1",
    ]) {
      expect(COMPACT).toContain(`create index if not exists ${index}`);
    }
    expect(COMPACT.match(/create index if not exists /g)).toHaveLength(3);
    expect(COMPACT).toContain(
      "pg_catalog.regexp_replace( pg_catalog.btrim(name), '[[:space:]]+', ' ', 'g' )"
    );
  });

  it("keeps source helpers dark and includes rollback-only PG17 trigger/index proof", () => {
    expect(COMPACT).not.toContain("grant execute");
    expect(COMPACT).not.toContain("grant select");
    for (const marker of [
      "runtime_requires_postgresql_17",
      "every_projected_source_bumps",
      "irrelevant_updates_do_not_bump",
      "writer_role_dml",
      "old_and_new_company_fanout",
      "normalized_family_index",
      "normalized_tag_index",
      "current_cost_index",
      "private_acl",
    ]) {
      expect(RUNTIME).toContain(marker);
    }
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_catalog_recipe_read_v24.sql";
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith(SUFFIX));

function read(path: string) {
  try {
    return readFileSync(path, "utf8").toLowerCase();
  } catch {
    return "";
  }
}

const MIGRATION = read(
  join(process.cwd(), "supabase/migrations", migrationNames[0] ?? "missing")
);
const BODY = read(
  join(
    process.cwd(),
    "src/lib/agent-control-plane/services/p2/catalog/sql/agent_catalog_reads.body.sql"
  )
);

const BASE_SOURCE_SHA256 =
  "8cd62292b72bb7dab9baa3b4db1eac406127c85ee8e7e0d694ef834589d6019d";
const V23 = "2026-09-10.mcp-exposure.v23";
const V24 = "2026-09-15.mcp-exposure.v24";

describe("catalogue recipe read v2 under exposure V24", () => {
  it("ships exactly one transactional migration ordered after the recipe fix", () => {
    expect(migrationNames).toEqual([
      "20260915223000_agent_catalog_recipe_read_v24.sql",
    ]);
    expect(migrationNames[0]! > "20260915221000").toBe(true);
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
  });

  it("pins the latest production detail definition as its only base", () => {
    expect(MIGRATION).toContain(BASE_SOURCE_SHA256);
    expect(MIGRATION).toContain("agent_catalog_recipe_read_source_drift");
    expect(MIGRATION).toContain("agent_catalog_recipe_read_prerequisite");
    expect(MIGRATION).toContain("agent_p2_catalog_detail_v1");
    expect(MIGRATION).toContain("read_agent_catalog_item_as_system");
  });

  it("adds the shape argument and its pinned bounds to both mirrors", () => {
    for (const sql of [MIGRATION, BODY]) {
      expect(sql).toContain("p_recipe_shape text");
      expect(sql).toContain("p_recipe_shape not in ('v1', 'v2')");
      expect(sql).toContain("p_recipe_selector_key_limit is distinct from 32");
      expect(sql).toContain("p_recipe_product_limit is distinct from 64");
      expect(sql).toContain(
        "p_recipe_product_fetch_limit is distinct from 65"
      );
      expect(sql).toContain("p_recipe_option_limit is distinct from 128");
      expect(sql).toContain("p_recipe_option_fetch_limit is distinct from 129");
      expect(sql).toContain("p_recipe_option_value_limit is distinct from 512");
      expect(sql).toContain(
        "p_recipe_option_value_fetch_limit is distinct from 513"
      );
      expect(sql).toContain("invalid_agent_catalog_detail_request");
    }
  });

  it("projects selector, scaling and recipe products only in shape v2", () => {
    for (const sql of [MIGRATION, BODY]) {
      expect(sql).toContain("'variant_selector'");
      expect(sql).toContain("'quantity_per_unit'");
      expect(sql).toContain("'quantity_basis'");
      expect(sql).toContain("'per_product_unit'");
      expect(sql).toContain("'per_option_count'");
      expect(sql).toContain("'scaled_by'");
      expect(sql).toContain("'product_material'");
      expect(sql).toContain("'product_option'");
      expect(sql).toContain("'product_option_value'");
      expect(sql).toContain("'recipe_products'");
      expect(sql).toContain("agent_p2_catalog_float8_decimal4_v1");
      expect(sql).toContain("scaled_by_option_id");
      expect(sql).toContain("public.product_options");
      expect(sql).toContain("public.product_option_values");
      // The v1 shape keeps the exact pre-change object and ordering.
      expect(sql).toContain("case when p_recipe_shape = 'v2'");
      expect(sql).toContain("agent_catalog_result_bound");
      expect(sql).toContain("agent_catalog_source_data_invalid");
    }
  });

  it("keeps every v23 acceptance and adds v24 beside it", () => {
    expect(MIGRATION).toContain(V24);
    expect(MIGRATION).toContain(V23);
    for (const signature of [
      "public.resolve_mcp_oauth_access_token_as_system",
      "private.assert_agent_customer_update_authority",
      "public.consume_agent_customer_update_prepare_rate_limit_as_system",
      "public.prepare_agent_customer_update_for_grant_as_system",
    ]) {
      expect(MIGRATION).toContain(signature.toLowerCase());
    }
    expect(MIGRATION).toContain("agent_catalog_recipe_read_anchor_drift");
    // Exposure acceptance never rewrites a consent catalogue or a scope ceiling.
    expect(MIGRATION).not.toContain("mcp-consent-catalog.v18");
    expect(MIGRATION).not.toContain("insert into private.mcp_oauth_clients");
    expect(MIGRATION).not.toContain("insert into private.mcp_oauth_grants");
  });

  it("re-applies the exact service-role grants and seeds no effect policy", () => {
    expect(MIGRATION).toContain("revoke all on function");
    expect(MIGRATION).toContain("grant execute on function");
    expect(MIGRATION).toContain("to service_role");
    expect(MIGRATION).not.toContain("agent_catalog_effect_policy");
    expect(MIGRATION).not.toContain("agent_catalog_setup_write");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260812150000_catalog_bulk_variant_expansion.sql"
);
const sql = readFileSync(migrationPath, "utf8").toLowerCase();
const compact = sql.replace(/\s+/g, " ");

describe("catalog bulk variant expansion migration", () => {
  it("uses the Firebase bridge, granular permission, invoker security, and app-role grants", () => {
    expect(compact).toContain("security invoker");
    expect(compact).toContain("private.get_user_company_id()");
    expect(compact).toContain(
      "private.current_user_has_permission('catalog.manage', 'all')"
    );
    expect(compact).toContain(
      "grant execute on function public.catalog_bulk_expand_variants(uuid, text, jsonb) to anon, authenticated"
    );
    expect(compact).not.toMatch(/\b(role|employee_type)\b\s*(=|in)/);
  });

  it("creates a company-scoped receipt that replays identical input and rejects changed input", () => {
    expect(compact).toContain(
      "create table if not exists public.catalog_bulk_variant_requests"
    );
    expect(compact).toContain("unique (company_id, idempotency_key)");
    expect(compact).toContain("v_existing_request is distinct from p_payload");
    expect(compact).toContain("'idempotency_conflict'");
    expect(compact).toContain(
      "jsonb_set(v_existing_response, '{replayed}', 'true'::jsonb, true)"
    );
  });

  it("locks deterministically and validates all families before the first mutation", () => {
    const advisory = compact.indexOf("pg_advisory_xact_lock");
    const itemLock = compact.indexOf("order by ci.id for update");
    const variantLock = compact.indexOf("order by cv.id for update");
    const preflight = compact.indexOf(
      "complete preflight for every family before the first write"
    );
    const mutation = compact.indexOf("mutation phase");
    expect(advisory).toBeGreaterThan(-1);
    expect(itemLock).toBeGreaterThan(advisory);
    expect(variantLock).toBeGreaterThan(itemLock);
    expect(preflight).toBeGreaterThan(variantLock);
    expect(mutation).toBeGreaterThan(preflight);
  });

  it("rejects stale and ambiguous source state and normalizes axis/value uniqueness", () => {
    expect(compact).toContain(
      "v_current_source is distinct from v_expected_source"
    );
    expect(compact).toContain("'stale_catalog'");
    expect(compact).toContain("'duplicate_option_axis'");
    expect(compact).toContain("'duplicate_option_value'");
    expect(compact).toContain("'unsafe_variant_options'");
    expect(compact).toContain("'duplicate_variant_signature'");
    expect(compact).toContain("'source_variants_missing'");
    expect(compact).toContain(
      "regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')"
    );
    expect(compact).toContain(
      "regexp_replace(btrim(value), '[[:space:]]+', ' ', 'g')"
    );
  });

  it("preserves existing variant identities and copies only safe settings to zero-stock blank-SKU clones", () => {
    expect(compact).not.toMatch(/update public\.catalog_variants[\s\S]*set/);
    expect(compact).toContain(
      "insert into public.catalog_variants ( company_id, catalog_item_id, sku, quantity, price_override, unit_cost_override, warning_threshold, critical_threshold, unit_id, is_active )"
    );
    expect(compact).toContain(
      "p_company_id, v_family_id, null, 0, v_source.price_override, v_source.unit_cost_override, v_source.warning_threshold, v_source.critical_threshold, v_source.unit_id, v_source.is_active"
    );
    expect(compact).not.toContain("insert into public.catalog_stock_units");
    expect(compact).not.toContain("insert into public.inventory_deductions");
    expect(compact).not.toContain("insert into public.catalog_snapshot_items");
    expect(compact).not.toContain("insert into public.catalog_order_items");
  });
});

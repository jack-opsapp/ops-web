import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260607175500_qbo_mapping_link_index_hardening.sql"),
  "utf8"
);

describe("qbo mapping/link index hardening migration", () => {
  it("adds direct FK-covering indexes for QBO mapping and link tables", () => {
    expect(sql).toContain("idx_qbo_import_runs_connection_id");
    expect(sql).toContain("on public.qbo_import_runs (connection_id)");
    expect(sql).toContain("idx_qbo_item_product_mappings_connection_id");
    expect(sql).toContain("on public.qbo_item_product_mappings (connection_id)");
    expect(sql).toContain("idx_qbo_estimate_opportunity_links_connection_id");
    expect(sql).toContain("on public.qbo_estimate_opportunity_links (connection_id)");
    expect(sql).toContain("idx_qbo_estimate_opportunity_links_estimate_id");
    expect(sql).toContain("on public.qbo_estimate_opportunity_links (estimate_id)");
  });

  it("keeps the indexes scoped to live rows where appropriate", () => {
    expect(sql).toContain("where connection_id is not null");
    expect(sql).toContain("and deleted_at is null");
    expect(sql).toContain("where deleted_at is null");
    expect(sql).toContain("where estimate_id is not null");
  });

  it("has sentinel checks for every expected index", () => {
    expect(sql).toContain("qbo_mapping_link_index_hardening_sentinel");
    expect(sql).toContain("import run connection index missing");
    expect(sql).toContain("mapping connection index missing");
    expect(sql).toContain("link connection index missing");
    expect(sql).toContain("link estimate index missing");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260607174000_qbo_item_product_mapping.sql"),
  "utf8"
);
const aclSql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260607174500_qbo_item_product_mapping_acl_hardening.sql"),
  "utf8"
);

describe("qbo item product mapping migration", () => {
  it("creates a durable company-scoped QBO Item to OPS product mapping table", () => {
    expect(sql).toContain("create table if not exists public.qbo_item_product_mappings");
    expect(sql).toContain("company_id uuid not null");
    expect(sql).toContain("connection_id uuid");
    expect(sql).toContain("qb_item_id text not null");
    expect(sql).toContain("product_id uuid not null");
    expect(sql).toContain("references public.products(id)");
    expect(sql).toContain("unique");
    expect(sql).toContain("where deleted_at is null");
  });

  it("adds ItemRef identity to staged QBO line items", () => {
    expect(sql).toContain("alter table public.qbo_staging_line_items");
    expect(sql).toContain("add column if not exists qb_item_id text");
    expect(sql).toContain("add column if not exists qb_item_name text");
  });

  it("protects mapping rows behind RLS and service-role writes", () => {
    expect(sql).toContain("alter table public.qbo_item_product_mappings enable row level security");
    expect(sql).toContain("revoke all on table public.qbo_item_product_mappings from anon, authenticated");
    expect(sql).toContain("grant select on table public.qbo_item_product_mappings to authenticated");
    expect(sql).toContain("grant all on table public.qbo_item_product_mappings to service_role");
    expect(sql).toContain("private.get_user_company_id()");
    expect(aclSql).toContain("qbo_item_product_mapping_acl_sentinel");
    expect(aclSql).toContain("privilege_type <> 'SELECT'");
  });
});

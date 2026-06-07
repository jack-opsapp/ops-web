import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260607175000_qbo_estimate_opportunity_link.sql"),
  "utf8"
);

describe("qbo estimate opportunity link migration", () => {
  it("creates a durable QBO estimate to opportunity link table", () => {
    expect(sql).toContain("create table if not exists public.qbo_estimate_opportunity_links");
    expect(sql).toContain("company_id uuid not null");
    expect(sql).toContain("connection_id uuid not null");
    expect(sql).toContain("qb_estimate_id text not null");
    expect(sql).toContain("opportunity_id uuid not null");
    expect(sql).toContain("qbo_estimate_opportunity_links_active_key");
    expect(sql).toContain("where deleted_at is null");
  });

  it("adds a service-role-only idempotent opportunity resolver", () => {
    expect(sql).toContain("create or replace function public.ensure_qbo_estimate_opportunity");
    expect(sql).toContain("service_role required");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("'quoted'");
    expect(sql).toContain("'quickbooks'");
    expect(sql).toContain("jsonb_build_object");
    expect(sql).toContain("grant execute on function public.ensure_qbo_estimate_opportunity");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("from public, anon, authenticated");
  });

  it("keeps user access read-only under RLS", () => {
    expect(sql).toContain("alter table public.qbo_estimate_opportunity_links enable row level security");
    expect(sql).toContain("revoke all on table public.qbo_estimate_opportunity_links from anon, authenticated");
    expect(sql).toContain("grant select on table public.qbo_estimate_opportunity_links to authenticated");
    expect(sql).toContain("privilege_type <> 'SELECT'");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260605090000_qbo_p2_sync_queue.sql"),
  "utf8"
);

describe("QBO P2 sync queue migration", () => {
  it("is transaction-wrapped and sentinel-guarded", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(sql).toContain("qbo_p2_sync_queue_sentinel");
    expect(sql).toContain("raise exception");
  });

  it("creates queue and event tables with uuid company ids", () => {
    expect(sql).toContain("create table if not exists public.accounting_sync_queue");
    expect(sql).toContain("create table if not exists public.accounting_sync_events");
    expect(sql).toContain("company_id uuid not null");
    expect(sql).toContain("connection_id uuid");
  });

  it("constrains queue values and active coalescing", () => {
    expect(sql).toContain("check (entity_type in ('customer', 'invoice', 'estimate', 'payment'))");
    expect(sql).toContain("check (operation in ('create', 'update', 'void', 'inactivate', 'delete_soft', 'link', 'reconcile'))");
    expect(sql).toContain("check (status in ('pending', 'claimed', 'succeeded', 'failed', 'blocked', 'needs_review', 'cancelled'))");
    expect(sql).toContain("accounting_sync_queue_active_uniq");
    expect(sql).toContain("where status in ('pending', 'claimed')");
  });

  it("adds a due index for pending rows", () => {
    expect(sql).toContain("accounting_sync_queue_due_idx");
    expect(sql).toContain("where status = 'pending'");
  });

  it("adds a service-role claim RPC using skip locked", () => {
    expect(sql).toContain("create or replace function public.claim_accounting_sync_queue");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("revoke all on function public.claim_accounting_sync_queue(text, integer, text) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.claim_accounting_sync_queue(text, integer, text) to service_role");
  });

  it("uses a transaction-local QuickBooks source marker to prevent echo loops", () => {
    expect(sql).toContain("current_setting('ops.sync_source', true)");
    expect(sql).toContain("= 'quickbooks'");
  });

  it("installs triggers for every OPS write surface", () => {
    for (const table of ["clients", "sub_clients", "invoices", "estimates", "payments", "line_items"]) {
      expect(sql).toContain(`trg_accounting_sync_queue_${table}`);
      expect(sql).toContain(`on public.${table}`);
    }
  });

  it("handles line items through parent invoices or estimates", () => {
    expect(sql).toContain("when 'line_items' then case");
    expect(sql).toContain("when v_row.invoice_id is not null then 'invoice'");
    expect(sql).toContain("when v_row.estimate_id is not null then 'estimate'");
    const parentLookup = sql.slice(
      sql.indexOf("if tg_table_name = 'line_items'"),
      sql.indexOf("else\n    v_external_id := nullif(to_jsonb(v_row)->>'qb_id'")
    );
    expect(parentLookup).toContain("from public.invoices");
    expect(parentLookup).toContain("from public.estimates");
    expect(parentLookup).not.toContain("to_jsonb(v_row)->>'qb_id'");
  });

  it("uses json snapshots for table-specific columns", () => {
    expect(sql).toContain("to_jsonb(new)->>'deleted_at'");
    expect(sql).toContain("to_jsonb(new)->>'voided_at'");
    expect(sql).toContain("to_jsonb(v_row)->>'updated_at'");
    expect(sql).toContain("to_jsonb(v_row)->>'qb_id'");
  });

  it("casts connection company id text while queue company id remains uuid", () => {
    expect(sql).toContain("where company_id = v_company_id::text");
    expect(sql).toContain("v_company_id uuid");
  });

  it("keeps queue and event writes server-side", () => {
    expect(sql).toContain("alter table public.accounting_sync_queue enable row level security");
    expect(sql).toContain("alter table public.accounting_sync_events enable row level security");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/for insert\s+to authenticated/i);
    expect(sql).not.toMatch(/for update\s+to authenticated/i);
  });
});

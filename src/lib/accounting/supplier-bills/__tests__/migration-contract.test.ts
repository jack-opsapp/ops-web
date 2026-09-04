import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260903210504_supplier_bills_ap_vertical.sql"
  ),
  "utf8"
).toLowerCase();
const COMPACT = SQL.replace(/\s+/g, " ").trim();
const ACL_REPAIR = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260903211009_supplier_bill_immutable_acl_repair.sql"
  ),
  "utf8"
).toLowerCase();

function functionDefinition(name: string): string {
  const marker = `create or replace function ${name}(`;
  const start = SQL.lastIndexOf(marker);
  if (start < 0) return "";
  const remainder = SQL.slice(start);
  const delimiter = /\bas\s+(\$[a-z0-9_]*\$)/.exec(remainder)?.[1];
  if (!delimiter) return "";
  const end = remainder.indexOf(`${delimiter};`);
  return end < 0 ? "" : remainder.slice(0, end + delimiter.length + 1);
}

describe("supplier bills AP migration contract", () => {
  it("is additive, transactional, and creates the complete canonical model", () => {
    expect(SQL).toMatch(/^--[\s\S]*?\nbegin;/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    for (const table of [
      "suppliers",
      "supplier_bills",
      "supplier_bill_line_items",
      "supplier_bill_project_allocations",
      "supplier_bill_payments",
      "supplier_bill_documents",
      "supplier_bill_provider_links",
      "supplier_bill_tax_mappings",
      "supplier_bill_payment_account_mappings",
      "supplier_bill_project_mappings",
      "supplier_bill_events",
    ]) {
      expect(COMPACT).toContain(`create table if not exists public.${table}`);
    }
    expect(COMPACT).toContain(
      "execute format('alter table public.%i enable row level security', v_table)"
    );
    expect(COMPACT).toContain(
      "create table if not exists private.supplier_bill_write_intents"
    );
  });

  it("prevents duplicate supplier invoices and duplicate source documents", () => {
    expect(COMPACT).toContain(
      "create unique index if not exists supplier_bills_company_supplier_invoice_uniq"
    );
    expect(COMPACT).toContain(
      "create unique index if not exists supplier_bill_documents_company_sha256_uniq"
    );
    expect(COMPACT).toContain("unique (company_id, idempotency_key)");
  });

  it("covers every supplier-bill foreign key used for joins and parent changes", () => {
    for (const index of [
      "supplier_bill_documents_bill_company_idx on public.supplier_bill_documents (bill_id, company_id)",
      "supplier_bill_documents_created_by_idx on public.supplier_bill_documents (created_by)",
      "supplier_bill_events_actor_idx on public.supplier_bill_events (actor_user_id)",
      "supplier_bill_events_company_idx on public.supplier_bill_events (company_id)",
      "supplier_bill_lines_bill_company_idx on public.supplier_bill_line_items (bill_id, company_id)",
      "supplier_bill_lines_category_idx on public.supplier_bill_line_items (category_id)",
      "supplier_bill_lines_company_idx on public.supplier_bill_line_items (company_id)",
      "supplier_bill_payment_accounts_company_idx on public.supplier_bill_payment_account_mappings (company_id)",
      "supplier_bill_payments_bill_company_idx on public.supplier_bill_payments (bill_id, company_id)",
      "supplier_bill_payments_company_idx on public.supplier_bill_payments (company_id)",
      "supplier_bill_payments_recorded_by_idx on public.supplier_bill_payments (recorded_by)",
      "supplier_bill_payments_voided_by_idx on public.supplier_bill_payments (voided_by)",
      "supplier_bill_allocations_line_bill_company_idx on public.supplier_bill_project_allocations (line_item_id, bill_id, company_id)",
      "supplier_bill_allocations_project_only_idx on public.supplier_bill_project_allocations (project_id)",
      "supplier_bill_project_mappings_company_idx on public.supplier_bill_project_mappings (company_id)",
      "supplier_bill_project_mappings_project_idx on public.supplier_bill_project_mappings (project_id)",
      "supplier_bill_provider_links_company_idx on public.supplier_bill_provider_links (company_id)",
      "supplier_bill_tax_mappings_company_idx on public.supplier_bill_tax_mappings (company_id)",
      "supplier_bills_category_idx on public.supplier_bills (category_id)",
      "supplier_bills_confirmed_by_idx on public.supplier_bills (confirmed_by)",
      "supplier_bills_created_by_idx on public.supplier_bills (created_by)",
      "supplier_bills_supplier_company_idx on public.supplier_bills (supplier_id, company_id)",
      "supplier_bills_voided_by_idx on public.supplier_bills (voided_by)",
      "suppliers_created_by_idx on public.suppliers (created_by)",
    ]) {
      expect(COMPACT).toContain(`create index if not exists ${index}`);
    }
  });

  it("keeps writes service-only while granting company-scoped authenticated reads", () => {
    expect(COMPACT).toContain(
      "revoke all on table private.supplier_bill_write_intents from public, anon, authenticated"
    );
    expect(COMPACT).toContain(
      "grant select on public.supplier_bills to anon, authenticated"
    );
    expect(COMPACT).toContain(
      "grant select, insert, update, delete on public.supplier_bills to service_role"
    );
    expect(COMPACT).toContain(
      "revoke all on table public.%i from service_role', v_table"
    );
    const readScope = functionDefinition(
      "private.can_read_supplier_bill_company"
    );
    expect(readScope).toContain("private.get_user_company_id()");
    expect(readScope).toContain("private.get_current_user_id()");
    expect(readScope).toContain("public.has_permission");
    expect(readScope).toContain("'accounting.view'");
  });

  it("repairs default service-role grants on immutable custody and audit records", () => {
    for (const table of ["supplier_bill_documents", "supplier_bill_events"]) {
      expect(ACL_REPAIR).toContain(
        `revoke all on table public.${table} from service_role`
      );
      expect(ACL_REPAIR).toContain(
        `grant select, insert on table public.${table} to service_role`
      );
    }
  });

  it("rechecks actor authority at prepare and commit and requires exact confirmation", () => {
    const prepare = functionDefinition("public.prepare_supplier_bill_write");
    const commit = functionDefinition("public.commit_supplier_bill_write");
    const actorScope = functionDefinition(
      "private.supplier_bill_actor_company"
    );
    expect(actorScope).toContain("from public.users");
    expect(actorScope).toContain("is_active = true");
    expect(actorScope).toContain("deleted_at is null");
    expect(actorScope).toContain("public.has_permission");
    expect(actorScope).toContain("'expenses.approve'");
    expect(actorScope).toContain("'accounting.view'");
    for (const body of [prepare, commit]) {
      expect(body).toContain("private.supplier_bill_actor_company");
    }
    expect(commit).toContain("p_confirmation_text is distinct from");
    expect(commit).toContain("for update");
    expect(commit).toContain("expires_at");
  });

  it("locks settlement, derives lifecycle, forbids overpayment, and emits fresh receipts", () => {
    const commit = functionDefinition("public.commit_supplier_bill_write");
    expect(commit).toContain("supplier_bill_payments");
    expect(commit).toContain("supplier_bill_project_allocations");
    expect(commit).toContain("supplier_bill_events");
    expect(commit).toContain("private.enqueue_supplier_bill_accounting");
    expect(
      functionDefinition("private.enqueue_supplier_bill_accounting")
    ).toContain("accounting_sync_queue");
    expect(commit).toContain("cannot exceed the open balance");
    expect(commit).toContain("when v_new_balance = 0 then 'paid'");
    expect(commit).toContain(
      "when v_new_balance < v_bill.total then 'partial'"
    );
    expect(commit).toContain("private.supplier_bill_live_receipt");
  });

  it("extends the existing queue without changing its prior sales values", () => {
    expect(COMPACT).toContain("provider in ('quickbooks', 'sage')");
    for (const entity of [
      "'customer'",
      "'invoice'",
      "'estimate'",
      "'payment'",
      "'supplier'",
      "'supplier_bill'",
      "'supplier_bill_payment'",
    ]) {
      expect(COMPACT).toContain(entity);
    }
    expect(COMPACT).toContain("'ops_to_sage'");
  });

  it("exposes only the narrow service-role functions for later server consumers", () => {
    for (const signature of [
      "public.prepare_supplier_bill_write(uuid, jsonb)",
      "public.commit_supplier_bill_write(uuid, uuid, text)",
      "public.finalize_paid_supplier_purchase(uuid, uuid, jsonb)",
      "public.finalize_supplier_bill_provider_sync(uuid, text, text, text, timestamptz)",
    ]) {
      expect(COMPACT).toContain(
        `revoke all on function ${signature} from public, anon, authenticated, service_role`
      );
      expect(COMPACT).toContain(
        `grant execute on function ${signature} to service_role`
      );
    }
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION =
  "supabase/migrations/20260904040358_supplier_bill_intake_clearance.sql";
const SQL = readFileSync(join(process.cwd(), MIGRATION), "utf8").toLowerCase();
const COMPACT = SQL.replace(/\s+/g, " ").trim();
const PERMISSIONS = readFileSync(
  join(process.cwd(), "src/lib/types/permissions.ts"),
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

describe("supplier bill intake migration contract", () => {
  it("is additive and creates the normalized durable intake model", () => {
    expect(SQL).toMatch(/^--[\s\S]*?\nbegin;/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    for (const table of [
      "supplier_bill_intakes",
      "supplier_bill_intake_line_items",
      "supplier_bill_intake_allocations",
      "supplier_bill_intake_checks",
      "supplier_bill_intake_documents",
      "supplier_bill_intake_events",
    ]) {
      expect(COMPACT).toContain(`create table if not exists public.${table}`);
      expect(COMPACT).toContain(`alter table public.${table} enable row level security`);
    }
    expect(COMPACT).toContain(
      "create table if not exists private.supplier_bill_intake_write_intents"
    );
  });

  it("registers separate capture, approve, and pay authority", () => {
    for (const permission of [
      "accounting.bills.capture",
      "accounting.bills.approve",
      "accounting.bills.pay",
    ]) {
      expect(PERMISSIONS).toContain(`id: "${permission}"`);
      expect(COMPACT).toContain(`'${permission}'`);
    }
    const actorScope = functionDefinition(
      "private.supplier_bill_intake_actor_company"
    );
    expect(actorScope).toContain("public.has_permission");
    expect(actorScope).toContain("p_required_permission");
    expect(actorScope).toContain("from public.users");
  });

  it("keeps authenticated clients read-only and company-scoped", () => {
    for (const table of [
      "supplier_bill_intakes",
      "supplier_bill_intake_line_items",
      "supplier_bill_intake_allocations",
      "supplier_bill_intake_checks",
      "supplier_bill_intake_documents",
      "supplier_bill_intake_events",
    ]) {
      expect(COMPACT).toContain(`grant select on public.${table} to anon, authenticated`);
      expect(COMPACT).toContain(
        `create policy ${table}_company_read on public.${table}`
      );
    }
    expect(COMPACT).toContain("private.can_read_supplier_bill_company(company_id)");
    expect(COMPACT).toContain(
      "revoke all on table private.supplier_bill_intake_write_intents from public, anon, authenticated"
    );
  });

  it("makes source documents and audit events immutable", () => {
    for (const table of [
      "supplier_bill_intake_documents",
      "supplier_bill_intake_events",
    ]) {
      expect(COMPACT).toContain(`revoke all on table public.${table} from service_role`);
      expect(COMPACT).toContain(
        `grant select, insert on table public.${table} to service_role`
      );
    }
  });

  it("indexes duplicate invoice candidates and rejects a repeated source document", () => {
    expect(COMPACT).toContain(
      "create index if not exists supplier_bill_intakes_duplicate_candidate_idx"
    );
    expect(COMPACT).toContain(
      "create unique index if not exists supplier_bill_intake_documents_company_sha256_uniq"
    );
    expect(COMPACT).toContain("unique (company_id, idempotency_key)");
  });

  it("stores the Canpro clearance facts without inventing a due date", () => {
    for (const field of [
      "document_kind",
      "review_stage",
      "purchase_order",
      "shipping_reference",
      "ordered_quantity",
      "invoiced_quantity",
      "unit_of_measure",
      "job_hint",
      "match_basis",
      "match_status",
      "payment_owner_id",
      "planned_payment_date",
      "hold_reason",
      "next_action",
    ]) {
      expect(COMPACT).toContain(field);
    }
    expect(COMPACT).toContain(
      "check (due_date is null or due_date >= invoice_date)"
    );
  });

  it("uses exact-confirmation prepare and commit with action-specific rechecks", () => {
    const prepare = functionDefinition(
      "public.prepare_supplier_bill_intake_write"
    );
    const commit = functionDefinition("public.commit_supplier_bill_intake_write");
    for (const body of [prepare, commit]) {
      expect(body).toContain("private.supplier_bill_intake_actor_company");
    }
    expect(prepare).toContain("idempotency_key");
    expect(prepare).toContain("command_hash");
    expect(commit).toContain("p_confirmation_text is distinct from");
    expect(commit).toContain("for update");
    expect(commit).toContain("expires_at");
    expect(commit).toContain("v_intent.expected_revision");
  });

  it("blocks approval until every required check and allocation is cleared", () => {
    const commit = functionDefinition("public.commit_supplier_bill_intake_write");
    expect(commit).toContain("rate_compliance");
    expect(commit).toContain("duplicate_billing");
    expect(commit).toContain("quantity_scope");
    expect(commit).toContain("order_specification");
    expect(commit).toContain("receipt");
    expect(commit).toContain("unresolved clearance checks");
    expect(commit).toContain("payment owner and target date are required");
    expect(commit).toContain("allocation total does not equal line total");
  });

  it("promotes approval once and creates provider work only at that boundary", () => {
    const commit = functionDefinition("public.commit_supplier_bill_intake_write");
    expect(commit).toContain("insert into public.supplier_bills");
    expect(commit).toContain("insert into public.supplier_bill_line_items");
    expect(commit).toContain("insert into public.supplier_bill_project_allocations");
    expect(commit).toContain("private.enqueue_supplier_bill_accounting");
    expect(commit).toContain("promoted_bill_id");
    expect(commit).toContain("supplier bill intake was already promoted");
  });

  it("routes employee documents to payroll and held documents outside AP", () => {
    const commit = functionDefinition("public.commit_supplier_bill_intake_write");
    expect(commit).toContain("document_kind = 'employee'");
    expect(commit).toContain("review_stage = 'payroll'");
    expect(commit).toContain("review_stage = 'held'");
    expect(commit).toContain("hold reason and next action are required");
  });

  it("requires pay authority separately and emits immutable fresh receipts", () => {
    const commit = functionDefinition("public.commit_supplier_bill_intake_write");
    expect(commit).toContain("'accounting.bills.pay'");
    expect(commit).toContain("supplier_bill_payments");
    expect(commit).toContain("supplier_bill_intake_events");
    expect(commit).toContain("private.supplier_bill_intake_live_receipt");
  });

  it("exposes only the two narrow server functions", () => {
    for (const signature of [
      "public.prepare_supplier_bill_intake_write(uuid, jsonb)",
      "public.commit_supplier_bill_intake_write(uuid, uuid, text)",
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

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_NAME = "20260829024746_agent_sales_document_sources.sql";
const BODY_PATH = join(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/sales/sql/agent_sales_document_sources.body.sql"
);
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  MIGRATION_NAME
);
const RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-sales-document-sources-runtime.sql"
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
  (name) => name.endsWith("_agent_sales_document_sources.sql")
);

describe("P2 sales-document source SQL", () => {
  it("byte-matches its single generated reservation", () => {
    expect(RESERVED).toEqual([MIGRATION_NAME]);
    expect(BODY).not.toBe("");
    expect(MIGRATION).toBe(BODY);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("task 14 canonical sales-document source body");
    expect(SQL).toContain("do $prerequisites$");
    expect(SQL).toContain("do $postflight$");
  });

  it("pins the actual estimate, invoice, child, company-currency, and revision graph", () => {
    for (const prerequisite of [
      "private.agent_read_domain_revisions",
      "private.advance_agent_read_domain_revisions(uuid[],text)",
      "public.estimates",
      "public.invoices",
      "public.line_items",
      "public.payment_milestones",
      "public.companies",
    ]) {
      expect(SQL).toContain(prerequisite);
    }
    expect(COMPACT).toContain(
      "alter table public.payment_milestones add column if not exists expected_date date"
    );
    expect(COMPACT).toContain(
      "create or replace function private.bump_agent_sales_document_source_revision()"
    );
    for (const table of [
      "estimates",
      "invoices",
      "line_items",
      "payment_milestones",
      "companies",
    ]) {
      expect(COMPACT).toContain(
        `create trigger ${table}_bump_agent_sales_document_revision after insert or update or delete on public.${table}`
      );
    }
    for (const field of [
      "currency_code",
      "project_ref",
      "opportunity_id",
      "client_ref",
      "estimate_number",
      "invoice_number",
      "expiration_date",
      "due_date",
      "amount_paid",
      "balance_due",
      "quantity",
      "unit_price",
      "discount_percent",
      "expected_date",
      "paid_at",
    ]) {
      expect(SQL).toContain(`'${field}'`);
    }
  });

  it("adds only the exact list and ordered child indexes", () => {
    for (const index of [
      "idx_estimates_agent_sales_history_v1",
      "idx_invoices_agent_sales_history_v1",
      "idx_line_items_agent_estimate_order_v1",
      "idx_line_items_agent_invoice_order_v1",
      "idx_payment_milestones_agent_estimate_order_v1",
    ]) {
      expect(COMPACT).toContain(`create index if not exists ${index}`);
    }
    expect(COMPACT.match(/create index if not exists /g)).toHaveLength(5);
  });

  it("keeps application ACL dark and includes fresh-PG runtime trigger coverage", () => {
    expect(COMPACT).not.toContain("grant execute");
    expect(COMPACT).not.toContain("grant select");
    expect(COMPACT).not.toContain("grant all");
    expect(COMPACT).not.toContain("capability_manifest");
    for (const marker of [
      "insert into public.estimates",
      "insert into public.invoices",
      "insert into public.line_items",
      "insert into public.payment_milestones",
      "update public.companies",
      "irrelevant_update_did_not_bump",
      "old_and_new_company_fanout",
    ]) {
      expect(RUNTIME).toContain(marker);
    }
  });
});

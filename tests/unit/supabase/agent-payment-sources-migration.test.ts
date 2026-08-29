import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_NAME = "20260829081500_agent_payment_sources.sql";
const BODY_PATH = join(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/payments/sql/agent_payment_sources.body.sql"
);
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  MIGRATION_NAME
);
const RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-payment-reads-runtime.sql"
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
  (name) => name.endsWith("_agent_payment_sources.sql")
);

describe("P2 payment source SQL", () => {
  it("byte-matches its one generated reservation", () => {
    expect(RESERVED).toEqual([MIGRATION_NAME]);
    expect(BODY).not.toBe("");
    expect(MIGRATION).toBe(BODY);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("task 15 canonical payment source body");
    expect(SQL).toContain("do $prerequisites$");
    expect(SQL).toContain("do $postflight$");
  });

  it("pins only the projected payment fields and exact payment domain", () => {
    for (const prerequisite of [
      "private.agent_read_domain_revisions",
      "private.advance_agent_read_domain_revisions(uuid[],text)",
      "public.payments",
    ]) {
      expect(SQL).toContain(prerequisite);
    }
    expect(COMPACT).toContain(
      "create or replace function private.bump_agent_payment_source_revision()"
    );
    expect(COMPACT).toContain(
      "create trigger payments_bump_agent_payment_revision after insert or update or delete on public.payments"
    );
    for (const field of [
      "company_id",
      "invoice_id",
      "client_id",
      "amount",
      "payment_method",
      "payment_date",
      "voided_at",
    ]) {
      expect(SQL).toContain(`'${field}'`);
    }
    for (const privateField of [
      "reference_number",
      "notes",
      "stripe_payment_intent",
      "created_by",
      "voided_by",
      "qb_id",
      "sage_id",
    ]) {
      expect(SQL).not.toContain(`'${privateField}'`);
    }
  });

  it("adds only the EXPLAIN-proven payment date/ID keyset", () => {
    expect(COMPACT).toContain(
      "create index if not exists idx_payments_agent_history_v1 on public.payments (company_id, payment_date desc, id)"
    );
    expect(COMPACT.match(/create index if not exists /g)).toHaveLength(1);
  });

  it("keeps application ACL dark and pins relevant/private revision runtime proof", () => {
    expect(COMPACT).not.toContain("grant execute");
    expect(COMPACT).not.toContain("grant select");
    for (const marker of [
      "payment_relevant_update_bumps",
      "payment_private_update_does_not_bump",
      "payment_old_and_new_company_fanout",
      "payment_keyset_index_plan",
    ]) {
      expect(RUNTIME).toContain(marker);
    }
  });
});

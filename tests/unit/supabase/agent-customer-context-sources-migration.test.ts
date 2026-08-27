import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_customer_context_sources.sql";
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith(SUFFIX));
const SQL = (() => {
  try {
    return readFileSync(
      join(
        process.cwd(),
        "supabase/migrations",
        migrationNames[0] ?? "MISSING"
      ),
      "utf8"
    ).toLowerCase();
  } catch {
    return "";
  }
})();
const COMPACT = SQL.replace(/\s+/g, " ").trim();

describe("P2 customer-context source fence migration", () => {
  it("uses one generated guarded migration and only checked-in prerequisites", () => {
    expect(migrationNames).toHaveLength(1);
    expect(migrationNames[0]).toMatch(
      /^\d{14}_agent_customer_context_sources\.sql$/
    );
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("do $prerequisites$");
    for (const prerequisite of [
      "private.agent_read_domain_revisions",
      "private.bump_agent_read_domain_revision()",
      "public.clients",
      "public.sub_clients",
      "public.duplicate_reviews",
    ]) {
      expect(SQL).toContain(prerequisite);
    }
  });

  it("attaches the closed customer fence to every mutable customer-context source", () => {
    for (const table of ["clients", "sub_clients", "duplicate_reviews"]) {
      expect(COMPACT).toContain(
        `create trigger ${table}_bump_agent_customer_context_revision after insert or update or delete on public.${table} for each row execute function private.bump_agent_read_domain_revision('customer', 'company_id')`
      );
    }
    expect(
      COMPACT.match(/bump_agent_read_domain_revision\('customer'/g)
    ).toHaveLength(3);
  });

  it("reuses proven customer/job indexes and does not smuggle a speculative duplicate index", () => {
    expect(COMPACT).not.toContain("create index");
    expect(COMPACT).not.toContain("create unique index");
    expect(COMPACT).not.toContain("drop index");
    expect(COMPACT).not.toContain("alter table");
    expect(COMPACT).not.toContain("create or replace function public.");
  });

  it("does not widen private source-revision execution or table access", () => {
    expect(COMPACT).not.toContain("grant execute");
    expect(COMPACT).not.toContain("grant select");
    expect(COMPACT).not.toContain("grant all");
  });
});

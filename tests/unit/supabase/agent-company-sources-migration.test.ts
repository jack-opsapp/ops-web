import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_company_sources.sql";
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith(SUFFIX));
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations", migrationNames[0] ?? "MISSING"),
  "utf8"
);
const BODY = readFileSync(
  join(
    process.cwd(),
    "src/lib/agent-control-plane/services/p2/company/sql/agent_company_sources.body.sql"
  ),
  "utf8"
);
const SQL = MIGRATION.toLowerCase();
const COMPACT = SQL.replace(/\s+/g, " ").trim();

describe("P2 company source fence migration", () => {
  it("uses one generated, byte-identical, transactional migration", () => {
    expect(migrationNames).toHaveLength(1);
    expect(migrationNames[0]).toMatch(/^\d{14}_agent_company_sources\.sql$/);
    expect(MIGRATION).toBe(BODY);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("do $prerequisites$");
    expect(SQL).toContain("do $source_shape$");
    expect(SQL).toContain("do $postflight$");
  });

  it("fences exactly the three safe company-context sources", () => {
    for (const [table, field] of [
      ["companies", "id"],
      ["company_inventory_settings", "company_id"],
      ["company_settings", "company_id"],
    ]) {
      expect(COMPACT).toContain(
        `after insert or update or delete on public.${table} for each row execute function private.bump_agent_read_domain_revision( 'company', '${field}' )`
      );
    }
    expect(
      COMPACT.match(/bump_agent_read_domain_revision\( 'company'/g)
    ).toHaveLength(3);
  });

  it("proves the exact closed columns and adds no speculative index or access", () => {
    for (const field of [
      "companies.default_work_start",
      "companies.default_work_end",
      "companies.currency_code",
      "companies.industry",
      "companies.timezone",
      "company_inventory_settings.inventory_mode",
      "company_settings.catalog_setup_completed_at",
    ]) {
      const [table, column] = field.split(".");
      expect(COMPACT).toContain(`('${table}', '${column}',`);
    }
    for (const forbidden of [
      "create index",
      "create unique index",
      "alter table",
      "grant execute",
      "grant select",
      "grant all",
      "create or replace function public.",
    ]) {
      expect(COMPACT).not.toContain(forbidden);
    }
  });

  it("does not schema-qualify parser-only SQL forms", () => {
    for (const parserOnly of [
      "coalesce",
      "nullif",
      "greatest",
      "least",
      "substring",
    ]) {
      expect(SQL).not.toContain(`pg_catalog.${parserOnly}(`);
    }
  });
});

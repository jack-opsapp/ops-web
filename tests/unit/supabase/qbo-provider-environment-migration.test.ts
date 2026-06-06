import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260606062000_qbo_provider_environment.sql"),
  "utf8"
);

describe("QBO provider environment migration", () => {
  it("is transaction-wrapped with a sentinel rollback guard", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(sql).toContain("qbo_provider_environment_sentinel");
    expect(sql).toContain("raise exception");
  });

  it("adds provider_environment to accounting_connections", () => {
    const normalized = sql.toLowerCase().replace(/\s+/g, " ");
    expect(normalized).toContain(
      "alter table public.accounting_connections add column if not exists provider_environment text not null default 'production'"
    );
    expect(normalized).toContain(
      "provider_environment = any (array['production'::text, 'sandbox'::text])"
    );
  });

  it("moves the connection uniqueness to provider_environment", () => {
    const normalized = sql.toLowerCase().replace(/\s+/g, " ");
    expect(normalized).toContain(
      "drop constraint if exists accounting_connections_company_id_provider_key"
    );
    expect(normalized).toContain(
      "unique (company_id, provider, provider_environment)"
    );
  });

  it("labels import runs with the provider environment used", () => {
    const normalized = sql.toLowerCase().replace(/\s+/g, " ");
    expect(normalized).toContain(
      "alter table public.qbo_import_runs add column if not exists provider_environment text not null default 'production'"
    );
  });
});

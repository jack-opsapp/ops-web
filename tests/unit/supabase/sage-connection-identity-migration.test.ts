import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260904040000_sage_connection_identity_and_oauth.sql"
  ),
  "utf8"
);
const sql = migration.toLowerCase().replace(/\s+/g, " ");

describe("Sage connection identity and OAuth migration", () => {
  it("adds an explicit encrypted Sage business binding", () => {
    expect(sql).toContain("add column if not exists sage_business_id text");
    expect(sql).toContain(
      "add column if not exists sage_business_id_lookup text"
    );
    expect(sql).toContain("add column if not exists sage_business_name text");
    expect(sql).toContain("accounting_connections_sage_business_binding_check");
  });

  it("preserves whether an OPS estimate is a Sage estimate or quote", () => {
    expect(sql).toContain("add column if not exists sage_document_kind text");
    expect(sql).toContain("sales_estimate");
    expect(sql).toContain("sales_quote");
  });

  it("stores OAuth attempts and pending business selections outside the browser-readable connection row", () => {
    expect(sql).toContain("create table public.accounting_oauth_attempts");
    expect(sql).toContain(
      "create table public.sage_business_selection_sessions"
    );
    expect(sql).toContain(
      "alter table public.accounting_oauth_attempts enable row level security"
    );
    expect(sql).toContain(
      "alter table public.sage_business_selection_sessions enable row level security"
    );
  });

  it("revokes browser execution and table access before granting service-role access", () => {
    expect(sql).toContain(
      "revoke all on table public.accounting_oauth_attempts from public, anon, authenticated"
    );
    expect(sql).toContain(
      "revoke all on table public.sage_business_selection_sessions from public, anon, authenticated"
    );
    expect(sql).toContain("to service_role");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public, pg_temp");
  });

  it("enforces one writable Sage environment and one OPS owner per bound Sage business", () => {
    expect(sql).toContain(
      "accounting_connections_one_sage_writable_per_company"
    );
    expect(sql).toContain("accounting_connections_sage_business_owner_uniq");
    expect(sql).toContain("where provider = 'sage'");
  });

  it("is atomic and ends with executable sentinels", () => {
    expect(migration.trim().startsWith("begin;")).toBe(true);
    expect(migration).toContain("sage_connection_identity_sentinel");
    expect(migration).toContain("raise exception");
    expect(migration.trim().endsWith("commit;")).toBe(true);
  });
});

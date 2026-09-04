import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260904050000_sage_queue_hardening.sql"
  ),
  "utf8"
);
const sql = migration.toLowerCase().replace(/\s+/g, " ");

describe("Sage durable queue migration", () => {
  it("adds durable provider acceptance evidence without invalidating old rows", () => {
    expect(sql).toContain("add column if not exists provider_request_id text");
    expect(sql).toContain(
      "add column if not exists provider_accepted_at timestamptz"
    );
    expect(sql).toContain(
      "add column if not exists idempotency_expires_at timestamptz"
    );
  });

  it("routes core mutations through every exact writable provider connection", () => {
    expect(sql).toContain(
      "create or replace function public.enqueue_accounting_sync()"
    );
    expect(sql).toContain("connection.provider in ('quickbooks', 'sage')");
    expect(sql).toContain("v_connection.provider_environment");
    expect(sql).toContain("v_connection_operation := v_operation");
    expect(sql).toContain(
      "current_setting('ops.sync_source', true) in ('quickbooks', 'sage')"
    );
  });

  it("keeps stale accepted writes out of automatic recovery", () => {
    expect(sql).toContain("provider_accepted_at is null");
    expect(sql).toContain("record_accounting_sync_acceptance");
    expect(sql).toContain("idempotency_expires_at");
  });

  it("serializes entity lifecycles, honors parents, and interleaves lanes", () => {
    expect(sql).toContain("older.status in ('pending', 'claimed')");
    expect(sql).toContain("parententityid");
    expect(sql).toContain("parentexternalid");
    expect(sql).toContain("row_number() over");
    expect(sql).toContain("lane_rank");
  });

  it("revokes browser execution and validates the final function bodies", () => {
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("set search_path = public, pg_temp");
    expect(migration).toContain("sage_queue_hardening_sentinel");
    expect(migration).toContain("raise exception");
  });

  it("is atomic", () => {
    expect(migration.trim().startsWith("begin;")).toBe(true);
    expect(migration.trim().endsWith("commit;")).toBe(true);
  });
});

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260721071828_email_sync_lock_rpc.sql"
);

function sql(): string {
  return existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
}

describe("email sync lock RPC migration", () => {
  it("claims an expired or empty connection lease atomically", () => {
    const source = sql();

    expect(source).toMatch(
      /create or replace function public\.acquire_email_connection_sync_lock_as_system\(\s*p_connection_id uuid,\s*p_lease_seconds integer default 600\s*\)\s*returns uuid/i
    );
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/set search_path = pg_catalog, pg_temp/i);
    expect(source).toMatch(
      /update public\.email_connections[\s\S]*?sync_in_progress_at\s*=\s*v_claimed_at[\s\S]*?sync_lock_owner\s*=\s*v_owner_id[\s\S]*?where id\s*=\s*p_connection_id[\s\S]*?sync_in_progress_at is null[\s\S]*?or sync_in_progress_at\s*<\s*v_claimed_at\s*-\s*make_interval\(secs\s*=>\s*p_lease_seconds\)[\s\S]*?returning sync_lock_owner into v_acquired_owner/i
    );
    expect(source).toMatch(/return v_acquired_owner/i);
  });

  it("is callable only by service_role and rejects invalid leases", () => {
    const source = sql();

    expect(source).toMatch(
      /coalesce\(\s*nullif\(current_setting\('request\.jwt\.claims', true\), ''\)::jsonb\s*->>\s*'role',\s*''\s*\)\s*<>\s*'service_role'/i
    );
    expect(source).toMatch(/raise exception[\s\S]*?using errcode = '42501'/i);
    expect(source).toMatch(
      /p_lease_seconds is null[\s\S]*?p_lease_seconds < 60[\s\S]*?p_lease_seconds > 3600[\s\S]*?using errcode = '22023'/i
    );
    expect(source).toMatch(
      /revoke all on function public\.acquire_email_connection_sync_lock_as_system\(\s*uuid,\s*integer\s*\)\s*from public, anon, authenticated, service_role/i
    );
    expect(source).toMatch(
      /grant execute on function public\.acquire_email_connection_sync_lock_as_system\(\s*uuid,\s*integer\s*\)\s*to service_role/i
    );
  });
});

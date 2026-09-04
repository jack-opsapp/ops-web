import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const migrationDirectory = resolve(__dirname, "../../../supabase/migrations");

function loadMigration(): string {
  const filename = readdirSync(migrationDirectory).find((candidate) =>
    candidate.endsWith("_create_instagram_connection.sql")
  );

  expect(
    filename,
    "Instagram connection migration must be generated"
  ).toBeDefined();
  return readFileSync(
    resolve(migrationDirectory, filename!),
    "utf8"
  ).toLowerCase();
}

describe("Instagram connection migration contract", () => {
  it("stores one encrypted, service-role-only account connection", () => {
    const sql = loadMigration();

    expect(sql).toContain("create table public.social_instagram_connections");
    expect(sql).toContain("id smallint primary key default 1");
    expect(sql).toContain("check (id = 1)");
    expect(sql).toContain("instagram_user_id text not null");
    expect(sql).toContain("username text not null");
    expect(sql).toContain("access_token_ciphertext text not null");
    expect(sql).toContain("token_issued_at timestamptz not null");
    expect(sql).toContain("token_expires_at timestamptz not null");
    expect(sql).toContain("required_scopes text[] not null");
    expect(sql).toContain("refresh_claim_token uuid");
    expect(sql).toContain("refresh_claim_expires_at timestamptz");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain(
      "revoke all on table public.social_instagram_connections from public, anon, authenticated"
    );
    expect(sql).toContain(
      "grant select, insert, update, delete on table public.social_instagram_connections to service_role"
    );
  });

  it("persists only hashed, expiring, one-time OAuth state", () => {
    const sql = loadMigration();

    expect(sql).toContain("create table public.social_instagram_oauth_states");
    expect(sql).toContain("nonce_hash text primary key");
    expect(sql).toContain("admin_email text not null");
    expect(sql).toContain("expires_at timestamptz not null");
    expect(sql).toContain(
      "revoke all on table public.social_instagram_oauth_states from public, anon, authenticated"
    );
    expect(sql).toContain(
      "create or replace function public.consume_social_instagram_oauth_state"
    );
    expect(sql).toContain("delete from public.social_instagram_oauth_states");
    expect(sql).toContain("state.expires_at > clock_timestamp()");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toMatch(
      /revoke all on function public\.consume_social_instagram_oauth_state\(text\)\s+from public, anon, authenticated/
    );
    expect(sql).toContain("to service_role");
  });

  it("leases proactive refresh to one worker", () => {
    const sql = loadMigration();

    expect(sql).toContain(
      "create or replace function public.claim_social_instagram_refresh"
    );
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain(
      "connection.token_expires_at <= clock_timestamp() + interval '7 days'"
    );
    expect(sql).toContain(
      "connection.token_issued_at <= clock_timestamp() - interval '24 hours'"
    );
    expect(sql).toContain("connection.refresh_claim_token = p_claim_token");
    expect(sql).toMatch(
      /refresh_claim_expires_at = clock_timestamp\(\)\s*\+ make_interval/
    );
    expect(sql).toContain(
      "create or replace function public.complete_social_instagram_refresh"
    );
    expect(sql).toContain("connection.refresh_claim_token = p_claim_token");
    expect(sql).toContain(
      "create or replace function public.release_social_instagram_refresh"
    );
    expect(sql).toContain(
      "grant execute on function public.claim_social_instagram_refresh"
    );
    expect(sql).toContain(
      "grant execute on function public.complete_social_instagram_refresh"
    );
    expect(sql).toContain(
      "grant execute on function public.release_social_instagram_refresh"
    );
  });
});

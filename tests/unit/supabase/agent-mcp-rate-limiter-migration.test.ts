import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_SUFFIX = "_agent_mcp_durable_rate_limit.sql";
const RUNTIME_FIXTURE = "agent-mcp-rate-limiter-runtime.sql";
const TRIGGER_COLLISION_FIXTURE =
  "agent-mcp-rate-limiter-trigger-collision.sql";

function migrationSql(): string {
  const directory = join(process.cwd(), "supabase/migrations");
  const matches = readdirSync(directory)
    .filter((file) => file.endsWith(MIGRATION_SUFFIX))
    .sort();

  expect(
    matches,
    `expected exactly one migration ending in ${MIGRATION_SUFFIX}`
  ).toHaveLength(1);
  return matches.length === 1
    ? readFileSync(join(directory, matches[0]), "utf8")
    : "";
}

function sqlFixture(file: string): string {
  return readFileSync(join(process.cwd(), "tests/sql", file), "utf8");
}

function compact(source: string): string {
  return source
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function functionDefinition(source: string, signature: string): string {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+${escaped}[\\s\\S]*?\\$function\\$\\s*;`,
      "i"
    )
  );
  expect(match, `${signature} is missing`).toBeTruthy();
  return compact(match?.[0] ?? "");
}

describe("durable MCP rate-limiter migration", () => {
  it("persists only HMAC bucket identities, policy metadata, counters, and expiry", () => {
    const sql = compact(migrationSql());

    expect(sql).toContain(
      "create table if not exists private.agent_mcp_rate_limit_buckets"
    );
    expect(sql).toMatch(/bucket_digest bytea not null/i);
    expect(sql).toMatch(/primary key\s*\(\s*bucket_digest\s*\)/i);
    expect(sql).toMatch(/octet_length\(bucket_digest\) = 32/i);
    expect(sql).toMatch(
      /bucket_kind[\s\S]*?actor[\s\S]*?grant[\s\S]*?company/i
    );
    expect(sql).toMatch(/policy_id text not null/i);
    expect(sql).toMatch(/window_start timestamptz not null/i);
    expect(sql).toMatch(/units_used integer not null/i);
    expect(sql).toMatch(/expires_at timestamptz not null/i);

    const tableDefinition = sql.match(
      /create table if not exists private\.agent_mcp_rate_limit_buckets\s*\(([\s\S]*?)\);/i
    )?.[1];
    expect(tableDefinition).toBeTruthy();
    expect(tableDefinition).not.toMatch(
      /(?:^|,)\s*(?:company_id|actor_user_id|grant_id|capability_id|request_id|query|token|evidence)\s+(?:uuid|text|bytea|integer|timestamptz)/i
    );
  });

  it("keeps the digest key private and uses keyed SHA-256 over canonical bucket dimensions", () => {
    const sql = compact(migrationSql());
    const digest = functionDefinition(
      migrationSql(),
      "private.agent_mcp_rate_limit_bucket_digest"
    );

    expect(sql).toContain(
      "create table if not exists private.agent_mcp_rate_limit_keys"
    );
    expect(sql).toMatch(/key_material bytea not null/i);
    expect(sql).toMatch(/gen_random_bytes\(32\)/i);
    expect(digest).toMatch(/extensions\.hmac\(/i);
    expect(digest).toContain("'sha256'");
    expect(digest).toContain("p_bucket_kind");
    expect(digest).toContain("p_company_id");
    expect(digest).toContain("p_actor_user_id");
    expect(digest).toContain("p_grant_id");
    expect(digest).toContain("p_capability_id");
    expect(digest).toContain("p_policy_id");
    expect(digest).toContain("p_window_start");
  });

  it("defines two immutable 60-second one-unit policies with actor, grant, and company limits", () => {
    const consume = functionDefinition(
      migrationSql(),
      "public.consume_agent_mcp_rate_limit_as_system"
    );

    expect(consume).toContain("mcp-lightweight-read:2026-08-23.v1");
    expect(consume).toContain("mcp-evidence-search:2026-08-23.v1");
    expect(consume).toMatch(/p_requested_units is distinct from 1/i);
    expect(consume).toMatch(
      /mcp-lightweight-read:2026-08-23\.v1[\s\S]*?120[\s\S]*?120[\s\S]*?600/i
    );
    expect(consume).toMatch(
      /mcp-evidence-search:2026-08-23\.v1[\s\S]*?30[\s\S]*?30[\s\S]*?120/i
    );
    expect(consume).toMatch(/v_window_seconds[^;]*:= 60/i);
  });

  it("re-proves the live grant, actor, company, and client before touching a bucket", () => {
    const consume = functionDefinition(
      migrationSql(),
      "public.consume_agent_mcp_rate_limit_as_system"
    );

    expect(consume).toContain("private.mcp_oauth_grants");
    expect(consume).toContain("private.mcp_oauth_clients");
    expect(consume).toContain("grants.id = p_grant_id");
    expect(consume).toContain("grants.user_id = p_actor_user_id");
    expect(consume).toContain("grants.company_id = p_company_id");
    expect(consume).toContain("grants.revoked_at is null");
    expect(consume).toContain("clients.disabled_at is null");
    expect(consume).toContain("p_capability_id !~ '^[a-z][a-z0-9_]{0,127}$'");
    expect(consume).toContain("p_protocol_era is null");
  });

  it("locks all three dimensions in deterministic order and increments only after a complete allow decision", () => {
    const consume = functionDefinition(
      migrationSql(),
      "public.consume_agent_mcp_rate_limit_as_system"
    );

    expect(consume).toMatch(
      /insert into private\.agent_mcp_rate_limit_buckets[\s\S]*?on conflict \(bucket_digest\) do nothing/i
    );
    expect(consume).toMatch(
      /order by bucket\.bucket_digest[\s\S]*?for update/i
    );
    expect(consume).toMatch(
      /if v_allowed then[\s\S]*?update private\.agent_mcp_rate_limit_buckets[\s\S]*?units_used = bucket\.units_used \+ p_requested_units/i
    );
    expect(consume).toContain("v_locked_count is distinct from 3");
  });

  it("uses indexed, hard-bounded expiry cleanup instead of an unbounded sweep", () => {
    const sql = compact(migrationSql());
    const prune = functionDefinition(
      migrationSql(),
      "private.prune_agent_mcp_rate_limit_buckets"
    );

    expect(sql).toMatch(
      /create index if not exists agent_mcp_rate_limit_buckets_expiry_idx on private\.agent_mcp_rate_limit_buckets \(expires_at, bucket_digest\)/i
    );
    expect(prune).toMatch(/limit p_limit/i);
    expect(prune).toMatch(/p_limit between 1 and 64/i);
    expect(prune).toMatch(/for update skip locked/i);
    expect(prune).toMatch(
      /order by bucket\.expires_at, bucket\.bucket_digest/i
    );
  });

  it("couples durable denial to one privacy-safe immutable request audit row", () => {
    const consume = functionDefinition(
      migrationSql(),
      "public.consume_agent_mcp_rate_limit_as_system"
    );

    expect(consume).toMatch(
      /else v_remaining := 0; insert into private\.mcp_request_audit/i
    );
    expect(consume).toContain("'rate_limited'");
    expect(consume).toContain("'RATE_LIMITED'");
    expect(consume).toContain("p_request_id");
    expect(consume).toContain("p_capability_id");
    expect(consume).not.toMatch(/p_query|p_evidence_token|p_input_sha256/i);
  });

  it("is volatile, fixed-search-path, and executable only by service_role", () => {
    const sql = compact(migrationSql())
      .replace(/\s*,\s*/g, ",")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");
    const consume = functionDefinition(
      migrationSql(),
      "public.consume_agent_mcp_rate_limit_as_system"
    );

    expect(consume).toContain("language plpgsql");
    expect(consume).toContain("volatile");
    expect(consume).toContain("security definer");
    expect(consume).toMatch(
      /set search_path (?:to|=) 'pg_catalog',\s*'public',\s*'private',\s*'extensions',\s*'pg_temp'/i
    );
    expect(consume).toContain("auth.role() is distinct from 'service_role'");
    expect(sql).toContain(
      "revoke all on table private.agent_mcp_rate_limit_buckets from public,anon,authenticated,service_role"
    );
    expect(sql).toContain(
      "revoke all on table private.agent_mcp_rate_limit_keys from public,anon,authenticated,service_role"
    );
    expect(sql).toContain(
      "revoke all on function public.consume_agent_mcp_rate_limit_as_system(text,uuid,uuid,uuid,text,text,integer,text) from public,anon,authenticated"
    );
    expect(sql).toContain(
      "grant execute on function public.consume_agent_mcp_rate_limit_as_system(text,uuid,uuid,uuid,text,text,integer,text) to service_role"
    );
  });

  it("pins exact primary-key, check, and default contracts on replay", () => {
    const sql = compact(migrationSql());
    const catalogSql = sql
      .replace(/\s*,\s*/g, ",")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");

    expect(sql).toContain("constraint_row.conkey = array[1]::smallint[]");
    expect(sql.match(/pg_catalog\.pg_get_constraintdef\(/g)).toHaveLength(7);
    for (const definition of [
      "CHECK (key_id = 'mcp-rate-limit-hmac:2026-08-23.v1'::text)",
      "CHECK (octet_length(key_material) = 32)",
      "CHECK (octet_length(bucket_digest) = 32)",
      "CHECK (bucket_kind = ANY (ARRAY['actor'::text, 'grant'::text, 'company'::text]))",
      "CHECK (policy_id = ANY (ARRAY['mcp-lightweight-read:2026-08-23.v1'::text, 'mcp-evidence-search:2026-08-23.v1'::text]))",
      "CHECK (units_used >= 0 AND units_used <= 600)",
      "CHECK (expires_at > window_start)",
    ]) {
      expect(sql).toContain(definition.replaceAll("'", "''"));
    }
    expect(catalogSql).toContain(
      "pg_catalog.pg_get_expr(default_value.adbin,default_value.adrelid) = 'statement_timestamp()'"
    );
    expect(catalogSql).toContain(
      "pg_catalog.pg_get_expr(default_value.adbin,default_value.adrelid) = '0'"
    );
    expect(catalogSql).toContain(
      "bool_and(attribute.attidentity = '' and attribute.attgenerated = '')"
    );
  });

  it("rejects either private table when replay finds any trigger", () => {
    const sql = compact(migrationSql());
    const collision = compact(sqlFixture(TRIGGER_COLLISION_FIXTURE));

    expect(sql.match(/and not relation\.relhastriggers/g)).toHaveLength(2);
    expect(collision).toContain(
      "create trigger task7_unexpected_rate_limit_trigger"
    );
    expect(collision).toContain(
      "private.agent_mcp_rate_limit_keys for each statement"
    );
    expect(collision).toContain(
      "20260823072843_agent_mcp_durable_rate_limit.sql"
    );
  });

  it("canonicalizes and proves exact ACLs against an unexpected replay grantee", () => {
    const sql = compact(migrationSql());
    const runtime = compact(sqlFixture(RUNTIME_FIXTURE));

    expect(
      sql.match(/pg_catalog\.aclexplode\(/g)?.length ?? 0
    ).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("acl_entry.grantee");
    expect(sql).toContain("acl_entry.privilege_type");
    expect(sql).toContain("acl_entry.is_grantable");
    expect(sql).toContain("roles.rolname = 'service_role'");
    expect(runtime).toContain(
      "grant select on table private.agent_mcp_rate_limit_buckets to pg_monitor"
    );
    expect(runtime).toContain(
      "grant execute on function public.consume_agent_mcp_rate_limit_as_system"
    );
    expect(runtime).toContain("to pg_monitor with grant option");
    expect(runtime).toContain("unexpected_rate_limit_acl_survived_replay");
  });

  it("ends with a fail-closed catalog postflight for replay collisions and ACL drift", () => {
    const sql = compact(migrationSql());
    const postflight = sql.match(/do \$postflight\$([\s\S]*?)\$postflight\$;/i);

    expect(postflight, "rate-limit catalog postflight is missing").toBeTruthy();
    const body = postflight?.[1] ?? "";
    for (const marker of [
      "agent_mcp_rate_limit_catalog_key_table_invalid",
      "agent_mcp_rate_limit_catalog_bucket_table_invalid",
      "agent_mcp_rate_limit_catalog_constraint_invalid",
      "agent_mcp_rate_limit_catalog_index_invalid",
      "agent_mcp_rate_limit_catalog_function_invalid",
      "agent_mcp_rate_limit_catalog_acl_invalid",
    ]) {
      expect(body).toContain(marker);
    }
    expect(body).toContain("pg_catalog.pg_attribute");
    expect(body).toContain("pg_catalog.pg_constraint");
    expect(body).toContain("pg_catalog.pg_index");
    expect(body).toContain("pg_catalog.pg_proc");
    expect(body).toContain("has_table_privilege");
    expect(body).toContain("has_function_privilege");
  });

  it("reloads the PostgREST schema only after the postflight succeeds", () => {
    const sql = compact(migrationSql());
    const postflightEnd = sql.lastIndexOf("$postflight$;");
    const reload = sql.lastIndexOf("notify pgrst, 'reload schema';");

    expect(postflightEnd).toBeGreaterThan(-1);
    expect(reload).toBeGreaterThan(postflightEnd);
    expect(sql.endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});

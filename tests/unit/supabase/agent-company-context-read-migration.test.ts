import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_company_context_read.sql";
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith(SUFFIX));
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  migrationNames[0] ?? "MISSING"
);
const BODY_PATH = join(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/company/sql/agent_company_context_read.body.sql"
);
const RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-company-context-runtime.sql"
);
const REPLAY_PATH = join(
  process.cwd(),
  "tests/sql/agent-company-context-replay-runtime.sql"
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
function definition(sql: string, name: string) {
  const marker = `create or replace function ${name}(`;
  const start = sql.lastIndexOf(marker);
  if (start < 0) return "";
  const tail = sql.slice(start);
  const delimiter = /\bas\s+(\$[a-z0-9_]*\$)/.exec(tail)?.[1];
  if (!delimiter) return "";
  const end = tail.indexOf(`${delimiter};`);
  return end < 0 ? "" : tail.slice(0, end + delimiter.length + 1);
}

const MIGRATION = read(MIGRATION_PATH);
const BODY = read(BODY_PATH);
const SQL = compact(MIGRATION);
const SIGNATURE_SQL = SQL.replace(/\(\s+/g, "(")
  .replace(/\s+\)/g, ")")
  .replace(/,\s+/g, ",");
const PRIVATE_SUMMARY = compact(
  definition(MIGRATION.toLowerCase(), "private.agent_p2_company_summary_v1")
);
const PUBLIC_READ = compact(
  definition(
    MIGRATION.toLowerCase(),
    "public.read_agent_company_context_as_system"
  )
);
const PRIVATE_SIGNATURE =
  "private.agent_p2_company_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,timestamp with time zone)";
const PUBLIC_SIGNATURE =
  "public.read_agent_company_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text)";

describe("P2 company-context read migration", () => {
  it("uses one generated, byte-identical, transactional migration and runtime pair", () => {
    expect(migrationNames).toHaveLength(1);
    expect(migrationNames[0]).toMatch(
      /^\d{14}_agent_company_context_read\.sql$/
    );
    expect(MIGRATION).toBe(BODY);
    expect(MIGRATION.toLowerCase()).toMatch(/(?:^|\n)begin;\s/);
    expect(MIGRATION.trim().toLowerCase().endsWith("commit;")).toBe(true);
    expect(read(RUNTIME_PATH)).not.toBe("");
    expect(read(REPLAY_PATH)).not.toBe("");
    expect(PRIVATE_SUMMARY).not.toBe("");
    expect(PUBLIC_READ).not.toBe("");
  });

  it("pins exact capability, consent, nominal permission, grant, client, and company revision", () => {
    expect(PUBLIC_READ).toContain(
      "p_capability_id is distinct from 'get_company_context'"
    );
    expect(PUBLIC_READ).toContain("'get_company_context:2026-08-22.v1'");
    expect(PUBLIC_READ).toContain("'2026-08-22.capability-manifest.v8'");
    expect(PRIVATE_SUMMARY).toContain("array['ops.company.read']::text[]");
    expect(PRIVATE_SUMMARY).toContain(
      "not ('settings.company' = any(p_registered_permission_keys))"
    );
    expect(PRIVATE_SUMMARY).toContain(
      "authority.settings_company_scope = p_settings_company_scope"
    );
    for (const fragment of [
      "private.resolve_agent_actor_authority(",
      "join private.mcp_oauth_grants oauth_grant",
      "join private.mcp_oauth_clients oauth_client",
      "oauth_grant.revoked_at is null",
      "oauth_client.disabled_at is null",
      "oauth_grant.scopes = p_granted_scope_ceiling",
      "oauth_grant.accepted_labels =",
      "oauth_grant.consent_catalog_revision = oauth_client.consent_catalog_revision",
      "oauth_grant.exposure_revision = oauth_client.exposure_revision",
      "company_revision.domain = 'company'",
    ]) {
      expect(PRIVATE_SUMMARY).toContain(fragment);
    }
  });

  it("projects only the closed operating profile and fails invalid core source state", () => {
    for (const field of [
      "'company_ref'",
      "'profile'",
      "'regional'",
      "'working_window'",
      "'catalog'",
      "'public_assets'",
      "'inventory_mode'",
      "'setup_state'",
      "'content_kind', 'untrusted_business_data'",
      "agent_company_context_source_invalid",
      "else array[v_source.industry]::text[]",
      "pg_catalog.cardinality(v_industries) = 0",
      "v_currency_code is null",
    ]) {
      expect(PRIVATE_SUMMARY).toContain(field);
    }
    for (const forbidden of [
      "'account_holder_id'",
      "'admin_ids'",
      "'email'",
      "'phone'",
      "'physical_address'",
      "'latitude'",
      "'longitude'",
      "'subscription_plan'",
      "'stripe_customer_id'",
      "'raw_settings'",
      "'schedule_settings'",
      "'invoice_settings'",
      "'lifecycle_settings'",
    ]) {
      expect(PRIVATE_SUMMARY).not.toContain(forbidden);
    }
  });

  it("keeps the summary private, the fixed RPC service-only, and binds the full proof envelope", () => {
    expect(PRIVATE_SUMMARY).toContain(
      "language plpgsql stable security invoker set search_path = ''"
    );
    expect(PUBLIC_READ).toContain(
      "language plpgsql stable security definer set search_path = ''"
    );
    expect(SIGNATURE_SQL).toContain(
      `revoke all on function ${PRIVATE_SIGNATURE}`
    );
    expect(SIGNATURE_SQL).toContain(
      `revoke all on function ${PUBLIC_SIGNATURE}`
    );
    expect(SIGNATURE_SQL).toContain(
      `grant execute on function ${PUBLIC_SIGNATURE}`
    );
    expect(SIGNATURE_SQL).not.toContain(
      `grant execute on function ${PRIVATE_SIGNATURE}`
    );
    for (const field of [
      "'oauth_grant_id', p_oauth_grant_id",
      "'oauth_client_id', p_oauth_client_id",
      "'grant_revision', p_grant_revision",
      "'granted_scope_ceiling', pg_catalog.to_jsonb(p_granted_scope_ceiling)",
      "'permission_snapshot_revision', p_permission_snapshot_revision",
      "'settings_company_scope', p_settings_company_scope",
      "'query', '{}'::jsonb",
      "'source_inspected'",
      "'ops_proof:v1:'",
      "private.canonical_agent_projection_json(v_envelope)",
    ]) {
      expect(SQL).toContain(field);
    }
  });

  it("does not schema-qualify parser-only SQL forms", () => {
    for (const value of [MIGRATION, read(RUNTIME_PATH), read(REPLAY_PATH)]) {
      for (const parserOnly of [
        "coalesce",
        "nullif",
        "greatest",
        "least",
        "substring",
      ]) {
        expect(value.toLowerCase()).not.toContain(`pg_catalog.${parserOnly}(`);
      }
    }
  });
});

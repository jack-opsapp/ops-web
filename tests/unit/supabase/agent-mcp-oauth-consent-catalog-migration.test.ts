import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_SUFFIX = "_mcp_oauth_consent_catalog_versioning.sql";
const V1_CONSENT_REVISION = "2026-08-22.mcp-consent-catalog.v1";
const V1_EXPOSURE_REVISION = "2026-08-22.mcp-exposure.v1";
const V1_SCOPES = [
  "ops.jobs.read",
  "ops.schedule.read",
  "ops.customers.read",
  "ops.customer_contacts.read",
  "ops.photos.read",
  "ops.correspondence.read",
  "ops.financials.read",
] as const;

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

function runtimeSql(): string {
  return readFileSync(
    join(
      process.cwd(),
      "tests/sql/agent-mcp-oauth-consent-catalog-runtime.sql"
    ),
    "utf8"
  );
}

function compact(source: string): string {
  return source
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function postflightSql(): string {
  const sql = compact(migrationSql());
  const start = sql.indexOf("do $postflight$");
  const end = sql.indexOf("notify pgrst, 'reload schema'");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
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

describe("MCP OAuth consent-catalogue migration", () => {
  it("stores one-time short-lived consent previews behind service-only issue/consume RPCs", () => {
    const sql = compact(migrationSql())
      .replace(/\s*,\s*/g, ",")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");

    expect(sql).toMatch(
      /create table if not exists private\.mcp_oauth_consent_previews/i
    );
    for (const boundColumn of [
      "preview_hash text",
      "client_id uuid",
      "user_id uuid",
      "company_id uuid",
      "client_name text",
      "company_name text",
      "redirect_uri text",
      "response_type text",
      "scopes text[]",
      "accepted_labels text[]",
      "consent_catalog_revision text",
      "exposure_revision text",
      "state text",
      "code_challenge text",
      "code_challenge_method text",
      "resource text",
      "expires_at timestamptz",
      "consumed_at timestamptz",
      "created_at timestamptz",
    ]) {
      expect(sql).toContain(boundColumn);
    }
    expect(sql).toMatch(/expires_at <= created_at \+ interval '5 minutes'/i);
    expect(sql).toMatch(
      /create index if not exists mcp_oauth_consent_previews_expiry_idx on private\.mcp_oauth_consent_previews \(expires_at,preview_hash\)/i
    );
    expect(sql).toMatch(/create trigger mcp_oauth_consent_previews_immutable/i);

    const issueSignature =
      "public.issue_mcp_oauth_consent_preview_as_system(text,uuid,uuid,uuid,text,text,text[],text[],text,text,text,text,text,text,timestamp with time zone)";
    const consumeSignature =
      "public.consume_mcp_oauth_consent_preview_as_system(text,uuid,uuid)";
    for (const signature of [issueSignature, consumeSignature]) {
      expect(sql.toLowerCase()).toContain(
        `revoke all on function ${signature} from public,anon,authenticated,service_role`
      );
      expect(sql.toLowerCase()).toContain(
        `grant execute on function ${signature} to service_role`
      );
    }
    const consume = functionDefinition(
      migrationSql(),
      "public.consume_mcp_oauth_consent_preview_as_system"
    );
    expect(consume).toMatch(/set consumed_at = statement_timestamp\(\)/i);
    expect(consume).toMatch(/preview\.consumed_at is null/i);
    expect(consume).toMatch(/preview\.expires_at > statement_timestamp\(\)/i);
    expect(consume).toMatch(/preview\.user_id = p_user_id/i);
    expect(consume).toMatch(/preview\.company_id = p_company_id/i);

    const issue = functionDefinition(
      migrationSql(),
      "public.issue_mcp_oauth_consent_preview_as_system"
    );
    expect(issue).toMatch(
      /where expired\.expires_at <= statement_timestamp\(\)[\s\S]*?order by expired\.expires_at, expired\.preview_hash[\s\S]*?limit 64[\s\S]*?for update skip locked/i
    );
    expect(issue).not.toMatch(/or\s+preview\.consumed_at is not null/i);
    expect(issue).toMatch(
      /client\.consent_catalog_revision = p_consent_catalog_revision/i
    );
    expect(issue).toMatch(/client\.exposure_revision = p_exposure_revision/i);
  });

  it("enforces a durable actor-company and global live-preview ceiling under database locks", () => {
    const sql = compact(migrationSql());
    const issue = functionDefinition(
      migrationSql(),
      "public.issue_mcp_oauth_consent_preview_as_system"
    );

    expect(sql).toMatch(
      /mcp_oauth_consent_previews_binding_expiry_idx on private\.mcp_oauth_consent_previews \(user_id, company_id, expires_at, preview_hash\)/i
    );
    expect(issue).toMatch(/pg_advisory_xact_lock/i);
    expect(issue).toMatch(/p_user_id::text \|\| ':' \|\| p_company_id::text/i);
    expect(issue).toMatch(
      /preview\.user_id = p_user_id[\s\S]*?preview\.company_id = p_company_id[\s\S]*?preview\.expires_at > statement_timestamp\(\)[\s\S]*?limit 31/i
    );
    expect(issue).toMatch(
      /preview\.expires_at > statement_timestamp\(\)[\s\S]*?limit 4097/i
    );
    expect(issue).toMatch(/v_binding_live_count >= 30/i);
    expect(issue).toMatch(/v_global_live_count >= 4096/i);
    expect(issue).toMatch(/rate_limited boolean/i);
    expect(issue).toMatch(/return query select[\s\S]*?true/i);

    const globalLock = issue.indexOf("pg_advisory_xact_lock(638416, 1)");
    const bindingLock = issue.indexOf("hashtextextended(");
    const bindingCount = issue.indexOf("into v_binding_live_count");
    const globalCount = issue.indexOf("into v_global_live_count");
    const insert = issue.indexOf(
      "insert into private.mcp_oauth_consent_previews"
    );
    expect(globalLock).toBeGreaterThan(-1);
    expect(bindingLock).toBeGreaterThan(globalLock);
    expect(bindingCount).toBeGreaterThan(bindingLock);
    expect(globalCount).toBeGreaterThan(bindingCount);
    expect(insert).toBeGreaterThan(globalCount);

    const runtime = compact(runtimeSql());
    expect(runtime).toContain("durable_binding_preview_ceiling_failed");
    expect(runtime).toContain("durable_global_preview_ceiling_failed");
    expect(runtime).toMatch(/generate_series\(1, 4095\)/i);
  });

  it("uses bounded multi-batch expired-preview cleanup that can catch up", () => {
    const issue = functionDefinition(
      migrationSql(),
      "public.issue_mcp_oauth_consent_preview_as_system"
    );

    expect(issue).toMatch(/for v_cleanup_batch in 1\.\.8 loop/i);
    expect(issue).toMatch(
      /order by expired\.expires_at, expired\.preview_hash[\s\S]*?limit 64[\s\S]*?for update skip locked/i
    );
    expect(issue).toMatch(/get diagnostics v_cleanup_deleted = row_count/i);
    expect(issue).toMatch(/exit when v_cleanup_deleted < 64/i);
    expect(issue).not.toMatch(/consumed_at is not null/i);
  });

  it("adds immutable client ceilings and code/grant consent snapshots", () => {
    const sql = compact(migrationSql());

    for (const column of [
      "scope_ceiling text[]",
      "consent_catalog_revision text",
      "exposure_revision text",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `alter table private\\.mcp_oauth_clients add column if not exists ${column.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          )}`,
          "i"
        )
      );
    }
    for (const table of ["authorization_codes", "grants"]) {
      expect(sql).toMatch(
        new RegExp(
          `alter table private\\.mcp_oauth_${table} add column if not exists accepted_labels text\\[\\]`,
          "i"
        )
      );
      expect(sql).toMatch(
        new RegExp(
          `alter table private\\.mcp_oauth_${table} add column if not exists consent_catalog_revision text`,
          "i"
        )
      );
      expect(sql).toMatch(
        new RegExp(
          `alter table private\\.mcp_oauth_${table} add column if not exists exposure_revision text`,
          "i"
        )
      );
    }
    expect(sql).toMatch(/create trigger mcp_oauth_clients_immutable_ceiling/i);
    expect(sql).toMatch(/create trigger mcp_oauth_codes_immutable_consent/i);
    expect(sql).toMatch(/create trigger mcp_oauth_grants_immutable_consent/i);
  });

  it("backfills v1 metadata without replacing any persisted client, code, or grant scope", () => {
    const sql = compact(migrationSql());

    expect(sql).toContain(`'${V1_CONSENT_REVISION}'`);
    expect(sql).toContain(`'${V1_EXPOSURE_REVISION}'`);
    for (const scope of V1_SCOPES) expect(sql).toContain(`'${scope}'`);
    expect(sql).toMatch(
      /update private\.mcp_oauth_clients[\s\S]*?scope_ceiling = private\.mcp_oauth_scope_array\(scope\)/i
    );
    expect(sql).toMatch(
      /update private\.mcp_oauth_authorization_codes[\s\S]*?accepted_labels = private\.mcp_oauth_labels_for_scopes\(\s*scopes/i
    );
    expect(sql).toMatch(
      /update private\.mcp_oauth_grants[\s\S]*?accepted_labels = private\.mcp_oauth_labels_for_scopes\(\s*scopes/i
    );
    expect(sql).not.toMatch(
      /update private\.mcp_oauth_(?:authorization_codes|grants)[\s\S]{0,400}\bscopes\s*=/i
    );
    expect(sql).not.toMatch(
      /update private\.mcp_oauth_clients[\s\S]{0,400}\bscope\s*=/i
    );
  });

  it("constrains exact non-empty ceilings, aligned labels, and bounded immutable revisions", () => {
    const sql = compact(migrationSql());

    expect(sql).toMatch(/mcp_oauth_clients_scope_ceiling_valid/i);
    expect(sql).toMatch(/mcp_oauth_codes_consent_snapshot_valid/i);
    expect(sql).toMatch(/mcp_oauth_grants_consent_snapshot_valid/i);
    expect(sql).toMatch(
      /cardinality\(accepted_labels\) = cardinality\(scopes\)/i
    );
    expect(sql).toMatch(/consent_catalog_revision ~ '\^\[0-9a-z/i);
    expect(sql).toMatch(/exposure_revision ~ '\^\[0-9a-z/i);
  });

  it("replaces every security-sensitive RPC with ceiling/revision-aware service-only signatures", () => {
    const sql = compact(migrationSql())
      .replace(/\s*,\s*/g, ",")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");
    const signatures = [
      "public.register_mcp_oauth_client_as_system(text,text[],text,text[],text,text,text,text)",
      "public.get_mcp_oauth_client_as_system(uuid)",
      "public.issue_mcp_oauth_consent_preview_as_system(text,uuid,uuid,uuid,text,text,text[],text[],text,text,text,text,text,text,timestamp with time zone)",
      "public.consume_mcp_oauth_consent_preview_as_system(text,uuid,uuid)",
      "public.create_mcp_oauth_authorization_code_as_system(text,uuid,uuid,uuid,text[],text[],text,text,text,text,text,timestamp with time zone)",
      "public.consume_mcp_oauth_authorization_code_as_system(text,uuid,text)",
      "public.mint_mcp_oauth_grant_as_system(text,uuid,uuid,uuid,text,text[],text,text,text,text,timestamp with time zone,timestamp with time zone)",
      "public.rotate_mcp_oauth_refresh_token_as_system(text,uuid,text[],text,text,timestamp with time zone,timestamp with time zone)",
      "public.resolve_mcp_oauth_access_token_as_system(text)",
    ];

    for (const signature of signatures) {
      expect(sql.toLowerCase()).toContain(
        `revoke all on function ${signature} from public,anon,authenticated`
      );
      expect(sql.toLowerCase()).toContain(
        `grant execute on function ${signature} to service_role`
      );
    }
    expect(sql).not.toMatch(
      /grant execute on function public\.(?:register|get|create|consume|mint|rotate|resolve)_mcp_oauth_[^(]+\([^;]+\) to (?:public|anon|authenticated)/i
    );
  });

  it("enforces client ceilings at code creation and derives grant snapshots from the consumed code", () => {
    const createCode = functionDefinition(
      migrationSql(),
      "public.create_mcp_oauth_authorization_code_as_system"
    );
    const mintGrant = functionDefinition(
      migrationSql(),
      "public.mint_mcp_oauth_grant_as_system"
    );

    expect(createCode).toMatch(/p_scopes\s*<@\s*v_client\.scope_ceiling/i);
    expect(createCode).toMatch(
      /client\.consent_catalog_revision = p_consent_catalog_revision/i
    );
    expect(createCode).toMatch(
      /client\.exposure_revision = p_exposure_revision/i
    );
    expect(createCode).toMatch(
      /p_exposure_revision[\s\S]*?p_consent_catalog_revision/i
    );
    expect(createCode).toMatch(
      /cardinality\(p_accepted_labels\) <> cardinality\(p_scopes\)/i
    );
    expect(mintGrant).toMatch(
      /code\.accepted_labels[\s\S]*?code\.consent_catalog_revision[\s\S]*?code\.exposure_revision/i
    );
    expect(mintGrant).not.toMatch(/p_scopes/i);
    expect(mintGrant).toMatch(
      /code\.exposure_revision\s*=\s*p_active_exposure_revision/i
    );
    expect(mintGrant).toMatch(/code\.scopes\s*<@\s*p_active_grantable_scopes/i);
  });

  it("keeps refresh non-widening and rejects grants outside the immutable client ceiling", () => {
    const rotate = functionDefinition(
      migrationSql(),
      "public.rotate_mcp_oauth_refresh_token_as_system"
    );

    expect(rotate).toMatch(/grants\.scopes\s*<@\s*clients\.scope_ceiling/i);
    expect(rotate).toMatch(/grants\.scopes\s*<@\s*p_active_grantable_scopes/i);
    expect(rotate).toMatch(/grants\.accepted_labels/i);
    expect(rotate).toMatch(/grants\.consent_catalog_revision/i);
    expect(rotate).toMatch(/grants\.exposure_revision/i);
    expect(rotate).not.toMatch(/p_scopes/i);
  });

  it("is replay-safe and keeps private tables and helpers inaccessible", () => {
    const sql = compact(migrationSql())
      .replace(/\s*,\s*/g, ",")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");

    expect(sql).toMatch(/add column if not exists scope_ceiling/i);
    expect(sql).toMatch(
      /drop trigger if exists mcp_oauth_clients_immutable_ceiling/i
    );
    expect(sql).toMatch(
      /drop trigger if exists mcp_oauth_codes_immutable_consent/i
    );
    expect(sql).toMatch(
      /drop trigger if exists mcp_oauth_grants_immutable_consent/i
    );
    for (const obsoleteSignature of [
      "public.register_mcp_oauth_client_as_system(text,text[],text,text,text)",
      "public.create_mcp_oauth_authorization_code_as_system(text,uuid,uuid,uuid,text[],text,text,text,timestamptz)",
      "public.mint_mcp_oauth_grant_as_system(text,uuid,uuid,uuid,text[],text,text,text,text,timestamptz,timestamptz)",
      "public.rotate_mcp_oauth_refresh_token_as_system(text,text,text,timestamptz,timestamptz)",
    ]) {
      expect(sql.toLowerCase()).not.toContain(
        `revoke all on function ${obsoleteSignature}`
      );
      expect(sql.toLowerCase()).toContain(
        `drop function if exists ${obsoleteSignature}`
      );
    }
    expect(sql).toMatch(
      /revoke all on table private\.mcp_oauth_clients,private\.mcp_oauth_authorization_codes,private\.mcp_oauth_grants,private\.mcp_oauth_tokens,private\.mcp_oauth_consent_previews from public,anon,authenticated,service_role/i
    );
    for (const signature of [
      "private.mcp_oauth_scope_array(text)",
      "private.mcp_oauth_labels_for_scopes(text[],text)",
      "private.enforce_mcp_oauth_consent_immutability()",
    ]) {
      expect(sql.toLowerCase()).toContain(
        `revoke all on function ${signature} from public,anon,authenticated,service_role`
      );
    }
  });

  it("fails closed on final catalogue drift before reloading the PostgREST schema", () => {
    const sql = compact(migrationSql()).toLowerCase();
    const postflight = sql.indexOf("do $postflight$");
    const notify = sql.indexOf("notify pgrst, 'reload schema'");

    expect(postflight).toBeGreaterThan(-1);
    expect(notify).toBeGreaterThan(postflight);
    expect(sql.slice(notify).trim()).toBe("notify pgrst, 'reload schema';");

    for (const catalog of [
      "pg_catalog.pg_attribute",
      "pg_catalog.pg_attrdef",
      "pg_catalog.pg_constraint",
      "pg_catalog.pg_trigger",
      "pg_catalog.pg_proc",
      "pg_catalog.pg_index",
      "pg_catalog.pg_am",
      "pg_catalog.aclexplode",
    ]) {
      expect(sql.slice(postflight, notify)).toContain(catalog);
    }

    for (const column of [
      "private.mcp_oauth_clients.scope_ceiling:text[]",
      "private.mcp_oauth_clients.consent_catalog_revision:text",
      "private.mcp_oauth_clients.exposure_revision:text",
      "private.mcp_oauth_authorization_codes.accepted_labels:text[]",
      "private.mcp_oauth_authorization_codes.consent_catalog_revision:text",
      "private.mcp_oauth_authorization_codes.exposure_revision:text",
      "private.mcp_oauth_grants.accepted_labels:text[]",
      "private.mcp_oauth_grants.consent_catalog_revision:text",
      "private.mcp_oauth_grants.exposure_revision:text",
    ]) {
      expect(sql.slice(postflight, notify)).toContain(`'${column}'`);
    }
    expect(sql.slice(postflight, notify)).toMatch(
      /\('preview_hash',\s*'text',\s*true\)/
    );
    expect(sql.slice(postflight, notify)).toMatch(
      /\('created_at',\s*'timestamp with time zone',\s*true\)/
    );
    expect(sql.slice(postflight, notify)).toContain(
      "mcp_oauth_consent_preview_default_postflight_failed"
    );
    expect(sql.slice(postflight, notify)).toContain(
      "mcp_oauth_consent_preview_constraint_count_failed"
    );

    for (const objectName of [
      "mcp_oauth_clients_scope_ceiling_valid",
      "mcp_oauth_codes_consent_snapshot_valid",
      "mcp_oauth_grants_consent_snapshot_valid",
      "mcp_oauth_clients_immutable_ceiling",
      "mcp_oauth_codes_immutable_consent",
      "mcp_oauth_grants_immutable_consent",
      "mcp_oauth_consent_previews_snapshot_valid",
      "mcp_oauth_consent_previews_immutable",
    ]) {
      expect(sql.slice(postflight, notify)).toContain(`'${objectName}'`);
    }
    expect(sql.slice(postflight, notify)).toContain(
      "mcp_oauth_consent_previews_expiry_idx"
    );

    for (const signature of [
      "private.mcp_oauth_scope_array(text)",
      "private.mcp_oauth_scope_array_is_valid(text[])",
      "private.mcp_oauth_labels_for_scopes(text[],text)",
      "private.enforce_mcp_oauth_consent_immutability()",
      "public.register_mcp_oauth_client_as_system(text,text[],text,text[],text,text,text,text)",
      "public.get_mcp_oauth_client_as_system(uuid)",
      "public.issue_mcp_oauth_consent_preview_as_system(text,uuid,uuid,uuid,text,text,text[],text[],text,text,text,text,text,text,timestamp with time zone)",
      "public.consume_mcp_oauth_consent_preview_as_system(text,uuid,uuid)",
      "public.create_mcp_oauth_authorization_code_as_system(text,uuid,uuid,uuid,text[],text[],text,text,text,text,text,timestamp with time zone)",
      "public.consume_mcp_oauth_authorization_code_as_system(text,uuid,text)",
      "public.mint_mcp_oauth_grant_as_system(text,uuid,uuid,uuid,text,text[],text,text,text,text,timestamp with time zone,timestamp with time zone)",
      "public.rotate_mcp_oauth_refresh_token_as_system(text,uuid,text[],text,text,timestamp with time zone,timestamp with time zone)",
      "public.resolve_mcp_oauth_access_token_as_system(text)",
    ]) {
      expect(sql.slice(postflight, notify)).toContain(`'${signature}'`);
    }

    expect(compact(runtimeSql())).toMatch(
      /\\ir \.\.\/\.\.\/supabase\/migrations\/20260823072837_mcp_oauth_consent_catalog_versioning\.sql/i
    );
  });

  it("rejects every unexpected non-owner ACL entry on replay", () => {
    const postflight = compact(migrationSql()).slice(
      compact(migrationSql()).indexOf("do $postflight$")
    );

    expect(postflight).toMatch(/where acl\.grantee <> v_function_owner/i);
    expect(postflight).toMatch(/where acl\.grantee <> v_table_owner/i);
    expect(postflight).not.toMatch(
      /role_row\.rolname in \('anon','authenticated','service_role'\)/i
    );
    expect(postflight).toContain(
      "coalesce(role_row.rolname, 'OID:' || acl.grantee::text)"
    );
    expect(postflight).toContain(
      "mcp_oauth_consent_function_signature_set_failed"
    );

    const functionAclWeakened = postflight.replace(
      /where acl\.grantee <> v_function_owner/gi,
      "where role_row.rolname in ('anon','authenticated','service_role')"
    );
    const tableAclWeakened = postflight.replace(
      /where acl\.grantee <> v_table_owner/gi,
      "where role_row.rolname in ('anon','authenticated','service_role')"
    );
    expect(functionAclWeakened).not.toMatch(
      /where acl\.grantee <> v_function_owner/i
    );
    expect(tableAclWeakened).not.toMatch(
      /where acl\.grantee <> v_table_owner/i
    );
  });

  it("requires the exact non-internal trigger set on every OAuth table", () => {
    const postflight = postflightSql();

    for (const tableName of [
      "mcp_oauth_clients",
      "mcp_oauth_authorization_codes",
      "mcp_oauth_grants",
      "mcp_oauth_consent_previews",
      "mcp_oauth_tokens",
    ]) {
      expect(postflight).toContain(`'${tableName}'`);
    }
    expect(postflight).toContain("mcp_oauth_consent_trigger_set_failed");
    expect(postflight).toMatch(/not trigger_row\.tgisinternal/i);
    expect(postflight).toMatch(/pg_catalog\.count\(\*\)/i);
    expect(postflight).toMatch(/mcp_oauth_tokens[\s\S]*?array\[\]::text\[\]/i);

    const runtime = compact(runtimeSql());
    expect(runtime).toContain("unexpected_oauth_trigger_collision_survived");
    expect(runtime).toContain("missing_oauth_trigger_collision_survived");
    expect(runtime.match(/array_agg\(trigger_row\.tgname::text/g)?.length).toBe(
      2
    );
  });

  it("postflights a closed-world owned function catalogue", () => {
    const postflight = postflightSql();

    for (const property of [
      "function_row.proowner",
      "function_row.prolang",
      "function_row.proisstrict",
      "function_row.proparallel",
      "function_row.prosecdef",
      "function_row.provolatile",
      "pg_catalog.pg_get_function_result",
    ]) {
      expect(postflight).toContain(property);
    }
    expect(postflight).toContain(
      "function_row.proowner = current_user::regrole"
    );
    expect(postflight).toContain("mcp_oauth_consent_function_shape_failed");
    for (const signature of [
      "private.prune_expired_mcp_oauth_artifacts()",
      "public.revoke_mcp_oauth_grant_as_system(uuid,uuid)",
      "public.revoke_mcp_oauth_token_as_system(text)",
      "public.list_mcp_oauth_grants_for_user_as_system(uuid,uuid)",
    ]) {
      expect(postflight).toContain(`'${signature}'`);
    }
  });

  it("postflights the full owned permanent table catalogue and legacy collision posture", () => {
    const postflight = postflightSql();

    for (const property of [
      "relation.relowner",
      "relation.relpersistence",
      "relation.relispartition",
      "relation.relrowsecurity",
      "relation.relforcerowsecurity",
      "pg_catalog.pg_rewrite",
    ]) {
      expect(postflight).toContain(property);
    }
    for (const marker of [
      "mcp_oauth_consent_table_shape_failed",
      "mcp_oauth_consent_column_set_failed",
      "mcp_oauth_consent_constraint_set_failed",
      "mcp_oauth_consent_index_set_failed",
      "mcp_oauth_consent_rule_set_failed",
    ]) {
      expect(postflight).toContain(marker);
    }
    expect(postflight).toContain("relation.relowner = current_user::regrole");
    expect(postflight).toContain("mcp_oauth_clients_name_bounded");
    expect(postflight).toContain("mcp_oauth_tokens_by_family");

    const runtime = compact(runtimeSql());
    expect(runtime).toContain("legacy_if_not_exists_collision_detected");
    expect(runtime).toContain("legacy_create_or_replace_collision_detected");
  });

  it("revokes and audits the exact closed-world column ACL vocabulary", () => {
    const sql = compact(migrationSql());
    const postflight = postflightSql();

    for (const tableName of [
      "mcp_oauth_clients",
      "mcp_oauth_authorization_codes",
      "mcp_oauth_grants",
      "mcp_oauth_tokens",
      "mcp_oauth_consent_previews",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all privileges \\([\\s\\S]*?\\) on table private\\.${tableName} from public, anon, authenticated, service_role`,
          "i"
        )
      );
    }
    expect(postflight).toContain("attribute.attacl");
    expect(postflight).toContain("pg_catalog.aclexplode(attribute.attacl)");
    expect(postflight).not.toContain("array[]::aclitem[]");
    expect(postflight).toContain("mcp_oauth_consent_column_acl_failed");
    expect(postflight).toMatch(/acl\.grantee <> relation\.relowner/i);

    const runtime = compact(runtimeSql());
    expect(runtime).toContain("legacy_column_acl_collision_survived");
    expect(runtime).toContain("pg_catalog.aclexplode(attribute.attacl)");
    expect(runtime).not.toContain("array[]::aclitem[]");
    expect(runtime).toMatch(
      /grant select \(client_name\) on private\.mcp_oauth_clients to authenticated/i
    );
  });

  it("rejects traditional inheritance in either direction and inherited columns", () => {
    const postflight = postflightSql();

    expect(postflight).toContain("pg_catalog.pg_inherits");
    expect(postflight).toContain("inheritance_row.inhrelid");
    expect(postflight).toContain("inheritance_row.inhparent");
    expect(postflight).toContain("mcp_oauth_consent_inheritance_failed");
    expect(postflight).toContain("attribute.attinhcount = 0");
    expect(postflight).toContain("attribute.attislocal");

    const runtime = compact(runtimeSql());
    expect(runtime).toContain("oauth_inheritance_child_collision_survived");
    expect(runtime).toContain("oauth_inheritance_parent_collision_survived");
    expect(runtime).toMatch(/alter table private\.mcp_oauth_tokens inherit/i);
    expect(runtime).toMatch(/inherits \(private\.mcp_oauth_clients\)/i);
  });

  it("aggregates every constraint before separately proving definitions and flags", () => {
    const postflight = postflightSql();
    const vocabularyMatch = postflight.match(
      /select coalesce\( pg_catalog\.array_agg\( constraint_row\.conname[\s\S]*?raise exception 'mcp_oauth_consent_constraint_set_failed:%'/i
    );
    expect(vocabularyMatch).toBeTruthy();
    const vocabulary = vocabularyMatch?.[0] ?? "";
    expect(vocabulary).not.toMatch(/and constraint_row\.convalidated/i);
    expect(vocabulary).not.toMatch(/and not constraint_row\.condeferrable/i);
    expect(vocabulary).not.toMatch(/and constraint_row\.conislocal/i);
    expect(vocabulary).not.toMatch(/and not constraint_row\.connoinherit/i);

    expect(postflight).toContain("pg_catalog.pg_get_constraintdef");
    expect(postflight).toContain(
      "mcp_oauth_consent_constraint_definition_failed"
    );
    expect(postflight).toContain("mcp_oauth_consent_constraint_flags_failed");

    const runtime = compact(runtimeSql());
    for (const marker of [
      "not_valid_constraint_collision_survived",
      "deferrable_constraint_collision_survived",
      "no_inherit_constraint_collision_survived",
      "inherited_constraint_collision_survived",
    ]) {
      expect(runtime).toContain(marker);
    }
  });

  it("pins PostgreSQL 17 canonical connoinherit by constraint kind", () => {
    const postflight = postflightSql();
    const runtime = compact(runtimeSql());

    // PostgreSQL 17 catalog-pg-constraint: PK/UNIQUE/FK constraints are
    // non-inheritable, while ordinary CHECK constraints inherit by default.
    for (const expected of [
      "mcp_oauth_clients_pkey:p:true",
      "mcp_oauth_authorization_codes_client_id_fkey:f:true",
      "mcp_oauth_grants_client_id_fkey:f:true",
      "mcp_oauth_tokens_grant_id_fkey:f:true",
      "mcp_oauth_tokens_kind:c:false",
    ]) {
      expect(postflight).toContain(expected);
    }
    expect(postflight).not.toMatch(
      /or constraint_row\.connoinherit[\s\S]*?mcp_oauth_consent_constraint_flags_failed/i
    );
    expect(postflight).toContain(
      "client_id->client_id:saa:true:false:false:true:0:true:0"
    );
    expect(runtime).toContain(
      "postgresql17_connoinherit_clean_catalog_mismatch"
    );
    expect(runtime).toMatch(
      /when constraint_row\.contype in \(\s*'p'::"char",\s*'u'::"char",\s*'f'::"char"\s*\) then true[\s\S]*?when constraint_row\.contype = 'c'::"char" then false/i
    );
  });

  it("pins incoming foreign keys and their internal trigger vocabulary", () => {
    const postflight = postflightSql();

    expect(postflight).toContain("constraint_row.confrelid");
    expect(postflight).toContain(
      "mcp_oauth_consent_incoming_foreign_key_set_failed"
    );
    expect(postflight).toContain(
      "mcp_oauth_consent_internal_trigger_set_failed"
    );
    for (const constraintName of [
      "mcp_oauth_authorization_codes_client_id_fkey",
      "mcp_oauth_grants_client_id_fkey",
      "mcp_oauth_tokens_grant_id_fkey",
    ]) {
      expect(postflight).toContain(constraintName);
    }
    expect(postflight).toContain("RI_FKey_check_ins");
    expect(postflight).toContain("RI_FKey_noaction_del");

    const runtime = compact(runtimeSql());
    expect(runtime).toContain("incoming_fk_cascade_collision_survived");
    expect(runtime).toContain("incoming_fk_restrict_collision_survived");
    expect(runtime).toMatch(/on delete cascade/i);
    expect(runtime).toMatch(/on delete restrict/i);
  });
});

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260727102500_external_api_authorization_foundation.sql"
);
const runnerPath = resolve(
  process.cwd(),
  "scripts/run-external-api-sql-contracts.mjs"
);
const sqlContractPath = resolve(
  process.cwd(),
  "tests/sql/external-api-authorization-contract.sql"
);
const packagePath = resolve(process.cwd(), "package.json");
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

function section(start: string, end?: string): string {
  const startIndex = source.indexOf(start.toLowerCase());
  expect(startIndex, `${start} marker missing`).toBeGreaterThanOrEqual(0);
  if (!end) return source.slice(startIndex);

  const endIndex = source.indexOf(end.toLowerCase(), startIndex + start.length);
  expect(endIndex, `${end} marker missing`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

const privateTables = [
  "external_api_principals",
  "external_api_principal_sources",
  "external_api_credentials",
  "lead_intake_sources",
  "lead_intake_forms",
  "external_api_request_audit",
  "external_api_network_fingerprints",
  "external_api_security_events",
  "external_lead_handles",
  "external_attribution_dictionary",
  "external_attribution_lookup_digests",
  "external_lead_source_projections",
  "external_lead_projection_state",
  "external_lead_projection_versions",
  "external_lead_projection_baselines",
] as const;

const publicWrappers = [
  "authenticate_external_api_credential_as_system",
  "list_external_api_settings_as_system",
  "create_lead_intake_source_as_system",
  "update_lead_intake_source_as_system",
  "create_external_api_credential_as_system",
  "update_external_api_credential_as_system",
  "rotate_external_api_credential_as_system",
  "revoke_external_api_credential_as_system",
  "record_external_api_request_audit_as_system",
  "purge_external_api_network_fingerprints_as_system",
] as const;

describe("external API authorization foundation migration", () => {
  it("exists and creates every private authorization, audit, source, and projection relation", () => {
    expect(existsSync(migrationPath)).toBe(true);

    for (const table of privateTables) {
      expect(source).toContain(`create table private.${table}`);
      expect(source).toContain(
        `alter table private.${table} enable row level security`
      );
    }
  });

  it("models durable grants while keeping long-lived server-key classes separate", () => {
    const principals = section(
      "create table private.external_api_principals",
      "create table private.external_api_principal_sources"
    );

    expect(principals).toContain("'server_key'");
    expect(principals).toContain("'oauth_installation'");
    expect(principals).toContain("'intake'");
    expect(principals).toContain("'analytics'");
    expect(principals).toContain("'oauth'");
    expect(principals).toContain("'intake.write'");
    expect(principals).toContain("'analytics.leads.read'");
    expect(principals).toContain("'analytics.financial.read'");
    expect(principals).toMatch(
      /analytics\.financial\.read[\s\S]*analytics\.leads\.read/
    );
    expect(principals).toContain("authorization_epoch");
    expect(principals).toContain("credential_family_id");
    expect(principals).toMatch(/unique\s*\(credential_family_id\)/);
    expect(principals).toContain("company_id");
  });

  it("keeps intake-source authorization normalized and tenant bound", () => {
    const grants = section(
      "create table private.external_api_principal_sources",
      "create table private.external_api_credentials"
    );

    expect(grants).toContain("principal_id");
    expect(grants).toContain("source_id");
    expect(grants).toContain("company_id");
    expect(grants).toMatch(
      /foreign key\s*\(principal_id,\s*company_id\)[\s\S]*external_api_principals/
    );
    expect(grants).toMatch(
      /foreign key\s*\(source_id,\s*company_id\)[\s\S]*lead_intake_sources/
    );
  });

  it("stores only versioned credential digests and complete lifecycle evidence", () => {
    const credentials = section(
      "create table private.external_api_credentials",
      "create table private.external_api_request_audit"
    );

    expect(credentials).toContain("digest_version");
    expect(credentials).toContain("secret_digest");
    expect(credentials).toContain("visible_prefix");
    expect(credentials).toContain("issued_authorization_epoch");
    expect(credentials).toContain("expires_at");
    expect(credentials).toContain("overlap_until");
    expect(credentials).toContain("revoked_at");
    expect(credentials).toContain("last_used_at");
    expect(credentials).toContain("last_rejected_at");
    expect(credentials).toContain("rejection_count");
    expect(credentials).toMatch(/octet_length\(secret_digest\)\s*=\s*32/);
    expect(credentials).toMatch(/interval\s+'24 hours'/);
    expect(credentials).not.toMatch(/\braw_secret\b|\bauthorization_header\b/);
  });

  it("creates opaque sources with a stable default form and guarded owner configuration", () => {
    const sources = section(
      "create table private.lead_intake_sources",
      "create table private.external_api_principal_sources"
    );

    expect(sources).toContain("public_source_id");
    expect(sources).toContain("canonical_host");
    expect(sources).toContain("default_phone_region");
    expect(sources).toContain("allowed_browser_origins");
    expect(sources).toContain("default_coarse_source");
    expect(sources).toContain("default_intake_owner_id");
    expect(sources).toContain("create table private.lead_intake_forms");
    expect(sources).toContain("public_form_id");
    expect(sources).toContain("form_key");
    expect(sources).toContain("'default'");
    expect(sources).toContain("is_default");
  });

  it("separates durable request audit identity from purgeable network evidence", () => {
    const audit = section(
      "create table private.external_api_request_audit",
      "create table private.external_api_security_events"
    );

    expect(audit).toMatch(/request_id\s+uuid\s+primary key/);
    expect(audit).toContain("base_recorded_at");
    expect(audit).toContain("finalized_at");
    expect(audit).toContain("response_class");
    expect(audit).toContain("duration_ms");
    expect(audit).toContain("rate_limit_result");
    expect(audit).toContain("idempotency_result");
    expect(audit).toContain("cache_result");
    expect(audit).toContain(
      "create table private.external_api_network_fingerprints"
    );
    expect(audit).toContain("fingerprint_digest");
    expect(audit).toContain("expires_at");
    expect(audit).toMatch(/interval\s+'30 days'/);
  });

  it("makes credential and security evidence append only", () => {
    const events = section(
      "create table private.external_api_security_events",
      "create table private.external_lead_handles"
    );

    expect(events).toContain("event_type");
    expect(events).toContain("authorization_epoch");
    expect(events).toContain("actor_user_id");
    expect(source).toContain(
      "create or replace function private.reject_external_api_audit_mutation"
    );
    expect(source).toContain(
      "create trigger external_api_security_events_append_only"
    );
    expect(source).toContain(
      "external_api_security_events_credential_rejection_time_idx"
    );
    expect(source).toMatch(
      /before update or delete[\s\S]*external_api_security_events/
    );
  });

  it("keeps random public handles separate from versioned keyed attribution lookups", () => {
    const projection = section(
      "create table private.external_lead_handles",
      "-- authorization helpers"
    );

    expect(projection).toContain("public_lead_id");
    expect(projection).toContain(
      "create table private.external_attribution_dictionary"
    );
    expect(projection).toContain("public_attribution_id");
    expect(projection).toContain(
      "create table private.external_attribution_lookup_digests"
    );
    expect(projection).toContain("lookup_key_version");
    expect(projection).toContain("lookup_digest");
    expect(projection).toMatch(
      /foreign key\s*\(dictionary_id,\s*company_id\)[\s\S]*external_attribution_dictionary/
    );
  });

  it("provides company-monotonic immutable versions and one current baseline", () => {
    const projection = section(
      "create table private.external_lead_projection_state",
      "-- authorization helpers"
    );

    expect(projection).toContain("high_water_sequence");
    expect(projection).toContain(
      "create table private.external_lead_projection_versions"
    );
    expect(projection).toContain(
      "create table private.external_lead_projection_baselines"
    );
    expect(projection).toContain("projection_schema_version");
    expect(projection).toContain("source_record_updated_at");
    expect(projection).toMatch(/unique\s*\(company_id,\s*change_sequence\)/);
    expect(projection).toMatch(/primary key\s*\(company_id,\s*handle_id\)/);
  });

  it("installs one private append helper for atomic handle, source, version, and baseline writes", () => {
    const helper = section(
      "create or replace function private.append_external_lead_projection_foundation",
      "-- management wrappers"
    );

    expect(helper).toContain("security definer");
    expect(helper).toMatch(
      /set search_path\s*(?:to|=)\s*'?(?:pg_catalog)'?,\s*'?(?:public)'?,\s*'?(?:private)'?,\s*'?(?:pg_temp)'?/
    );
    expect(helper).toContain("private.external_lead_handles");
    expect(helper).toContain("private.external_lead_source_projections");
    expect(helper).toContain("private.external_lead_projection_state");
    expect(helper).toContain("private.external_lead_projection_versions");
    expect(helper).toContain("private.external_lead_projection_baselines");
    expect(helper).toContain("p_projection_schema_version is null");
    expect(helper).toContain("p_operation is null");
    expect(helper).toContain("p_normalized_source_projection is null");
    expect(helper).toContain("p_public_projection is null");
    expect(helper).toContain("return query");
  });

  it("exposes only fixed service-role wrappers and revokes private execution", () => {
    for (const wrapper of publicWrappers) {
      expect(source).toContain(`create or replace function public.${wrapper}`);
      expect(source).toMatch(
        new RegExp(
          `revoke all on function public\\.${wrapper}[\\s\\S]*?from public, anon, authenticated, service_role`
        )
      );
      expect(source).toMatch(
        new RegExp(
          `grant execute on function public\\.${wrapper}[\\s\\S]*?to service_role`
        )
      );
    }

    expect(source).toMatch(
      /revoke all on function private\.append_external_lead_projection_foundation[\s\S]*from public, anon, authenticated, service_role/
    );
    expect(source).not.toMatch(/\bexecute\s+format\s*\(|\bformat\s*\(\s*['"`]/);
  });

  it("revalidates management actor, company, permission, and feature gate in the database", () => {
    const feature = section(
      "create or replace function private.external_api_company_feature_enabled",
      "create or replace function private.require_external_api_management_actor"
    );
    const helper = section(
      "create or replace function private.require_external_api_management_actor",
      "create or replace function private.append_external_api_security_event"
    );

    expect(helper).toContain("public.users");
    expect(helper).toContain("deleted_at is null");
    expect(helper).toContain("is_active");
    expect(helper).toContain("settings.integrations");
    expect(helper).toContain("'all'");
    expect(helper).toContain("lock_external_api_company_exclusive");
    expect(helper).toContain("feature_enabled");
    expect(feature).toContain("public.admin_feature_overrides");
    expect(feature).toContain("'external_api'");
  });

  it("serializes live authorization against every company security mutation", () => {
    const auth = section(
      "create or replace function public.authenticate_external_api_credential_as_system",
      "create or replace function public.list_external_api_settings_as_system"
    );

    expect(source).toContain(
      "create or replace function private.lock_external_api_company_shared"
    );
    expect(source).toContain(
      "create or replace function private.lock_external_api_company_exclusive"
    );
    expect(source).toContain(
      "create trigger admin_feature_overrides_external_api_lock"
    );
    expect(source).toMatch(
      /revoke all on function private\.lock_external_api_company_shared\(uuid\)[\s\S]*?from public, anon, authenticated, service_role/
    );
    expect(source).toMatch(
      /revoke all on function private\.lock_external_api_company_exclusive\(uuid\)[\s\S]*?from public, anon, authenticated, service_role/
    );
    expect(source).toMatch(
      /revoke all on function private\.lock_external_api_feature_override_mutation\(\)[\s\S]*?from public, anon, authenticated, service_role/
    );
    expect(auth.indexOf("lock_external_api_company_shared")).toBeLessThan(
      auth.indexOf("for update")
    );
  });

  it("binds authentication to digest, principal epoch, class scopes, source grants, and the live feature gate", () => {
    const auth = section(
      "create or replace function public.authenticate_external_api_credential_as_system",
      "create or replace function public.list_external_api_settings_as_system"
    );

    expect(auth).toContain("service_role");
    expect(auth).toContain("secret_digest");
    expect(auth).toContain("digest_version");
    expect(auth).toContain("visible_prefix");
    expect(auth).toContain("issued_authorization_epoch");
    expect(auth).toContain("authorization_epoch");
    expect(auth).toContain("overlap_until");
    expect(auth).toContain("expires_at");
    expect(auth).toContain("revoked_at");
    expect(auth).toContain("external_api_principal_sources");
    expect(auth).toContain("external_api_company_feature_enabled");
    expect(auth).toContain("'feature_disabled'");
    expect(auth.indexOf("for update")).toBeLessThan(auth.indexOf("for share"));
    expect(auth).not.toMatch(
      /set last_rejected_at[\s\S]*?updated_at\s*=\s*clock_timestamp\(\)/
    );
    expect(auth).not.toMatch(
      /set last_used_at[\s\S]*?updated_at\s*=\s*clock_timestamp\(\)/
    );
  });

  it("limits rotation overlap and preserves the authorization principal", () => {
    const rotate = section(
      "create or replace function public.rotate_external_api_credential_as_system",
      "create or replace function public.revoke_external_api_credential_as_system"
    );
    const revoke = section(
      "create or replace function public.revoke_external_api_credential_as_system",
      "create or replace function public.record_external_api_request_audit_as_system"
    );

    expect(rotate).toContain("86400");
    expect(rotate).toContain("principal_id");
    expect(rotate).toContain("issued_authorization_epoch");
    expect(rotate).not.toContain("insert into private.external_api_principals");
    expect(
      rotate.indexOf("v_rotation_at := clock_timestamp()")
    ).toBeGreaterThan(rotate.indexOf("for update"));
    expect(revoke.indexOf("v_revoked_at := clock_timestamp()")).toBeGreaterThan(
      revoke.indexOf("for update")
    );
  });

  it("rejects nullable management state instead of treating it as revocation", () => {
    const updateSource = section(
      "create or replace function public.update_lead_intake_source_as_system",
      "create or replace function public.create_external_api_credential_as_system"
    );

    expect(updateSource).toContain("p_active is null");
  });

  it("supports authenticated base audit insertion and redacted post-response finalization", () => {
    const base = section(
      "create or replace function private.insert_external_api_authenticated_audit_base",
      "create or replace function private.append_external_lead_projection_foundation"
    );
    const finalizer = section(
      "create or replace function public.record_external_api_request_audit_as_system",
      "create or replace function public.purge_external_api_network_fingerprints_as_system"
    );

    expect(base).toContain("insert into private.external_api_request_audit");
    expect(base).toContain("request_id");
    expect(base).toContain("principal_id");
    expect(base).toContain("credential_id");
    expect(base).not.toContain("on conflict");
    expect(base.indexOf("for share")).toBeGreaterThanOrEqual(0);
    expect(base).toContain("external_api_company_feature_enabled");
    expect(finalizer).toContain("'pre_auth'");
    expect(finalizer).toContain("'finalize'");
    expect(finalizer).toContain("update private.external_api_request_audit");
    expect(finalizer).not.toMatch(
      /\bauthorization\b|\braw_secret\b|\brequest_body\b|\bsigned_url\b/
    );
  });

  it("revokes direct table access and enables RLS on all private relations", () => {
    for (const table of privateTables) {
      expect(source).toContain(
        `alter table private.${table} enable row level security`
      );
      expect(source).toMatch(
        new RegExp(
          `revoke all on table private\\.${table}[\\s\\S]*?from public, anon, authenticated`
        )
      );
    }
  });

  it("installs a deterministic, disposable-only, multi-session SQL contract runner", () => {
    expect(existsSync(runnerPath)).toBe(true);
    const runner = existsSync(runnerPath)
      ? readFileSync(runnerPath, "utf8")
      : "";
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["test:external-api:sql"]).toBe(
      "node scripts/run-external-api-sql-contracts.mjs"
    );
    expect(runner).toContain("external-");
    expect(runner).toContain(".sort(");
    expect(runner).toContain("ON_ERROR_STOP");
    expect(runner).toContain("--allow-disposable-branch");
    expect(runner).toContain("--expected-project-ref");
    expect(runner).toContain("sessions.json");
    expect(runner).toContain("statement_timeout");
    expect(runner).toContain("lock_timeout");
    expect(runner).toContain("application_name");
    expect(runner).toContain("pg_stat_activity");
    expect(runner).toContain("OPS_EXTERNAL_API_SQL_CONTRACT_PASS");
    expect(runner).toContain("if (!/^\\d+$/.test(normalizedOutput))");
    expect(runner).not.toContain("...process.env");
    expect(runner).toContain('PGPASSFILE: "/dev/null"');
    expect(runner).toContain('isLoopback ? "disable" : "verify-full"');
    expect(runner).toContain("PGSSLROOTCERT");
    expect(runner).toContain("EXTERNAL_API_SQL_SSL_ROOT_CERT");
    expect(runner).toContain("FORBIDDEN_PROJECT_REFS");
    expect(runner).toContain("ijeekuhbatykdomumfjx");
    expect(runner).toContain('hostname.includes(",")');
    expect(runner).toContain("username === `postgres.${expectedProjectRef}`");
    expect(runner).toContain("assertNotCancelled");
    expect(runner).toContain("normalizeHostname");
    expect(runner).toContain("cancellationExitCode");
    expect(runner).toContain("127.0.0.1");
    expect(runner).toContain("localhost");
  });

  it("ships a rollback-only executable tenant and credential security contract", () => {
    expect(existsSync(sqlContractPath)).toBe(true);
    const contract = existsSync(sqlContractPath)
      ? readFileSync(sqlContractPath, "utf8").toLowerCase()
      : "";

    expect(contract.trimStart()).toMatch(/^begin;/);
    expect(contract.trimEnd()).toMatch(/rollback;$/);
    expect(contract).not.toContain("user_type");
    expect(contract).not.toContain("insert into public.user_roles");
    expect(contract).toContain("set constraints all immediate");
    expect(contract).toContain(
      "external_api_authorization_contract_check_set_changed"
    );
    expect(contract).toContain("null_create_forms_means_default_only");
    expect(contract).toContain("null_update_forms_preserves_custom_forms");
    expect(contract).toContain("nullable_default_source_denied");
    expect(contract).toContain("nullable_source_active_denied");
    expect(contract).toContain("nullable_credential_class_denied");
    expect(contract).toContain("nullable_credential_scopes_denied");
    expect(contract).toContain("nullable_audit_phase_denied");
    expect(contract).toContain("fingerprint_prefix_without_digest_denied");
    expect(contract).toContain(
      "inactive_source_cannot_create_authenticated_audit"
    );
    expect(contract).toContain("cross_company_actor_denied");
    expect(contract).toContain("cross_company_source_denied");
    expect(contract).toContain("mixed_server_key_scope_denied");
    expect(contract).toContain("financial_without_lead_read_denied");
    expect(contract).toContain("expired_credential_denied");
    expect(contract).toContain("old_epoch_credential_denied");
    expect(contract).toContain("revoked_credential_denied");
    expect(contract).toContain(
      "revoked_credential_cannot_create_authenticated_audit"
    );
    expect(contract).toContain("rotation_preserves_principal");
    expect(contract).toContain("private_tables_deny_app_roles");
    expect(contract).toContain("public_wrappers_are_service_only");
    expect(contract).toContain("audit_surface_has_no_sensitive_fields");
    expect(contract).toContain("audit_finalization_failure_preserves_base");
    expect(contract).toContain("projection_versions_are_append_only");
    expect(contract).toContain(
      "set_config('ops.external_projection_refreshing', 'on', true)"
    );
    expect(contract).toContain(
      "set_config('ops.external_projection_refreshing', 'off', true)"
    );
    expect(contract).toContain("request.jwt.claim.role");
    expect(contract).toContain("has_function_privilege");
    expect(contract).toContain("has_table_privilege");
    expect(contract).toContain("ops_external_api_sql_contract_pass");
  });
});

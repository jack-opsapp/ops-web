import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260726211000_external_intake_upload_foundation.sql"
);
const contractPath = resolve(
  process.cwd(),
  "tests/sql/external-intake-upload-contract.sql"
);
const sessionManifestPath = resolve(
  process.cwd(),
  "tests/sql/external-intake-upload-contract.sessions.json"
);
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
  "external_intake_upload_batches",
  "external_intake_upload_intents",
  "external_intake_company_quota_locks",
  "external_intake_rolling_byte_reservations",
  "external_intake_pending_object_reservations",
  "external_intake_scan_slot_reservations",
  "external_intake_cleanup_reservations",
] as const;

const serviceWrappers = [
  "reserve_external_intake_upload_batch_as_system",
  "release_external_intake_upload_batch_as_system",
  "record_external_intake_uploaded_object_as_system",
] as const;

describe("external intake upload foundation migration", () => {
  it("creates every private replay, quota, scan, and cleanup relation", () => {
    expect(existsSync(migrationPath)).toBe(true);
    for (const table of privateTables) {
      expect(source).toContain(`create table private.${table}`);
      expect(source).toMatch(
        new RegExp(
          `alter table private\\.${table}\\s+enable row level security`
        )
      );
      expect(source).toMatch(
        new RegExp(
          `revoke all on table private\\.${table}[\\s\\S]*?from public, anon, authenticated`
        )
      );
    }
  });

  it("scopes idempotency to principal, source, form, and a versioned canonical manifest", () => {
    const batches = section(
      "create table private.external_intake_upload_batches",
      "create table private.external_intake_upload_intents"
    );

    expect(batches).toContain("principal_id");
    expect(batches).toContain("source_id");
    expect(batches).toContain("form_id");
    expect(batches).toContain("idempotency_digest");
    expect(batches).toContain("manifest_hash_version");
    expect(batches).toContain("manifest_hash");
    expect(batches).toMatch(
      /unique\s*\(\s*principal_id,\s*idempotency_digest_version,\s*idempotency_digest\s*\)/
    );
    expect(batches).toMatch(/octet_length\(manifest_hash\)\s*=\s*32/);
  });

  it("enforces the exact upload state machine and immutable object evidence", () => {
    const intents = section(
      "create table private.external_intake_upload_intents",
      "create table private.external_intake_company_quota_locks"
    );
    for (const state of [
      "issued",
      "uploaded",
      "claimed",
      "pending_inspection",
      "accepted",
      "rejected",
      "closed_missing",
      "expired",
    ]) {
      expect(intents).toContain(`'${state}'`);
    }
    expect(intents).toContain("object_version_id");
    expect(intents).toContain("observed_checksum_sha256");
    expect(intents).toContain("observed_size_bytes");
    expect(intents).toContain("capability_expires_at");
    expect(intents).toContain("delete_not_before");
    expect(source).toContain(
      "create or replace function private.guard_external_intake_upload_transition"
    );
    expect(source).toContain("external_intake_upload_object_conflict");
  });

  it("serializes quota checks under a company-first row lock", () => {
    const reservation = section(
      "create or replace function public.reserve_external_intake_upload_batch_as_system",
      "create or replace function public.release_external_intake_upload_batch_as_system"
    );

    expect(reservation).toContain(
      "insert into private.external_intake_company_quota_locks"
    );
    expect(reservation).toContain("for update");
    expect(reservation.indexOf("for update")).toBeLessThan(
      reservation.indexOf("external_intake_rolling_byte_reservations")
    );
    expect(reservation).toContain("1073741824");
    expect(reservation).toContain("52428800");
    expect(reservation).toContain("26214400");
    expect(reservation).toContain("jsonb_array_length(p_files)");
    expect(source).toContain(
      "create or replace function private.acquire_external_intake_scan_slot"
    );
    expect(source).toContain(">= 5");
  });

  it("revalidates digest, epoch, scope, company, source, form, and optional origin", () => {
    const reservation = section(
      "create or replace function public.reserve_external_intake_upload_batch_as_system",
      "create or replace function public.release_external_intake_upload_batch_as_system"
    );

    expect(reservation).toContain("private.require_external_intake_credential");
    expect(source).toContain("credential.secret_digest = p_credential_digest");
    expect(reservation).toContain("digest_version");
    expect(reservation).toContain("visible_prefix");
    expect(source).toContain("credential.issued_authorization_epoch");
    expect(reservation).toContain("authorization_epoch");
    expect(source).toContain("array['intake.write']::text[]");
    expect(reservation).toContain("external_api_principal_sources");
    expect(reservation).toContain("lead_intake_sources");
    expect(reservation).toContain("lead_intake_forms");
    expect(reservation).toContain("allowed_browser_origins");
    expect(reservation).toContain("p_requested_origin is not null");
    expect(reservation).not.toContain("origin_authentication");
  });

  it("returns safe statuses while keeping storage/provider internals private", () => {
    const reservation = section(
      "create or replace function public.reserve_external_intake_upload_batch_as_system",
      "create or replace function public.release_external_intake_upload_batch_as_system"
    );

    expect(reservation).toContain("'new'");
    expect(reservation).toContain("'replay'");
    expect(reservation).toContain("'conflict'");
    expect(reservation).toContain("'expired'");
    expect(reservation).toContain("'quota_exceeded'");
    expect(reservation).toContain("public_upload_id");
    expect(reservation).not.toContain("bucket_name");
    const resultBuilder = section(
      "create or replace function private.external_intake_upload_batch_result",
      "create or replace function private.expire_external_intake_reservations"
    );
    expect(resultBuilder).not.toContain("storage_object_key");
    expect(resultBuilder).not.toContain("expected_checksum_sha256");
    expect(resultBuilder).not.toContain("object_version_id");
  });

  it("exposes only fixed service-role wrappers", () => {
    for (const wrapper of serviceWrappers) {
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
  });

  it("ships a rollback-only race and state contract", () => {
    expect(existsSync(contractPath)).toBe(true);
    const contract = existsSync(contractPath)
      ? readFileSync(contractPath, "utf8").toLowerCase()
      : "";

    expect(contract.trimStart()).toMatch(/^begin;/);
    expect(contract.trimEnd()).toMatch(/rollback;$/);
    expect(contract).toContain("exact_replay_does_not_reserve_twice");
    expect(contract).toContain("changed_manifest_conflicts");
    expect(contract).toContain("expired_batch_returns_expired");
    expect(contract).toContain("cross_source_denied");
    expect(contract).toContain("cross_form_denied");
    expect(contract).toContain("origin_mismatch_denied");
    expect(contract).toContain("immutable_object_evidence");
    expect(contract).toContain("quota_concurrency_cannot_oversubscribe");
    expect(contract).toContain("ops_external_api_sql_contract_pass");
    expect(existsSync(sessionManifestPath)).toBe(true);
  });
});

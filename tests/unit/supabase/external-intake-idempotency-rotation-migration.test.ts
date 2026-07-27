import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260726212500_external_intake_idempotency_rotation.sql"
);
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const contractPath = resolve(
  process.cwd(),
  "tests/sql/external-intake-upload-contract.sql"
);
const contract = existsSync(contractPath)
  ? readFileSync(contractPath, "utf8").toLowerCase()
  : "";

describe("external intake idempotency rotation migration", () => {
  it("adds a guarded rotating upload command without exposing private state", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(source).toContain(
      "create or replace function public.reserve_external_intake_upload_batch_rotating_as_system"
    );
    expect(source).toContain("private.require_external_api_service_role()");
    expect(source).toContain("private.require_external_intake_credential(");
    expect(source).toContain("p_idempotency_candidates");
    expect(source).toContain("jsonb_array_elements(p_idempotency_candidates)");
    expect(source).toContain("for update");
    expect(source).toContain(
      "public.reserve_external_intake_upload_batch_as_system("
    );
  });

  it("locks company-first, rejects split ledgers, and writes only the active digest", () => {
    const lockIndex = source.indexOf(
      "insert into private.external_intake_company_quota_locks"
    );
    const lookupIndex = source.indexOf(
      "from private.external_intake_upload_batches batch"
    );
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(lookupIndex).toBeGreaterThan(lockIndex);
    expect(source).toContain("external_intake_idempotency_split_brain");
    expect(source).toContain("v_selected_digest_version");
    expect(source).toContain("p_idempotency_digest_version");
    expect(source).toContain("p_idempotency_digest");
  });

  it("is callable only by service role", () => {
    expect(source).toMatch(
      /revoke all on function public\.reserve_external_intake_upload_batch_as_system[\s\S]*?from public, anon, authenticated, service_role/
    );
    expect(source).toMatch(
      /revoke all on function public\.reserve_external_intake_upload_batch_rotating_as_system[\s\S]*?from public, anon, authenticated, service_role/
    );
    expect(source).toMatch(
      /grant execute on function public\.reserve_external_intake_upload_batch_rotating_as_system[\s\S]*?to service_role/
    );
  });

  it("extends the rollback-only SQL contract with an old-key replay", () => {
    expect(contract).toContain("idempotency_key_rotation_replays_original");
    expect(contract).toContain(
      "public.reserve_external_intake_upload_batch_rotating_as_system("
    );
    expect(contract.trimEnd()).toMatch(/rollback;$/);
  });
});

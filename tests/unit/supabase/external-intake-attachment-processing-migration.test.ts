import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260727102700_external_intake_attachment_processing.sql"
);
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

const privateTables = [
  "external_intake_object_events",
  "external_intake_guardduty_results",
  "external_intake_inspection_jobs",
  "external_intake_delivery_objects",
] as const;

const serviceFunctions = [
  "record_external_intake_object_event_as_system",
  "claim_external_intake_inspections_as_system",
  "finish_external_intake_inspection_as_system",
  "claim_external_intake_cleanups_as_system",
  "finish_external_intake_cleanup_as_system",
  "maintain_external_intake_files_as_system",
  "stage_external_intake_delivery_as_system",
  "record_external_intake_delivery_as_system",
  "abandon_external_intake_delivery_as_system",
  "claim_external_intake_delivery_cleanups_as_system",
  "finish_external_intake_delivery_cleanup_as_system",
] as const;

describe("external intake attachment processing migration", () => {
  it("creates private idempotency, malware, and durable inspection state", () => {
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
          `revoke all on table private\\.${table}[\\s\\S]*?service_role`
        )
      );
    }
    expect(source).toContain("provider_event_id");
    expect(source).toContain("object_version_id");
    expect(source).toContain("guardduty_status");
    expect(source).toContain("deadline_at");
    expect(source).toContain("lease_token");
    expect(source).toContain("generation");
    expect(source).toContain("accepted-original/");
    expect(source).toContain("safe-derivative/");
  });

  it("uses company-scoped leases, generation fences, and bounded claims", () => {
    expect(source).toContain("for update skip locked");
    expect(source).toContain("private.acquire_external_intake_scan_slot");
    expect(source).toContain("external_intake_scan_slot_reservations");
    expect(source).toContain("p_generation");
    expect(source).toContain("p_lease_token");
    expect(source).toContain("p_limit between 1 and 25");
    expect(source).toContain("interval '24 hours'");
  });

  it("keeps cleanup retryable and honors the create-only capability window", () => {
    expect(source).toContain("delete_not_before");
    expect(source).toContain("capability_expires_at");
    expect(source).toContain("state = 'pending'");
    expect(source).toContain("attempt_count = cleanup.attempt_count + 1");
    expect(source).not.toContain("max_cleanup_attempt");
    expect(source).toContain("p_object_version_id");
    expect(source).toContain("state = 'delete_pending'");
    expect(source).toContain("p_observed_object_version_id");
  });

  it("durably retires expired credential overlap windows in bounded batches", () => {
    expect(source).toContain("credentials_retired");
    expect(source).toContain("credential.status = 'overlap'");
    expect(source).toContain("credential.overlap_until <= clock_timestamp()");
    expect(source).toContain("set status = 'retired'");
    expect(source).toContain("retired_at = clock_timestamp()");
    expect(source).toContain("overlap_started_at = null");
    expect(source).toContain("overlap_until = null");
  });

  it("exposes only fixed service-role functions", () => {
    for (const functionName of serviceFunctions) {
      expect(source).toContain(
        `create or replace function public.${functionName}`
      );
      expect(source).toMatch(
        new RegExp(
          `revoke all on function public\\.${functionName}[\\s\\S]*?from public, anon, authenticated, service_role`
        )
      );
      expect(source).toMatch(
        new RegExp(
          `grant execute on function public\\.${functionName}[\\s\\S]*?to service_role`
        )
      );
    }
  });
});

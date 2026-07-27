import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260726214000_external_intake_lead_file_access.sql"
);
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

describe("external intake lead file access migration", () => {
  it("keeps source evidence and project representations private", () => {
    expect(existsSync(migrationPath)).toBe(true);
    for (const table of [
      "external_intake_project_file_relationships",
      "external_intake_project_file_projection_outbox",
      "external_intake_legal_holds",
      "external_intake_erasure_outbox",
      "external_intake_upload_erasure_write_tokens",
    ]) {
      expect(source).toContain(`create table private.${table}`);
      expect(source).toMatch(
        new RegExp(
          `alter table private\\.${table}\\s+enable row level security`
        )
      );
      expect(source).toMatch(
        new RegExp(
          `revoke all on table private\\.${table}[\\s\\S]*?from public, anon, authenticated, service_role`
        )
      );
    }
    expect(source).toContain(
      "never writes to the public project-photos bucket"
    );
    expect(source).not.toContain("insert into public.project_photos");
  });

  it("converges conversion-before-scan and scan-before-conversion", () => {
    expect(source).toContain(
      "external_intake_project_files_on_opportunity_link"
    );
    expect(source).toContain(
      "external_intake_project_file_on_attachment_accept"
    );
    expect(source).toContain("unique (project_id, intent_id)");
    expect(source).toContain(
      "claim_external_intake_project_file_projections_as_system"
    );
    expect(source).toContain(
      "finish_external_intake_project_file_projection_as_system"
    );
    expect(source).toContain("for update skip locked");
    expect(source).toContain("lease_generation");
    expect(source).toContain("lease_token");
  });

  it("returns allowlisted descriptors and resolves capabilities only after access recheck", () => {
    expect(source).toContain("external_intake_attachment_descriptors");
    expect(source).toContain("resolve_external_intake_attachment_as_system");
    expect(source).toContain("authorize_opportunity_action_as_system");
    expect(source).toContain("'preview_url'");
    expect(source).toContain("'download_url'");
    expect(source).not.toMatch(
      /'preview_url'\s*,\s*(?:delivery|intent)\.storage_object_key/
    );
    expect(source).not.toMatch(
      /'download_url'\s*,\s*(?:delivery|intent)\.storage_object_key/
    );
  });

  it("blocks visibility first and erases every private representation behind a legal-hold gate", () => {
    expect(source).toContain("request_external_intake_erasure_as_system");
    expect(source).toMatch(
      /request_external_intake_erasure_as_system[\s\S]*?authorize_opportunity_action_as_system\([\s\S]*?'edit'[\s\S]*?public\.has_permission\([\s\S]*?'pipeline\.manage'[\s\S]*?'all'/
    );
    expect(source).toContain("claim_external_intake_erasures_as_system");
    expect(source).toContain("finish_external_intake_erasure_as_system");
    expect(source).toContain("external_intake_legal_holds");
    expect(source).toContain("clock_timestamp() + interval '6 minutes'");
    expect(source).toContain(
      'raw_source_payload = \'{"state":"privacy_erased"}\''
    );
    expect(source).toContain("normalized_email = null");
    expect(source).toContain("normalized_phone = null");
    expect(source).toContain(
      "delete from private.external_intake_project_file_relationships"
    );
    expect(source).toContain(
      "delete from private.external_intake_project_file_projection_outbox"
    );
    expect(source).toContain("original_filename = 'privacy-erased'");
    expect(source).toContain("'deletion'");
    expect(source).toContain("invalidation_reference");
  });

  it("publishes only guarded browser reads and service-only worker commands", () => {
    expect(source).toMatch(
      /grant execute on function public\.get_opportunity_assigned_context\(uuid\)[\s\S]*?to anon, authenticated/
    );
    expect(source).toMatch(
      /grant execute on function public\.list_project_intake_files\(uuid\)[\s\S]*?to anon, authenticated/
    );
    for (const functionName of [
      "resolve_external_intake_attachment_as_system",
      "claim_external_intake_project_file_projections_as_system",
      "finish_external_intake_project_file_projection_as_system",
      "request_external_intake_erasure_as_system",
      "claim_external_intake_erasures_as_system",
      "finish_external_intake_erasure_as_system",
    ]) {
      expect(source).toMatch(
        new RegExp(
          `grant execute on function\\s+public\\.${functionName}[\\s\\S]*?to service_role`
        )
      );
    }
  });
});

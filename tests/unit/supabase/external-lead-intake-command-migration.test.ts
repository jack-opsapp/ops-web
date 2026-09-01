import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260727102900_external_lead_intake_command.sql"
);
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const contractPath = resolve(
  process.cwd(),
  "tests/sql/external-lead-intake-contract.sql"
);
const contract = existsSync(contractPath)
  ? readFileSync(contractPath, "utf8").toLowerCase()
  : "";
const concurrencyContractPath = resolve(
  process.cwd(),
  "tests/sql/external-lead-intake-concurrency-contract.sql"
);
const concurrencyManifestPath = resolve(
  process.cwd(),
  "tests/sql/external-lead-intake-concurrency-contract.sessions.json"
);
const concurrencyWriterPath = resolve(
  process.cwd(),
  "tests/sql/external-lead-intake-concurrency-writer.psql"
);
const concurrencyContenderPath = resolve(
  process.cwd(),
  "tests/sql/external-lead-intake-concurrency-contender.psql"
);

const privateTables = [
  "external_contact_identities",
  "external_intake_submissions",
  "external_intake_submission_replay_digests",
  "external_intake_submission_uploads",
  "external_intake_possible_duplicates",
  "external_intake_post_commit_outbox",
] as const;

describe("external lead intake command migration", () => {
  it("creates an immutable private evidence and replay ledger", () => {
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
          `revoke all on table private\\.${table}[\\s\\S]*?from public, anon, authenticated, service_role`
        )
      );
    }
    expect(source).toContain("canonical_request_hash");
    expect(source).toContain("canonicalization_version");
    expect(source).toContain("evidence_schema_version");
    expect(source).toContain("original_contact");
    expect(source).toContain("original_organization");
    expect(source).toContain("original_work");
    expect(source).toContain("original_service_address");
    expect(source).toContain("ordered_answers");
    expect(source).toContain("raw_attribution");
    expect(source).toContain("raw_source_payload");
    expect(source).toContain("external_reference");
    expect(source).toContain("external_intake_submission_evidence_immutable");
  });

  it("uses rotation-safe replay identities and deterministic source keys", () => {
    expect(source).toContain("p_idempotency_candidates");
    expect(source).toContain("p_external_submission_candidates");
    expect(source).toContain("external_intake_submission_replay_split_brain");
    expect(source).toContain("'idempotency_conflict'");
    expect(source).toContain("'external_submission_conflict'");
    expect(source).toContain("source_thread_key");
    expect(source).toContain("external_intake:");
    expect(source).toContain("stage");
    expect(source).toContain("'new_lead'");
    expect(source).not.toContain("default_coarse_source := 'website'");
  });

  it("matches only normalized email and E.164 identities under sorted locks", () => {
    expect(source).toContain("normalized_email");
    expect(source).toContain("normalized_phone");
    expect(source).toContain("external_contact_identities_email_idx");
    expect(source).toContain("external_contact_identities_phone_idx");
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain("order by identity_key");
    expect(source).toContain("for update");
    expect(source).toContain("entity_kind in ('client', 'sub_client')");
    expect(source).toContain("from public.clients client");
    expect(source).toContain("from public.sub_clients sub_client");
    expect(source).toContain("where customer.normalized_email is not null");
    expect(source).not.toMatch(/right\s*\([^)]*phone[^)]*,\s*\d+\s*\)/);
    expect(source).not.toContain("normalized_name");
    expect(source).not.toContain("limit 1");
  });

  it("preserves parent and contact structure without overwriting customers", () => {
    expect(source).toContain("insert into public.clients");
    expect(source).toContain("insert into public.sub_clients");
    expect(source).toContain("client_id");
    expect(source).toContain("client_ref");
    expect(source).toContain("matched_sub_client_id");
    expect(source).toContain("'created_possible_duplicate'");
    expect(source).toContain(
      "insert into private.external_intake_possible_duplicates"
    );
    expect(source).not.toMatch(/update\s+public\.clients\s+set/);
    expect(source).not.toMatch(/update\s+public\.sub_clients\s+set/);
  });

  it("claims exact uploads while missing objects close independently", () => {
    expect(source).toContain("external_intake_submission_uploads");
    expect(source).toContain("external_intake_upload_claim_conflict");
    expect(source).toContain("external_intake_upload_scope_mismatch");
    expect(source).toContain("closed_missing");
    expect(source).toContain("pending_inspection");
    expect(source).toContain("public_upload_id");
    expect(source).toContain("object_version_id");
  });

  it("creates projection, assignment, delivery, and outbox in the command", () => {
    expect(source).toContain(
      "create or replace function public.create_external_intake_submission_as_system"
    );
    expect(source).toContain(
      "private.append_external_lead_projection_foundation("
    );
    expect(source).toMatch(
      /private\.append_external_lead_projection_foundation\([\s\S]*?1::smallint,[\s\S]*?'upsert'/
    );
    expect(source).toMatch(
      /insert into private\.external_lead_handles[\s\S]*?on conflict \(company_id, opportunity_id\) do nothing/
    );
    expect(source).toMatch(
      /select handle\.public_lead_id[\s\S]*?from private\.external_lead_handles handle[\s\S]*?where handle\.company_id = p_company_id[\s\S]*?and handle\.opportunity_id = v_opportunity_id/
    );
    expect(source).toContain("external_intake_default");
    expect(source).toContain("private.change_opportunity_assignment_core(");
    expect(source).toContain(
      "private.enqueue_unassigned_lead_assignment_deliveries("
    );
    expect(source).toContain(
      "insert into private.external_intake_post_commit_outbox"
    );
    expect(source).toContain("source_kind");
    expect(source).toContain("external_intake");
  });

  it("preserves assignment-version delivery fences while generalizing lead sources", () => {
    expect(source).toMatch(
      /create or replace function private\.enqueue_unassigned_lead_assignment_deliveries_at_version\([\s\S]*?p_assignment_version bigint[\s\S]*?source_kind[\s\S]*?source_id[\s\S]*?on conflict \([\s\S]*?opportunity_id,[\s\S]*?recipient_user_id,[\s\S]*?assignment_version[\s\S]*?\) do nothing/
    );
    expect(
      source.match(
        /opportunity\.assignment_version\s*<>\s*delivery\.assignment_version/g
      )
    ).toHaveLength(2);
    expect(source).not.toContain("opportunity.assignment_version <> 0");
  });

  it("keeps every callable boundary service-role-only", () => {
    for (const functionName of [
      "resolve_external_intake_submission_context_as_system",
      "create_external_intake_submission_as_system",
    ]) {
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

  it("keeps a rollback-only executable concurrency contract", () => {
    expect(existsSync(contractPath)).toBe(true);
    expect(existsSync(concurrencyContractPath)).toBe(true);
    expect(existsSync(concurrencyManifestPath)).toBe(true);
    expect(existsSync(concurrencyWriterPath)).toBe(true);
    expect(existsSync(concurrencyContenderPath)).toBe(true);
    expect(contract).toContain("same_key_same_hash_replays");
    expect(contract).toContain("same_key_changed_hash_conflicts");
    expect(contract).toContain("external_id_replays_across_transport_keys");
    expect(contract).toContain("same_identity_creates_two_leads_one_customer");
    expect(contract).toContain("sub_client_match_preserves_parent");
    expect(contract).toContain("created_possible_duplicate");
    expect(contract).toContain("uploads_commit_with_submission");
    expect(contract).toContain("'external-intake-contract@example.invalid'");
    expect(contract).toContain("'contract-access-token'");
    expect(contract).toContain("'contract-refresh-token'");
    expect(contract.trimEnd()).toMatch(/rollback;$/);

    const writer = readFileSync(concurrencyWriterPath, "utf8").toLowerCase();
    const contender = readFileSync(
      concurrencyContenderPath,
      "utf8"
    ).toLowerCase();
    expect(writer).toContain("pg_advisory_lock(2026072612)");
    expect(writer).toContain("pg_advisory_lock(2026072613)");
    expect(writer).toContain(
      "external_lead_intake_same_identity_concurrency_failed"
    );
    expect(writer).toContain(
      "external_lead_intake_same_key_concurrency_failed"
    );
    expect(contender).toContain("'same_identity'");
    expect(contender).toContain("'same_key'");
  });
});

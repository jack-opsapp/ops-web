import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const BODY_PATH = join(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/artifacts/sql/agent_artifact_reads.body.sql"
);
const RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-artifact-reads-runtime.sql"
);
const REPLAY_RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-artifact-reads-replay-runtime.sql"
);
function read(path: string) {
  try {
    return readFileSync(path, "utf8").toLowerCase();
  } catch {
    return "";
  }
}
function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
function replaceExactly(
  value: string,
  oldFragment: string,
  newFragment: string,
  expectedCount: number
) {
  expect(value.split(oldFragment).length - 1).toBe(expectedCount);
  return value.split(oldFragment).join(newFragment);
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

const SQL = read(BODY_PATH);
const COMPACT = compact(SQL);
const PRIVATE_EVIDENCE = compact(
  definition(SQL, "private.agent_p2_artifact_private_evidence_v1")
);
const ATTENTION = compact(
  definition(SQL, "private.agent_p2_artifact_attention_v1")
);
const LIST_PRIVATE = compact(
  definition(SQL, "private.agent_p2_artifact_list_v1")
);
const EXACT_PRIVATE = compact(
  definition(SQL, "private.agent_p2_artifact_evidence_v1")
);
const LIST_PUBLIC = compact(
  definition(SQL, "public.read_agent_job_artifacts_as_system")
);
const EXACT_PUBLIC = compact(
  definition(SQL, "public.read_agent_job_artifact_evidence_as_system")
);
const RUNTIME = compact(read(RUNTIME_PATH));
const REPLAY_RUNTIME = compact(read(REPLAY_RUNTIME_PATH));
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith("_agent_artifact_reads.sql"));

describe("P2 artifact read SQL body", () => {
  it("freezes private evidence/attention projections and exactly two service-only public RPCs", () => {
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("task 10 canonical artifact read body");
    expect(migrationNames).toHaveLength(1);
    const historical = readFileSync(
      join(process.cwd(), "supabase/migrations", migrationNames[0]!),
      "utf8"
    ).toLowerCase();
    expect(
      replaceExactly(
        historical,
        "if p_value !~*\n    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'",
        "if p_value !~\n    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'",
        1
      )
    ).toBe(SQL);
    for (const value of [
      PRIVATE_EVIDENCE,
      ATTENTION,
      LIST_PRIVATE,
      EXACT_PRIVATE,
      LIST_PUBLIC,
      EXACT_PUBLIC,
    ]) {
      expect(value).not.toBe("");
    }
    for (const value of [LIST_PUBLIC, EXACT_PUBLIC]) {
      expect(value).toContain(
        "language plpgsql stable security definer set search_path = ''"
      );
      expect(value).toContain("auth.role() is distinct from 'service_role'");
    }
  });

  it("re-proves the exact current grant, actor, company, policy snapshot, revisions, and parent job in each statement", () => {
    for (const value of [LIST_PRIVATE, EXACT_PRIVATE]) {
      expect(value).toContain("private.mcp_oauth_grants grant_row");
      expect(value).toContain("grant_row.revoked_at is null");
      expect(value).toContain("grant_row.id = p_oauth_grant_id");
      expect(value).toContain("grant_row.client_id = p_oauth_client_id");
      expect(value).toContain("grant_row.revision = p_grant_revision");
      expect(value).toContain(
        "grant_row.accepted_labels = private.mcp_oauth_labels_for_scopes("
      );
      expect(value).toContain("private.mcp_oauth_clients oauth_client");
      expect(value).toContain("oauth_client.disabled_at is null");
      expect(value).toContain("grant_row.scopes <@ oauth_client.scope_ceiling");
      expect(value).toContain(
        "grant_row.consent_catalog_revision = oauth_client.consent_catalog_revision"
      );
      expect(value).toContain(
        "grant_row.exposure_revision = oauth_client.exposure_revision"
      );
      expect(value).toContain("private.resolve_agent_actor_authority(");
      expect(value).toContain(
        "authority.permission_snapshot_revision = p_permission_snapshot_revision"
      );
      expect(value).toContain("private.agent_read_domain_revisions");
      expect(value).toContain("private.agent_operational_read_revisions");
      expect(value).toContain("private.agent_user_can_access_entity(");
      expect(value).toContain("job.deleted_at is null");
    }
  });

  it("freezes linked and genuinely unlinked site-visit anchors for private same-statement composition", () => {
    expect(PRIVATE_EVIDENCE).toContain("'site_visit_linked'");
    expect(PRIVATE_EVIDENCE).toContain("'site_visit_unlinked'");
    expect(PRIVATE_EVIDENCE).toContain(
      "p_source_kinds is distinct from array['site_visit_artifact']::text[]"
    );
    expect(PRIVATE_EVIDENCE).toContain("visit.id = p_job_id");
    expect(PRIVATE_EVIDENCE).toContain("visit.opportunity_id is not null");
    expect(PRIVATE_EVIDENCE).toContain("visit.opportunity_id is null");
    expect(PRIVATE_EVIDENCE).toContain("visit.project_ref is null");
    expect(PRIVATE_EVIDENCE).toContain("visit.project_id is null");
    expect(PRIVATE_EVIDENCE).toContain("'client'");
    expect(PRIVATE_EVIDENCE).toContain(
      "p_resolved_permission_scopes ->> 'photos.view' is distinct from 'all'"
    );
    expect(PRIVATE_EVIDENCE).toContain(
      "p_resolved_permission_scopes ->> 'pipeline.view' is distinct from 'all'"
    );
  });

  it("enforces every source-specific scope and row-level authority branch", () => {
    for (const permission of [
      "calendar.view",
      "clients.view",
      "deck_builder.view",
      "documents.view",
      "email.view",
      "estimates.view",
      "expenses.view",
      "inbox.view",
      "invoices.view",
      "photos.view",
      "pipeline.view",
      "projects.view",
    ]) {
      expect(LIST_PRIVATE).toContain(`'${permission}'`);
      expect(EXACT_PRIVATE).toContain(`'${permission}'`);
    }
    for (const value of [LIST_PRIVATE, EXACT_PRIVATE]) {
      expect(value).toContain("private.user_can_view_inbox_connection(");
      expect(value).toContain(
        "source.authority_submitter_id = p_actor_user_id"
      );
      expect(value).toContain("source.authority_site_visit_id");
      expect(value).toContain("context.deck_builder_scope");
    }
  });

  it("does not let a site-visit bridge manufacture a deck reference or deck authority", () => {
    expect(PRIVATE_EVIDENCE).toContain(
      "left join public.deck_designs visit_design"
    );
    expect(PRIVATE_EVIDENCE).toContain(
      "visit_design.id = artifact.deck_design_id"
    );
    expect(PRIVATE_EVIDENCE).toContain(
      "visit_design.company_id = p_company_id"
    );
    expect(PRIVATE_EVIDENCE).toContain("visit_design.deleted_at is null");
    expect(PRIVATE_EVIDENCE).toContain(
      "p_job_kind in ('site_visit_linked', 'site_visit_unlinked')"
    );
    expect(PRIVATE_EVIDENCE).not.toContain(
      "p_job_kind = 'site_visit_unlinked' and visit_design.opportunity_id is null"
    );
    expect(PRIVATE_EVIDENCE).toContain("'deck_design_id', visit_design.id");
    expect(PRIVATE_EVIDENCE).toContain(
      "p_resolved_permission_scopes ->> 'deck_builder.view' in ('all', 'assigned')"
    );
    expect(PRIVATE_EVIDENCE).toContain(
      "private.agent_user_can_access_entity( p_actor_user_id, p_company_id, 'project', visit_design.project_id, 'view' )"
    );
    expect(PRIVATE_EVIDENCE).toContain(
      "private.agent_user_can_access_entity( p_actor_user_id, p_company_id, 'opportunity', visit_design.opportunity_id, 'view' )"
    );
    expect(PRIVATE_EVIDENCE).toContain(
      "p_job_kind = 'site_visit_unlinked' and visit_design.project_id is null and visit_design.opportunity_id is null and p_resolved_permission_scopes ->> 'deck_builder.view' = 'all'"
    );
    for (const value of [LIST_PRIVATE, EXACT_PRIVATE]) {
      expect(value).toContain(
        "source.artifact_kind <> 'deck_design' or context.deck_builder_scope in ('all', 'assigned')"
      );
    }
  });

  it("uses production UUID columns directly and parses only true legacy text", () => {
    expect(PRIVATE_EVIDENCE).toContain(
      "photo.site_visit_id as authority_site_visit_id"
    );
    expect(PRIVATE_EVIDENCE).toContain(
      "coalesce( invoice.project_ref, invoice.project_id )"
    );
    expect(PRIVATE_EVIDENCE).toContain("expense.submitted_by");
    expect(PRIVATE_EVIDENCE).not.toContain(
      "private.agent_p2_artifact_uuid_from_text( photo.site_visit_id )"
    );
    expect(PRIVATE_EVIDENCE).not.toContain(
      "private.agent_p2_artifact_uuid_from_text(invoice.project_id)"
    );
    expect(PRIVATE_EVIDENCE).not.toContain(
      "private.agent_p2_artifact_uuid_from_text(expense.submitted_by)"
    );
    expect(PRIVATE_EVIDENCE).not.toContain(
      "pg_catalog.lower(invoice.project_id)"
    );
  });

  it("bounds opportunity-note and job-linked visit parents before child scans", () => {
    const opportunityParents = PRIVATE_EVIDENCE.indexOf(
      "opportunity_note_project_gate as materialized"
    );
    const visitParents = PRIVATE_EVIDENCE.indexOf(
      "job_site_visit_gate as materialized"
    );
    const rawGate = PRIVATE_EVIDENCE.indexOf("raw_source_gate as materialized");
    expect(opportunityParents).toBeGreaterThanOrEqual(0);
    expect(visitParents).toBeGreaterThan(opportunityParents);
    expect(rawGate).toBeGreaterThan(visitParents);
    expect(PRIVATE_EVIDENCE).toContain(
      "opportunity_note_project_state as materialized"
    );
    expect(PRIVATE_EVIDENCE).toContain("job_site_visit_state as materialized");
    expect(PRIVATE_EVIDENCE).toContain(
      "site_visit_artifact_state as materialized"
    );
    expect(PRIVATE_EVIDENCE).toContain(
      "or artifact_state.source_query_bound as source_query_bound"
    );
    expect(PRIVATE_EVIDENCE).toContain("source_query_bound");
    expect(PRIVATE_EVIDENCE).toContain(
      "case when state.source_query_bound then p_source_limit else state.raw_source_count end"
    );
  });

  it("projects only current bounded rows from every frozen artifact family", () => {
    for (const table of [
      "project_photos",
      "project_notes",
      "site_visit_artifacts",
      "site_visits",
      "deck_designs",
      "email_attachments",
      "attachment_inspections",
      "email_attachment_inspection_jobs",
      "estimates",
      "invoices",
      "expenses",
      "expense_project_allocations",
    ]) {
      expect(PRIVATE_EVIDENCE).toContain(`public.${table}`);
    }
    expect(PRIVATE_EVIDENCE).toContain("raw_source_gate as materialized");
    expect(PRIVATE_EVIDENCE).toContain("limit 501");
    expect(LIST_PRIVATE).toContain("source.source_count < 501");
    expect(EXACT_PRIVATE).toContain("source.source_count < 501");
    expect(LIST_PRIVATE).toContain("p_item_limit not between 1 and 25");
    expect(LIST_PRIVATE).toContain(
      "p_page_fetch_limit is distinct from p_item_limit + 1"
    );
    expect(LIST_PRIVATE).toContain("p_source_limit is distinct from 501");
    expect(EXACT_PRIVATE).toContain("p_source_limit is distinct from 501");
  });

  it("materializes the 501-row raw source fence before source-specific authorization", () => {
    const rawGate = PRIVATE_EVIDENCE.indexOf("raw_source_gate as materialized");
    const rawLimit = PRIVATE_EVIDENCE.indexOf("limit 501", rawGate);
    const authorizationGate = PRIVATE_EVIDENCE.indexOf(
      "authorized_source as materialized",
      rawGate
    );
    expect(rawGate).toBeGreaterThanOrEqual(0);
    expect(rawLimit).toBeGreaterThan(rawGate);
    expect(authorizationGate).toBeGreaterThan(rawLimit);
    expect(PRIVATE_EVIDENCE).toContain("raw_source_state as materialized");
    expect(PRIVATE_EVIDENCE).toContain(
      "left join authorized_source source on true"
    );
    expect(PRIVATE_EVIDENCE).toContain(
      "v_source.raw_source_count >= p_source_limit"
    );
    expect(PRIVATE_EVIDENCE).toContain(
      "raise exception 'agent_artifact_source_query_bound' using errcode = '54000'"
    );

    for (const sourceSpecificFilter of [
      "private.user_can_view_inbox_connection(",
      "source.authority_submitter_id = p_actor_user_id",
      "source.source_kind <> 'site_visit_artifact'",
    ]) {
      expect(
        PRIVATE_EVIDENCE.indexOf(sourceSpecificFilter, rawGate)
      ).toBeGreaterThan(rawLimit);
    }
  });

  it("hashes canonical full-context item, evidence, exact, and collection projections", () => {
    for (const value of [LIST_PRIVATE, EXACT_PRIVATE]) {
      expect(value).toContain("'granted_scope_ceiling'");
      expect(value).toContain("'resolved_permission_scopes'");
      expect(value).toContain("'source_revisions'");
      expect(value).toContain("'source_inspected'");
      expect(value).toContain("'source_identity'");
      expect(value).toContain("'source_id'");
    }
    expect(LIST_PRIVATE).toContain("proof_context as materialized");
    expect(LIST_PRIVATE).toContain(
      "'ranking_revision', 'artifact-ranking:2026-08-22.v1'"
    );
    expect(LIST_PRIVATE).toContain("'proof_kind', 'artifact_list_entity'");
    expect(LIST_PRIVATE).toContain("'proof_kind', 'artifact_list_collection'");
    expect(LIST_PRIVATE).toContain("'returned_count'");
    expect(LIST_PRIVATE).toContain("'has_more'");
    expect(LIST_PRIVATE).toContain("'children'");
    expect(EXACT_PRIVATE).toContain("proof_context as materialized");
    expect(EXACT_PRIVATE).toContain("'proof_kind', 'artifact_exact_entity'");
  });

  it("keeps locators and source content inside the private projection while public JSON stays opaque", () => {
    expect(PRIVATE_EVIDENCE).toContain("raw_locator");
    expect(PRIVATE_EVIDENCE).toContain("inline_text");
    expect(PRIVATE_EVIDENCE).toContain("'ops_evidence:v1:'");
    expect(PRIVATE_EVIDENCE).toContain("'ops_deck_design:v1:'");
    for (const value of [LIST_PRIVATE, LIST_PUBLIC, EXACT_PUBLIC]) {
      for (const forbidden of [
        "'raw_locator'",
        "'storage_path'",
        "'source_url'",
        "'receipt_image_url'",
        "'ocr_raw_data'",
        "'drawing_data'",
        "'dimensions'",
        "'layers'",
        "'from_email'",
      ]) {
        expect(value).not.toContain(forbidden);
      }
    }
    expect(EXACT_PRIVATE).toContain(
      "'delivery_state', 'ready_for_single_use_delivery'"
    );
    expect(EXACT_PRIVATE).not.toContain("'raw_locator'");
  });

  it("closes function ACLs/catalog state and supplies a rollback-only PG17 fixture", () => {
    expect(COMPACT).toContain(
      "revoke all on function public.read_agent_job_artifacts_as_system"
    );
    expect(COMPACT).toContain(
      "revoke all on function public.read_agent_job_artifact_evidence_as_system"
    );
    expect(COMPACT).toContain("to service_role");
    expect(COMPACT).toContain("do $postflight$");
    expect(RUNTIME.startsWith("begin;")).toBe(true);
    expect(RUNTIME.endsWith("rollback;")).toBe(true);
    expect(RUNTIME).toContain("set local role authenticated");
    expect(RUNTIME).toContain("agent_artifact_runtime_failed");
    expect(RUNTIME).toContain("revoked grant accepted");
    expect(RUNTIME).toContain(
      "assert_artifact_authority_rejected('disabled_client')"
    );
    expect(RUNTIME).toContain(
      "assert_artifact_authority_rejected('stale_client_ceiling')"
    );
    expect(RUNTIME).toContain(
      "assert_artifact_authority_rejected('stale_consent_revision')"
    );
    expect(RUNTIME).toContain(
      "assert_artifact_authority_rejected('stale_exposure_revision')"
    );
    expect(RUNTIME).toContain(
      "assert_artifact_authority_rejected('invalid_accepted_labels')"
    );
    expect(RUNTIME).toContain("cross-company artifact leaked");
    expect(RUNTIME).toContain("unsafe inspection accepted");
    expect(RUNTIME).toContain("canonical proof round trip failed");
    expect(RUNTIME).toContain("artifact revision did not advance");
    expect(RUNTIME).toContain("unsafe or invalid visit deck bridge");
    expect(RUNTIME).toContain(
      "public visit bridge manufactured deck authority"
    );
    expect(RUNTIME).toContain("explain (analyze, buffers, format json)");
    expect(RUNTIME).toContain("hidden source authorization leaked");
    expect(RUNTIME).toContain("hidden source explain gate failed");
    expect(RUNTIME).toContain(
      "artifact source plan did not use required index"
    );
    expect(RUNTIME).toContain(
      "artifact source plan executed a sequential scan"
    );
    expect(RUNTIME).toContain(
      "artifact source plan exceeded physical work bound"
    );
    expect(RUNTIME).toContain("artifact source plan exceeded buffer bound");
    expect(RUNTIME).toContain("rows removed by join filter");
    expect(RUNTIME).toContain("heap fetches");
    for (const sourceKind of [
      "project_photo",
      "project_note",
      "site_visit_artifact",
      "deck_design",
      "email_attachment",
      "generated_estimate",
      "generated_invoice",
      "expense_receipt",
    ]) {
      expect(RUNTIME).toContain(`'${sourceKind}'`);
    }
    expect(RUNTIME).toContain("invisible source bound accepted");
    expect(REPLAY_RUNTIME.startsWith("begin;")).toBe(true);
    expect(REPLAY_RUNTIME.endsWith("rollback;")).toBe(true);
    expect(REPLAY_RUNTIME).toContain("pg_monitor with grant option");
    expect(REPLAY_RUNTIME).toContain("unexpected role grant survived replay");
    expect(REPLAY_RUNTIME).toContain("replay service acl mismatch");
  });
});

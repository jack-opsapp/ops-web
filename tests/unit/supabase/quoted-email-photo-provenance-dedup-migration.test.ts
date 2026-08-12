import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260811232704_quoted_email_photo_provenance_dedup.sql"
);

function migration(): string {
  return readFileSync(migrationPath, "utf8");
}

function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$function$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("quoted email photo provenance and dedup migration", () => {
  it("centralizes exact attachment and source eligibility", () => {
    const sql = migration();
    const sourceEligibility = functionBody(
      sql,
      "private.email_conversion_photo_source_is_eligible"
    );

    expect(sql).toMatch(
      /create or replace function private\.email_conversion_photo_attachment_is_base_eligible\(\s*p_attachment_id uuid\s*\)/i
    );
    expect(sourceEligibility).toMatch(
      /private\.email_conversion_photo_attachment_is_base_eligible\(attachment\.id\)/i
    );
    expect(sourceEligibility).toMatch(
      /outbound_attachment\.company_id = attachment\.company_id[\s\S]*outbound_attachment\.content_sha256 = attachment\.content_sha256[\s\S]*outbound_attachment\.connection_id = attachment\.connection_id[\s\S]*outbound_attachment\.provider_thread_id is not distinct from attachment\.provider_thread_id/i
    );
    expect(sourceEligibility).toMatch(
      /outbound_attachment\.content_sha256 = attachment\.content_sha256[\s\S]*\([\s\S]*outbound_attachment\.connection_id = attachment\.connection_id[\s\S]*outbound_attachment\.provider_thread_id is not distinct from attachment\.provider_thread_id[\s\S]*or[\s\S]*attachment\.opportunity_id is not null[\s\S]*outbound_attachment\.opportunity_id is not distinct from attachment\.opportunity_id[\s\S]*\)/i
    );
    expect(sourceEligibility).toMatch(
      /outbound_activity\.direction = 'outbound'[\s\S]*outbound_attachment\.occurred_at <= attachment\.occurred_at/i
    );
    expect(sourceEligibility).toMatch(
      /prior_attachment\.company_id = attachment\.company_id[\s\S]*prior_attachment\.opportunity_id = attachment\.opportunity_id[\s\S]*prior_attachment\.content_sha256 = attachment\.content_sha256/i
    );
    expect(sourceEligibility).toMatch(
      /\(prior_attachment\.occurred_at, prior_attachment\.id\)[\s\S]*<[\s\S]*\(attachment\.occurred_at, attachment\.id\)/i
    );
  });

  it("uses the shared eligibility predicate at every materialization boundary", () => {
    const sql = migration();
    const jobIdentity = functionBody(
      sql,
      "private.require_email_conversion_photo_job_identity"
    );
    const reconcile = functionBody(
      sql,
      "private.reconcile_email_attachment_conversion_photo"
    );
    const enqueue = functionBody(
      sql,
      "private.enqueue_conversion_event_email_photos"
    );
    const complete = functionBody(
      sql,
      "public.complete_email_conversion_photo_job"
    );

    expect(jobIdentity).toMatch(
      /not private\.email_conversion_photo_source_is_eligible\(attachment\.id\)/i
    );
    expect(reconcile).toMatch(
      /eligible := private\.email_conversion_photo_source_is_eligible\(attachment\.id\)/i
    );
    expect(enqueue).toMatch(
      /private\.email_conversion_photo_source_is_eligible\(attachment\.id\)/i
    );
    expect(complete).toMatch(
      /not private\.email_conversion_photo_source_is_eligible\(attachment\.id\)/i
    );
  });

  it("reconciles same-hash siblings when attachments or activities change", () => {
    const sql = migration();
    const relatedReconcile = functionBody(
      sql,
      "private.reconcile_related_email_conversion_photo_sources"
    );
    const attachmentTrigger = functionBody(
      sql,
      "private.reconcile_email_attachment_conversion_photo_jobs"
    );
    const activityTrigger = functionBody(
      sql,
      "private.revoke_email_conversion_photos_for_activity_change"
    );

    expect(relatedReconcile).toMatch(
      /related_attachment\.company_id = p_company_id[\s\S]*related_attachment\.content_sha256 is not distinct from p_content_sha256[\s\S]*related_attachment\.opportunity_id is not distinct from p_opportunity_id[\s\S]*related_attachment\.connection_id = p_connection_id[\s\S]*related_attachment\.provider_thread_id is not distinct from p_provider_thread_id/i
    );
    expect(attachmentTrigger).toMatch(
      /private\.reconcile_related_email_conversion_photo_sources\(\s*new\.company_id,\s*new\.opportunity_id,\s*new\.connection_id,\s*new\.provider_thread_id,\s*new\.content_sha256\s*\)/i
    );
    expect(attachmentTrigger).toMatch(
      /tg_op = 'UPDATE'[\s\S]*private\.reconcile_related_email_conversion_photo_sources\(\s*old\.company_id,\s*old\.opportunity_id,\s*old\.connection_id,\s*old\.provider_thread_id,\s*old\.content_sha256\s*\)/i
    );
    expect(activityTrigger).toMatch(
      /private\.reconcile_related_email_conversion_photo_sources\(\s*linked_attachment\.company_id,\s*linked_attachment\.opportunity_id,\s*linked_attachment\.connection_id,\s*linked_attachment\.provider_thread_id,\s*linked_attachment\.content_sha256\s*\)/i
    );
    expect(sql).toMatch(
      /create trigger email_attachments_enqueue_converted_project_photo[\s\S]*after insert or update of[\s\S]*connection_id[\s\S]*provider_thread_id[\s\S]*occurred_at[\s\S]*content_sha256[\s\S]*on public\.email_attachments/i
    );
  });

  it("revokes existing invalid projections before enforcing one active project hash", () => {
    const sql = migration();

    expect(sql).toMatch(
      /perform private\.revoke_email_conversion_photo_jobs\(revoked_job_ids\)/i
    );
    expect(sql).toMatch(
      /not private\.email_conversion_photo_source_is_eligible\(job\.email_attachment_id\)/i
    );
    expect(sql).toMatch(
      /row_number\(\) over\s*\([\s\S]*partition by job\.company_id, job\.project_id, job\.source_content_sha256/i
    );
    expect(sql).toMatch(
      /create unique index email_conversion_photo_jobs_active_project_hash_unique[\s\S]*on public\.email_conversion_photo_jobs\s*\(company_id, project_id, source_content_sha256\)[\s\S]*where operation = 'materialize'/i
    );
    expect(sql).toMatch(/on conflict do nothing/i);
  });

  it("indexes the exact thread and opportunity hash lookups used by eligibility", () => {
    const sql = migration();

    expect(sql).toMatch(
      /create index email_attachments_photo_thread_hash_idx[\s\S]*on public\.email_attachments\s*\(company_id, connection_id, provider_thread_id, content_sha256, occurred_at\)[\s\S]*where ingest_status = 'stored'[\s\S]*content_sha256 is not null/i
    );
    expect(sql).toMatch(
      /create index email_attachments_photo_opportunity_hash_idx[\s\S]*on public\.email_attachments\s*\(company_id, opportunity_id, content_sha256, occurred_at, id\)[\s\S]*where ingest_status = 'stored'[\s\S]*content_sha256 is not null/i
    );
  });

  it("keeps all new private helpers inaccessible to API roles", () => {
    const sql = migration();

    expect(sql).toMatch(
      /revoke all on function private\.email_conversion_photo_attachment_is_base_eligible\(uuid\)\s*from public, anon, authenticated, service_role/i
    );
    expect(sql).toMatch(
      /revoke all on function private\.email_conversion_photo_source_is_eligible\(uuid\)\s*from public, anon, authenticated, service_role/i
    );
    expect(sql).toMatch(
      /revoke all on function private\.reconcile_related_email_conversion_photo_sources\(uuid, uuid, uuid, text, text\)\s*from public, anon, authenticated, service_role/i
    );
    expect(sql).not.toMatch(
      /grant execute on function private\.(?:email_conversion_photo|reconcile_related)[^;]*to (?:public|anon|authenticated)/i
    );
  });
});

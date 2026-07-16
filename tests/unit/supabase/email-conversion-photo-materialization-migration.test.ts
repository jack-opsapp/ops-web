import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260715173000_email_conversion_photo_materialization.sql"
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

describe("email conversion photo materialization migration", () => {
  it("uses a durable event-plus-attachment identity without redefining conversion", () => {
    const sql = migration();

    expect(sql).toMatch(/create table public\.email_conversion_photo_jobs/i);
    expect(sql).toMatch(
      /unique\s*\(\s*conversion_event_id\s*,\s*email_attachment_id\s*\)/i
    );
    expect(sql).toMatch(
      /conversion_event_id uuid not null references public\.opportunity_conversion_events/i
    );
    expect(sql).toMatch(
      /email_attachment_id uuid not null references public\.email_attachments/i
    );
    expect(sql).not.toMatch(
      /create or replace function public\.convert_opportunity_to_project/i
    );
    expect(sql).not.toMatch(
      /update\s+public\.opportunities[\s\S]*assigned_to/i
    );
  });

  it("reserves every public object in a durable generation-fenced ledger before upload", () => {
    const sql = migration();

    expect(sql).toMatch(/create table public\.email_conversion_photo_objects/i);
    expect(sql).toMatch(
      /job_id uuid not null references public\.email_conversion_photo_jobs/i
    );
    expect(sql).toMatch(/unique\s*\(\s*job_id\s*,\s*generation\s*\)/i);
    expect(sql).toMatch(/unique\s*\(\s*object_path\s*\)/i);
    expect(sql).toMatch(
      /create or replace function public\.stage_email_conversion_photo_object\([\s\S]*p_job_id uuid[\s\S]*p_generation bigint[\s\S]*p_lease_token uuid[\s\S]*p_object_path text/i
    );
    expect(sql).toMatch(
      /stage_email_conversion_photo_object[\s\S]*job\.status <> 'processing'[\s\S]*job\.operation <> 'materialize'[\s\S]*job\.generation is distinct from p_generation[\s\S]*job\.lease_token is distinct from p_lease_token/i
    );
    expect(sql).toMatch(
      /job\.conversion_event_id::text[\s\S]*job\.email_attachment_id::text[\s\S]*job\.generation::text/i
    );
    expect(sql).toMatch(/insert into public\.email_conversion_photo_objects/i);
  });

  it("enqueues both existing and late inbound image attachments", () => {
    const sql = migration();

    expect(sql).toMatch(
      /create trigger email_conversion_events_enqueue_photos[\s\S]*after insert[\s\S]*on public\.opportunity_conversion_events/i
    );
    expect(sql).toMatch(
      /create trigger email_attachments_enqueue_converted_project_photo[\s\S]*after insert or update/i
    );
    expect(sql).toMatch(/attachment\.ingest_status = 'stored'/i);
    expect(sql).toMatch(/attachment\.attribution_status = 'attributed'/i);
    expect(sql).toMatch(/detected_mime_type[\s\S]*like 'image\/%'/i);
    expect(sql).toMatch(/activity\.direction = 'inbound'/i);
    expect(sql).toMatch(
      /insert into public\.email_conversion_photo_jobs[\s\S]*from public\.opportunity_conversion_events/i
    );
    expect(sql).toMatch(
      /create or replace function private\.reconcile_email_attachment_conversion_photo_jobs[\s\S]*operation = 'revoke'/i
    );
  });

  it("increments generation on every claim and completes only an exact staged object", () => {
    const sql = migration();

    expect(sql).toMatch(
      /create or replace function public\.claim_email_conversion_photo_jobs/i
    );
    expect(sql).toMatch(/lease_token\s*=\s*gen_random_uuid\(\)/i);
    expect(sql).toMatch(/generation\s*=\s*job\.generation\s*\+\s*1/i);
    expect(sql).toMatch(/for update skip locked/i);
    expect(sql).toMatch(
      /\(\s*job\.status in \('pending', 'retrying'\)[\s\S]*job\.attempts < job\.max_attempts[\s\S]*\)[\s\S]*or \(job\.status = 'processing' and job\.lease_expires_at <= now\(\)\)/i
    );
    expect(sql).toMatch(
      /create or replace function public\.complete_email_conversion_photo_job/i
    );
    expect(sql).toMatch(/job\.lease_token is distinct from p_lease_token/i);
    expect(sql).toMatch(/job\.generation is distinct from p_generation/i);
    expect(sql).toMatch(
      /from public\.email_conversion_photo_objects\s+(\w+)[\s\S]*\1\.job_id = job\.id[\s\S]*\1\.generation = p_generation[\s\S]*\1\.object_path = p_project_storage_path[\s\S]*for update/i
    );
    expect(sql).toMatch(/object_row\.state <> 'staged'/i);
    expect(sql).toMatch(
      /attachment\.content_sha256 is distinct from job\.source_content_sha256/i
    );
    expect(sql).toMatch(
      /attachment\.verified_size_bytes is distinct from job\.source_verified_size_bytes/i
    );
    expect(sql).toMatch(/activity\.type is distinct from 'email'/i);
    expect(sql).toMatch(/insert into public\.project_photos/i);
    expect(sql).toMatch(/deleted_at = null/i);
    expect(sql).toMatch(/is_client_visible[\s\S]*false/i);
    expect(sql).toMatch(/source[\s\S]*'other'/i);
    expect(sql).toMatch(
      /update public\.email_conversion_photo_objects[\s\S]*state = 'published'/i
    );
    expect(sql).toMatch(/status = 'complete'/i);
    expect(sql).toMatch(
      /create or replace function public\.complete_email_conversion_photo_revocation/i
    );
    expect(sql).toMatch(
      /deleted_at = coalesce\((?:photo\.)?deleted_at, now\(\)\)/i
    );
    expect(sql).toMatch(
      /if exists\s*\([\s\S]*from public\.email_conversion_photo_objects[\s\S]*state <> 'deleted'[\s\S]*then[\s\S]*return false/i
    );
  });

  it("cleans public objects through indefinitely retryable generation-specific leases", () => {
    const sql = migration();
    const markCleanup = functionBody(
      sql,
      "public.mark_email_conversion_photo_object_cleanup"
    );

    expect(sql).toMatch(
      /create or replace function public\.mark_email_conversion_photo_object_cleanup/i
    );
    expect(sql).toMatch(
      /mark_email_conversion_photo_object_cleanup\([\s\S]*p_job_id uuid[\s\S]*p_generation bigint[\s\S]*p_object_path text[\s\S]*p_reason text/i
    );
    expect(markCleanup).toMatch(
      /if object_row\.state = 'published' then[\s\S]*return false[\s\S]*update public\.email_conversion_photo_objects[\s\S]*set state = 'delete_pending'[\s\S]*lease_owner = null[\s\S]*lease_token = null[\s\S]*lease_expires_at = null[\s\S]*deleted_at = null/i
    );
    expect(sql).toMatch(
      /create or replace function public\.claim_email_conversion_photo_object_cleanups/i
    );
    expect(sql).toMatch(/lease_token\s*=\s*gen_random_uuid\(\)/i);
    expect(sql).toMatch(/for update skip locked/i);
    expect(sql).toMatch(
      /object_row\.state = 'staged'[\s\S]*object_row\.cleanup_available_at <= now\(\)[\s\S]*job\.status = 'processing'[\s\S]*job\.generation = object_row\.generation[\s\S]*job\.lease_token = object_row\.job_lease_token[\s\S]*job\.lease_expires_at > now\(\)/i
    );
    expect(sql).toMatch(
      /create or replace function public\.finish_email_conversion_photo_object_cleanup/i
    );
    expect(sql).toMatch(/p_outcome not in \('deleted', 'retrying'\)/i);
    expect(sql).not.toMatch(
      /email_conversion_photo_objects[\s\S]{0,800}max_attempts/i
    );
    expect(sql).toMatch(
      /state = case[\s\S]*when p_outcome = 'deleted' then 'deleted'[\s\S]*else 'delete_pending'/i
    );
  });

  it("revokes projections when exact email activity identity changes", () => {
    const sql = migration();

    expect(sql).toMatch(
      /create trigger activities_revoke_email_conversion_photos[\s\S]*after update of[\s\S]*type[\s\S]*email_connection_id[\s\S]*email_message_id[\s\S]*opportunity_id[\s\S]*direction[\s\S]*match_needs_review[\s\S]*on public\.activities/i
    );
    expect(sql).toMatch(
      /create or replace function private\.revoke_email_conversion_photos_for_activity_change/i
    );
    expect(sql).toMatch(
      /update public\.email_conversion_photo_objects[\s\S]*state = 'delete_pending'/i
    );
    expect(sql).toMatch(
      /revoke_email_conversion_photo_jobs[\s\S]*update public\.project_photos[\s\S]*deleted_at = coalesce/i
    );
    expect(sql).toMatch(
      /revoke_email_conversion_photos_for_activity_change[\s\S]*perform private\.reconcile_email_attachment_conversion_photo\(linked_attachment\.id\)/i
    );
  });

  it("accepts only the exact staged path's public project-photos URL", () => {
    const sql = migration();

    expect(sql).toMatch(
      /expected_url_suffix\s*:=\s*[\s\S]*\/storage\/v1\/object\/public\/project-photos\/[\s\S]*expected_path/i
    );
    expect(sql).toMatch(
      /right\(p_project_photo_url, length\(expected_url_suffix\)\) is distinct from expected_url_suffix/i
    );
    expect(sql).toMatch(/p_project_photo_url !~ '\^https:\/\/'/i);
  });

  it("keeps queue writes behind service-only RPCs", () => {
    const sql = migration();

    expect(sql).toMatch(
      /revoke all on table public\.email_conversion_photo_jobs[\s\S]*from public, anon, authenticated, service_role/i
    );
    expect(sql).toMatch(
      /grant select on table public\.email_conversion_photo_jobs[\s\S]*to service_role/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.claim_email_conversion_photo_jobs[\s\S]*to service_role/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.complete_email_conversion_photo_job[\s\S]*to service_role/i
    );
    expect(sql).toMatch(
      /revoke all on table public\.email_conversion_photo_objects[\s\S]*from public, anon, authenticated, service_role/i
    );
    expect(sql).toMatch(
      /grant select on table public\.email_conversion_photo_objects[\s\S]*to service_role/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.stage_email_conversion_photo_object[\s\S]*to service_role/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.mark_email_conversion_photo_object_cleanup[\s\S]*to service_role/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.claim_email_conversion_photo_object_cleanups[\s\S]*to service_role/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.finish_email_conversion_photo_object_cleanup[\s\S]*to service_role/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.complete_email_conversion_photo_revocation[\s\S]*to service_role/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.finish_email_conversion_photo_job[\s\S]*to service_role/i
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.(?:claim|stage|mark|finish|complete)_email_conversion_photo[^;]*\)\s*to (?:public|anon|authenticated)/i
    );
  });
});

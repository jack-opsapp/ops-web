import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const migrationDirectory = resolve(repoRoot, "supabase/migrations");

function loadMigration(): string {
  const filename = readdirSync(migrationDirectory).find((candidate) =>
    candidate.endsWith("_create_social_publishing.sql")
  );

  expect(filename, "social publishing migration must be generated").toBeDefined();
  return readFileSync(resolve(migrationDirectory, filename!), "utf8").toLowerCase();
}

describe("social publishing migration contract", () => {
  it("creates a constrained, service-role-only durable queue", () => {
    const sql = loadMigration();

    expect(sql).toContain("create table public.social_posts");
    expect(sql).toContain("idempotency_key text not null unique");
    expect(sql).toContain("content jsonb not null");
    expect(sql).toContain("rendered_assets jsonb not null");
    expect(sql).toContain("audit_log jsonb not null");
    expect(sql).toContain("claim_token uuid");
    expect(sql).toContain("claim_expires_at timestamptz");
    expect(sql).toContain("publish_stage text not null default 'idle'");
    expect(sql).toContain("publish_attempts jsonb not null default '[]'::jsonb");
    expect(sql).toContain("recovery_notification_pending boolean not null default false");
    expect(sql).toContain("recovery_notification_claim_token uuid");
    expect(sql).toContain("recovery_notification_claim_expires_at timestamptz");
    expect(sql).toContain("recovery_notified_at timestamptz");
    expect(sql).toContain("instagram_media_id text");
    expect(sql).toContain("instagram_permalink text");
    expect(sql).toContain("instagram_media_id is not null");
    expect(sql).not.toContain("instagram_permalink is not null");
    expect(sql).toMatch(/check\s*\(status\s+in\s*\(/);
    expect(sql).toMatch(/check\s*\(story_type\s+in\s*\(/);
    expect(sql).toMatch(/check\s*\(visual_treatment\s+in\s*\(/);
    expect(sql).toMatch(/check\s*\(post_format\s+in\s*\(/);
    expect(sql).toContain("jsonb_typeof(rendered_assets) = 'array'");
    expect(sql).toContain("attempt_count >= 0");
    expect(sql).toContain("max_attempts between 1 and 10");
    expect(sql).toContain("max_attempts integer not null default 4");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on table public.social_posts from public, anon, authenticated");
    expect(sql).toContain("grant select, insert, update, delete on table public.social_posts to service_role");
  });

  it("indexes the due queue and history lookup", () => {
    const sql = loadMigration();

    expect(sql).toContain("social_posts_due_idx");
    expect(sql).toContain("social_posts_history_idx");
    expect(sql).toContain("social_posts_source_idx");
  });

  it("claims due rows atomically with a fixed security boundary", () => {
    const sql = loadMigration();

    expect(sql).toContain("create or replace function public.claim_due_social_posts");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("claim_expires_at");
    expect(sql).toContain("revoke all on function public.claim_due_social_posts");
    expect(sql).toContain("grant execute on function public.claim_due_social_posts");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("create or replace function public.claim_social_post_by_id");
    expect(sql).toContain("revoke all on function public.claim_social_post_by_id");
    expect(sql).toContain("create or replace function public.record_social_publish_stage");
    expect(sql).toContain("publish_stage = 'claimed'");
    expect(sql).toContain("p_stage = 'publish_requested'");
    expect(sql).toContain("p_stage = 'publish_succeeded'");
    expect(sql).toContain("revoke all on function public.record_social_publish_stage");
  });

  it("recovers only pre-publish leases and quarantines uncertain outcomes", () => {
    const sql = loadMigration();

    expect(sql).toContain("social_post.publish_stage in ('claimed', 'container_ready')");
    expect(sql).toContain("social_post.publish_stage in ('publish_requested', 'publish_succeeded')");
    expect(sql).toContain("publish_stage = 'reconciliation_required'");
    expect(sql).toContain("last_error_code = 'stale_rendering'");
    expect(sql).toContain("last_error_code = 'publish_attempts_exhausted'");
    expect(sql).toContain("social_post.attempt_count >= social_post.max_attempts");
    expect(sql).toContain("recovery_notification_pending = true");
    expect(sql).toContain("social_post.updated_at <= now() - interval '15 minutes'");
    expect(sql).toContain("and social_post.status = 'review'");
  });

  it("leases and atomically delivers durable recovery notifications", () => {
    const sql = loadMigration();

    expect(sql).toContain("create or replace function public.claim_social_recovery_notifications");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("recovery_notification_claim_token = p_claim_token");
    expect(sql).toContain("create or replace function public.deliver_social_recovery_notification");
    expect(sql).toContain("'social-recovery:' || v_post.id::text");
    expect(sql).toContain("persistent");
    expect(sql).toContain("recovery_notification_pending = false");
    expect(sql).toContain("grant execute on function public.claim_social_recovery_notifications");
    expect(sql).toContain("grant execute on function public.deliver_social_recovery_notification");
    expect(sql).toContain("create or replace function public.fn_resolve_social_recovery_on_transition");
    expect(sql).toContain("old.status = 'failed' and new.status <> 'failed'");
    expect(sql).toContain("new.recovery_notification_pending = false");
    expect(sql).toContain("notification.dedupe_key = 'social-recovery:' || new.id::text");
    expect(sql).toContain("create trigger social_posts_resolve_recovery_on_transition");
  });

  it("keeps updated_at server-owned", () => {
    const sql = loadMigration();

    expect(sql).toContain("create trigger social_posts_set_updated_at");
    expect(sql).toContain("execute function public.fn_set_updated_at()");
  });
});

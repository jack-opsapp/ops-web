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
  });

  it("keeps updated_at server-owned", () => {
    const sql = loadMigration();

    expect(sql).toContain("create trigger social_posts_set_updated_at");
    expect(sql).toContain("execute function public.fn_set_updated_at()");
  });
});

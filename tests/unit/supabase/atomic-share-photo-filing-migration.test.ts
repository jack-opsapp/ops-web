import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260723193000_atomic_share_photo_filing.sql"
  ),
  "utf8"
).toLowerCase();

describe("atomic share-photo filing migration", () => {
  it("keeps a recovery acknowledgement idempotent after the notice is read", () => {
    expect(sql).toContain("notifications_share_photo_recovery_dedupe_key_uidx");
    expect(sql).toContain("where dedupe_key like 'share-photo:recovery:%'");
  });

  it("exposes one service-role-only transactional filing function", () => {
    expect(sql).toContain(
      "create or replace function public.file_share_photo_as_system"
    );
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path to 'pg_catalog', 'pg_temp'");
    expect(sql).toContain(
      "coalesce(auth.jwt() ->> 'role', '') <> 'service_role'"
    );
    expect(sql).toContain(
      "revoke all on function public.file_share_photo_as_system"
    );
    expect(sql).toContain(
      "grant execute on function public.file_share_photo_as_system"
    );
  });

  it("serializes both same-job retries and project image appends", () => {
    expect(sql).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(sql).toContain("pg_catalog.hashtextextended");
    expect(sql).toMatch(/from public\.projects[\s\S]*for update/);
    expect(sql).toContain("array_append");
    expect(sql).toContain("array_position");
    expect(sql).toContain("insert into public.project_photos");
  });

  it("rejects identity reuse without resurrecting soft-deleted photos", () => {
    expect(sql).toContain("share_photo_identity_conflict");
    expect(sql).toContain("v_existing.deleted_at is null");
    expect(sql).toContain("p_job_id");
    expect(sql).toContain("p_project_id");
    expect(sql).toContain("p_company_id");
    expect(sql).toContain("p_actor_user_id");
    expect(sql).toContain("v_existing.taken_at is distinct from p_taken_at");
    expect(sql).toContain("attached boolean");
    expect(sql).toContain("p_url");
    expect(sql).toContain("private.user_can_edit_project");
  });
});

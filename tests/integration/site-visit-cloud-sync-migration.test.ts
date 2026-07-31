import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const migrationFiles = readdirSync(MIGRATIONS).filter((file) =>
  file.endsWith("_site_visit_cloud_sync.sql")
);
const migrationPath =
  migrationFiles.length === 1 ? join(MIGRATIONS, migrationFiles[0]) : "";
const sql = migrationPath ? readFileSync(migrationPath, "utf8").toLowerCase() : "";

const BUSINESS_TABLES = [
  "site_visit_artifacts",
  "site_visit_checklist_answers",
  "site_visit_identity_drafts",
] as const;

function expectTablePattern(table: string, pattern: RegExp): void {
  const start = sql.indexOf(`create table public.${table}`);
  expect(start, `missing public.${table}`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("\n);", start);
  expect(end, `unterminated public.${table}`).toBeGreaterThan(start);
  expect(sql.slice(start, end + 3), `public.${table}`).toMatch(pattern);
}

describe("site-visit cloud sync migration", () => {
  it("ships exactly one ordered migration", () => {
    expect(migrationFiles).toHaveLength(1);
  });

  it("creates only the three normalized business-data children", () => {
    const created = [...sql.matchAll(/create table public\.([a-z0-9_]+)/g)]
      .map((match) => match[1])
      .sort();

    expect(created).toEqual([...BUSINESS_TABLES].sort());
    for (const machinery of ["queue", "receipt", "outbox", "delivery", "event"]) {
      expect(created.some((table) => table.includes(machinery))).toBe(false);
    }
  });

  it("uses the live text tenant scope and real parent foreign keys", () => {
    for (const table of BUSINESS_TABLES) {
      expectTablePattern(table, /company_id\s+text\s+not null/);
      expectTablePattern(
        table,
        /site_visit_id\s+uuid\s+not null[\s\S]*references public\.site_visits\s*\(id\)\s+on delete cascade/
      );
      expectTablePattern(table, /deleted_at\s+timestamptz/);
    }

    expectTablePattern("site_visit_identity_drafts", /client_id\s+uuid/);
    expectTablePattern("site_visit_identity_drafts", /sub_client_id\s+uuid/);
  });

  it("constrains wire enums, JSON shapes, and active identities", () => {
    for (const kind of [
      "photo",
      "annotated_photo",
      "dimensioned_photo",
      "note",
      "transcript",
      "measurement",
      "deck_design",
    ]) {
      expect(sql).toContain(`'${kind}'`);
    }
    for (const source of [
      "camera",
      "gallery",
      "microphone",
      "keyboard",
      "laser",
      "lidar",
      "deck_builder",
      "manual",
    ]) {
      expect(sql).toContain(`'${source}'`);
    }
    for (const kind of [
      "checkbox",
      "yes_no_na",
      "short_text",
      "long_text",
      "measurement",
      "photo",
      "photo_markup",
      "deck_design",
    ]) {
      expect(sql).toContain(`'${kind}'`);
    }

    expect(sql).toMatch(/jsonb_typeof\(dimensions\)\s*=\s*'object'/);
    expect(sql).toMatch(/jsonb_typeof\(answer_value\)\s*=\s*'object'/);
    expect(sql).toMatch(
      /unique index site_visit_checklist_answers_active_field_uidx[\s\S]*\(site_visit_id, field_id\)[\s\S]*where deleted_at is null/
    );
    expect(sql).toMatch(
      /unique index site_visit_identity_drafts_active_visit_uidx[\s\S]*\(site_visit_id\)[\s\S]*where deleted_at is null/
    );
  });

  it("rejects a child whose direct tenant differs from its parent", () => {
    expect(sql).toContain("private.require_site_visit_child_company_match");
    expect(sql).toMatch(/from public\.site_visits[\s\S]*for key share/);
    expect(sql).toContain("new.company_id");
    expect(sql).toContain("new.site_visit_id");
    for (const table of BUSINESS_TABLES) {
      expect(sql).toMatch(
        new RegExp(
          `before insert or update of site_visit_id, company_id[\\s\\S]*on public\\.${table}[\\s\\S]*private\\.require_site_visit_child_company_match`
        )
      );
    }
  });

  it("enables parent-authorized RLS and grants only normal app mutations", () => {
    expect(sql).toContain("private.current_user_can_access_site_visit_child");
    expect(sql).toContain("private.current_user_can_view_site_visit");
    expect(sql).toContain("private.current_user_can_edit_site_visit");

    for (const table of BUSINESS_TABLES) {
      expect(sql).toContain(
        `alter table public.${table} enable row level security`
      );
      expect(sql).toMatch(
        new RegExp(
          `grant select, insert, update on table public\\.${table} to anon, authenticated`
        )
      );
      expect(sql).toMatch(
        new RegExp(
          `grant select, insert, update, delete on table public\\.${table} to service_role`
        )
      );
      expect(sql).not.toMatch(
        new RegExp(`grant[^;]*delete[^;]*public\\.${table}[^;]*(anon|authenticated)`)
      );
    }
  });

  it("makes completion atomic, monotonic, and retry-safe", () => {
    expect(sql).toContain("activities_site_visit_completion_uidx");
    expect(sql).toMatch(
      /where type = 'site_visit' and site_visit_id is not null/
    );
    expect(sql).toContain("duplicate_site_visit_completion_activities");
    expect(sql).toContain("public.complete_site_visit_guarded");
    expect(sql).toMatch(/from public\.site_visits[\s\S]*for update/);
    expect(sql).toContain("private.current_user_can_edit_site_visit");
    expect(sql).toContain("private.get_user_company_id");
    expect(sql).toContain("cannot_complete_cancelled_site_visit");
    expect(sql).toContain("cannot_complete_deleted_site_visit");
    expect(sql).toMatch(/completed_at\s*=\s*coalesce\(completed_at,/);
    expect(sql).toMatch(/insert into public\.activities[\s\S]*on conflict/);
    expect(sql).toMatch(/update public\.site_visits[\s\S]*activity_id/);
  });

  it("keeps the guarded RPC callable only through the app roles", () => {
    expect(sql).toMatch(
      /create or replace function public\.complete_site_visit_guarded\(uuid, jsonb\)/
    );
    expect(sql).toMatch(/set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'/);
    expect(sql).toMatch(
      /revoke all on function public\.complete_site_visit_guarded\(uuid, jsonb\) from public, anon, authenticated, service_role/
    );
    expect(sql).toMatch(
      /grant execute on function public\.complete_site_visit_guarded\(uuid, jsonb\) to anon, authenticated/
    );
  });

  it("publishes the parent and children without duplicate publication errors", () => {
    for (const table of ["site_visits", ...BUSINESS_TABLES]) {
      expect(sql).toContain(`'${table}'`);
      expect(sql).toMatch(
        new RegExp(
          `pg_publication_tables[\\s\\S]*${table}[\\s\\S]*alter publication supabase_realtime add table public\\.${table}`
        )
      );
    }
  });

  it("never disables integrity enforcement", () => {
    expect(sql).not.toContain("session_replication_role");
    expect(sql).not.toMatch(/disable\s+trigger/);
  });

  it("includes a rollback-only cross-tenant purge rehearsal", () => {
    const rehearsal = join(
      process.cwd(),
      "tests/sql/site-visit-cloud-sync-purge-contract.sql"
    );
    expect(existsSync(rehearsal)).toBe(true);
    if (!existsSync(rehearsal)) return;

    const contract = readFileSync(rehearsal, "utf8").toLowerCase();
    expect(contract).toContain("begin;");
    expect(contract).toContain("rollback;");
    for (const table of ["site_visits", ...BUSINESS_TABLES]) {
      expect(contract).toContain(table);
    }
    expect(contract).toContain("cross_tenant");
    expect(contract).toContain("purge_company_data");
  });
});

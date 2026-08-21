import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260821185843_project_primary_sub_client.sql"
);

function migrationSql(): string {
  return readFileSync(migrationPath, "utf8");
}

function functionBody(source: string, name: string): string {
  const marker = `create or replace function ${name}`;
  const start = source.toLowerCase().indexOf(marker);
  expect(start, `${name} missing`).toBeGreaterThanOrEqual(0);
  const next = source
    .toLowerCase()
    .indexOf("create or replace function ", start + marker.length);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

describe("project primary sub-client migration", () => {
  it("adds one nullable indexed FK without changing existing rows", () => {
    const sql = migrationSql();

    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(sql).toMatch(
      /alter table public\.projects\s+add column if not exists primary_sub_client_id uuid/i
    );
    expect(sql).toMatch(
      /foreign key \(primary_sub_client_id\)\s+references public\.sub_clients\(id\)\s+on delete set null/i
    );
    expect(sql).toMatch(
      /create index if not exists projects_primary_sub_client_id_idx[\s\S]*?where primary_sub_client_id is not null/i
    );
    expect(sql).not.toMatch(/primary_sub_client_id uuid[^,;\n]*not null/i);
  });

  it("validates active same-company contacts belonging to the selected client", () => {
    const body = functionBody(
      migrationSql(),
      "private.validate_project_primary_sub_client"
    );

    expect(body).toMatch(/sub_client\.id\s*=\s*new\.primary_sub_client_id/i);
    expect(body).toMatch(/sub_client\.client_id\s*=\s*new\.client_id/i);
    expect(body).toMatch(/sub_client\.company_id\s*=\s*new\.company_id/i);
    expect(body).toMatch(/sub_client\.deleted_at\s+is\s+null/i);
    expect(body).toMatch(/errcode\s*=\s*'23514'/i);
  });

  it("clears an inherited selection when an older client changes parent client", () => {
    const body = functionBody(
      migrationSql(),
      "private.validate_project_primary_sub_client"
    );

    expect(body).toMatch(/new\.client_id\s+is\s+distinct\s+from\s+old\.client_id/i);
    expect(body).toMatch(
      /new\.primary_sub_client_id\s+is\s+not\s+distinct\s+from\s+old\.primary_sub_client_id/i
    );
    expect(body).toMatch(/new\.primary_sub_client_id\s*:=\s*null/i);
  });

  it("clears project selections when the chosen contact is deleted or reparented", () => {
    const body = functionBody(
      migrationSql(),
      "private.clear_invalid_project_primary_sub_client"
    );

    expect(body).toMatch(/update public\.projects/i);
    expect(body).toMatch(/set primary_sub_client_id\s*=\s*null/i);
    expect(body).toMatch(/project\.primary_sub_client_id\s*=\s*new\.id/i);
    expect(body).toMatch(/new\.deleted_at\s+is\s+not\s+null/i);
    expect(body).toMatch(/project\.client_id\s+is\s+distinct\s+from\s+new\.client_id/i);
    expect(body).toMatch(/project\.company_id\s+is\s+distinct\s+from\s+new\.company_id/i);
  });

  it("keeps trigger functions private and search-path hardened", () => {
    const sql = migrationSql();

    expect(sql).toMatch(
      /security definer\s+set search_path = pg_catalog, public, private, pg_temp/i
    );
    expect(sql).toMatch(
      /revoke all on function private\.validate_project_primary_sub_client\(\) from public, anon, authenticated/i
    );
    expect(sql).toMatch(
      /revoke all on function private\.clear_invalid_project_primary_sub_client\(\) from public, anon, authenticated/i
    );
  });
});

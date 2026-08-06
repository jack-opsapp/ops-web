import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260806103000_site_visit_checklist_templates.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

describe("site-visit checklist template migration", () => {
  it("creates one company-scoped, soft-deletable template table", () => {
    expect(sql).toContain("create table public.site_visit_types");
    expect(sql).toMatch(/company_id\s+text\s+not null/);
    expect(sql).toMatch(/fields\s+jsonb\s+not null/);
    expect(sql).toMatch(/deleted_at\s+timestamptz/);
    expect(
      [...sql.matchAll(/create table public\.([a-z0-9_]+)/g)].map(
        (match) => match[1]
      )
    ).toEqual(["site_visit_types"]);
  });

  it("bounds and validates every reusable field definition", () => {
    expect(sql).toContain("private.site_visit_type_fields_valid");
    expect(sql).toMatch(/jsonb_array_length\(p_fields\) between 1 and 100/);
    expect(sql).toMatch(/pg_column_size\(p_fields\) <= 131072/);
    expect(sql).toContain("count(distinct field ->> 'id')");
    expect(sql).toContain("field -> 'isvisible' = 'true'::jsonb");
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
  });

  it("enforces one active slug and one active default per company", () => {
    expect(sql).toMatch(
      /unique index site_visit_types_active_company_slug_uidx[\s\S]*\(company_id, slug\)[\s\S]*where deleted_at is null/
    );
    expect(sql).toMatch(
      /unique index site_visit_types_active_company_default_uidx[\s\S]*\(company_id\)[\s\S]*where deleted_at is null and is_default/
    );
  });

  it("allows company reads but requires company-settings authority to write", () => {
    expect(sql).toContain("alter table public.site_visit_types enable row level security");
    expect(sql).toContain("site_visit_types_company_select");
    expect(sql).toContain("site_visit_types_company_insert");
    expect(sql).toContain("site_visit_types_company_update");
    expect(sql).toContain("private.get_user_company_id");
    expect(sql).toContain("private.current_user_has_permission");
    expect(sql).toContain("'settings.company'");
    expect(sql).toMatch(
      /grant select, insert, update on table public\.site_visit_types\s+to anon, authenticated/
    );
    expect(sql).not.toMatch(
      /grant[^;]*delete[^;]*public\.site_visit_types[^;]*(anon|authenticated)/
    );
    expect(sql).toMatch(
      /grant select, insert, update, delete on table public\.site_visit_types\s+to service_role/
    );
  });

  it("publishes full-row realtime changes and preserves visit snapshots", () => {
    expect(sql).toContain("alter table public.site_visit_types replica identity full");
    expect(sql).toContain("alter publication supabase_realtime add table public.site_visit_types");
    expect(sql).toContain("visit answers remain immutable snapshots");
  });
});

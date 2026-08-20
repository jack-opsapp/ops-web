import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260820172857_fix_related_attachment_record_shadowing.sql"
);

function migration(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("related email attachment reconciliation repair migration", () => {
  it("uses separate scalar and relation names for related attachment IDs", () => {
    const sql = migration();

    expect(sql).toMatch(/v_related_attachment_id uuid/i);
    expect(sql).toMatch(
      /for v_related_attachment_id in\s+select attachment\.id\s+from public\.email_attachments as attachment/i
    );
    expect(sql).toMatch(
      /private\.reconcile_email_attachment_conversion_photo\(\s*v_related_attachment_id\s*\)/i
    );
    expect(sql).not.toMatch(/related_attachment record/i);
  });

  it("short-circuits attachment discovery until a valid content hash exists", () => {
    const sql = migration();

    expect(sql).toMatch(
      /p_company_id is null\s+or p_content_sha256 is null\s+or p_content_sha256 !~ '\^\[0-9a-f\]\{64\}\$'/i
    );
  });

  it("preserves the hardened helper boundary", () => {
    const sql = migration();

    expect(sql).toMatch(/language plpgsql\s+security definer/i);
    expect(sql).toMatch(
      /set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'/i
    );
    expect(sql).toMatch(
      /revoke all on function private\.reconcile_related_email_conversion_photo_sources\(uuid, uuid, uuid, text, text\)\s+from public, anon, authenticated, service_role/i
    );
  });
});

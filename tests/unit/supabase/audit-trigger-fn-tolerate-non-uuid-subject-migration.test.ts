import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260615211000_audit_trigger_fn_tolerate_non_uuid_subject.sql"
  ),
  "utf8"
);

describe("audit_trigger_fn tolerate non-uuid subject migration", () => {
  it("is sentinel-guarded", () => {
    expect(sql).toContain("audit_trigger_non_uuid_subject_sentinel");
  });

  it("recreates audit_trigger_fn as SECURITY DEFINER", () => {
    expect(sql).toContain(
      "create or replace function public.audit_trigger_fn()"
    );
    expect(sql).toContain("security definer");
  });

  it("guards the sub cast behind a uuid-shape check and routes changed_by through it", () => {
    expect(sql).toContain("v_changed_by uuid := case");
    expect(sql).toContain(
      "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    );
    // all three branches must write the guarded variable, never a bare cast
    const inserts = sql
      .split("\n")
      .filter((l) => l.includes("changed_by") && l.includes("values"));
    // VALUES lines reference v_changed_by, not (auth.jwt() ->> 'sub')::uuid
    for (const line of inserts) {
      expect(line).toContain("v_changed_by");
      expect(line).not.toContain("auth.jwt");
    }
  });

  it("preserves all three audit branches", () => {
    expect(sql).toContain("tg_op = 'INSERT'");
    expect(sql).toContain("tg_op = 'UPDATE'");
    expect(sql).toContain("tg_op = 'DELETE'");
  });
});

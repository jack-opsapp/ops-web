import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260615230000_crit3_rls_policies_firebase_subject.sql"
  ),
  "utf8"
);

// the six policy expression blocks that must be rewritten (everything after the
// last header comment line, i.e. the executable body)
const body = sql.slice(sql.indexOf("begin;"));

describe("crit3 rls policies firebase subject migration", () => {
  it("is sentinel-guarded", () => {
    expect(sql).toContain("crit3_rls_subject_sentinel");
  });

  it("alters exactly the six flagged policies", () => {
    const alters = body.match(/alter policy/g) ?? [];
    expect(alters.length).toBe(6);
    expect(body).toContain("on public.task_recurrences");
    expect(body).toContain("on public.task_recurrence_exceptions");
    expect(body).toContain('"Users can view own company reviews" on public.duplicate_reviews');
    expect(body).toContain('"Users can update own company reviews" on public.duplicate_reviews');
    expect(body).toContain("data_setup_requests_insert_company on public.data_setup_requests");
    expect(body).toContain("data_setup_requests_update_admin on public.data_setup_requests");
  });

  it("replaces auth.uid() with the Firebase-safe resolution in every executable expression", () => {
    // the executable body must not call auth.uid() anywhere
    expect(body).not.toContain("auth.uid()");
    // and must use the crit3-safe forms
    expect(body).toContain("users.id = private.get_current_user_id()");
    expect(body).toContain("auth.jwt() ->> 'sub'");
  });

  it("preserves the already-correct company helper clause for data_setup_requests", () => {
    expect(body).toContain("company_id = (select private.get_user_company_id())");
  });
});

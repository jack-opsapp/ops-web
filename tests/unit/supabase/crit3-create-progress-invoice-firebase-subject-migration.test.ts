import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260615220000_crit3_create_progress_invoice_firebase_subject.sql"
  ),
  "utf8"
);

describe("crit3 create_progress_invoice firebase subject migration", () => {
  it("is sentinel-guarded", () => {
    expect(sql).toContain("crit3_progress_invoice_sentinel");
  });

  it("removes the auth.uid() caller lookup and resolves via the helper", () => {
    // the replacement (new) fragment must not cast auth.uid(); it calls the helper
    const parts = sql.split("$new$");
    expect(parts.length).toBeGreaterThan(1);
    const newFragment = parts[1];
    expect(newFragment).not.toContain("auth.uid()");
    expect(newFragment).toContain(
      "v_caller_company := private.get_user_company_id();"
    );
    // post-apply sentinel enforces the live definition is auth.uid()-free
    expect(sql).toContain(
      "crit3_progress_invoice_sentinel: create_progress_invoice still calls auth.uid() after migration"
    );
  });

  it("targets the create_progress_invoice(uuid, jsonb) RPC", () => {
    expect(sql).toContain(
      "public.create_progress_invoice(uuid, jsonb)'::regprocedure"
    );
  });

  it("is idempotent (only rewrites while auth.uid() is still present)", () => {
    expect(sql).toContain("if v_functiondef ~ 'auth\\.uid\\(\\)' then");
  });
});

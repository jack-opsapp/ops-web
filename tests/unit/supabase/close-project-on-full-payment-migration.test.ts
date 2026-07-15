/**
 * Contract test for the paid-invoice → project-closed cascade migration
 * (Automation F, bug af27ea82). Pins the invariants that make the trigger safe:
 * it only ever advances a `completed` project to `closed`, never `archived`;
 * it excludes voided/deleted invoices from "outstanding"; and it can never abort
 * the payment transaction it rides on.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260705120000_close_project_on_full_payment.sql"
);

function sql(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("close_project_on_full_payment migration", () => {
  it("defines the cascade function as a locked-search-path SECURITY DEFINER", () => {
    const s = sql();
    expect(s).toContain("CREATE OR REPLACE FUNCTION public.close_project_when_fully_paid()");
    expect(s).toContain("SECURITY DEFINER");
    expect(s).toContain("SET search_path TO 'public', 'pg_temp'");
  });

  it("fires only on a real invoice→paid transition, after the balance trigger", () => {
    const s = sql();
    expect(s).toContain("AFTER UPDATE OF status ON public.invoices");
    expect(s).toMatch(/WHEN \(NEW\.status = 'paid' AND OLD\.status IS DISTINCT FROM 'paid'\)/);
    expect(s).toContain("EXECUTE FUNCTION public.close_project_when_fully_paid()");
    // Idempotent / re-runnable.
    expect(s).toContain("DROP TRIGGER IF EXISTS trg_close_project_on_full_payment ON public.invoices");
  });

  it("closes only a completed project and never writes 'archived'", () => {
    const s = sql();
    expect(s).toMatch(/SET status = 'closed'/);
    expect(s).toMatch(/AND status = 'completed'/);
    // The cascade is a completion-success path; it must never archive.
    expect(s).not.toContain("'archived'");
  });

  it("computes outstanding from live invoices only (excludes void + soft-deleted)", () => {
    const s = sql();
    expect(s).toContain("SUM(balance_due)");
    expect(s).toContain("deleted_at IS NULL");
    expect(s).toContain("status <> 'void'");
    expect(s).toMatch(/v_outstanding <= 0/);
  });

  it("is best-effort — a cascade failure can never abort payment recording", () => {
    const s = sql();
    expect(s).toContain("EXCEPTION");
    expect(s).toMatch(/WHEN OTHERS THEN/);
    expect(s).toContain("RAISE WARNING");
  });

  it("locks the SECURITY DEFINER function down from direct callers", () => {
    const s = sql();
    expect(s).toContain("REVOKE ALL ON FUNCTION public.close_project_when_fully_paid() FROM PUBLIC");
    expect(s).toContain("FROM anon, authenticated");
  });
});

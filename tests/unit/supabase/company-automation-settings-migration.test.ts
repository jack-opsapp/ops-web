import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260813170000_add_company_automation_settings.sql"
);

function migrationSql(): string {
  return existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
}

describe("company automation settings migration", () => {
  it("adds object-valued schedule and invoice settings with production defaults", () => {
    const sql = migrationSql().toLowerCase();

    expect(sql).toContain(
      "add column if not exists schedule_settings jsonb not null default"
    );
    expect(sql).toContain('"optimization_window_days": 2');
    expect(sql).toContain('"cascade_detection": true');
    expect(sql).toContain('"outdoor_task_type_ids": []');

    expect(sql).toContain(
      "add column if not exists invoice_settings jsonb not null default"
    );
    expect(sql).toContain('"default_payment_terms": "net-30"');
    expect(sql).toContain('"auto_suggest_on_completion": true');
    expect(sql).toContain('"financial_intelligence"');
    expect(sql).toContain('"aging_days_threshold": 60');

    expect(sql).toContain("companies_schedule_settings_object_check");
    expect(sql).toContain("companies_invoice_settings_object_check");
  });

  it("provides a service-role-only atomic invoice settings merge", () => {
    const sql = migrationSql().toLowerCase().replace(/\s+/g, " ");

    expect(sql).toContain("function public.merge_company_invoice_settings(");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("p_patch - 'financial_intelligence'");
    expect(sql).toContain("invoice_settings -> 'financial_intelligence'");
    expect(sql).toContain(
      "revoke all on function public.merge_company_invoice_settings(uuid, jsonb) from public, anon, authenticated"
    );
    expect(sql).toContain(
      "grant execute on function public.merge_company_invoice_settings(uuid, jsonb) to service_role"
    );
  });
});

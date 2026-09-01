import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const BODY_PATH = join(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/artifacts/sql/agent_artifact_sources.body.sql"
);
const BODY = (() => {
  try {
    return readFileSync(BODY_PATH, "utf8").toLowerCase();
  } catch {
    return "";
  }
})();
const COMPACT = BODY.replace(/\s+/g, " ").trim();
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith("_agent_artifact_sources.sql"));

describe("P2 artifact source-fence SQL body", () => {
  it("is transaction-guarded while the official CLI migration reservation remains external", () => {
    expect(BODY).toMatch(/(?:^|\n)begin;\s/);
    expect(BODY.trim().endsWith("commit;")).toBe(true);
    expect(BODY).toContain("task 10 canonical artifact source body");
    expect(BODY).toContain("do $prerequisites$");
    expect(migrationNames).toHaveLength(1);
    expect(migrationNames[0]).toMatch(/^\d{14}_agent_artifact_sources\.sql$/);
    expect(
      readFileSync(
        join(process.cwd(), "supabase/migrations", migrationNames[0]!),
        "utf8"
      ).toLowerCase()
    ).toBe(BODY);
  });

  it("advances artifacts for every metadata, locator, scan, parent-authority, and receipt-allocation dependency", () => {
    for (const table of [
      "attachment_inspections",
      "deck_designs",
      "email_attachment_inspection_jobs",
      "email_attachments",
      "email_connections",
      "estimates",
      "expenses",
      "invoices",
      "opportunities",
      "project_notes",
      "project_photo_annotations",
      "project_photos",
      "project_tasks",
      "projects",
      "site_visit_artifacts",
      "site_visits",
    ]) {
      expect(COMPACT).toContain(
        `on public.${table} for each row execute function private.bump_agent_read_domain_revision('artifacts', 'company_id')`
      );
    }
    expect(COMPACT).toContain(
      "private.bump_agent_artifact_expense_allocation_revision()"
    );
    expect(COMPACT).toContain("on public.expense_project_allocations");
    expect(COMPACT).toContain(
      "private.advance_agent_read_domain_revisions( v_company_ids, 'artifacts' )"
    );
  });

  it("keeps custom helpers private and validates every trigger", () => {
    expect(COMPACT).toContain(
      "language plpgsql security definer set search_path = ''"
    );
    expect(COMPACT).toContain(
      "revoke all on function private.bump_agent_artifact_expense_allocation_revision() from public, anon, authenticated, service_role"
    );
    expect(COMPACT).toContain("do $postflight$");
    expect(COMPACT).not.toContain("grant execute");
  });

  it("pins only the PostgreSQL-17-proven artifact source paths", () => {
    const indexes = [
      "idx_project_photos_agent_artifact_project_v1",
      "idx_project_photo_annotations_agent_artifact_latest_v1",
      "idx_project_notes_agent_artifact_project_v1",
      "idx_projects_agent_artifact_opportunity_v1",
      "idx_site_visit_artifacts_agent_context_v1",
      "idx_site_visits_agent_artifact_opportunity_v1",
      "idx_site_visits_agent_artifact_project_v1",
      "idx_deck_designs_agent_artifact_opportunity_v1",
      "idx_deck_designs_agent_artifact_project_v1",
      "idx_email_attachments_agent_artifact_opportunity_v1",
      "idx_email_attachment_inspection_jobs_agent_artifact_v1",
      "idx_attachment_inspections_agent_artifact_v1",
      "idx_estimates_agent_artifact_opportunity_v1",
      "idx_estimates_agent_artifact_project_v1",
      "idx_invoices_agent_artifact_opportunity_v1",
      "idx_invoices_agent_artifact_project_v1",
      "idx_expense_project_allocations_agent_artifact_project_v1",
    ];

    for (const index of indexes) {
      expect(COMPACT).toContain(`create index if not exists ${index}`);
      expect(COMPACT).toContain(`'${index}'`);
    }
    expect(COMPACT.match(/create index if not exists /g)).toHaveLength(
      indexes.length
    );
    expect(COMPACT).toContain("pg_catalog.pg_get_indexdef(");
    expect(COMPACT).toContain("agent_artifact_source_index_invalid");
    expect(COMPACT).toContain("pg_catalog.lower(company_id)");
    expect(COMPACT).toContain("pg_catalog.lower(project_id)");
    expect(COMPACT).toContain("coalesce(project_ref, project_id)");
    expect(COMPACT).not.toContain("pg_catalog.lower(invoices.project_id)");
  });
});

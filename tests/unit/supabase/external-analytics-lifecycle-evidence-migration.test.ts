import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260727103200_external_analytics_lifecycle_evidence.sql"
);
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const sqlContractPath = resolve(
  process.cwd(),
  "tests/sql/external-analytics-lifecycle-contract.sql"
);
const sqlContract = existsSync(sqlContractPath)
  ? readFileSync(sqlContractPath, "utf8").toLowerCase()
  : "";

describe("external analytics lifecycle evidence migration", () => {
  it("keeps canonical lifecycle facts and immutable events private", () => {
    expect(existsSync(migrationPath)).toBe(true);
    for (const table of [
      "external_lead_lifecycle_facts",
      "external_lead_lifecycle_events",
    ]) {
      expect(source).toContain(`create table private.${table}`);
      expect(source).toMatch(
        new RegExp(
          `alter table private\\.${table}\\s+enable row level security`
        )
      );
      expect(source).toMatch(
        new RegExp(
          `revoke all on table private\\.${table}[\\s\\S]*?from public, anon, authenticated, service_role`
        )
      );
    }
    expect(source).toContain("external_lead_lifecycle_events_append_only");
  });

  it("writes inquiry, stage, terminal, archive, deletion, merge, and conversion evidence in the business transaction", () => {
    expect(source).toContain("external_lead_lifecycle_on_opportunity_change");
    expect(source).toContain("external_lead_lifecycle_on_intake_submission");
    for (const event of [
      "inquiry_received",
      "stage_changed",
      "won",
      "lost",
      "discarded",
      "archived",
      "unarchived",
      "deleted",
      "merged",
      "converted",
    ]) {
      expect(source).toContain(`'${event}'`);
    }
    expect(source).toContain("inquiry_time_quality");
    expect(source).toContain("'exact'");
    expect(source).toContain("'provider'");
    expect(source).toContain("'manual'");
    expect(source).toContain("'fallback'");
  });

  it("records versioned first-response eligibility without treating unknown history as measured", () => {
    expect(source).toContain("response_definition_version");
    expect(source).toContain("response_kind");
    expect(source).toContain("counts_as_first_response");
    expect(source).toContain("first_response_at");
    expect(source).toContain("'automated_acknowledgement'");
    expect(source).toContain("'delivery_receipt'");
    expect(source).toContain("'internal_note'");
    expect(source).toContain("'unknown'");
    expect(source).toContain("record_opportunity_correspondence_event");
    expect(source).toContain("guarded_orphan_email_activity_adoption");
    expect(source).toContain("guarded_orphan_outbound_email_activity_adoption");
  });

  it("preserves canonical commercial commands and attachment projection atomicity", () => {
    expect(source).toContain("move_opportunity_stage");
    expect(source).toMatch(
      /mutate_opportunity_lifecycle[\s\S]*?security definer[\s\S]*?user_can_edit_opportunity/
    );
    expect(source).toContain(
      "external_intake_project_files_on_opportunity_link"
    );
    expect(source).toContain("execute_opportunity_merge_guarded");
    expect(source).toContain("convert_opportunity_to_project");
    expect(source).not.toContain(
      "drop function public.convert_opportunity_to_project"
    );
    expect(source).not.toContain(
      "drop function public.execute_opportunity_merge_guarded"
    );
  });

  it("ships a rollback-only executable SQL contract", () => {
    expect(existsSync(sqlContractPath)).toBe(true);
    expect(sqlContract).toContain("atomic_stage_and_evidence");
    expect(sqlContract).toContain("conversion_is_distinct_from_win");
    expect(sqlContract).toContain("historical_unknown_reduces_coverage");
    expect(sqlContract).toContain("'qualifying'");
    expect(sqlContract).toContain("'in_progress'");
    expect(sqlContract).not.toContain("'contacted'");
    expect(sqlContract.trimEnd()).toMatch(/rollback;$/);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260527140000_lead_lifecycle_p4_foundation.sql"
);

function migrationSql(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("lead lifecycle P4 foundation migration", () => {
  it("uses company-paired relational guards for company-owned references", () => {
    const sql = migrationSql();

    expect(sql).toContain("opportunities_company_id_id_uidx");
    expect(sql).toContain("activities_company_id_id_uidx");
    expect(sql).toContain("ai_draft_history_company_id_id_uidx");
    expect(sql).toContain("users_company_id_id_uidx");
    expect(sql).toContain("clients_company_id_id_uidx");
    expect(sql).toContain("sub_clients_company_id_id_uidx");
    expect(sql).toContain("opportunity_correspondence_events_company_id_id_uidx");

    for (const constraintName of [
      "opportunity_correspondence_events_opportunity_company_fkey",
      "opportunity_correspondence_events_activity_company_fkey",
      "opportunity_follow_up_drafts_opportunity_company_fkey",
      "opportunity_follow_up_drafts_source_event_company_fkey",
      "opportunity_follow_up_drafts_ai_draft_history_company_fkey",
      "opportunity_follow_up_drafts_created_by_company_fkey",
      "opportunity_follow_up_drafts_edited_by_company_fkey",
      "opportunity_lifecycle_state_opportunity_company_fkey",
      "opportunity_lifecycle_state_last_meaningful_event_company_fkey",
    ]) {
      expect(sql).toContain(`constraint ${constraintName}`);
    }
  });

  it("uses validated trigger guards where composite FKs cannot match target column types", () => {
    const sql = migrationSql();

    expect(sql).toContain("lead_lifecycle_enforce_connection_company");
    expect(sql).toContain("lead_lifecycle_enforce_linked_contact_company");
    expect(sql).toContain("opportunity_correspondence_events_connection_company_guard");
    expect(sql).toContain("opportunity_follow_up_drafts_connection_company_guard");
    expect(sql).toContain("opportunity_correspondence_events_linked_contact_company_guard");
    expect(sql).toMatch(/email_connections[\s\S]+company_id <>/);
    expect(sql).toMatch(/linked_contact_kind[\s\S]+sub_client/);
  });

  it("recreates policies safely and avoids broad authenticated write policies", () => {
    const sql = migrationSql();

    for (const policyName of [
      "opportunity_correspondence_events_company_select",
      "opportunity_follow_up_drafts_company_select",
      "opportunity_lifecycle_state_company_select",
      "lead_lifecycle_settings_company_select",
    ]) {
      expect(sql).toContain(`drop policy if exists ${policyName}`);
      expect(sql).toContain(`create policy ${policyName}`);
    }

    expect(sql).toContain("drop policy if exists opportunity_follow_up_drafts_company_all");
    expect(sql).toContain("drop policy if exists opportunity_lifecycle_state_company_all");
    expect(sql).toContain("drop policy if exists lead_lifecycle_settings_company_all");
    expect(sql).not.toMatch(/for all\s+to authenticated/i);
  });
});

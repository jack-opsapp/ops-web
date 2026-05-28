import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260527140000_lead_lifecycle_p4_foundation.sql"
);
const guardedExecutionMigrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260527210000_lead_lifecycle_p4_guarded_action_audit.sql"
);

function migrationSql(): string {
  return readFileSync(migrationPath, "utf8");
}

function guardedExecutionMigrationSql(): string {
  return readFileSync(guardedExecutionMigrationPath, "utf8");
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

  it("adds an auditable, additive table for guarded destructive action attempts", () => {
    const sql = guardedExecutionMigrationSql();

    expect(sql).toContain("create table if not exists public.opportunity_lifecycle_action_audit");
    expect(sql).toContain("before_values jsonb not null");
    expect(sql).toContain("after_values jsonb not null");
    expect(sql).toContain("guard_reason text");
    expect(sql).toContain("error_code text");
    expect(sql).toContain("error_message text");
    expect(sql).toContain("runner text");
    expect(sql).toContain("approved_action_key text");
    expect(sql).toContain("opportunity_lifecycle_action_audit_applied_action_uidx");
    expect(sql).toContain("where status = 'applied'");
    expect(sql).toContain("opportunity_lifecycle_action_audit_opportunity_company_fkey");
    expect(sql).toContain("enable row level security");
    expect(sql).not.toMatch(/for all\s+to authenticated/i);
  });

  it("adds an atomic guarded action RPC that writes audit and opportunity mutation together", () => {
    const sql = guardedExecutionMigrationSql();

    expect(sql).toContain(
      "create or replace function public.execute_opportunity_lifecycle_guarded_action"
    );
    expect(sql).toContain("returns jsonb");
    expect(sql).toContain("language plpgsql");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("for update");
    expect(sql).toContain("insert into public.opportunity_lifecycle_action_audit");
    expect(sql).toContain("update public.opportunities");
    expect(sql).toContain("jsonb_object_keys(coalesce(p_after_values");
    expect(sql).toContain("revoke execute on function public.execute_opportunity_lifecycle_guarded_action");
    expect(sql).toContain("grant execute on function public.execute_opportunity_lifecycle_guarded_action");
    expect(sql).not.toContain("updated_at =");
  });

  it("keeps the guarded destructive action RPC service-role only", () => {
    const sql = guardedExecutionMigrationSql();

    expect(sql).toMatch(
      /revoke\s+execute\s+on\s+function\s+public\.execute_opportunity_lifecycle_guarded_action[\s\S]*?\)\s+from\s+authenticated\s*;/i
    );
    expect(sql).toMatch(
      /revoke\s+execute\s+on\s+function\s+public\.execute_opportunity_lifecycle_guarded_action[\s\S]*?\)\s+from\s+public\s*;/i
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.execute_opportunity_lifecycle_guarded_action[\s\S]*?\)\s+to\s+service_role\s*;/i
    );
    expect(sql).not.toMatch(
      /grant\s+execute\s+on\s+function\s+public\.execute_opportunity_lifecycle_guarded_action[\s\S]*?\)\s+to\s+authenticated\s*;/i
    );
  });

  it("computes guarded action before/after audit payloads on the server", () => {
    const sql = guardedExecutionMigrationSql();

    expect(sql).toContain("v_before_values jsonb");
    expect(sql).toContain("v_after_values jsonb");
    expect(sql).toContain("v_expected_before_values jsonb");
    expect(sql).toContain("v_expected_after_values jsonb");
    expect(sql).toContain("v_before_values := jsonb_build_object");
    expect(sql).toContain("v_after_values := jsonb_build_object");
    expect(sql).toContain("'snapshot_mismatch'");
    expect(sql).not.toMatch(
      /'applied'[\s\S]{0,240}p_before_values[\s\S]{0,240}p_after_values/i
    );
  });
});

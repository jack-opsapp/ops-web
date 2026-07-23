import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260722210500_guarded_orphan_email_activity_adoption.sql"
);
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compact = source.replace(/\s+/g, " ");

describe("guarded orphan email-activity adoption migration", () => {
  it("is one service-role-only transaction with a pinned search path", () => {
    const executable = source.replace(/--[^\n]*/g, "").trim();
    expect(executable.startsWith("begin;")).toBe(true);
    expect(source.trim().endsWith("commit;")).toBe(true);
    expect(compact).toContain(
      "create or replace function public.adopt_orphan_email_activity_as_system"
    );
    expect(compact).toContain("security definer set search_path = ''");
    expect(compact).toContain("auth.role() is distinct from 'service_role'");
    expect(compact).toMatch(
      /revoke all on function public\.adopt_orphan_email_activity_as_system\([\s\S]*?\) from public, anon, authenticated, service_role/
    );
    expect(compact).toMatch(
      /grant execute on function public\.adopt_orphan_email_activity_as_system\([\s\S]*?\) to service_role/
    );
  });

  it("locks the company and active target before any exact child mutation", () => {
    const companyLock = compact.indexOf(
      "perform private.lock_lead_assignment_company(p_company_id)"
    );
    const targetLock = compact.indexOf("from public.opportunities opportunity");
    const activityLock = compact.indexOf("from public.activities activity");
    const activityUpdate = compact.indexOf("update public.activities activity");

    expect(companyLock).toBeGreaterThanOrEqual(0);
    expect(targetLock).toBeGreaterThan(companyLock);
    expect(activityLock).toBeGreaterThan(targetLock);
    expect(activityUpdate).toBeGreaterThan(activityLock);
    expect(compact).toContain("opportunity.deleted_at is null");
    expect(compact).toContain("opportunity.merged_into_opportunity_id is null");
    expect(compact).toMatch(
      /from public\.opportunities opportunity[\s\S]*?for update/
    );
  });

  it("requires the current physical-mailbox lease and public lock mirror", () => {
    expect(compact).toMatch(
      /from private\.email_provider_mailbox_sync_leases lease[\s\S]*?lease\.connection_id = p_connection_id[\s\S]*?lease\.owner_id = p_sync_lock_owner[\s\S]*?lease\.expires_at > clock_timestamp\(\)[\s\S]*?for update/
    );
    expect(compact).toMatch(
      /from public\.email_connections connection[\s\S]*?connection\.company_id = p_company_id::text[\s\S]*?connection\.status = 'active'[\s\S]*?connection\.sync_enabled is true[\s\S]*?connection\.sync_lock_owner = p_sync_lock_owner[\s\S]*?connection\.sync_in_progress_at is not null[\s\S]*?for update/
    );
  });

  it("re-authorizes an active recovery actor for exact ingest and target edit", () => {
    expect(compact).toContain(
      "if p_ingestion_source = 'email_recovery' then"
    );
    expect(compact).toMatch(
      /from public\.users actor[\s\S]*?actor\.id = p_actor_user_id[\s\S]*?actor\.company_id = p_company_id[\s\S]*?actor\.deleted_at is null[\s\S]*?coalesce\(actor\.is_active, false\)[\s\S]*?for share/
    );
    expect(compact).toMatch(
      /public\.authorize_email_exact_message_ingest_as_system\( p_actor_user_id, p_company_id, p_connection_id \)/
    );
    expect(compact).toMatch(
      /private\.user_can_edit_opportunity\( p_actor_user_id, p_target_opportunity_id \)/
    );
  });

  it("locks the exact inbound activity and rejects every conflicting owner or event", () => {
    for (const identity of [
      "activity.id = p_activity_id",
      "activity.company_id = p_company_id",
      "activity.email_connection_id = p_connection_id",
      "activity.email_thread_id = p_provider_thread_id",
      "activity.email_message_id = p_provider_message_id",
      "activity.type = 'email'",
      "activity.direction = 'inbound'",
    ]) {
      expect(compact).toContain(identity);
    }
    expect(compact).toContain("orphan_email_activity_owner_conflict");
    expect(compact).toContain(
      "v_existing_event.opportunity_id is distinct from p_target_opportunity_id"
    );
    expect(compact).toContain(
      "v_existing_event.activity_id is distinct from p_activity_id"
    );
    expect(compact).toContain(
      "v_existing_event.provider_thread_id is distinct from p_provider_thread_id"
    );
    expect(compact).toContain(
      "orphan_email_activity_correspondence_conflict"
    );
  });

  it("fails closed on nullable or padded classification identity", () => {
    expect(compact).toContain("p_ingestion_source is null");
    expect(compact).toContain(
      "p_match_confidence is distinct from btrim(p_match_confidence)"
    );
    expect(compact).toContain("p_party_role is null");
  });

  it("token-gates only the exact NULL-to-target CAS and clears review state", () => {
    expect(compact).toContain(
      "insert into private.opportunity_child_reparent_tokens"
    );
    expect(compact).toContain("'activities', p_activity_id, null,");
    expect(compact).toContain("p_target_opportunity_id");
    expect(compact).toMatch(
      /update public\.activities activity set opportunity_id = p_target_opportunity_id,[\s\S]*?match_needs_review = false,[\s\S]*?suggested_client_id = null,[\s\S]*?activity\.opportunity_id is null/
    );
    expect(compact).toContain(
      "or p_ingestion_source = 'email_recovery'"
    );
  });

  it("records and projects correspondence before returning the adoption receipt", () => {
    const record = compact.indexOf(
      "from public.record_opportunity_correspondence_event("
    );
    const receipt = compact.indexOf("return pg_catalog.jsonb_build_object(");
    expect(record).toBeGreaterThanOrEqual(0);
    expect(receipt).toBeGreaterThan(record);
    expect(compact.slice(record, receipt)).toContain("'inbound'");
    expect(compact.slice(record, receipt)).toContain("'sync_activity'");
    expect(compact.slice(record, receipt)).toContain("true");
    expect(compact).toContain(
      "orphan_email_activity_correspondence_not_projected"
    );
  });

  it("never updates stage, project linkage, or assigned_to", () => {
    const code = source.replace(/--[^\n]*/g, "");
    expect(code).not.toMatch(/update\s+public\.opportunities\s+set/i);
    expect(code).not.toMatch(/assigned_to\s*=/i);
    expect(code).not.toMatch(/project_id\s*=/i);
    expect(code).not.toMatch(/stage\s*=/i);
    expect(code).not.toMatch(/insert\s+into\s+public\.projects/i);
  });
});

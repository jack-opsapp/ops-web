import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260723224713_guarded_orphan_outbound_email_activity_adoption.sql"
);

function sql(): string {
  expect(
    existsSync(migrationPath),
    "guarded orphan outbound adoption migration missing"
  ).toBe(true);
  return readFileSync(migrationPath, "utf8").toLowerCase();
}

describe("guarded orphan outbound email-activity adoption migration", () => {
  it("is one service-role-only transaction with a pinned search path", () => {
    const source = sql();
    const compact = source.replace(/\s+/g, " ");
    const executable = source.replace(/--[^\n]*/g, "").trim();

    expect(executable.startsWith("begin;")).toBe(true);
    expect(source.trim().endsWith("commit;")).toBe(true);
    expect(compact).toContain(
      "create or replace function public.adopt_orphan_outbound_email_activity_with_payload_guard_as_system"
    );
    expect(compact).toContain("security definer set search_path = ''");
    expect(compact).toContain("auth.role() is distinct from 'service_role'");
    expect(compact).toMatch(
      /revoke all on function public\.adopt_orphan_outbound_email_activity_with_payload_guard_as_system\([\s\S]*?\) from public, anon, authenticated, service_role/
    );
    expect(compact).toMatch(
      /grant execute on function public\.adopt_orphan_outbound_email_activity_with_payload_guard_as_system\([\s\S]*?\) to service_role/
    );
  });

  it("locks company, active target, canonical thread owner, mailbox lease, public mirror, and exact activity in order", () => {
    const compact = sql().replace(/\s+/g, " ");
    const companyLock = compact.indexOf(
      "perform private.lock_lead_assignment_company(p_company_id)"
    );
    const targetLock = compact.indexOf("from public.opportunities opportunity");
    const threadLinkLock = compact.indexOf(
      "from public.opportunity_email_threads thread_link"
    );
    const leaseLock = compact.indexOf(
      "from private.email_provider_mailbox_sync_leases lease"
    );
    const connectionLock = compact.indexOf(
      "from public.email_connections connection"
    );
    const activityLock = compact.indexOf("from public.activities activity");
    const activityUpdate = compact.indexOf("update public.activities activity");

    expect(companyLock).toBeGreaterThanOrEqual(0);
    expect(targetLock).toBeGreaterThan(companyLock);
    expect(threadLinkLock).toBeGreaterThan(targetLock);
    expect(leaseLock).toBeGreaterThan(threadLinkLock);
    expect(connectionLock).toBeGreaterThan(leaseLock);
    expect(activityLock).toBeGreaterThan(connectionLock);
    expect(activityUpdate).toBeGreaterThan(activityLock);
    expect(compact).toContain("opportunity.deleted_at is null");
    expect(compact).toContain("opportunity.merged_into_opportunity_id is null");
    expect(compact).toContain(
      "thread_link.opportunity_id = p_target_opportunity_id"
    );
    expect(compact).toContain("thread_link.thread_id = p_provider_thread_id");
    expect(compact).toContain("thread_link.connection_id = p_connection_id");
    expect(compact).toContain(
      "orphan_outbound_email_activity_thread_owner_changed"
    );
    expect(compact).toContain("lease.owner_id = p_sync_lock_owner");
    expect(compact).toContain(
      "lease.expires_at > pg_catalog.clock_timestamp()"
    );
    expect(compact).toContain("connection.sync_lock_owner = p_sync_lock_owner");
  });

  it("binds adoption to the exact persisted outbound payload", () => {
    const compact = sql().replace(/\s+/g, " ");

    for (const identity of [
      "activity.id = p_activity_id",
      "activity.company_id = p_company_id",
      "activity.email_connection_id = p_connection_id",
      "activity.email_thread_id = p_provider_thread_id",
      "activity.email_message_id = p_provider_message_id",
      "activity.type = 'email'",
      "activity.direction = 'outbound'",
      "v_activity.created_at is distinct from p_occurred_at",
      "v_activity.subject is distinct from p_subject",
      "v_activity.content is distinct from p_content",
      "v_activity.body_text is distinct from p_body_text",
      "v_activity.body_text_clean is distinct from p_body_text_clean",
    ]) {
      expect(compact).toContain(identity);
    }
    expect(compact).toContain("orphan_outbound_email_activity_payload_changed");
  });

  it("accepts only ordinary lease-owned email sync, never a user-forged recovery mode", () => {
    const compact = sql().replace(/\s+/g, " ");

    expect(compact).toContain("p_actor_user_id is not null");
    expect(compact).toContain(
      "p_ingestion_source is distinct from 'email_sync'"
    );
    expect(compact).toContain("invalid_orphan_outbound_email_activity_adoption");
  });

  it("rejects conflicting owners or correspondence identities", () => {
    const compact = sql().replace(/\s+/g, " ");

    expect(compact).toContain("orphan_outbound_email_activity_owner_conflict");
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
      "v_existing_event.direction is distinct from 'outbound'"
    );
    expect(compact).toContain(
      "orphan_outbound_email_activity_correspondence_conflict"
    );
  });

  it("token-gates the exact NULL-to-target CAS and clears review state", () => {
    const compact = sql().replace(/\s+/g, " ");

    expect(compact).toContain(
      "insert into private.opportunity_child_reparent_tokens"
    );
    expect(compact).toContain("'activities', p_activity_id, null,");
    expect(compact).toMatch(
      /update public\.activities activity set opportunity_id = p_target_opportunity_id,[\s\S]*?match_needs_review = false,[\s\S]*?suggested_client_id = null,[\s\S]*?match_confidence = p_match_confidence,[\s\S]*?activity\.opportunity_id is null/
    );
    expect(compact).toContain("orphan_outbound_email_activity_adoption_race");
    expect(compact).toContain(
      "delete from private.opportunity_child_reparent_tokens"
    );
  });

  it("atomically records one outbound correspondence projection before returning", () => {
    const compact = sql().replace(/\s+/g, " ");
    const record = compact.indexOf(
      "from public.record_opportunity_correspondence_event("
    );
    const receipt = compact.indexOf(
      "return pg_catalog.jsonb_build_object("
    );

    expect(record).toBeGreaterThanOrEqual(0);
    expect(receipt).toBeGreaterThan(record);
    expect(compact.slice(record, receipt)).toContain("'outbound'");
    expect(compact.slice(record, receipt)).toContain("'sync_activity'");
    expect(compact.slice(record, receipt)).toContain("true");
    expect(compact).toContain(
      "orphan_outbound_email_activity_correspondence_not_projected"
    );
  });

  it("never changes lead stage, assignment, project linkage, or provider state", () => {
    const code = sql().replace(/--[^\n]*/g, "");

    expect(code).not.toMatch(/update\s+public\.opportunities\s+set/i);
    expect(code).not.toMatch(/assigned_to\s*=/i);
    expect(code).not.toMatch(/project_id\s*=/i);
    expect(code).not.toMatch(/stage\s*=/i);
    expect(code).not.toMatch(/insert\s+into\s+public\.projects/i);
    expect(code).not.toMatch(/gmail|microsoft|provider_draft_id/i);
  });
});

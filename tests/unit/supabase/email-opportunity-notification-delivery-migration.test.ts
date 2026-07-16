import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260715177000_email_opportunity_notification_delivery.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compact = sql.replace(/\s+/g, " ");
const syncFunctionStart = compact.indexOf(
  "create or replace function public.create_email_sync_complete_notification_as_system("
);
const syncFunctionEnd = compact.indexOf(
  "revoke all on function public.create_email_sync_complete_notification_as_system(",
  syncFunctionStart
);
const syncFunction = compact.slice(syncFunctionStart, syncFunctionEnd);

describe("email opportunity notification delivery migration", () => {
  it("defines one service-only, non-generic notification operation", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(compact).toContain(
      "create or replace function public.create_email_opportunity_notification_as_system( p_opportunity_id uuid, p_connection_id uuid, p_provider_thread_id text, p_expected_assignment_version bigint, p_event_type text )"
    );
    expect(compact).toContain(
      "coalesce(auth.jwt() ->> 'role', '') <> 'service_role'"
    );
    expect(compact).toContain(
      "revoke all on function public.create_email_opportunity_notification_as_system( uuid, uuid, text, bigint, text ) from public, anon, authenticated, service_role"
    );
    expect(compact).toContain(
      "grant execute on function public.create_email_opportunity_notification_as_system( uuid, uuid, text, bigint, text ) to service_role"
    );
    expect(compact).not.toContain("p_recipient_user_id");
    expect(compact).not.toContain("p_company_id");
    expect(compact).not.toContain("p_title");
    expect(compact).not.toContain("p_body");
  });

  it("locks and fences the current assignment before deriving the recipient", () => {
    const lockIndex = compact.indexOf("from public.opportunities opportunity");
    const insertIndex = compact.indexOf("insert into public.notifications");
    expect(lockIndex).toBeGreaterThan(-1);
    expect(compact.slice(lockIndex, insertIndex)).toContain("for update");
    expect(compact.slice(lockIndex, insertIndex)).toContain(
      "opportunity.assignment_version = p_expected_assignment_version"
    );
    expect(compact.slice(lockIndex, insertIndex)).toContain(
      "opportunity.assigned_to is not null"
    );
    expect(compact).toContain(
      "v_recipient_user_id := v_opportunity.assigned_to"
    );
    expect(lockIndex).toBeLessThan(insertIndex);
  });

  it("requires the exact mailbox thread and canonical lead inbox intersection", () => {
    expect(compact).toContain("from public.email_threads thread");
    expect(compact).toContain("thread.connection_id = p_connection_id");
    expect(compact).toContain(
      "thread.provider_thread_id = btrim(p_provider_thread_id)"
    );
    expect(compact).toContain("thread.opportunity_id = p_opportunity_id");
    expect(compact).toContain("from public.opportunity_email_threads link");
    expect(compact).toContain("private.user_can_view_opportunity_inbox(");
    expect(compact).toContain("private.user_can_convert_opportunity(");
    expect(compact).toContain("coalesce(user_row.is_active, false)");
    expect(compact).not.toContain("coalesce(user_row.is_active, true)");
    expect(compact).not.toContain("public.has_permission(v_recipient_user_id");
    expect(compact).not.toContain("'pipeline.manage'");
    expect(compact).not.toContain("lower(user_row.email)");
  });

  it("allows only known email events and dedupes from server-derived identity", () => {
    for (const eventType of [
      "terminal_likely_won",
      "terminal_likely_lost",
      "accept_auto_won",
      "accept_review_won",
      "thread_customer",
      "thread_platform_bid",
      "thread_urgent",
    ]) {
      expect(compact).toContain(`'${eventType}'`);
    }
    expect(compact).toContain(
      "v_dedupe_key := 'email-opportunity-event:' || p_event_type || ':' || p_opportunity_id::text || ':' || v_thread.id::text || ':' || p_expected_assignment_version::text"
    );
    expect(compact).toContain("on conflict do nothing");
    expect(compact).not.toContain("update public.opportunities");
    expect(compact).not.toContain("set assigned_to");
  });

  it("derives classified-thread alert copy and destination from the locked thread", () => {
    expect(compact).toContain("v_thread.latest_sender_name");
    expect(compact).toContain("v_thread.latest_sender_email");
    expect(compact).toContain("v_thread.subject");
    expect(compact).toContain(
      "'/inbox?thread=' || v_thread.id::text || '&opportunityid=' || p_opportunity_id::text"
    );
    expect(compact).not.toContain("connection.user_id as recipient");
  });
});

describe("email sync-complete notification delivery migration", () => {
  it("defines a narrow service-only operation without generic notification inputs", () => {
    expect(syncFunctionStart).toBeGreaterThan(-1);
    expect(syncFunctionEnd).toBeGreaterThan(syncFunctionStart);
    expect(syncFunction).toContain(
      "create or replace function public.create_email_sync_complete_notification_as_system( p_connection_id uuid, p_expected_owner_user_id uuid, p_new_leads integer, p_matched integer, p_needs_review integer )"
    );
    expect(syncFunction).toContain(
      "coalesce(auth.jwt() ->> 'role', '') <> 'service_role'"
    );
    expect(compact).toContain(
      "revoke all on function public.create_email_sync_complete_notification_as_system( uuid, uuid, integer, integer, integer ) from public, anon, authenticated, service_role"
    );
    expect(compact).toContain(
      "grant execute on function public.create_email_sync_complete_notification_as_system( uuid, uuid, integer, integer, integer ) to service_role"
    );
    for (const forbidden of [
      "p_company_id",
      "p_recipient_user_id",
      "p_title",
      "p_body",
      "p_action_url",
      "p_mailbox_address",
    ]) {
      expect(syncFunction).not.toContain(forbidden);
    }
  });

  it("locks the exact personal mailbox and fences the current owner", () => {
    const connectionIndex = syncFunction.indexOf(
      "from public.email_connections connection"
    );
    const notificationIndex = syncFunction.indexOf(
      "insert into public.notifications"
    );
    expect(connectionIndex).toBeGreaterThan(-1);
    expect(notificationIndex).toBeGreaterThan(connectionIndex);
    expect(syncFunction.slice(connectionIndex, notificationIndex)).toContain(
      "connection.id = p_connection_id"
    );
    expect(syncFunction.slice(connectionIndex, notificationIndex)).toContain(
      "for update"
    );
    expect(syncFunction).toContain("v_connection.type::text <> 'individual'");
    expect(syncFunction).toContain(
      "v_connection.user_id <> p_expected_owner_user_id::text"
    );
    expect(syncFunction).not.toContain("v_connection.type::text = 'company'");
  });

  it("requires the exact active OPS owner in the mailbox company", () => {
    const userIndex = syncFunction.indexOf("from public.users user_row");
    const permissionIndex = syncFunction.indexOf(
      "private.user_can_view_inbox_connection("
    );
    expect(syncFunction).toContain("from public.users user_row");
    expect(syncFunction).toContain("user_row.id = p_expected_owner_user_id");
    expect(syncFunction).toContain(
      "user_row.company_id::text = v_connection.company_id"
    );
    expect(syncFunction).toContain("user_row.deleted_at is null");
    expect(syncFunction).toContain("coalesce(user_row.is_active, false)");
    expect(syncFunction).not.toContain("coalesce(user_row.is_active, true)");
    expect(syncFunction.slice(userIndex, permissionIndex)).toContain(
      "for share"
    );
    expect(syncFunction).toContain("private.user_can_view_inbox_connection(");
    expect(syncFunction).not.toContain("public.has_permission(");
    expect(syncFunction).not.toContain("lower(user_row.email)");
  });

  it("bounds all counts and derives generic mailbox-only copy", () => {
    for (const count of ["p_new_leads", "p_matched", "p_needs_review"]) {
      expect(syncFunction).toContain(`${count} < 0`);
      expect(syncFunction).toContain(`${count} > 10000`);
    }
    expect(syncFunction).toContain("v_connection.email");
    expect(syncFunction).toContain("'email_sync_complete'");
    expect(syncFunction).not.toContain("latest_sender");
    expect(syncFunction).not.toContain("from_email");
    expect(syncFunction).not.toContain("subject");
    expect(syncFunction).not.toContain("activities");
  });

  it("derives the destination from inbox_ui and dedupes each count snapshot per hour", () => {
    expect(syncFunction).toContain("from public.admin_feature_overrides flag");
    expect(syncFunction).toContain("flag.company_id = v_company_id");
    expect(syncFunction).toContain("flag.feature_key = 'inbox_ui'");
    expect(syncFunction).toContain("flag.enabled = true");
    expect(syncFunction).toContain("then '/inbox'");
    expect(syncFunction).toContain("else '/pipeline'");
    expect(syncFunction).toContain(
      "date_trunc('hour', transaction_timestamp())"
    );
    expect(syncFunction).toContain("p_new_leads::text");
    expect(syncFunction).toContain("p_matched::text");
    expect(syncFunction).toContain("p_needs_review::text");
    expect(syncFunction).toContain("on conflict do nothing");
  });
});

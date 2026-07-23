import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260723092000_event_scoped_exact_recovery_lifecycle_context.sql"
);
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compact = source.replace(/\s+/g, " ");

describe("event-scoped exact-recovery lifecycle context", () => {
  it("keeps canonical recovery entrypoints while fencing their delegates", () => {
    expect(compact).toContain(
      "alter function public.reparent_opportunity_email_message_guarded"
    );
    expect(compact).toContain("set schema private");
    expect(compact).toContain(
      "rename to reparent_email_message_exact_delegate"
    );
    expect(compact).toContain(
      "alter function public.create_target_and_reparent_opportunity_email_message_guarded"
    );
    expect(compact).toContain(
      "rename to create_target_reparent_email_exact_delegate"
    );
    expect(compact).toMatch(
      /revoke all on function private\.reparent_email_message_exact_delegate\([\s\S]*?\) from public, anon, authenticated, service_role/
    );
    expect(compact).toMatch(
      /revoke all on function private\.create_target_reparent_email_exact_delegate\([\s\S]*?\) from public, anon, authenticated, service_role/
    );
    expect(compact).toContain(
      "pg_catalog.set_config( 'ops.exact_recovery_event_id', p_expected_correspondence_event_id::text, true )"
    );
    expect(compact).toContain(
      "private.reparent_email_message_exact_delegate("
    );
    expect(compact).toContain(
      "private.create_target_reparent_email_exact_delegate("
    );
    for (const identifier of [
      "reparent_email_message_exact_delegate",
      "create_target_reparent_email_exact_delegate",
    ]) {
      expect(identifier.length).toBeLessThanOrEqual(63);
    }
  });

  it("allows only inert historical notification state behind exact event proof", () => {
    expect(compact).toContain(
      "create or replace function private.assert_exact_message_lifecycle_recomputable"
    );
    expect(compact).toContain(
      "pg_catalog.current_setting('ops.exact_recovery_event_id', true)"
    );
    expect(compact).toContain(
      "event.id = v_context_event_id and event.company_id = p_company_id and event.opportunity_id = p_opportunity_id"
    );
    expect(compact).toContain("event.is_meaningful is true");
    expect(compact).toContain(
      "event.opportunity_projection_applied is true"
    );
    expect(compact).toContain(
      "v_state.last_meaningful_event_id is distinct from v_latest_event_id"
    );
    expect(compact).toContain("v_latest_event_id = v_context_event_id");
    expect(compact).toContain(
      "p_latest_event_occurred_at > p_moved_event_occurred_at"
    );
    expect(compact).toContain(
      "p_latest_active_notification_created_at < p_moved_event_occurred_at"
    );
    expect(compact).toContain(
      "private.exact_recovery_notification_history_is_inert("
    );
    for (const preservedGuard of [
      "state.unanswered_follow_up_count <> 0",
      "state.second_follow_up_sent_at is not null",
      "state.operator_follow_up_miss_at is not null",
      "state.stale_status is not null",
      "state.stale_status_at is not null",
      "state.protected_until is not null",
      "from public.opportunity_follow_up_drafts draft",
      "from public.opportunity_lifecycle_action_audit action",
      "action.status = 'applied'",
    ]) {
      expect(compact).toContain(preservedGuard);
    }
  });

  it("remains transactional and service-role only", () => {
    const executable = source.replace(/--[^\n]*/g, "").trim();
    expect(executable.startsWith("begin;")).toBe(true);
    expect(source.trim().endsWith("commit;")).toBe(true);
    expect(compact).toContain(
      "if auth.role() is distinct from 'service_role' then"
    );
    expect(compact).toContain(
      "lock table public.opportunity_lifecycle_action_audit, public.opportunity_lifecycle_state, public.opportunity_follow_up_drafts, public.notifications in share row exclusive mode"
    );
    const lifecycleGuardIndex = compact.indexOf(
      "create or replace function private.assert_exact_message_lifecycle_recomputable"
    );
    const lifecycleFenceIndex = compact.indexOf(
      "lock table public.opportunity_lifecycle_action_audit"
    );
    const publicWrapperIndex = compact.indexOf(
      "create or replace function public.reparent_opportunity_email_message_guarded"
    );
    expect(lifecycleFenceIndex).toBeGreaterThan(lifecycleGuardIndex);
    expect(lifecycleFenceIndex).toBeLessThan(publicWrapperIndex);
    expect(compact).toContain(
      "select max(notification.created_at) into v_latest_active_notification_created_at"
    );
    expect(
      compact.match(
        /pg_catalog\.current_setting\(\s*'ops\.exact_recovery_event_id',\s*true\s*\)/g
      )?.length
    ).toBeGreaterThanOrEqual(3);
    expect(
      compact.match(
        /pg_catalog\.set_config\( 'ops\.exact_recovery_event_id'/g
      )?.length
    ).toBeGreaterThanOrEqual(6);
    expect(compact).not.toContain("pg_catalog.coalesce");
    expect(compact).toMatch(
      /revoke all on function public\.reparent_opportunity_email_message_guarded\([\s\S]*?\) from public, anon, authenticated, service_role/
    );
    expect(compact).toMatch(
      /grant execute on function public\.reparent_opportunity_email_message_guarded\([\s\S]*?\) to service_role/
    );
    expect(compact).toMatch(
      /revoke all on function public\.create_target_and_reparent_opportunity_email_message_guarded\([\s\S]*?\) from public, anon, authenticated, service_role/
    );
    expect(compact).toMatch(
      /grant execute on function public\.create_target_and_reparent_opportunity_email_message_guarded\([\s\S]*?\) to service_role/
    );
  });
});

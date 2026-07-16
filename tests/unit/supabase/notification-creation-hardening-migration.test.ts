import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260715180500_notification_creation_hardening.sql"
  ),
  "utf8"
);

describe("notification creation hardening migration", () => {
  it("removes every direct client notification creation privilege", () => {
    expect(sql).toMatch(
      /drop policy if exists notifications_insert_company on public\.notifications/i
    );
    expect(sql).toMatch(
      /revoke insert, delete, truncate on table public\.notifications\s+from public, anon, authenticated/i
    );
    expect(sql).toMatch(
      /revoke all on function public\.create_notification_if_new\([\s\S]*?\) from public, anon, authenticated/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.create_notification_if_new\([\s\S]*?\) to service_role/i
    );
  });

  it("adds a service-only dedupe seam that reports whether a row was created", () => {
    expect(sql).toMatch(
      /create or replace function public\.create_notification_if_new_with_status\([\s\S]*?\)\s*returns boolean/i
    );
    expect(sql).toMatch(/get diagnostics v_inserted = row_count/i);
    expect(sql).toMatch(/return v_inserted = 1/i);
    expect(sql).toMatch(
      /revoke all on function public\.create_notification_if_new_with_status\([\s\S]*?\)\s+from public, anon, authenticated, service_role/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.create_notification_if_new_with_status\([\s\S]*?\)\s+to service_role/i
    );
  });

  it("enforces relative internal action URLs for every future table write", () => {
    expect(sql).toContain("notification_action_url_internal");
    expect(sql).toMatch(/action_url is null/i);
    expect(sql).toMatch(/left\(action_url, 1\) = '\/'/i);
    expect(sql).toMatch(/left\(action_url, 2\) <> '\/\/'/i);
    expect(sql).toMatch(/position\(E'\\\\' in action_url\) = 0/i);
    expect(sql).toMatch(/action_url !~ '\[\[:cntrl:\]\]'/i);
    expect(sql).toMatch(
      /update public\.notifications[\s\S]*?set action_url = null,[\s\S]*?action_label = null/i
    );
  });

  it("exposes one narrow lockout request RPC with server-derived identity, recipients, copy, and actions", () => {
    expect(sql).toMatch(
      /create or replace function public\.request_lockout_admin_notification\(\s*\)/i
    );
    expect(sql).toContain("private.get_current_user_id()");
    expect(sql).toMatch(/u\.company_id = v_company_id/i);
    expect(sql).toMatch(/coalesce\(u\.is_active, false\) = true/i);
    expect(sql).toContain("public.users_with_permission");
    expect(sql).toContain("team.assign_roles");
    expect(sql).toContain("settings.billing");
    expect(sql).toContain("Access Request");
    expect(sql).toContain("Reactivation Request");
    expect(sql).toContain("/settings?section=team");
    expect(sql).toContain("/settings?section=billing");
    expect(sql).toContain("v_company.subscription_status");
    expect(sql).toContain("v_company.trial_end_date");
    expect(sql).toContain("v_company.seated_employee_ids");
    expect(sql).toContain("v_company.admin_ids");
    expect(sql).toMatch(/v_reason := 'subscription_expired'/i);
    expect(sql).toMatch(/v_reason := 'unseated'/i);
    expect(sql).toMatch(/notification actor is not locked out/i);
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toMatch(/interval '24 hours'/i);
    const signature = sql.match(
      /create or replace function public\.request_lockout_admin_notification\(([\s\S]*?)\)\s*returns/i
    )?.[1];
    expect(signature).toBeDefined();
    expect(signature).not.toContain("p_reason");
    expect(signature).not.toMatch(
      /user|company|recipient|admin|title|body|action|persistent/i
    );
  });

  it("grants the narrow RPC to app sessions without reopening generic creation", () => {
    expect(sql).toMatch(
      /revoke all on function public\.request_lockout_admin_notification\(\)\s+from public, anon, authenticated, service_role/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.request_lockout_admin_notification\(\)\s+to anon, authenticated/i
    );
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
  });

  it("replaces the forgeable signature prompt RPC with an actor-scoped service bridge", () => {
    expect(sql).toMatch(
      /revoke all on function public\.sync_email_signature_notification\(uuid, uuid, uuid\)\s+from public, anon, authenticated, service_role/i
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.sync_email_signature_notification\(uuid, uuid, uuid\)/i
    );

    expect(sql).toMatch(
      /create or replace function public\.sync_email_signature_notification_as_system\(\s*p_actor_user_id uuid,\s*p_connection_id uuid\s*\)/i
    );
    expect(sql).toMatch(
      /create or replace function private\.user_has_email_signature_notification_path\(\s*p_actor_user_id uuid,\s*p_connection_id uuid\s*\)/i
    );
    expect(sql).toMatch(/actor\.id = p_actor_user_id/i);
    expect(sql).toMatch(/coalesce\(actor\.is_active, false\)/i);
    expect(sql).toMatch(/actor\.deleted_at is null/i);
    expect(sql).toMatch(/connection\.company_id = v_company_id::text/i);
    expect(sql).toMatch(/connection\.status = 'active'/i);
    expect(sql).toMatch(/coalesce\(connection\.sync_enabled, false\)/i);
    expect(sql).toMatch(/v_connection\.type = 'individual'/i);
    expect(sql).toMatch(
      /nullif\(btrim\(v_connection\.user_id\), ''\) = p_actor_user_id::text/i
    );
    expect(sql).toMatch(/private\.user_can_send_inbox_connection\(/i);
    expect(sql).toMatch(/private\.user_can_send_opportunity_inbox\(/i);
    expect(sql).not.toMatch(
      /public\.has_permission\(\s*p_actor_user_id,\s*'inbox\.send'/i
    );
    expect(sql).toMatch(
      /public\.has_permission\(\s*p_actor_user_id,\s*'settings\.integrations',\s*'all'\s*\)/i
    );
    expect(sql).toContain("/settings?section=profile&connection=");

    const signature = sql.match(
      /create or replace function public\.sync_email_signature_notification_as_system\(([\s\S]*?)\)\s*returns/i
    )?.[1];
    expect(signature).toBeDefined();
    expect(signature).not.toMatch(/company|scope|recipient|title|body|action/i);

    expect(sql).toMatch(
      /revoke all on function public\.sync_email_signature_notification_as_system\(uuid, uuid\)\s+from public, anon, authenticated, service_role/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.sync_email_signature_notification_as_system\(uuid, uuid\)\s+to service_role/i
    );
  });
});

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const path = join(
  process.cwd(),
  "supabase/migrations/20260715177500_email_attachment_notification_identity.sql"
);
const sql = existsSync(path) ? readFileSync(path, "utf8").toLowerCase() : "";
const compact = sql.replace(/\s+/g, " ");

function functionBody(name: string, nextMarker: string): string {
  const start = compact.indexOf(`create or replace function ${name}`);
  const end = compact.indexOf(nextMarker, start + 1);
  return compact.slice(start, end < 0 ? undefined : end);
}

describe("email attachment notification identity migration", () => {
  it("defines a narrow service-only attachment exception operation", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(compact).toContain(
      "create or replace function public.notify_email_attachment_scan_exception_as_system( p_scan_id uuid )"
    );
    expect(compact).toContain(
      "coalesce(auth.jwt() ->> 'role', '') <> 'service_role'"
    );
    expect(compact).toContain(
      "revoke all on function public.notify_email_attachment_scan_exception_as_system( uuid ) from public, anon, authenticated, service_role"
    );
    expect(compact).toContain(
      "grant execute on function public.notify_email_attachment_scan_exception_as_system( uuid ) to service_role"
    );
    expect(compact).toContain(
      "revoke execute on function public.notify_email_attachment_scan_exception( uuid, uuid, text, text, text, text, text ) from service_role"
    );

    const body = functionBody(
      "public.notify_email_attachment_scan_exception_as_system(",
      "revoke all on function public.notify_email_attachment_scan_exception_as_system("
    );
    for (const spoofable of [
      "p_company_id",
      "p_user_id",
      "p_title",
      "p_body",
      "p_action_url",
      "p_action_label",
    ]) {
      expect(body).not.toContain(spoofable);
    }
  });

  it("derives a linked recipient from the current lead assignment and inbox intersection", () => {
    const helper = functionBody(
      "private.resolve_email_attachment_notification_recipient(",
      "revoke all on function private.resolve_email_attachment_notification_recipient("
    );
    expect(helper).toContain("private.user_can_view_opportunity_inbox(");
    expect(helper).toContain("opportunity.assigned_to is not null");
    expect(helper).toContain("private.user_can_view_inbox_connection(");
    expect(helper).not.toContain("public.has_permission(v_recipient");
    expect(helper).toContain("coalesce(user_row.is_active, false)");
    expect(helper).not.toContain("coalesce(user_row.is_active, true)");
    expect(helper).not.toContain("lower(user_row.email)");
    expect(helper).not.toContain("pipeline.manage");
  });

  it("uses mailbox ownership only for an exact individual mailbox without a lead", () => {
    const helper = functionBody(
      "private.resolve_email_attachment_notification_recipient(",
      "revoke all on function private.resolve_email_attachment_notification_recipient("
    );
    expect(helper).toContain("v_connection_type <> 'individual'");
    expect(helper).toContain("user_row.id::text = v_connection_user_id");
    expect(helper).not.toContain("connection.user_id as recipient");
    expect(helper).not.toContain("is_company_admin");
    expect(helper).not.toContain("fallback_recipient");
  });

  it("fails closed when thread, activity, and link lead identities conflict", () => {
    const helper = functionBody(
      "private.resolve_email_attachment_notification_recipient(",
      "revoke all on function private.resolve_email_attachment_notification_recipient("
    );
    expect(helper).toContain("cardinality(v_link_opportunity_ids) > 1");
    expect(helper).toContain(
      "v_thread_opportunity_id is distinct from v_link_opportunity_id"
    );
    expect(helper).toContain(
      "v_activity_opportunity_id is distinct from v_canonical_opportunity_id"
    );
  });

  it("routes terminal attachment failures through the same recipient helper", () => {
    const trigger = functionBody(
      "public.notify_terminal_email_attachment_failure(",
      "revoke all on function public.notify_terminal_email_attachment_failure("
    );
    expect(trigger).toContain(
      "private.resolve_email_attachment_notification_recipient("
    );
    expect(trigger).not.toContain("connection.user_id");
    expect(trigger).not.toContain("is_company_admin");
    expect(trigger).not.toContain("fallback_recipient");
  });

  it("marks reconnects without treating a company connector as notification authority", () => {
    const reconnect = functionBody(
      "public.mark_email_connection_needs_reconnect_as_system(",
      "revoke all on function public.mark_email_connection_needs_reconnect_as_system("
    );
    expect(reconnect).toContain("connection.type::text = 'company'");
    expect(reconnect).toContain(
      "public.has_permission( user_row.id, 'settings.integrations', 'all' )"
    );
    expect(reconnect).toContain("coalesce(user_row.is_active, false)");
    expect(reconnect).not.toContain("connection.user_id");
    expect(reconnect).not.toContain("is_company_admin");
    expect(reconnect).not.toContain("fallback_recipient");
  });
});

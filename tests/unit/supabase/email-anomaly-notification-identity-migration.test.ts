import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260813172000_email_anomaly_notification_identity.sql"
  ),
  "utf8"
).toLowerCase();

describe("email anomaly notification identity migration", () => {
  it("keeps one event-scoped row independent of read or resolution state", () => {
    expect(sql).toContain("notifications_email_anomaly_event_unique");
    expect(sql).toContain("on public.notifications (type, dedupe_key)");
    expect(sql).not.toContain(
      "notifications_email_anomaly_event_unique\n  on public.notifications (user_id, company_id, type, dedupe_key)"
    );
    expect(sql).toContain("where type = 'email_anomaly'");
    expect(sql).not.toMatch(
      /notifications_email_anomaly_event_unique[\s\S]*?where[\s\S]*?is_read\s*=\s*false/
    );
    expect(sql).not.toMatch(
      /notifications_email_anomaly_event_unique[\s\S]*?where[\s\S]*?resolved_at\s+is\s+null/
    );
    expect(sql).toContain("'email-anomaly:' || p_anomaly_id::text");
  });

  it("exposes only a service-role RPC and reconciles the exact durable row", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("auth.jwt() ->> 'role'");
    expect(sql).toContain("service_role");
    expect(sql).toContain("on conflict do nothing");
    expect(sql).toContain("notification.dedupe_key = v_dedupe_key");
    expect(sql).not.toMatch(
      /select notification\.id[\s\S]*?where notification\.user_id = p_user_id::text[\s\S]*?notification\.dedupe_key = v_dedupe_key/
    );
    expect(sql).toContain("revoke all on function");
    expect(sql).toContain("grant execute on function");
  });

  it("durably retries pause notification fanout by anomaly and audit identity", () => {
    expect(sql).toContain("notifications_email_pause_anomaly_unique");
    expect(sql).toContain(
      "on public.notifications (user_id, company_id, type, dedupe_key)"
    );
    expect(sql).toContain("select distinct\n    recipient.id::text");
    expect(sql).toContain("reconcile_email_pause_notification_fanout");
    expect(sql).toContain("'email-pause-anomaly:' || p_anomaly_id::text");
    expect(sql).toContain("audit.id = p_pause_audit_id");
    expect(sql).toContain("audit.anomaly_log_id = p_anomaly_id");
    expect(sql).toContain("pause_state.is_paused");
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260813172000_email_anomaly_notification_identity.sql"
  ),
  "utf8"
).toLowerCase();

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const forwardRepairMigrationNames = readdirSync(migrationsDirectory).filter(
  (name) =>
    /^\d{14}_email_anomaly_notification_identity_forward_repair_20260813172000\.sql$/.test(
      name
    )
);

function expectExecutablePostgresExpressions(source: string): void {
  expect(source).not.toContain("pg_catalog.coalesce(");
  expect(source).not.toContain("pg_catalog.nullif(");
}

describe("email anomaly notification identity migration", () => {
  it("replays the skipped historical contract under the current forward ledger", () => {
    expect(
      forwardRepairMigrationNames,
      "the production ledger skipped the historical migration, so one forward repair migration must exist"
    ).toHaveLength(1);

    const repairMigrationName = forwardRepairMigrationNames[0];
    if (!repairMigrationName) return;

    const repairSql = readFileSync(
      join(migrationsDirectory, repairMigrationName),
      "utf8"
    ).toLowerCase();

    expect(repairSql).toContain(
      "create or replace function public.create_email_anomaly_notification_if_new("
    );
    expect(repairSql).toContain(
      "create or replace function public.reconcile_email_pause_notification_fanout("
    );
    expect(repairSql).toContain("notifications_email_anomaly_event_unique");
    expect(repairSql).toContain("notifications_email_pause_anomaly_unique");
    expect(repairSql).toContain(
      "revoke all on function public.create_email_anomaly_notification_if_new("
    );
    expect(repairSql).toContain(
      "revoke all on function public.reconcile_email_pause_notification_fanout("
    );
    expect(repairSql).toMatch(
      /grant execute on function public\.create_email_anomaly_notification_if_new\([\s\S]*?\) to service_role;/
    );
    expect(repairSql).toMatch(
      /grant execute on function public\.reconcile_email_pause_notification_fanout\([\s\S]*?\) to service_role;/
    );
    expect(repairSql).toContain("from pg_catalog.pg_index as target_index");
    expect(repairSql).toContain("target_index.indisunique");
    expect(repairSql).toContain("target_index.indisvalid");
    expect(repairSql).toContain("target_index.indisready");
    expect(repairSql).toContain("target_index.indnkeyatts = 2");
    expect(repairSql).toContain("target_index.indnkeyatts = 4");
    expect(
      repairSql.match(/not \(0 = any\(target_index\.indkey::smallint\[\]\)\)/g)
    ).toHaveLength(2);
    expect(repairSql).toContain("pg_catalog.pg_get_expr(");
    expect(repairSql).toMatch(
      /pg_catalog\.has_function_privilege\(\s*'service_role',\s*'public\.reconcile_email_pause_notification_fanout\(uuid,uuid\)',\s*'execute'\s*\)/
    );
    expect(repairSql).toMatch(
      /pg_catalog\.has_function_privilege\(\s*'authenticated',\s*'public\.reconcile_email_pause_notification_fanout\(uuid,uuid\)',\s*'execute'\s*\)/
    );
    expect(repairSql).toMatch(
      /pg_catalog\.has_function_privilege\(\s*'anon',\s*'public\.reconcile_email_pause_notification_fanout\(uuid,uuid\)',\s*'execute'\s*\)/
    );
    expect(repairSql).toContain("notify pgrst, 'reload schema'");
    expectExecutablePostgresExpressions(repairSql);
  });

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
    expectExecutablePostgresExpressions(sql);
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

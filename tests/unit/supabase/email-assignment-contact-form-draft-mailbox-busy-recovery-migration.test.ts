import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase/migrations");
const migrationName = readdirSync(migrationsDirectory).find((name) =>
  name.endsWith("_keep_contact_form_mailbox_busy_retryable.sql")
);
const sql = migrationName
  ? readFileSync(join(migrationsDirectory, migrationName), "utf8").toLowerCase()
  : "";
const compact = sql.replace(/\s+/g, " ");

describe("contact-form draft mailbox-busy recovery migration", () => {
  it("keeps pre-provider mailbox contention retryable beyond the ordinary attempt ceiling", () => {
    expect(migrationName).toBeDefined();
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(compact).toContain(
      "create or replace function public.fail_email_assignment_contact_form_draft_as_system"
    );
    expect(compact).toContain(
      "v_mailbox_busy := btrim(p_error) = 'email_assignment_contact_form_draft_mailbox_busy'"
    );

    const uncertainProviderFence = compact.indexOf(
      "when queue.provider_create_started_at is not null then 'reconciliation_required'"
    );
    const mailboxBusyRetry = compact.indexOf(
      "when v_mailbox_busy then 'retrying'"
    );
    const ordinaryAttemptCeiling = compact.indexOf(
      "when queue.attempts >= 8 then 'failed'"
    );

    expect(uncertainProviderFence).toBeGreaterThan(-1);
    expect(mailboxBusyRetry).toBeGreaterThan(uncertainProviderFence);
    expect(ordinaryAttemptCeiling).toBeGreaterThan(mailboxBusyRetry);
    expect(compact).toContain(
      "when v_mailbox_busy then clock_timestamp() + make_interval(mins => 5)"
    );
  });

  it("returns only exact contention-only terminal rows to the guarded queue", () => {
    const repairStart = compact.indexOf(
      "update public.email_assignment_contact_form_draft_queue work set status = 'retrying'"
    );
    const repair = compact.slice(repairStart);

    expect(repairStart).toBeGreaterThan(-1);
    expect(repair).toContain("where work.status = 'failed'");
    expect(repair).toContain("work.provider_create_attempt_id is null");
    expect(repair).toContain("work.provider_create_started_at is null");
    expect(repair).toContain(
      "btrim(work.last_error) = 'email_assignment_contact_form_draft_mailbox_busy'"
    );
    expect(repair).toContain("lease_holder = null");
    expect(repair).toContain("lease_expires_at = null");
    expect(repair).not.toContain("opportunity_id =");
    expect(repair).not.toContain("update public.ai_draft_history");
  });

  it("preserves service-only execution for the corrected failure contract", () => {
    expect(compact).toContain(
      "coalesce(auth.jwt() ->> 'role', '') <> 'service_role'"
    );
    expect(compact).toContain(
      "revoke all on function public.fail_email_assignment_contact_form_draft_as_system( uuid, text, text ) from public, anon, authenticated, service_role"
    );
    expect(compact).toContain(
      "grant execute on function public.fail_email_assignment_contact_form_draft_as_system( uuid, text, text ) to service_role"
    );
  });
});

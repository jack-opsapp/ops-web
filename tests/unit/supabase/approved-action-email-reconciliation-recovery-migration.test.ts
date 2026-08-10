import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260809180033_approved_action_email_reconciliation_recovery.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compactSql = sql.replace(/\s+/g, " ");

function functionBody(name: string, nextName: string): string {
  return sql.slice(
    sql.indexOf(`create or replace function public.${name}`),
    sql.indexOf(`create or replace function public.${nextName}`)
  );
}

describe("approved-action email reconciliation recovery migration", () => {
  it("preflights impossible counters and terminalizes capped legacy recovery rows", () => {
    expect(sql).not.toBe("");
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(compactSql).toContain(
      "add column if not exists max_reconciliation_attempts integer not null default 8"
    );
    expect(compactSql).toContain(
      "add column if not exists reconciliation_exhausted_at timestamptz"
    );
    expect(compactSql).toContain("reconciliation_attempts >= 0");
    expect(compactSql).toContain(
      "max_reconciliation_attempts between 1 and 100"
    );
    expect(compactSql).toContain(
      "reconciliation_attempts <= max_reconciliation_attempts"
    );
    expect(compactSql).toContain("reconciliation_attempts > 100");
    expect(compactSql).toContain(
      "approved_action_email_reconciliation_preflight_attempts_above_100"
    );
    expect(compactSql).toContain("status = 'reconciliation_failed'");
    expect(compactSql).toContain("reconciliation_exhausted_at = coalesce");
    expect(compactSql).toContain("reconciliation_lease_expires_at <= now()");
  });

  it("claims only provider-accepted work after cooldown or an expired lease", () => {
    const claim = functionBody(
      "claim_next_approved_action_email_reconciliation",
      "complete_approved_action_email_reconciliation"
    );

    expect(claim).toContain("for update skip locked");
    expect(claim).toContain(
      "i.status in ('provider_accepted', 'reconciliation_failed')"
    );
    expect(claim).toContain("i.updated_at <= p_failed_before");
    expect(claim).toContain("i.status = 'reconciling'");
    expect(claim).toContain("i.reconciliation_lease_expires_at is null");
    expect(claim).toContain("i.reconciliation_lease_expires_at <= now()");
    expect(claim).toContain(
      "i.reconciliation_attempts < i.max_reconciliation_attempts"
    );
    expect(claim).toContain("order by");
    expect(claim).toContain("end nulls first");
    expect(claim).toContain("limit 1");
    expect(claim).not.toContain(
      "reconciliation_attempts = i.reconciliation_attempts + 1"
    );
    expect(claim).toContain("reconciliation_lease_token = gen_random_uuid()");
    for (const unsafeState of [
      "awaiting_signature",
      "prepared",
      "sending",
      "delivery_unknown",
    ]) {
      expect(claim).not.toContain(`'${unsafeState}'`);
    }
    expect(claim).not.toContain("sendemail");
  });

  it("makes accepted-intent state changes RPC-only for service role", () => {
    expect(compactSql).toContain(
      "revoke all on table public.approved_action_email_intents from service_role"
    );
    expect(compactSql).toContain(
      "grant select on table public.approved_action_email_intents to service_role"
    );
  });

  it("renews only the current unexpired reconciliation owner", () => {
    const renew = functionBody(
      "renew_approved_action_email_reconciliation",
      "complete_approved_action_email_reconciliation"
    );
    const compactRenew = renew.replace(/\s+/g, " ");

    expect(compactRenew).toContain("i.status = 'reconciling'");
    expect(compactRenew).toContain(
      "i.reconciliation_lease_token = p_lease_token"
    );
    expect(compactRenew).toContain("i.reconciliation_lease_expires_at > now()");
    expect(compactRenew).toContain(
      "reconciliation_lease_expires_at = now() + make_interval"
    );
    expect(compactRenew).toContain(
      "approved_action_email_reconciliation_lease_invalid"
    );
    expect(compactRenew).not.toContain("reconciliation_attempts =");
  });

  it("applies the same retry cap to the interactive per-intent reconciliation lease", () => {
    const claim = functionBody(
      "claim_approved_action_email_reconciliation",
      "claim_next_approved_action_email_reconciliation"
    );

    expect(claim).toContain("for update skip locked");
    expect(claim).toContain(
      "i.reconciliation_attempts < i.max_reconciliation_attempts"
    );
    expect(claim).toContain("i.reconciliation_lease_expires_at is null");
    expect(claim).toContain("i.reconciliation_lease_expires_at <= now()");
    expect(claim).not.toContain(
      "reconciliation_attempts = i.reconciliation_attempts + 1"
    );
  });

  it("consumes retry budget only on failure and can release pressure without spending it", () => {
    const fail = sql.slice(
      sql.indexOf(
        "create or replace function public.fail_approved_action_email_reconciliation"
      ),
      sql.indexOf(
        "revoke all on function public.claim_approved_action_email_reconciliation"
      )
    );

    expect(fail).toContain("reconciliation_exhausted_at");
    expect(fail).toContain(
      "if v_intent.reconciliation_exhausted_at is not null"
    );
    expect(fail).toMatch(
      /reconciliation_attempts\s*=\s*least\(\s*i\.reconciliation_attempts \+ 1,\s*i\.max_reconciliation_attempts\s*\)/
    );
    expect(fail).toContain(
      "insert into private.approved_action_email_reconciliation_alert_outbox"
    );

    const release = functionBody(
      "release_approved_action_email_reconciliation",
      "finalize_expired_approved_action_email_reconciliations"
    );
    expect(release).toContain("status = 'reconciliation_failed'");
    expect(release).toContain("reconciliation_lease_token = null");
    expect(release).not.toContain("reconciliation_attempts =");
  });

  it("validates the exact activity and action result before completing", () => {
    const complete = functionBody(
      "complete_approved_action_email_reconciliation",
      "fail_approved_action_email_reconciliation"
    );

    expect(complete).toContain("status = 'reconciled'");
    expect(complete).toContain("i.reconciliation_lease_expires_at > now()");
    for (const identity of [
      "activity.company_id = v_intent.company_id",
      "activity.email_connection_id = v_intent.connection_id",
      "activity.email_message_id = v_intent.provider_message_id",
      "activity.email_thread_id = v_intent.accepted_provider_thread_id",
      "activity.type = 'email'",
      "activity.direction = 'outbound'",
      "activity.created_by = v_intent.actor_user_id",
      "activity.opportunity_id is not distinct from v_intent.opportunity_id",
      "activity.client_id is not distinct from v_intent.client_id",
      "activity.invoice_id is not distinct from v_intent.invoice_id",
      "activity.project_id is not distinct from v_intent.project_id::text",
    ]) {
      expect(complete).toContain(identity);
    }
    expect(complete).toContain(
      "approved_action_email_reconciliation_activity_identity_invalid"
    );
    expect(complete).toContain("action.status in ('approved', 'failed')");
    expect(complete).toContain("action.status = 'executed'");
    expect(complete).toContain("action.execution_result = v_execution_result");
    expect(complete).toContain(
      "approved_action_email_reconciliation_action_state_invalid"
    );
  });

  it("rejects expired owners from completion, failure, and pressure release", () => {
    const complete = functionBody(
      "complete_approved_action_email_reconciliation",
      "fail_approved_action_email_reconciliation"
    );
    const fail = functionBody(
      "fail_approved_action_email_reconciliation",
      "release_approved_action_email_reconciliation"
    );
    const release = functionBody(
      "release_approved_action_email_reconciliation",
      "finalize_expired_approved_action_email_reconciliations"
    );

    for (const transition of [complete, fail, release]) {
      expect(transition).toContain(
        "i.reconciliation_lease_token = p_lease_token"
      );
      expect(transition).toContain("i.reconciliation_lease_expires_at > now()");
    }
  });

  it("projects retryable open and resolved alerts with an actor fallback", () => {
    expect(compactSql).toContain(
      "create table if not exists private.approved_action_email_reconciliation_alert_outbox"
    );
    const projection = sql.slice(
      sql.indexOf(
        "create or replace function public.project_next_approved_action_email_reconciliation_alert"
      ),
      sql.indexOf(
        "revoke all on function public.claim_approved_action_email_reconciliation"
      )
    );
    expect(projection).toContain("for update skip locked");
    expect(projection).toContain(
      "outbox.desired_version > outbox.applied_version"
    );
    expect(projection).toContain("insert into public.notifications");
    expect(projection).toContain("company.account_holder_id");
    expect(projection).toContain("company.admin_ids");
    expect(projection).toContain("private.permission_user_is_admin(");
    expect(projection).toContain("v_outbox.actor_user_id");
    expect(projection).toContain("actor.deleted_at is null");
    expect(projection).toContain("coalesce(actor.is_active, false)");
    expect(projection).toContain(
      "and not exists (select 1 from manager_recipients)"
    );
    expect(projection).toContain(
      "get diagnostics v_projected_rows = row_count"
    );
    expect(projection).toContain(
      "approved_action_email_reconciliation_alert_recipient_unavailable"
    );
    expect(projection).toContain(
      "resolved_at = coalesce(notification.resolved_at, now())"
    );
    expect(projection).toContain(
      "projection_attempts = projection_attempts + 1"
    );
    expect(projection).toContain("available_at = now() +");
    expect(projection).toContain("get stacked diagnostics");
  });

  it("binds each private alert row to the intent's exact tenant", () => {
    expect(compactSql).toContain(
      "constraint approved_action_email_reconciliation_alert_intent_company_fkey foreign key (company_id, intent_id) references public.approved_action_email_intents(company_id, id) on delete cascade"
    );
    expect(compactSql).not.toContain(
      "intent_id uuid primary key references public.approved_action_email_intents(id)"
    );
  });

  it("exposes each recovery transition to service role only", () => {
    for (const functionName of [
      "claim_approved_action_email_reconciliation",
      "claim_next_approved_action_email_reconciliation",
      "renew_approved_action_email_reconciliation",
      "complete_approved_action_email_reconciliation",
      "fail_approved_action_email_reconciliation",
      "release_approved_action_email_reconciliation",
      "finalize_expired_approved_action_email_reconciliations",
      "project_next_approved_action_email_reconciliation_alert",
    ]) {
      expect(compactSql).toContain(
        `revoke all on function public.${functionName}`
      );
      expect(compactSql).toContain(
        `grant execute on function public.${functionName}`
      );
    }
  });
});

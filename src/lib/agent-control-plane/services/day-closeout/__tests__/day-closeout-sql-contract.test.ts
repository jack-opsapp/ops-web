import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260831042518_agent_day_closeout_foundation_zero.sql"
  ),
  "utf8"
);
const normalized = migration.replace(/\s+/g, " ");
const routineMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260831042631_agent_day_closeout_routine_worker.sql"
  ),
  "utf8"
);
const normalizedRoutine = routineMigration.replace(/\s+/g, " ");
const normalizedDayCloseoutMigrations = readdirSync(
  join(process.cwd(), "supabase/migrations")
)
  .filter((name) => name.includes("agent_day_closeout"))
  .sort()
  .map((name) =>
    readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8")
  )
  .join("\n")
  .replace(/\s+/g, " ");

describe("day-closeout Foundation Zero SQL contract", () => {
  it("keeps every OPS-owned record private with no direct Supabase-role grants", () => {
    for (const table of [
      "agent_day_closeout_routines",
      "agent_day_closeout_runs",
      "agent_day_closeout_change_sets",
      "agent_day_closeout_confirmations",
      "agent_day_closeout_receipts",
    ]) {
      expect(normalized).toContain(
        `alter table private.${table} enable row level security;`
      );
      expect(normalized).toContain(
        `revoke all on table private.${table} from public, anon, authenticated, service_role;`
      );
    }
  });

  it("re-proves current tenant, grant, scope, and exact all-scope permissions", () => {
    for (const fragment of [
      "grant_record.user_id = p_actor_user_id",
      "grant_record.company_id = p_company_id",
      "grant_record.client_id = p_oauth_client_id",
      "grant_record.revision = p_grant_revision",
      "grant_record.scopes = p_granted_scope_ceiling",
      "grant_record.revoked_at is null",
      "v_required_scopes <@ grant_record.scopes",
      "authority.effective_permissions @> v_required_permissions",
    ]) {
      expect(normalized).toContain(fragment);
    }
    for (const permission of [
      "calendar.view",
      "email.view",
      "invoices.view",
      "pipeline.view",
      "projects.view",
      "reports.view",
      "tasks.view",
    ]) {
      expect(migration).toContain(
        `jsonb_build_object('permission', '${permission}', 'scope', 'all')`
      );
    }
  });

  it("binds one immutable preview to one Firebase actor and a replay-safe receipt", () => {
    for (const fragment of [
      "action.user_id = p_actor_user_id",
      "change_set.id = p_change_set_id",
      "change_set.preview_hash = substring(p_preview_sha256 from 8)",
      "confirmation.idempotency_key = p_idempotency_key",
      "v_existing_receipt.preview_hash is distinct from substring(p_preview_sha256 from 8)",
      "AGENT_DAY_CLOSEOUT_IDEMPOTENCY_CONFLICT",
      "v_change.expires_at <= statement_timestamp()",
      "v_action.status is distinct from 'pending'",
      "v_existing_receipt.result || jsonb_build_object('replayed', true)",
      "v_result := v_result || jsonb_build_object( 'receipt_sha256', 'sha256:' || v_receipt_hash )",
    ]) {
      expect(normalized).toContain(fragment);
    }
  });

  it("limits the only commit effect to OPS filing with truthful receipts", () => {
    expect(normalized).toContain("'effect', 'filed_inside_ops'");
    expect(normalized).toContain("'messages_sent', 0");
    expect(normalized).toContain("'money_moved', false");
    expect(normalized).toContain("'No messages sent. No money moved.'");
    expect(migration).not.toMatch(/\b(sendgrid|mailgun|resend|stripe)\b/i);
  });

  it("persists the correspondence truth boundary in the exact review payload", () => {
    for (const fragment of [
      "'correspondence_state', v_correspondence_component ->> 'state'",
      "'correspondence_coverage_state', v_correspondence_component #>> '{coverage,state}'",
      "'communication_brief_count', jsonb_array_length(p_result_base -> 'communication_briefs')",
    ]) {
      expect(normalized).toContain(fragment);
    }
    expect(normalized).toContain(
      "select 1 from pg_catalog.pg_timezone_names timezone_row where timezone_row.name = p_timezone"
    );
  });

  it("uses a separate durable 6/6/30 prepare policy pinned to inactive v3", () => {
    expect(normalized).toContain(
      "v_actor_limit constant integer := 6; v_grant_limit constant integer := 6; v_company_limit constant integer := 30;"
    );
    expect(normalized).toContain(
      "grant_record.exposure_revision = '2026-08-30.mcp-exposure.v3'"
    );
    expect(normalized).toContain(
      "'ops.operations.prepare' = any(grant_record.scopes)"
    );
    expect(normalized).toContain(
      "grant execute on function public.consume_agent_day_closeout_prepare_rate_limit_as_system( text, uuid, uuid, uuid, text, text, integer, text ) to service_role;"
    );
  });

  it("keeps routine scheduling state in OPS rather than in any MCP host", () => {
    for (const field of [
      "local_time time not null",
      "timezone text not null",
      "weekdays smallint[] not null",
      "next_run_at timestamptz not null",
      "claim_token uuid",
      "change_cursor jsonb not null",
      "schedule_revision bigint not null",
    ]) {
      expect(normalized).toContain(field);
    }
  });

  it("pins dormant routines to the exact inactive manifest and exposure", () => {
    expect(normalizedRoutine).toContain(
      "capability_manifest_revision = '2026-08-30.capability-manifest.v9'"
    );
    expect(normalizedRoutine).toContain(
      "exposure_revision = '2026-08-30.mcp-exposure.v3'"
    );
  });

  it("claims due routines with bounded leases and skip-locked exclusion", () => {
    for (const fragment of [
      "for update skip locked",
      "claim_expires_at <= statement_timestamp()",
      "p_limit between 1 and 25",
      "p_lease_seconds between 60 and 900",
      "attempt_count = least(routine.attempt_count + 1, 4)",
      "claim_token = gen_random_uuid()",
    ]) {
      expect(normalizedRoutine).toContain(fragment);
    }
  });

  it("rechecks and atomically binds the exact current actor, grant, client, schedule, and claim", () => {
    for (const fragment of [
      "routine.company_id, routine.actor_user_id, routine.oauth_grant_id",
      "routine.oauth_client_id, routine.grant_revision",
      "routine.granted_scope_ceiling, null, routine.exposure_revision",
      "source.claim_token = p_claim_token",
      "source.next_run_at = p_scheduled_for",
      "source.schedule_revision = p_schedule_revision",
      "trigger_kind = 'routine'",
      "'actor_user_id', routine.actor_user_id",
      "'company_id', routine.company_id",
      "'oauth_grant_id', routine.oauth_grant_id",
      "'oauth_client_id', routine.oauth_client_id",
      "'granted_scope_ceiling', routine.granted_scope_ceiling",
    ]) {
      expect(normalizedRoutine).toContain(fragment);
    }
  });

  it("recovers an already-persisted exact occurrence before retry or failure", () => {
    for (const fragment of [
      "Persistence and its network response are not atomic",
      "run.idempotency_key = p_idempotency_key",
      "run.trigger_kind = 'routine'",
      "v_effective_outcome := v_run.state",
      "v_effective_run_id := v_run.id",
    ]) {
      expect(normalizedRoutine).toContain(fragment);
    }
  });

  it("calculates the next local wall-clock occurrence in the stored IANA timezone", () => {
    expect(normalizedRoutine).toContain(
      "v_candidate := (v_local_date + v_day_offset + p_local_time) at time zone p_timezone;"
    );
    expect(normalizedRoutine).toContain(
      "extract( isodow from (v_local_date + v_day_offset) )::smallint = any(p_weekdays)"
    );
    expect(normalizedRoutine).toContain(
      "private.next_agent_day_closeout_run( routine.local_time, routine.timezone, routine.weekdays, greatest(statement_timestamp(), p_scheduled_for) )"
    );
  });

  it("keeps retries bounded and makes partial, blocked, and failed outcomes visible", () => {
    for (const fragment of [
      "routine.attempt_count < 3",
      "interval '5 minutes'",
      "interval '15 minutes'",
      "'ROUTINE_EXECUTION_BUDGET_EXPIRED'",
      "'Day closeout incomplete'",
      "'Day closeout paused'",
      "'Day closeout failed'",
      "false, true, v_action_url, v_action_label",
    ]) {
      expect(normalizedRoutine).toContain(fragment);
    }
    expect(routineMigration).not.toMatch(
      /\b(sendgrid|mailgun|resend|stripe|openai|anthropic)\b/i
    );
  });

  it("stores terminal failures separately from canonical closeout results", () => {
    for (const fragment of [
      "create table private.agent_day_closeout_routine_failures",
      "outcome text not null check (outcome in ('blocked', 'failed'))",
      "(outcome = 'blocked' and failure_code = 'AUTHORITY_BLOCKED')",
      "outcome = 'failed' and failure_code in ( 'ROUTINE_EXECUTION_FAILED', 'ROUTINE_EXECUTION_BUDGET_EXPIRED', 'CLAIM_ATTEMPTS_EXHAUSTED' )",
      "alter table private.agent_day_closeout_routine_failures enable row level security",
      "revoke all on table private.agent_day_closeout_routine_failures from public, anon, authenticated, service_role",
      "insert into private.agent_day_closeout_routine_failures",
      "'failure_id', v_failure_id",
    ]) {
      expect(normalizedRoutine).toContain(fragment);
    }
    expect(normalizedRoutine).not.toContain(
      "insert into private.agent_day_closeout_runs"
    );
    expect(normalized).toContain(
      "status text not null check (status in ('prepared', 'filed'))"
    );
  });

  it("uses only real notification destinations and omits links when none are truthful", () => {
    expect(normalizedRoutine).toContain("v_action_url := '/settings'");
    expect(normalizedRoutine).toContain("v_action_url := '/agent/queue'");
    expect(normalizedRoutine).toContain("v_action_label := 'REVIEW'");
    expect(normalizedRoutine).not.toContain("v_action_url := '/agent';");
  });

  it("keeps every worker RPC service-role-only and routine creation disabled", () => {
    expect(normalizedRoutine).toContain(
      "alter table private.agent_day_closeout_routines alter column enabled set default false;"
    );
    for (const functionName of [
      "claim_agent_day_closeout_routines_as_system",
      "assert_agent_day_closeout_routine_claim_as_system",
      "persist_agent_day_closeout_routine_as_system",
      "finalize_agent_day_closeout_routine_as_system",
    ]) {
      expect(normalizedRoutine).toContain(
        `revoke all on function public.${functionName}`
      );
      expect(normalizedRoutine).toContain("from public, anon, authenticated;");
      expect(normalizedRoutine).toContain(
        `grant execute on function public.${functionName}`
      );
    }
  });

  it("indexes every foreign-key lookup reported by the production advisor", () => {
    for (const [table, column] of [
      ["agent_day_closeout_routines", "oauth_grant_id"],
      ["agent_day_closeout_routines", "oauth_client_id"],
      ["agent_day_closeout_runs", "routine_id"],
      ["agent_day_closeout_runs", "oauth_grant_id"],
      ["agent_day_closeout_runs", "oauth_client_id"],
      ["agent_day_closeout_routine_failures", "routine_id"],
      ["agent_day_closeout_routine_failures", "oauth_grant_id"],
      ["agent_day_closeout_routine_failures", "oauth_client_id"],
    ]) {
      expect(normalizedDayCloseoutMigrations).toContain(
        `on private.${table} (${column});`
      );
    }
  });
});

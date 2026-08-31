import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260831003057_agent_day_closeout_foundation_zero.sql"
  ),
  "utf8"
);
const normalized = migration.replace(/\s+/g, " ");

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
});

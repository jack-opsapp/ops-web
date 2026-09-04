import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260904050000_agent_dispatch_confirmation_task.sql"
  ),
  "utf8"
).toLowerCase();

describe("dispatch confirmation task SQL contract", () => {
  it("keeps policy, evidence, decisions, and receipts private", () => {
    for (const table of [
      "agent_company_policy_versions",
      "agent_internal_task_runs",
      "agent_internal_task_evidence",
      "agent_internal_task_change_sets",
      "agent_internal_task_confirmations",
      "agent_internal_task_receipts",
    ]) {
      expect(sql).toContain(`create table private.${table}`);
      expect(sql).toContain(`revoke all on table private.${table}`);
    }
    expect(sql).not.toContain("source_document_body");
    expect(sql).not.toContain("browser automation");
    expect(sql).not.toContain("canpro");
  });

  it("fails closed on exact policy, grant, permission, source, and evidence bindings", () => {
    for (const fragment of [
      "agent_dispatch_policy_missing",
      "agent_dispatch_policy_conflict",
      "agent_dispatch_policy_hash_invalid",
      "v_policy.approver_user_id is distinct from p_actor_user_id",
      "v_policy.assignee_user_id",
      "agent_dispatch_grant_stale_or_denied",
      "agent_dispatch_authority_stale_or_denied",
      "agent_dispatch_source_stale",
      "agent_dispatch_evidence_invalid",
      "2026-09-03.mcp-consent-catalog.v8",
      "private.mcp_oauth_labels_for_scopes",
      "p_registered_permission_keys",
      "client_record.scope_ceiling = v_exposure_scopes",
      "schedule_confirmed_at is null",
      "task.schedule_version = p_expected_schedule_version",
      "'confirmation_required'",
    ]) {
      expect(sql).toContain(fragment);
    }
  });

  it("binds replay, changed input, expiry, single-use, and one atomic task mutation", () => {
    for (const fragment of [
      "agent_dispatch_idempotency_conflict",
      "agent_dispatch_change_set_stale_or_invalid",
      "for update",
      "consumed_at is not null",
      "create_task_with_event_as_system",
      "task_id_conflict",
      "readback_sha256",
      "policy_revision",
      "'tasks_created',1",
      "'messages_sent',0",
      "'money_moved',false",
      "'financial_documents_issued',0",
    ]) {
      expect(sql).toContain(fragment);
    }
  });

  it("binds the current scoped canonical task-creation signature", () => {
    expect(sql).toContain(
      "public.create_task_with_event_as_system(uuid,uuid,uuid,uuid,text,text,text,uuid[],timestamp with time zone,timestamp with time zone,integer,jsonb)"
    );
    expect(sql).toMatch(
      /array\[v_change\.proposed_assignee_id\]\s*,\s*null\s*,\s*null\s*,\s*1\s*,\s*null::jsonb/
    );
  });

  it("creates one persistent approval notification and resolves it on either decision", () => {
    expect(sql).toContain("'approve_dispatch_confirmation_task'");
    expect(sql).toContain("'dispatch confirmation ready'");
    expect(sql).toMatch(
      /false\s*,\s*true\s*,\s*'\/agent\/queue'\s*,\s*'review'/
    );
    expect(sql).toContain("set is_read = true, persistent = false");
  });

  it("supports bounded retention, legal hold, redaction, and audit tombstones", () => {
    for (const fragment of [
      "retain_until",
      "legal_hold",
      "redacted_at",
      "redaction_mode",
      "tombstoned_at",
      "tombstone_reason",
      "redact_agent_internal_task_evidence_as_system",
      "redact_expired_agent_internal_task_evidence_as_system",
      "retention_expired",
      "not source.legal_hold",
    ]) {
      expect(sql).toContain(fragment);
    }
  });

  it("uses empty search paths and revokes public execution", () => {
    for (const fn of [
      "prepare_agent_dispatch_confirmation_task_as_system",
      "commit_agent_dispatch_confirmation_task_as_actor",
      "reject_agent_dispatch_confirmation_task_as_actor",
      "redact_agent_internal_task_evidence_as_system",
      "redact_expired_agent_internal_task_evidence_as_system",
      "consume_agent_dispatch_prepare_rate_limit_as_system",
    ]) {
      expect(sql).toContain(`create or replace function public.${fn}`);
      expect(sql).toContain(`revoke all on function public.${fn}`);
    }
    expect(
      sql.match(/set search_path = ''/g)?.length ?? 0
    ).toBeGreaterThanOrEqual(6);
  });
});

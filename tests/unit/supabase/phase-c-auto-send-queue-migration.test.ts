import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260715163000_phase_c_auto_send_queue.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

function functionBody(name: string, nextName?: string): string {
  const start = compactSql.indexOf(
    `create or replace function public.${name}(`
  );
  const end = nextName
    ? compactSql.indexOf(
        `create or replace function public.${nextName}(`,
        start + 1
      )
    : compactSql.length;
  return start < 0 ? "" : compactSql.slice(start, end < 0 ? undefined : end);
}

describe("Phase C auto-send queue migration", () => {
  it("is the transaction-wrapped migration immediately after send intents", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
  });

  it("persists immutable actor, assignment, content, signature, and lease fences", () => {
    for (const fragment of [
      "add column if not exists actor_user_id uuid references public.users(id) on delete restrict",
      "add column if not exists assignment_version bigint",
      "add column if not exists assignment_event_id uuid references public.opportunity_assignment_events(id) on delete restrict",
      "add column if not exists source_email_thread_id uuid references public.email_threads(id) on delete restrict",
      "add column if not exists actor_name_snapshot text",
      "add column if not exists actor_email_snapshot text",
      "add column if not exists client_from_address_snapshot text",
      "add column if not exists signature_id uuid references public.email_signatures(id) on delete restrict",
      "add column if not exists signature_content_hash text",
      "add column if not exists authored_body text",
      "add column if not exists rendered_body text",
      "add column if not exists rendered_body_hash text",
      "add column if not exists content_type text",
      "add column if not exists profile_type_snapshot text",
      "add column if not exists learning_authority text not null default 'autonomous'",
      "add column if not exists idempotency_key text",
      "add column if not exists send_intent_id uuid references public.email_send_intents(id) on delete restrict",
      "add column if not exists lease_token uuid",
      "add column if not exists claimed_at timestamptz",
      "add column if not exists lease_expires_at timestamptz",
      "add column if not exists updated_at timestamptz not null default now()",
      "status in ('pending', 'leased', 'sent', 'cancelled', 'failed')",
      "learning_authority = 'autonomous'",
      "signature_id is not null and signature_content_hash is not null",
      "profile_type_snapshot is not null and length(btrim(profile_type_snapshot)) between 1 and 64",
      "pending_auto_sends_actionable_fence_check",
      "assignment_event_id is not null",
      "pending_auto_sends_company_idempotency_unique",
      "pending_auto_sends_assignment_event_idx",
      "pending_auto_sends_signature_idx",
      "email_send_intents_pending_auto_send_idx",
      "pending_auto_sends_due_claim_idx",
      "pending_auto_sends_stale_lease_idx",
    ]) {
      expect(compactSql).toContain(fragment);
    }
  });

  it("schedules idempotently only after opportunity-first canonical authorization", () => {
    const schedule = functionBody(
      "schedule_phase_c_auto_send",
      "claim_phase_c_auto_sends"
    );

    expect(schedule).toContain("security definer set search_path = ''");
    expect(schedule.indexOf("from public.opportunities o")).toBeGreaterThan(-1);
    expect(schedule.indexOf("from public.opportunities o")).toBeLessThan(
      schedule.indexOf("from public.email_connections c")
    );
    expect(schedule).toContain("for update");
    expect(schedule).toContain(
      "v_opportunity.assignment_version is distinct from p_assignment_version"
    );
    expect(schedule).toContain("p_assignment_event_id is null");
    expect(schedule).toContain("v_current_assignment_event_id is null");
    expect(schedule).toContain(
      "p_assignment_event_id is distinct from v_current_assignment_event_id"
    );
    expect(schedule).toContain("coalesce(u.is_active, false)");
    expect(schedule).toContain("c.status = 'active'");
    expect(schedule).toContain("coalesce(c.sync_enabled, false)");
    expect(schedule).toContain("coalesce(c.agent_can_send_from, false)");
    expect(schedule).toContain("from public.admin_feature_overrides afo");
    expect(schedule).toContain("from public.companies company");
    expect(schedule).toContain("private.email_company_subscription_active(");
    expect(schedule).toContain("phase_c_auto_send_subscription_inactive");
    expect(schedule).toContain("afo.feature_key = 'ai_auto_send'");
    expect(schedule).toContain(
      "v_connection.user_id is distinct from p_actor_user_id::text"
    );
    expect(schedule).toContain("private.user_can_send_opportunity_inbox(");
    expect(schedule).not.toContain("'pipeline.edit'");
    expect(schedule).not.toContain("public.has_permission(");
    expect(schedule).not.toContain("'pipeline.manage'");
    expect(schedule).toContain("t.id = p_source_email_thread_id");
    expect(schedule).toContain(
      "t.provider_thread_id = p_reply_provider_thread_id"
    );
    expect(schedule).toContain("from public.opportunity_email_threads link");
    expect(schedule).toContain("d.user_id = p_actor_user_id");
    expect(schedule).toContain("d.original_draft = p_draft_text");
    expect(schedule).toContain("s.content_hash = p_signature_content_hash");
    expect(schedule).toContain("p_signature_id is null");
    expect(schedule).toContain("p_signature_content_hash is null");
    expect(schedule).toContain(
      "on conflict (company_id, idempotency_key) do nothing"
    );
    expect(schedule).toContain(
      "concat_ws(' ', v_actor.first_name, v_actor.last_name)"
    );
    expect(schedule).toContain("lower(btrim(v_connection.email))");
    expect(compactSql).toContain(
      "and signature_id is not null and signature_content_hash is not null"
    );
  });

  it("claims without blocking and reauthorizes before issuing a fresh token", () => {
    const claim = functionBody(
      "claim_phase_c_auto_sends",
      "complete_phase_c_auto_send"
    );
    const opportunityLock = claim.indexOf("from public.opportunities o");
    const queueLock = claim.indexOf(
      "from public.pending_auto_sends pas",
      opportunityLock + 1
    );

    expect(claim).toContain("security definer set search_path = ''");
    expect(claim).toContain("pas.scheduled_send_at <= v_now");
    expect(claim).toContain("pas.lease_expires_at <= v_now");
    expect(opportunityLock).toBeGreaterThan(-1);
    expect(queueLock).toBeGreaterThan(opportunityLock);
    expect(claim.slice(opportunityLock, queueLock)).toContain(
      "for update skip locked"
    );
    expect(claim.slice(queueLock)).toContain("for update skip locked");
    expect(claim).toContain(
      "v_opportunity.assigned_to is distinct from v_queue.actor_user_id"
    );
    expect(claim).toContain(
      "v_opportunity.assignment_version is distinct from v_queue.assignment_version"
    );
    expect(claim).toContain("phase_c_auto_send_assignment_stale");
    expect(claim).toContain("phase_c_auto_send_actor_inactive");
    expect(claim).toContain("phase_c_auto_send_actor_snapshot_stale");
    expect(claim).toContain("phase_c_auto_send_connection_disabled");
    expect(claim).toContain("from public.admin_feature_overrides afo");
    expect(claim).toContain("phase_c_auto_send_authorization_revoked");
    expect(claim).toContain("private.user_can_send_opportunity_inbox(");
    expect(claim).not.toContain("'pipeline.edit'");
    expect(claim).not.toContain("'pipeline.manage'");
    expect(claim).toContain("from public.companies company");
    expect(claim).toContain("private.email_company_subscription_active(");
    expect(claim).toContain("phase_c_auto_send_subscription_inactive");
    expect(claim).toContain(
      "v_cancel_reason <> 'phase_c_auto_send_subscription_inactive'"
    );
    expect(claim).toContain("d.original_draft = v_queue.draft_text");
    expect(claim).toContain("status = 'leased'");
    expect(claim).toContain("lease_token = gen_random_uuid()");
    expect(claim).toContain("lease_expires_at = v_now + make_interval");
  });

  it("token-fences completion, retry, and claimed cancellation", () => {
    const complete = functionBody(
      "complete_phase_c_auto_send",
      "retry_phase_c_auto_send"
    );
    const retry = functionBody(
      "retry_phase_c_auto_send",
      "cancel_phase_c_auto_send"
    );
    const cancel = functionBody("cancel_phase_c_auto_send");

    expect(complete).toContain(
      "v_queue.lease_token is distinct from p_lease_token"
    );
    expect(complete).toContain("i.pending_auto_send_id = v_queue.id");
    expect(complete).toContain("i.actor_user_id = v_queue.actor_user_id");
    expect(complete).toContain("i.status = 'reconciled'");
    expect(complete).toContain("status = 'sent'");
    expect(complete).toContain("send_intent_id = p_send_intent_id");

    expect(retry).toContain(
      "v_queue.lease_token is distinct from p_lease_token"
    );
    expect(retry).toContain("v_next_retry_count := v_queue.retry_count + 1");
    expect(retry).toContain("retry_count = v_next_retry_count");
    expect(retry).toContain("status = 'failed'");
    expect(retry).toContain("status = 'pending'");
    expect(retry).not.toContain("update public.ai_draft_history");
    expect(retry).not.toContain("set status = 'discarded'");

    expect(cancel).toContain("v_queue.status <> 'leased'");
    expect(cancel).toContain(
      "v_queue.lease_token is distinct from p_lease_token"
    );
    expect(cancel).toContain("status = 'cancelled'");
    expect(cancel).toContain("p_actor_user_id uuid");
    expect(cancel).toContain("private.user_can_send_opportunity_inbox(");
    expect(cancel).not.toContain("public.has_permission(");
    expect(cancel).toContain("p_lease_token is not null");
    expect(cancel).toContain("p_actor_user_id is not null");
    expect(cancel).not.toContain("'pipeline.manage'");
  });

  it("binds every auto-send intent to the exact claimed queue snapshot", () => {
    expect(compactSql).toContain(
      "create or replace function private.enforce_phase_c_auto_send_intent_fence()"
    );
    expect(compactSql).toContain(
      "create trigger email_send_intents_phase_c_queue_fence"
    );
    expect(compactSql).toContain(
      "before insert or update of pending_auto_send_id, pending_auto_send_lease_token, idempotency_key, status"
    );
    for (const fragment of [
      "new.pending_auto_send_id",
      "v_queue.status <> 'leased'",
      "new.pending_auto_send_lease_token is distinct from v_queue.lease_token",
      "new.idempotency_key is distinct from v_queue.idempotency_key",
      "new.actor_user_id is distinct from v_queue.actor_user_id",
      "new.assignment_version is distinct from v_queue.assignment_version",
      "new.connection_id is distinct from v_queue.connection_id",
      "new.opportunity_id is distinct from v_queue.opportunity_id",
      "new.authored_body is distinct from v_queue.authored_body",
      "new.rendered_body is distinct from v_queue.rendered_body",
      "new.learning_authority <> 'autonomous'",
      "new.profile_type_snapshot is distinct from v_queue.profile_type_snapshot",
    ]) {
      expect(compactSql).toContain(fragment);
    }
    expect(compactSql).toContain(
      "old.status = 'prepared' and new.status = 'sending'"
    );
  });

  it("exposes only the five queue transitions to service role", () => {
    for (const name of [
      "schedule_phase_c_auto_send",
      "claim_phase_c_auto_sends",
      "complete_phase_c_auto_send",
      "retry_phase_c_auto_send",
      "cancel_phase_c_auto_send",
    ]) {
      expect(compactSql).toContain(`revoke all on function public.${name}`);
      expect(compactSql).toContain(`grant execute on function public.${name}`);
      expect(compactSql).toMatch(
        new RegExp(
          `grant execute on function public\\.${name}\\([^;]+to service_role;`
        )
      );
    }
    expect(compactSql).not.toContain("lower(u.email) = lower(c.email)");
    expect(compactSql).not.toContain("u.email = c.email");
    expect(compactSql).toContain(
      "revoke all on function private.enforce_phase_c_auto_send_intent_fence()"
    );
  });
});

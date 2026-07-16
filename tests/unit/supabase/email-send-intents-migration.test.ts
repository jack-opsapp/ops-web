import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase/migrations");
const migrationName = readdirSync(migrationsDir).find((name) =>
  name.endsWith("_email_send_intents.sql")
);
const migrationPath = migrationName
  ? join(migrationsDir, migrationName)
  : join(migrationsDir, "MISSING_email_send_intents.sql");
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compactSql = sql.replace(/\s+/g, " ");

describe("email send intents migration", () => {
  it("exposes only a service-role bridge to the canonical inbox helpers", () => {
    const bridge = sql.slice(
      sql.indexOf(
        "create or replace function public.authorize_email_inbox_action_as_system"
      ),
      sql.indexOf(
        "create or replace function private.email_company_subscription_active"
      )
    );

    expect(bridge).toContain("auth.role() is distinct from 'service_role'");
    expect(bridge).toContain("p_action not in ('view', 'send')");
    expect(bridge).toContain("private.user_can_view_opportunity_inbox(");
    expect(bridge).toContain("private.user_can_send_opportunity_inbox(");
    expect(bridge).toContain("private.user_can_view_inbox_connection(");
    expect(bridge).toContain("private.user_can_send_inbox_connection(");
    expect(bridge).not.toContain("p_company_id");
    expect(compactSql).toContain(
      "grant execute on function public.authorize_email_inbox_action_as_system( uuid, uuid, uuid, text ) to service_role"
    );
    expect(bridge).not.toContain("to authenticated");
  });

  it("creates a transaction-wrapped, service-role-only durable intent ledger", () => {
    expect(migrationName).toBeTruthy();
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(sql).toContain("create table public.email_send_intents");
    expect(compactSql).toContain("unique (company_id, idempotency_key)");
    expect(sql).toContain(
      "alter table public.email_send_intents enable row level security"
    );
    expect(compactSql).toContain(
      "revoke all on table public.email_send_intents from public, anon, authenticated, service_role"
    );
    expect(compactSql).toContain(
      "grant select, insert, update on table public.email_send_intents to service_role"
    );
    expect(compactSql).toContain(
      "create or replace function private.email_company_subscription_active"
    );
    expect(compactSql).toContain(
      "revoke all on function private.email_company_subscription_active"
    );
    expect(compactSql).toContain(
      "coalesce(p_subscription_status in ('active', 'grace'), false)"
    );
  });

  it("binds the canonical actor, mailbox, thread mode, lead, request, and provider result", () => {
    for (const fragment of [
      "company_id uuid not null references public.companies(id)",
      "actor_user_id uuid not null references public.users(id)",
      "connection_id uuid not null references public.email_connections(id)",
      "opportunity_id uuid not null references public.opportunities(id)",
      "assignment_version bigint not null",
      "assignment_event_id uuid references public.opportunity_assignment_events(id)",
      "source_email_thread_id uuid references public.email_threads(id)",
      "idempotency_key text not null",
      "request_fingerprint text not null",
      "initiated_by text not null",
      "reply_provider_thread_id text",
      "in_reply_to text",
      "sender_switched boolean not null default false",
      "to_emails text[] not null",
      "cc_emails text[] not null default '{}'::text[]",
      "authored_body text not null",
      "rendered_body text not null",
      "draft_history_id uuid references public.ai_draft_history(id)",
      "follow_up_draft_id uuid references public.opportunity_follow_up_drafts(id)",
      "provider_message_id text",
      "accepted_provider_thread_id text",
      "provider_accepted_at timestamptz",
      "reconciliation_attempts integer not null default 0",
      "reconciliation_lease_token uuid",
      "reconciliation_lease_expires_at timestamptz",
      "reconciled_activity_id uuid references public.activities(id)",
      "last_error text",
      "actor_name_snapshot text not null",
      "actor_email_snapshot text not null",
      "client_from_address_snapshot text not null",
      "signature_id uuid references public.email_signatures(id)",
      "signature_content_hash text",
      "rendered_body_hash text not null",
      "pending_auto_send_id uuid references public.pending_auto_sends(id)",
      "pending_auto_send_lease_token uuid",
      "profile_type_snapshot text not null",
    ]) {
      expect(compactSql).toContain(fragment);
    }
    expect(compactSql).toContain(
      "check (initiated_by in ('operator', 'phase_c_auto_send', 'lifecycle_auto_send'))"
    );
    expect(compactSql).toContain(
      "check (status in ('prepared', 'sending', 'provider_accepted', 'reconciling', 'reconciliation_failed', 'reconciled', 'provider_rejected', 'delivery_unknown'))"
    );
    expect(compactSql).toMatch(
      /\(pending_auto_send_id is null and pending_auto_send_lease_token is null\) or \(\s*pending_auto_send_id is not null and pending_auto_send_lease_token is not null\s*\)/
    );
  });

  it("prepares idempotently and rejects request-key reuse with different content", () => {
    const prepare = sql.slice(
      sql.indexOf(
        "create or replace function public.prepare_email_send_intent"
      ),
      sql.indexOf(
        "create or replace function public.claim_email_send_provider_delivery"
      )
    );

    expect(prepare).toContain("on conflict (company_id, idempotency_key)");
    expect(prepare).toContain("for update");
    expect(prepare).toContain("email_send_idempotency_conflict");
    expect(prepare).toContain("request_fingerprint");
    expect(prepare).toContain("actor_user_id");
    expect(prepare).toContain("connection_id");
    expect(prepare).toContain("opportunity_id");
    expect(prepare).toContain("sender_switched");
    expect(prepare).toContain("assignment_event_id");
    expect(prepare).toContain("actor_name_snapshot");
    expect(prepare).toContain("client_from_address_snapshot");
    expect(prepare).toContain("signature_content_hash");
    expect(prepare).toContain("rendered_body_hash");
    expect(prepare).toContain("pending_auto_send_lease_token");
    expect(prepare).not.toContain("'pipeline.manage'");
  });

  it("binds a reply message to the canonical mailbox, provider thread, and lead", () => {
    const prepare = sql.slice(
      sql.indexOf(
        "create or replace function public.prepare_email_send_intent"
      ),
      sql.indexOf(
        "create or replace function public.claim_email_send_provider_delivery"
      )
    );

    expect(prepare).toContain("email_send_reply_message_invalid");
    expect(prepare).toContain("a.email_connection_id = p_connection_id");
    expect(prepare).toContain("a.opportunity_id = p_opportunity_id");
    expect(prepare).toContain(
      "a.email_thread_id = v_source_thread.provider_thread_id"
    );
    expect(prepare).toContain("a.email_message_id = p_in_reply_to");
  });

  it("binds draft provenance to the exact source mailbox, thread, message, and lead", () => {
    const prepare = sql.slice(
      sql.indexOf(
        "create or replace function public.prepare_email_send_intent"
      ),
      sql.indexOf(
        "create or replace function public.claim_email_send_provider_delivery"
      )
    );

    expect(prepare).toContain(
      "p_draft_history_id is not null and p_follow_up_draft_id is not null"
    );
    expect(prepare).toContain("into v_draft_history");
    expect(prepare).toContain("into v_follow_up_draft");
    expect(prepare).toContain("into v_follow_up_source_event");
    expect(prepare).toContain(
      "v_draft_history.opportunity_id is distinct from p_opportunity_id"
    );
    expect(prepare).toContain(
      "v_draft_history.connection_id is distinct from v_source_thread.connection_id"
    );
    expect(prepare).toContain(
      "v_draft_history.thread_id is distinct from v_source_thread.provider_thread_id"
    );
    expect(prepare).toContain(
      "a.email_message_id = v_draft_history.source_message_id"
    );
    expect(prepare).toContain(
      "p_in_reply_to is distinct from v_draft_history.source_message_id"
    );
    expect(prepare).toContain(
      "v_follow_up_draft.connection_id is distinct from v_source_thread.connection_id"
    );
    expect(prepare).toContain(
      "v_follow_up_draft.provider_thread_id is distinct from v_source_thread.provider_thread_id"
    );
    expect(prepare).toContain(
      "v_follow_up_source_event.provider_message_id is null"
    );
    expect(prepare).toContain(
      "p_in_reply_to is distinct from v_follow_up_source_event.provider_message_id"
    );
    expect(prepare).toContain("for share");
  });

  it("claims provider delivery once and makes uncertain delivery non-resendable", () => {
    const claim = sql.slice(
      sql.indexOf(
        "create or replace function public.claim_email_send_provider_delivery"
      ),
      sql.indexOf(
        "create or replace function public.mark_email_send_provider_accepted"
      )
    );
    const accepted = sql.slice(
      sql.indexOf(
        "create or replace function public.mark_email_send_provider_accepted"
      ),
      sql.indexOf(
        "create or replace function public.claim_email_send_reconciliation"
      )
    );

    expect(claim).toContain("status = 'prepared'");
    expect(claim).toContain("status = 'sending'");
    expect(claim).toContain("for update");
    expect(claim).toContain(
      "o.assignment_version = v_intent.assignment_version"
    );
    expect(claim).toContain("private.user_can_send_opportunity_inbox(");
    expect(claim).not.toContain("'pipeline.edit'");
    expect(claim).not.toContain("public.has_permission(");
    expect(claim).not.toContain("'pipeline.manage'");
    expect(claim).toContain("from public.companies company");
    expect(claim).toContain("for share");
    expect(claim).toContain("private.email_company_subscription_active(");
    expect(claim).toContain("v_intent.pending_auto_send_id is not null");
    expect(claim).toContain("email_send_subscription_inactive");
    expect(accepted).toContain("provider_message_id");
    expect(accepted).toContain("accepted_provider_thread_id");
    expect(accepted).toContain("provider_accepted_at");
    expect(accepted).not.toContain("status = 'prepared'");
  });

  it("leases reconciliation with skip locked semantics and token-guards completion/failure", () => {
    const claim = sql.slice(
      sql.indexOf(
        "create or replace function public.claim_email_send_reconciliation"
      ),
      sql.indexOf(
        "create or replace function public.complete_email_send_reconciliation"
      )
    );
    const complete = sql.slice(
      sql.indexOf(
        "create or replace function public.complete_email_send_reconciliation"
      ),
      sql.indexOf(
        "create or replace function public.fail_email_send_reconciliation"
      )
    );
    const fail = sql.slice(
      sql.indexOf(
        "create or replace function public.fail_email_send_reconciliation"
      ),
      sql.indexOf("revoke all on function public.prepare_email_send_intent")
    );

    expect(claim).toContain("for update skip locked");
    expect(claim).toContain(
      "status in ('provider_accepted', 'reconciliation_failed')"
    );
    expect(claim).toContain(
      "reconciliation_attempts = i.reconciliation_attempts + 1"
    );
    expect(claim).toContain("reconciliation_lease_token = gen_random_uuid()");
    for (const rpc of [complete, fail]) {
      expect(rpc).toContain("reconciliation_lease_token = p_lease_token");
      expect(rpc).toContain("status = 'reconciling'");
    }
    expect(complete).toContain("status = 'reconciled'");
    expect(fail).toContain("status = 'reconciliation_failed'");
  });

  it("claims scheduled reconciliation recovery without revisiting provider delivery", () => {
    const recoveryClaim = sql.slice(
      sql.indexOf(
        "create or replace function public.claim_next_email_send_reconciliation"
      ),
      sql.indexOf(
        "create or replace function public.complete_email_send_reconciliation"
      )
    );

    expect(recoveryClaim).toContain("for update skip locked");
    expect(recoveryClaim).toContain(
      "status in ('provider_accepted', 'reconciliation_failed')"
    );
    expect(recoveryClaim).toContain("updated_at <= p_failed_before");
    expect(recoveryClaim).toContain("status = 'reconciling'");
    expect(recoveryClaim).toContain("reconciliation_lease_expires_at <= now()");
    expect(recoveryClaim).toContain(
      "i.reconciliation_attempts < i.max_reconciliation_attempts"
    );
    expect(recoveryClaim).not.toContain("sendemail");
  });

  it("grants every state transition only to service role", () => {
    for (const functionName of [
      "prepare_email_send_intent",
      "claim_email_send_provider_delivery",
      "mark_email_send_provider_accepted",
      "claim_email_send_reconciliation",
      "claim_next_email_send_reconciliation",
      "complete_email_send_reconciliation",
      "fail_email_send_reconciliation",
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

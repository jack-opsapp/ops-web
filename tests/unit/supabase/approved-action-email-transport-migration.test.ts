import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260715171000_approved_action_email_transport.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

describe("approved-action email transport migration", () => {
  it("persists one deterministic, non-browser send intent per action", () => {
    expect(sql).toContain("create table public.approved_action_email_intents");
    expect(sql).toContain("action_id uuid not null unique");
    expect(sql).toContain("idempotency_key text not null unique");
    expect(sql).toContain(
      "alter table public.approved_action_email_intents enable row level security"
    );
    expect(sql).toContain(
      "revoke all on table public.approved_action_email_intents from public"
    );
    expect(sql).toContain(
      "grant select, insert, update on table public.approved_action_email_intents to service_role"
    );
  });

  it("derives manual and autonomous actors from the persisted action under lock", () => {
    expect(sql).toMatch(/from public\.agent_actions[\s\S]*?for update/);
    expect(sql).toContain("v_actor_user_id := v_action.reviewed_by");
    expect(sql).toContain("v_actor_user_id := v_action.user_id");
    expect(sql).toContain("v_action.reviewed_by is not null");
    expect(sql).toContain("v_action.reviewed_by is null");
    expect(sql).toContain("v_action.auto_execute_at > v_now");
  });

  it("re-authorizes mailbox, permissions, lead assignment, and automation state", () => {
    expect(sql).toContain("v_connection.type::text = 'individual'");
    expect(sql).toContain(
      "v_connection.user_id, '') <> v_intent.actor_user_id::text"
    );
    expect(sql).toContain("private.user_can_send_opportunity_inbox(");
    expect(sql).toContain("private.user_can_send_inbox_connection(");
    expect(sql).not.toContain("public.has_permission(");
    expect(sql).toContain(
      "v_opportunity.assigned_to is distinct from v_intent.actor_user_id"
    );
    expect(sql).toContain("coalesce(v_connection.agent_can_send_from, false)");
    expect(sql).toContain("private.email_company_subscription_active(");
    expect(sql).toContain(
      "v_signature.scope_user_id <> v_intent.actor_user_id"
    );
    expect(sql).toContain("'ai_auto_send'");
    expect(sql).toContain("'phase_c'");
    expect(sql).not.toContain("'pipeline.edit'");
    expect(sql).not.toContain("'pipeline.manage'");
  });

  it("fences away-then-back reassignment with a version and latest-event snapshot", () => {
    const authorization = sql.slice(
      sql.indexOf(
        "create or replace function private.approved_action_email_intent_is_authorized"
      ),
      sql.indexOf(
        "create or replace function public.prepare_approved_action_email_intent"
      )
    );
    const prepare = sql.slice(
      sql.indexOf(
        "create or replace function public.prepare_approved_action_email_intent"
      ),
      sql.indexOf(
        "create or replace function public.claim_approved_action_email_delivery"
      )
    );
    const claim = sql.slice(
      sql.indexOf(
        "create or replace function public.claim_approved_action_email_delivery"
      ),
      sql.indexOf(
        "create or replace function public.mark_approved_action_email_provider_accepted"
      )
    );

    expect(sql).toContain("assignment_version bigint");
    expect(sql).toContain("assignment_event_id uuid");
    expect(prepare).toContain(
      "v_assignment_version := v_opportunity.assignment_version"
    );
    expect(prepare).toContain("v_assignment_version, v_assignment_event_id");
    expect(prepare).toMatch(
      /from public\.opportunities[\s\S]*?deleted_at is null for update/
    );
    expect(authorization).toContain(
      "assignment_version = v_intent.assignment_version"
    );
    expect(authorization).toContain(
      "v_latest_assignment_event_id is distinct from v_intent.assignment_event_id"
    );
    expect(claim).toMatch(/from public\.opportunities[\s\S]*?for share/);
    expect(claim.indexOf("from public.opportunities")).toBeLessThan(
      claim.indexOf("private.approved_action_email_intent_is_authorized")
    );
  });

  it("keeps autonomous reschedule delivery on its proposal-time assignee", () => {
    const authorization = sql.slice(
      sql.indexOf(
        "create or replace function private.approved_action_email_intent_is_authorized"
      ),
      sql.indexOf(
        "create or replace function public.prepare_approved_action_email_intent"
      )
    );
    const prepare = sql.slice(
      sql.indexOf(
        "create or replace function public.prepare_approved_action_email_intent"
      ),
      sql.indexOf(
        "create or replace function public.claim_approved_action_email_delivery"
      )
    );

    expect(prepare).toContain("v_source_assignment_version");
    expect(prepare).toContain(
      "v_action.action_data ->> 'source_assignment_version'"
    );
    expect(prepare).toContain(
      "v_source_assignment_version is distinct from v_opportunity.assignment_version"
    );
    expect(authorization).toContain("v_intent.execution_mode = 'autonomous'");
    expect(authorization).toContain(
      "v_opportunity.assigned_to is distinct from v_intent.actor_user_id"
    );
  });

  it("fences provider delivery and reconciliation into non-resendable states", () => {
    expect(sql).toContain("claim_approved_action_email_delivery");
    expect(sql).toContain("mark_approved_action_email_provider_accepted");
    expect(sql).toContain("mark_approved_action_email_delivery_unknown");
    expect(sql).toContain("claim_approved_action_email_reconciliation");
    expect(sql).toContain("complete_approved_action_email_reconciliation");
    expect(sql).toContain("status = 'sending'");
    expect(sql).toContain("status = 'delivery_unknown'");
    expect(sql).toMatch(
      /where status in \(\s*'awaiting_signature',\s*'prepared',\s*'provider_accepted',\s*'reconciling'/
    );
  });

  it("binds an autonomous draft outcome only to the validated automation actor", () => {
    expect(sql).toContain(
      "v_source_draft.user_id is distinct from v_actor_user_id"
    );
    expect(sql).toContain("v_draft_history_id := v_source_draft_id");
  });

  it("never mutates lead assignment", () => {
    expect(sql).not.toMatch(
      /update\s+public\.opportunities[\s\S]*?set[\s\S]*?assigned_to/
    );
  });
});

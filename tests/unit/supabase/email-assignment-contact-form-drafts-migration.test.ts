import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260715178000_email_assignment_contact_form_drafts.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compact = sql.replace(/\s+/g, " ");
const normalizedSignatures = compact
  .replace(/\(\s+/g, "(")
  .replace(/\s+\)/g, ")");

describe("assignment-triggered contact-form draft migration", () => {
  it("creates a private durable queue keyed to the immutable assignment event", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(compact).toContain(
      "create table public.email_assignment_contact_form_draft_queue"
    );
    expect(compact).toContain(
      "assignment_event_id uuid not null references public.opportunity_assignment_events"
    );
    expect(compact).toContain("unique (assignment_event_id)");
    expect(compact).toContain("assignment_version bigint not null");
    expect(compact).toContain("actor_user_id uuid not null");
    expect(compact).toContain(
      "revoke all on table public.email_assignment_contact_form_draft_queue from public, anon, authenticated, service_role"
    );
    expect(compact).not.toContain(
      "update public.opportunities set assigned_to"
    );
    expect(compact).not.toContain("set assigned_to =");
  });

  it("validates an assignment event is current before it can stale older queue work", () => {
    const helperStart = compact.indexOf(
      "create or replace function private.enqueue_email_assignment_contact_form_draft"
    );
    const helperEnd = compact.indexOf(
      "revoke all on function private.enqueue_email_assignment_contact_form_draft",
      helperStart
    );
    const helper = compact.slice(helperStart, helperEnd);
    const currentAssignmentGuard = helper.indexOf(
      "select opportunity_row.* into opportunity"
    );
    const staleQueueUpdate = helper.indexOf(
      "update public.email_assignment_contact_form_draft_queue queue"
    );

    expect(currentAssignmentGuard).toBeGreaterThan(-1);
    expect(staleQueueUpdate).toBeGreaterThan(currentAssignmentGuard);
  });

  it("rendezvouses assignment and exact inbound activity arrival without drafting unassigned company leads", () => {
    expect(compact).toContain(
      "after insert on public.opportunity_assignment_events"
    );
    expect(compact).toContain("after insert on public.activities");
    expect(compact).toContain("event.new_assignee_id is not null");
    expect(compact).toContain(
      "opportunity.assigned_to = event.new_assignee_id"
    );
    expect(compact).toContain(
      "opportunity.assignment_version = event.assignment_version"
    );
    expect(compact).toContain("opportunity.source::text = 'email'");
    expect(compact).toMatch(/source_thread_key\s*!~\s*'\^email:/);
    expect(compact).toContain(":message:");
    expect(compact).toContain("activity.direction = 'inbound'");
    expect(compact).toContain("activity.type = 'email'");
    expect(compact).toContain(
      "activity_row.email_message_id = v_provider_message_id"
    );
    expect(compact).toContain(
      "activity_row.email_connection_id = v_connection_id"
    );
    expect(compact).toContain("activity.opportunity_id = opportunity.id");
    expect(compact).toContain("activity.from_email");
    expect(compact).toContain("client.email");
    expect(compact).toContain("coalesce(activity.subject, '')");
  });

  it("derives the actor only from current assignment and treats mailbox ownership as transport authority", () => {
    expect(compact).toContain("v_actor_user_id := event.new_assignee_id");
    expect(compact).toContain("coalesce(user_row.is_active, false)");
    expect(compact).toContain("user_row.deleted_at is null");
    expect(compact).toContain(
      "private.user_can_send_opportunity_inbox( queue.actor_user_id, opportunity.id, connection.id )"
    );
    expect(compact).toContain("connection.type::text = 'individual'");
    expect(compact).toContain(
      "connection.user_id is distinct from v_actor_user_id::text"
    );
    expect(compact).toContain("connection.type::text = 'company'");
    expect(compact).not.toContain("connection.user_id::uuid");
    expect(compact).not.toContain("lower(user_row.email)");
    expect(compact).not.toContain("'inbox.send', 'all'");
    expect(compact).not.toContain("'inbox.send', 'assigned'");
  });

  it("exposes only service-role claim, preparation, reauthorization, completion, and failure RPCs", () => {
    for (const signature of [
      "claim_email_assignment_contact_form_drafts(text, integer, integer)",
      "prepare_email_assignment_contact_form_draft_as_system(uuid, text, uuid)",
      "reauthorize_email_assignment_contact_form_draft_as_system(uuid, text)",
      "begin_email_assignment_contact_form_draft_provider_create_as_system(uuid, text)",
      "mark_email_assignment_contact_form_draft_reconciliation_required_as_system(uuid, text, uuid, text, text, text)",
      "complete_email_assignment_contact_form_draft_as_system(uuid, text, text, text, uuid, uuid, text)",
      "fail_email_assignment_contact_form_draft_as_system(uuid, text, text)",
    ]) {
      expect(normalizedSignatures).toContain(
        `revoke all on function public.${signature}`
      );
      expect(normalizedSignatures).toContain(
        `grant execute on function public.${signature} to service_role`
      );
    }
    expect(compact).toContain(
      "coalesce(auth.jwt() ->> 'role', '') <> 'service_role'"
    );
    expect(compact).toContain("for update skip locked");
    expect(compact).toContain("lease_expires_at");
    expect(compact).toContain("attempts = queue.attempts + 1");
    expect(compact).toContain("status = 'retrying'");
    expect(compact).toContain("else 'stale'");
  });

  it("revalidates exact assignment, activity, mailbox, and CUSTOMER autonomy before provider drafting", () => {
    expect(compact).toContain("queue.assignment_event_id = event.id");
    expect(compact).toContain(
      "queue.assignment_version = opportunity.assignment_version"
    );
    expect(compact).toContain("opportunity.assigned_to = queue.actor_user_id");
    expect(compact).toContain("queue.source_activity_id = activity.id");
    expect(compact).toContain(
      "coalesce(activity.subject, '') = queue.source_subject"
    );
    expect(compact).toContain("queue.connection_id = connection.id");
    expect(compact).toContain("connection.status = 'active'");
    expect(compact).toContain("coalesce(connection.sync_enabled, false)");
    expect(compact).toContain(
      "connection.auto_send_settings -> 'category_autonomy' ->> 'primary:customer'"
    );
    expect(compact).toContain("'auto_draft'");
    expect(compact).toContain("'auto_send'");
    expect(compact).toContain("'auto_follow_up'");
    expect(compact).toContain(
      "opportunity.stage not in ('won', 'lost', 'discarded')"
    );
    expect(compact).toContain(
      "private.email_assignment_contact_form_draft_has_reply( queue.company_id, queue.opportunity_id, queue.connection_id, activity.created_at, queue.customer_email )"
    );
  });

  it("fences meaningful customer replies in both correspondence and the activity projection gap", () => {
    const helperStart = compact.indexOf(
      "create or replace function private.email_assignment_contact_form_draft_has_reply"
    );
    const helperEnd = compact.indexOf(
      "revoke all on function private.email_assignment_contact_form_draft_has_reply",
      helperStart
    );
    const helper = compact.slice(helperStart, helperEnd);

    expect(compact).toContain(
      "create or replace function private.email_assignment_contact_form_draft_has_reply"
    );
    expect(compact).toContain(
      "from public.opportunity_correspondence_events reply"
    );
    expect(compact).toContain("reply.direction = 'outbound'");
    expect(compact).toContain("reply.party_role = 'ops'");
    expect(compact).toContain("reply.is_meaningful");
    expect(compact).toContain("reply.occurred_at > p_source_occurred_at");
    expect(compact).toContain("from public.activities reply_activity");
    expect(helper).not.toContain(
      "reply_activity.email_connection_id = p_connection_id"
    );
    expect(helper).toContain(
      "reply_activity.opportunity_id = p_opportunity_id"
    );
    expect(compact).toContain(
      "reply_activity.created_at > p_source_occurred_at"
    );
    expect(compact).toContain("reply_activity.email_message_id");
    expect(compact).toContain("reply_activity.body_text");
    expect(compact).toContain("unnest(reply.to_emails || reply.cc_emails)");
    expect(normalizedSignatures).toContain(
      "unnest(coalesce(reply_activity.to_emails, '{}'::text[]) || coalesce(reply_activity.cc_emails, '{}'::text[]))"
    );
  });

  it("blocks unresolved prior provider attempts and reuses only one exact completed OPS draft", () => {
    expect(compact).toContain(
      "create or replace function private.email_assignment_contact_form_draft_prior_placement"
    );
    expect(compact).toContain("prior.provider_create_started_at is not null");
    expect(compact).toContain("prior.status <> 'completed'");
    expect(compact).toContain("reused_from_draft_history_id uuid");
    expect(normalizedSignatures).toContain(
      "private.email_assignment_contact_form_draft_prior_placement(queue.id)"
    );
    expect(compact).toContain(
      "prior_placement.disposition in ('create', 'update')"
    );
    expect(compact).toContain("'mode', v_prior_placement.disposition");
    expect(compact).toContain(
      "p_expected_old_draft_history_id => queue.reused_from_draft_history_id"
    );
  });

  it("persists one provider-create attempt and terminally fences uncertain acceptance", () => {
    expect(compact).toContain("provider_create_attempt_id uuid");
    expect(compact).toContain("provider_create_started_at timestamptz");
    expect(compact).toContain("'reconciliation_required'");
    expect(compact).toContain(
      "create or replace function public.begin_email_assignment_contact_form_draft_provider_create_as_system"
    );
    expect(compact).toContain(
      "create or replace function public.mark_email_assignment_contact_form_draft_reconciliation_required_as_system"
    );
    expect(compact).toContain(
      "v_provider_create_attempt_id := gen_random_uuid()"
    );
    expect(compact).toContain("provider_create_started_at = clock_timestamp()");
    expect(compact).toContain("draft placement needs review");
  });

  it("routes reconciliation to an actor who can perform the advertised action", () => {
    const notificationStart = compact.indexOf(
      "create or replace function private.notify_email_assignment_contact_form_draft_reconciliation"
    );
    const notificationEnd = compact.indexOf(
      "revoke all on function private.notify_email_assignment_contact_form_draft_reconciliation",
      notificationStart
    );
    const notification = compact.slice(notificationStart, notificationEnd);
    const companyStart = notification.indexOf(
      "elsif v_connection.type::text = 'company'"
    );
    const companyEnd = notification.indexOf("end if;", companyStart);
    const companyBranch = notification.slice(companyStart, companyEnd);

    expect(notification).toContain("user_row.id::text = v_connection.user_id");
    expect(notification).toContain("coalesce(user_row.is_active, false)");
    expect(notification).toContain("v_action_url := null");
    expect(companyBranch).toContain(
      "public.has_permission( user_row.id, 'settings.integrations', 'all' )"
    );
    expect(companyBranch).not.toContain("v_connection.user_id");
    expect(notification).toContain(
      "v_action_url := '/settings?tab=integrations'"
    );
  });

  it("atomically reauthorizes, reassigns learning history, links the thread, and completes", () => {
    expect(compact).toContain(
      "join public.opportunities opportunity on opportunity.id = work.opportunity_id where work.id = p_queue_id for update of opportunity"
    );
    expect(compact).toContain(
      "private.email_assignment_contact_form_draft_authorized( p_queue_id, true )"
    );
    expect(compact).toContain("from public.ai_draft_history draft");
    expect(compact).toContain("draft.user_id = queue.actor_user_id");
    expect(compact).toContain("draft.connection_id = queue.connection_id");
    expect(compact).toContain("draft.opportunity_id = queue.opportunity_id");
    expect(compact).toContain(
      "perform public.reassign_phase_c_mailbox_draft( p_company_id => queue.company_id, p_connection_id => queue.connection_id, p_thread_id => btrim(p_provider_thread_id), p_new_draft_history_id => p_draft_history_id, p_mailbox_draft_id => btrim(p_mailbox_draft_id), p_expected_old_draft_history_id => queue.reused_from_draft_history_id"
    );
    expect(compact).toContain(
      "insert into public.opportunity_email_threads ( opportunity_id, thread_id, connection_id )"
    );
    expect(compact).toContain(
      "on conflict (thread_id, connection_id) do nothing"
    );
    expect(compact).toContain("set status = 'completed'");
    expect(compact).toContain(
      "queue.provider_create_attempt_id = p_provider_create_attempt_id"
    );
  });
});

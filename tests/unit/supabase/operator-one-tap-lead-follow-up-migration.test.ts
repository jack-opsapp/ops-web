import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260723233000_operator_one_tap_lead_follow_up.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compact = sql.replace(/\s+/g, " ");

function block(start: string, end: string): string {
  const startIndex = sql.indexOf(start);
  const endIndex = sql.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing ${end}`).toBeGreaterThan(startIndex);
  return sql.slice(startIndex, endIndex);
}

describe("operator one-tap lead follow-up migration", () => {
  it("adds an immutable outcome receipt and upgrades only the legacy stock template", () => {
    expect(sql).not.toBe("");
    expect(compact).toContain(
      "alter table public.email_send_intents add column if not exists follow_up_outcome_applied_at timestamptz"
    );
    expect(compact).toContain(
      "add column if not exists follow_up_comeback_at timestamptz"
    );
    expect(compact).toContain(
      "add column if not exists follow_up_notification_id uuid"
    );
    expect(compact).toContain(
      "foreign key (follow_up_notification_id) references public.notifications (id) on delete restrict"
    );
    expect(compact).toContain(
      "create index if not exists email_send_intents_follow_up_notification_idx on public.email_send_intents (follow_up_notification_id) where follow_up_notification_id is not null"
    );
    expect(compact).toContain(
      "alter column follow_up_template_body set default"
    );
    expect(compact).toContain(
      "where follow_up_template_body = 'hey there {{first_name}}, just following up on this as i didn''t see anything back from you.'"
    );
    expect(compact).toContain(
      "hi {{first_name}}, just checking in to see if you had any questions about the quote. no pressure — i wanted to make sure you had everything you needed."
    );
  });

  it("keeps the reconciliation rpc service-only and locks parent before children", () => {
    const rpc = block(
      "create or replace function public.reconcile_operator_template_follow_up_send_as_system",
      "revoke all on function public.reconcile_operator_template_follow_up_send_as_system"
    );
    const companyLock = rpc.indexOf(
      "perform private.lock_lead_assignment_company(v_identity.company_id)"
    );
    const opportunityLock = rpc.indexOf("from public.opportunities candidate");
    const intentLock = rpc.indexOf(
      "from public.email_send_intents candidate",
      opportunityLock
    );
    const draftLock = rpc.indexOf(
      "from public.opportunity_follow_up_drafts candidate"
    );

    expect(rpc).toContain("auth.jwt() ->> 'role'");
    expect(rpc).toContain("service_role");
    expect(companyLock).toBeGreaterThanOrEqual(0);
    expect(opportunityLock).toBeGreaterThan(companyLock);
    expect(intentLock).toBeGreaterThan(opportunityLock);
    expect(draftLock).toBeGreaterThan(intentLock);
    expect(rpc.slice(opportunityLock, draftLock)).toContain("for update");
    expect(compact).toContain(
      "grant execute on function public.reconcile_operator_template_follow_up_send_as_system( uuid ) to service_role"
    );
    expect(compact).not.toContain(
      "grant execute on function public.reconcile_operator_template_follow_up_send_as_system( uuid ) to authenticated"
    );
  });

  it("accepts only a provider-accepted template follow-up bound to the same lead", () => {
    const rpc = block(
      "create or replace function public.reconcile_operator_template_follow_up_send_as_system",
      "revoke all on function public.reconcile_operator_template_follow_up_send_as_system"
    );
    const normalized = rpc.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "v_intent.status not in ( 'provider_accepted', 'reconciling', 'reconciled' )"
    );
    expect(rpc).toContain("v_intent.provider_accepted_at is null");
    expect(rpc).toContain("v_intent.follow_up_draft_id is null");
    expect(rpc).toContain("candidate.company_id = v_intent.company_id");
    expect(rpc).toContain("candidate.opportunity_id = v_intent.opportunity_id");
    expect(rpc).toContain(
      "v_draft.origin is distinct from 'template_follow_up'"
    );
    expect(rpc).toContain(
      "v_draft.connection_id is distinct from v_intent.connection_id"
    );
    expect(normalized).toContain(
      "v_draft.provider_thread_id is distinct from v_intent.accepted_provider_thread_id"
    );
    expect(normalized).toContain(
      "v_intent.reply_provider_thread_id is distinct from v_intent.accepted_provider_thread_id"
    );
  });

  it("marks the draft sent and advances lifecycle exactly once", () => {
    const rpc = block(
      "create or replace function public.reconcile_operator_template_follow_up_send_as_system",
      "revoke all on function public.reconcile_operator_template_follow_up_send_as_system"
    );

    expect(rpc).toContain("set status = 'sent'");
    expect(rpc).toContain("final_sent_body = v_intent.authored_body");
    expect(rpc).toContain("sent_at = v_intent.provider_accepted_at");
    expect(rpc).toContain("unanswered_follow_up_count =");
    expect(rpc).toContain("v_state.unanswered_follow_up_count + 1");
    expect(rpc).toContain("second_follow_up_sent_at");
    expect(rpc).toContain("operator_follow_up_miss_at = null");
    expect(rpc).toContain("stale_status = case");
    expect(rpc).toContain("then null");
    expect(rpc).toContain("handled_at = v_intent.provider_accepted_at");
    expect(rpc).toContain("v_intent.provider_accepted_at + interval '3 days'");
    expect(rpc).toContain("follow_up_outcome_applied_at = v_applied_at");
    expect(rpc).toContain("follow_up_comeback_at = v_comeback_at");
  });

  it("returns the stored receipt on replay before any second mutation", () => {
    const rpc = block(
      "create or replace function public.reconcile_operator_template_follow_up_send_as_system",
      "revoke all on function public.reconcile_operator_template_follow_up_send_as_system"
    );
    const receiptCheck = rpc.indexOf(
      "if v_intent.follow_up_outcome_applied_at is not null then"
    );
    const draftUpdate = rpc.indexOf(
      "update public.opportunity_follow_up_drafts draft"
    );

    expect(receiptCheck).toBeGreaterThanOrEqual(0);
    expect(draftUpdate).toBeGreaterThan(receiptCheck);
    expect(rpc.slice(receiptCheck, draftUpdate)).toContain("return next");
  });

  it("creates one permanent standard notification for the actor and lead", () => {
    const rpc = block(
      "create or replace function public.reconcile_operator_template_follow_up_send_as_system",
      "revoke all on function public.reconcile_operator_template_follow_up_send_as_system"
    );

    expect(compact).toContain(
      "create unique index if not exists notifications_lead_follow_up_sent_dedupe_idx on public.notifications (dedupe_key) where dedupe_key like 'lead-follow-up-sent:%'"
    );
    expect(rpc).toContain("'lead-follow-up-sent:' || v_intent.id::text");
    expect(rpc).toContain("'lead_follow_up_sent'");
    expect(rpc).toContain("'follow-up sent'");
    expect(rpc).toContain("false");
    expect(rpc).toContain(
      "'/pipeline?opportunityid=' || v_intent.opportunity_id::text"
    );
    expect(rpc).toContain("'view lead'");
    expect(rpc).toContain("'lead'");
    expect(rpc).toContain("on conflict do nothing");
    expect(rpc).toContain("follow_up_notification_id = v_notification_id");
  });

  it("rechecks due, thread, recipient, and conversation authority at prepared-to-sending", () => {
    const guard = block(
      "create or replace function private.guard_system_handoff_email_send_delivery",
      "drop trigger if exists email_send_intents_system_handoff_delivery_guard"
    );
    const normalized = guard.replace(/\s+/g, " ");

    expect(guard).toContain("old.status = 'prepared'");
    expect(guard).toContain("new.status = 'sending'");
    expect(guard).toContain("draft.origin = 'template_follow_up'");
    expect(guard).toContain("opportunity.next_follow_up_at is null");
    expect(guard).toContain("timezone.name = company.timezone");
    expect(guard).toContain("join pg_catalog.pg_timezone_names timezone");
    expect(guard).toContain("at time zone v_company_timezone");
    expect(normalized).toContain(
      ")::date > ( now() at time zone v_company_timezone )::date"
    );
    expect(normalized).toContain(
      "opportunity.stage not in ( 'quoted', 'follow_up', 'negotiation' )"
    );
    expect(guard).toContain("draft.status <> 'drafted'");
    expect(guard).toContain("new.initiated_by <> 'operator'");
    expect(guard).toContain("new.sender_switched");
    expect(guard).toContain(
      "new.reply_provider_thread_id is distinct from draft.provider_thread_id"
    );
    expect(guard).toContain(
      "new.in_reply_to is distinct from source_event.provider_message_id"
    );
    expect(guard).toContain("cardinality(new.to_emails) <> 1");
    expect(guard).toContain("coalesce(cardinality(new.cc_emails), 0) <> 0");
    expect(normalized).toContain(
      "event.direction = 'outbound' and event.party_role = 'ops'"
    );
    expect(guard).toContain(
      "newer_outbound.occurred_at >= source_event.occurred_at"
    );
    expect(normalized).toContain(
      "later_inbound.direction = 'inbound' and later_inbound.party_role = 'customer'"
    );
    expect(guard).toContain(
      "later_inbound.occurred_at >= source_event.occurred_at"
    );
    expect(guard).toContain(
      "competing_intent.in_reply_to =\n           source_event.provider_message_id"
    );
  });

  it("treats any equal-or-newer opportunity event on another linked thread as stale", () => {
    const guard = block(
      "create or replace function private.guard_system_handoff_email_send_delivery",
      "drop trigger if exists email_send_intents_system_handoff_delivery_guard"
    );
    const newerOutboundStart = guard.indexOf(
      "from public.opportunity_correspondence_events newer_outbound"
    );
    const laterInboundStart = guard.indexOf(
      "from public.opportunity_correspondence_events later_inbound"
    );
    const unresolvedStart = guard.indexOf(
      "from public.email_send_intents unresolved_intent"
    );
    expect(newerOutboundStart).toBeGreaterThanOrEqual(0);
    expect(laterInboundStart).toBeGreaterThan(newerOutboundStart);
    expect(unresolvedStart).toBeGreaterThan(laterInboundStart);

    const durableFence = guard.slice(newerOutboundStart, unresolvedStart);
    expect(durableFence).toContain(
      "newer_outbound.opportunity_id = new.opportunity_id"
    );
    expect(durableFence).toContain(
      "later_inbound.opportunity_id = new.opportunity_id"
    );
    expect(durableFence).toContain(
      "newer_outbound.occurred_at >= source_event.occurred_at"
    );
    expect(durableFence).toContain(
      "later_inbound.occurred_at >= source_event.occurred_at"
    );
    expect(durableFence).not.toContain("newer_outbound.connection_id");
    expect(durableFence).not.toContain("newer_outbound.provider_thread_id");
    expect(durableFence).not.toContain("later_inbound.connection_id");
    expect(durableFence).not.toContain("later_inbound.provider_thread_id");
  });

  it("advances a same-local-day comeback to provider acceptance plus three days", () => {
    const rpc = block(
      "create or replace function public.reconcile_operator_template_follow_up_send_as_system",
      "revoke all on function public.reconcile_operator_template_follow_up_send_as_system"
    );
    const normalized = rpc.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "v_requested_comeback_at := v_intent.provider_accepted_at + interval '3 days'"
    );
    expect(normalized).toContain(
      "when ( v_opportunity.next_follow_up_at at time zone v_company_timezone )::date > ( v_intent.provider_accepted_at at time zone v_company_timezone )::date then least( v_opportunity.next_follow_up_at, v_requested_comeback_at ) else v_requested_comeback_at end"
    );
  });

  it("blocks every unresolved template follow-up for the lead, not only the current thread", () => {
    const guard = block(
      "create or replace function private.guard_system_handoff_email_send_delivery",
      "drop trigger if exists email_send_intents_system_handoff_delivery_guard"
    );
    const fenceStart = guard.indexOf(
      "from public.email_send_intents unresolved_intent"
    );
    const fenceEnd = guard.indexOf(") or exists (", fenceStart);
    expect(fenceStart).toBeGreaterThanOrEqual(0);
    expect(fenceEnd).toBeGreaterThan(fenceStart);
    const fence = guard.slice(fenceStart, fenceEnd);
    const normalized = fence.replace(/\s+/g, " ");

    expect(fence).toContain("unresolved_intent.company_id = new.company_id");
    expect(fence).toContain(
      "unresolved_intent.opportunity_id = new.opportunity_id"
    );
    expect(normalized).toContain(
      "unresolved_intent.status in ( 'sending', 'delivery_unknown', 'provider_accepted', 'reconciling', 'reconciliation_failed' )"
    );
    expect(fence).not.toContain("unresolved_intent.connection_id");
    expect(fence).not.toContain("unresolved_intent.reply_provider_thread_id");
  });

  it("freezes template draft content and binding while provider outcome is unresolved", () => {
    const mutationGuard = block(
      "create or replace function private.guard_template_follow_up_draft_mutation",
      "drop trigger if exists opportunity_follow_up_drafts_template_send_guard"
    );
    const normalized = mutationGuard.replace(/\s+/g, " ");

    expect(mutationGuard).toContain(
      "old.origin is distinct from 'template_follow_up'"
    );
    expect(normalized).toContain(
      "unresolved_intent.status in ( 'sending', 'delivery_unknown', 'provider_accepted', 'reconciling', 'reconciliation_failed' )"
    );
    expect(mutationGuard).toContain(
      "EMAIL_SEND_TEMPLATE_FOLLOW_UP_DRAFT_FROZEN".toLowerCase()
    );
    expect(normalized).toContain(
      "new.final_sent_body is not distinct from accepted_intent.authored_body"
    );
    expect(normalized).toContain(
      "new.sent_at is not distinct from accepted_intent.provider_accepted_at"
    );
    expect(compact).toContain(
      "create trigger opportunity_follow_up_drafts_template_send_guard before update or delete on public.opportunity_follow_up_drafts"
    );
  });

  it("does not let a delayed reconciliation overwrite newer lifecycle truth", () => {
    const rpc = block(
      "create or replace function public.reconcile_operator_template_follow_up_send_as_system",
      "revoke all on function public.reconcile_operator_template_follow_up_send_as_system"
    );
    const normalized = rpc.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "v_lifecycle_is_current := ( v_state.last_meaningful_at is null"
    );
    expect(normalized).toContain("and not exists (");
    expect(normalized).toContain(
      "from public.opportunity_correspondence_events durable_truth"
    );
    expect(normalized).toContain(
      "durable_truth.occurred_at >= v_intent.provider_accepted_at"
    );
    expect(normalized).toContain(
      "durable_truth.provider_message_id is distinct from v_intent.provider_message_id"
    );
    const durableTruthStart = normalized.indexOf(
      "from public.opportunity_correspondence_events durable_truth"
    );
    const durableTruthEnd = normalized.indexOf(
      "); if v_lifecycle_is_current",
      durableTruthStart
    );
    const durableTruth = normalized.slice(durableTruthStart, durableTruthEnd);
    expect(durableTruth).not.toContain(
      "and durable_truth.connection_id = v_intent.connection_id"
    );
    expect(durableTruth).not.toContain("durable_truth.provider_thread_id");
    expect(durableTruth).not.toContain(
      "durable_truth.opportunity_projection_applied"
    );
    expect(normalized).toContain(
      "if v_lifecycle_is_current then v_next_unanswered_count := v_state.unanswered_follow_up_count + 1"
    );
    expect(normalized).toContain(
      "if v_lifecycle_is_current then -- clear the actionable"
    );
    expect(normalized).toContain(
      "if v_lifecycle_is_current and v_opportunity.deleted_at is null"
    );
    expect(rpc).toContain(
      "v_opportunity.handled_at <= v_intent.provider_accepted_at"
    );
    expect(normalized).toContain(
      "else -- provider delivery is still recorded, but this send did not own the -- current chase state"
    );
    expect(normalized).toContain("v_comeback_at := null");
    expect(normalized).toContain(
      "when v_comeback_at is not null then 'next check-in scheduled for '"
    );
  });

  it("preserves the existing system-handoff authorization branch", () => {
    const guard = block(
      "create or replace function private.guard_system_handoff_email_send_delivery",
      "drop trigger if exists email_send_intents_system_handoff_delivery_guard"
    );

    expect(guard).toContain("draft.origin is distinct from 'system_handoff'");
    expect(guard).toContain("email_send_system_handoff_authorization_stale");
    expect(guard).toContain("projection.conversation_scope = 'message'");
    expect(guard).toContain(
      "later_intent.follow_up_source_event_id = source_event.id"
    );
  });
});

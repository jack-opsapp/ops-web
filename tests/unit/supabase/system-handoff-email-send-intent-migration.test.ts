import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260722211000_system_handoff_email_send_intent.sql"
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

describe("system-handoff email send-intent migration", () => {
  it("snapshots the exact source event and recipient on the durable send intent", () => {
    expect(sql).not.toBe("");
    expect(compact).toContain(
      "alter table public.email_send_intents add column if not exists follow_up_source_event_id uuid"
    );
    expect(compact).toContain(
      "add column if not exists follow_up_recipient_email text"
    );
    expect(compact).toContain(
      "foreign key (company_id, follow_up_source_event_id) references public.opportunity_correspondence_events (company_id, id)"
    );
    expect(compact).toContain(
      "check ( (follow_up_source_event_id is null and follow_up_recipient_email is null) or (follow_up_source_event_id is not null and follow_up_recipient_email is not null) )"
    );
  });

  it("accepts only an operator, the exact recipient, and the exact message-scoped source event", () => {
    const prepare = block(
      "create or replace function public.prepare_email_send_intent_guarded",
      "create or replace function private.guard_system_handoff_email_send_delivery"
    );

    expect(prepare).toContain("v_follow_up_draft.origin = 'system_handoff'");
    expect(prepare).toContain("p_initiated_by is distinct from 'operator'");
    expect(prepare).toContain("p_source_email_thread_id is not null");
    expect(prepare).toContain("p_reply_provider_thread_id is not null");
    expect(prepare).toContain("p_in_reply_to is not null");
    expect(prepare).toContain("coalesce(p_sender_switched, false)");
    expect(prepare).toContain("cardinality(p_to_emails) <> 1");
    expect(prepare).toContain(
      "lower(btrim(p_to_emails[1])) is distinct from lower(btrim(v_follow_up_draft.recipient_email))"
    );
    expect(prepare).toContain("coalesce(cardinality(p_cc_emails), 0) <> 0");
    expect(prepare).toContain("e.id = v_follow_up_draft.source_event_id");
    expect(prepare).toContain("e.connection_id = p_connection_id");
    expect(prepare).toContain("e.opportunity_id = p_opportunity_id");
    expect(prepare).toContain("e.direction = 'inbound'");
    expect(prepare).toContain("e.party_role = 'customer'");
    expect(prepare).toContain("e.is_meaningful is true");
    expect(prepare).toContain("e.noise_reason is null");
    expect(prepare).toContain(
      "lower(btrim(e.from_email)) = lower(btrim(v_follow_up_draft.recipient_email))"
    );
    expect(prepare).toContain("projection.conversation_scope = 'message'");
    expect(prepare).toContain(
      "projection.response_disposition = 'reply_required'"
    );
    expect(prepare).toContain(
      "v_follow_up_source_event.id, lower(btrim(v_follow_up_draft.recipient_email))"
    );
  });

  it("returns an exact existing intent before mutable draft state checks and rejects changed retries", () => {
    const prepare = block(
      "create or replace function public.prepare_email_send_intent_guarded",
      "create or replace function private.guard_system_handoff_email_send_delivery"
    );
    const existingLookup = prepare.indexOf("where i.company_id = p_company_id");
    const draftLookup = prepare.indexOf(
      "from public.opportunity_follow_up_drafts d"
    );

    expect(existingLookup).toBeGreaterThanOrEqual(0);
    expect(draftLookup).toBeGreaterThan(existingLookup);
    expect(prepare).toContain(
      "v_intent.request_fingerprint = p_request_fingerprint"
    );
    expect(prepare).toContain("return v_intent");
    expect(prepare).toContain("email_send_idempotency_conflict");
    expect(prepare).toContain("public.prepare_email_send_intent(");
  });

  it("locks the opportunity before any system-handoff child row", () => {
    const prepare = block(
      "create or replace function public.prepare_email_send_intent_guarded",
      "create or replace function private.guard_system_handoff_email_send_delivery"
    );
    const opportunityLock = prepare.indexOf(
      "from public.opportunities candidate"
    );
    const draftLock = prepare.indexOf(
      "from public.opportunity_follow_up_drafts d"
    );
    const eventLock = prepare.indexOf(
      "from public.opportunity_correspondence_events e"
    );
    const intentLock = prepare.indexOf("from public.email_send_intents i");

    expect(opportunityLock).toBeGreaterThanOrEqual(0);
    expect(intentLock).toBeGreaterThan(opportunityLock);
    expect(draftLock).toBeGreaterThan(opportunityLock);
    expect(eventLock).toBeGreaterThan(draftLock);
    expect(prepare.slice(opportunityLock, intentLock)).toContain("for update");
  });

  it("rejects a deleted, terminal, archived, merged, or project-linked opportunity at preparation and delivery", () => {
    const prepare = block(
      "create or replace function public.prepare_email_send_intent_guarded",
      "create or replace function private.guard_system_handoff_email_send_delivery"
    );
    const guard = block(
      "create or replace function private.guard_system_handoff_email_send_delivery",
      "drop trigger if exists email_send_intents_system_handoff_delivery_guard"
    );

    for (const boundary of [prepare, guard]) {
      const normalized = boundary.replace(/\s+/g, " ");
      expect(normalized).toContain("opportunity.deleted_at is not null");
      expect(normalized).toContain("opportunity.archived_at is not null");
      expect(normalized).toContain(
        "opportunity.merged_into_opportunity_id is not null"
      );
      expect(normalized).toContain("opportunity.project_id is not null");
      expect(normalized).toContain("opportunity.project_ref is not null");
      expect(normalized).toContain(
        "opportunity.stage not in ( 'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up', 'negotiation' )"
      );
    }
  });

  it("rechecks the immutable handoff facts immediately before provider delivery can be claimed", () => {
    const guard = block(
      "create or replace function private.guard_system_handoff_email_send_delivery",
      "drop trigger if exists email_send_intents_system_handoff_delivery_guard"
    );

    expect(guard).toContain("old.status = 'prepared'");
    expect(guard).toContain("new.status = 'sending'");
    expect(guard).toContain("draft.status <> 'drafted'");
    expect(guard).toContain("draft.origin is distinct from 'system_handoff'");
    expect(guard).toContain(
      "new.follow_up_source_event_id is distinct from draft.source_event_id"
    );
    expect(guard).toContain(
      "new.follow_up_recipient_email is distinct from lower(btrim(draft.recipient_email))"
    );
    expect(guard).toContain("new.source_email_thread_id is not null");
    expect(guard).toContain("new.reply_provider_thread_id is not null");
    expect(guard).toContain("new.in_reply_to is not null");
    expect(guard).toContain("cardinality(new.to_emails) <> 1");
    expect(guard).toContain("coalesce(cardinality(new.cc_emails), 0) <> 0");
    expect(guard).toContain("projection.conversation_scope = 'message'");
    expect(guard).toContain("return new");
    expect(compact).toContain(
      "before update of status on public.email_send_intents for each row execute function private.guard_system_handoff_email_send_delivery()"
    );
  });

  it("fails closed for rolling legacy handoff intents that lack immutable bindings", () => {
    const prepare = block(
      "create or replace function public.prepare_email_send_intent_guarded",
      "create or replace function private.guard_system_handoff_email_send_delivery"
    );
    const guard = block(
      "create or replace function private.guard_system_handoff_email_send_delivery",
      "drop trigger if exists email_send_intents_system_handoff_delivery_guard"
    );
    const draftLookup = guard.indexOf(
      "from public.opportunity_follow_up_drafts candidate"
    );
    const ordinaryReturn = guard.indexOf(
      "draft.origin is distinct from 'system_handoff'"
    );
    const bindingCheck = guard.indexOf(
      "new.follow_up_source_event_id is null"
    );

    expect(prepare).toContain("email_send_system_handoff_binding_required");
    expect(draftLookup).toBeGreaterThanOrEqual(0);
    expect(ordinaryReturn).toBeGreaterThan(draftLookup);
    expect(bindingCheck).toBeGreaterThan(ordinaryReturn);
    expect(guard.slice(ordinaryReturn, bindingCheck)).toContain("return new");
    expect(guard).toContain("email_send_system_handoff_authorization_stale");
  });

  it("serializes provider claims parent-before-child and blocks every durable may-have-sent state", () => {
    const claim = block(
      "create or replace function public.claim_email_send_provider_delivery",
      "revoke all on function public.claim_email_send_provider_delivery"
    );
    const companyLock = claim.indexOf(
      "perform private.lock_lead_assignment_company(intent_identity.company_id)"
    );
    const opportunityLock = claim.indexOf("from public.opportunities opportunity");
    const delegatedClaim = claim.indexOf(
      "public.claim_email_send_provider_delivery_pre_system_handoff_guard"
    );

    expect(companyLock).toBeGreaterThanOrEqual(0);
    expect(opportunityLock).toBeGreaterThan(companyLock);
    expect(delegatedClaim).toBeGreaterThan(opportunityLock);
    expect(claim.slice(opportunityLock, delegatedClaim)).toContain("for update");

    const guard = block(
      "create or replace function private.guard_system_handoff_email_send_delivery",
      "drop trigger if exists email_send_intents_system_handoff_delivery_guard"
    );
    expect(guard).toContain("later_intent.id <> new.id");
    expect(guard).toContain("later_intent.company_id = new.company_id");
    expect(guard).toContain(
      "later_intent.opportunity_id = new.opportunity_id"
    );
    expect(guard).toContain(
      "later_intent.follow_up_source_event_id = source_event.id"
    );
    expect(guard).toContain(
      "lower(btrim(recipient.email)) = new.follow_up_recipient_email"
    );
    expect(guard.replace(/\s+/g, " ")).toContain(
      "later_intent.status in ( 'prepared', 'sending', 'delivery_unknown', 'provider_accepted', 'reconciling', 'reconciliation_failed', 'reconciled' )"
    );
    expect(guard).toContain(
      "later_intent.created_at >= source_event.created_at"
    );
    expect(guard).not.toMatch(
      /later_intent\.status\s+in\s*\([^)]*provider_rejected/
    );

    const claimCompact = claim.replace(/\s+/g, " ");
    expect(claimCompact).toContain(
      "handoff.status in ( 'sending', 'delivery_unknown', 'provider_accepted', 'reconciling', 'reconciliation_failed' )"
    );
    expect(claimCompact).not.toMatch(
      /handoff\.status\s+in\s*\([^)]*provider_rejected/
    );
    expect(claimCompact).not.toMatch(
      /handoff\.status\s+in\s*\([^)]*reconciled/
    );
    expect(guard).not.toContain(
      "private.lock_lead_assignment_company(new.company_id)"
    );
  });

  it("treats distinct same-timestamp correspondence as stale without UUID ordering", () => {
    const guard = block(
      "create or replace function private.guard_system_handoff_email_send_delivery",
      "drop trigger if exists email_send_intents_system_handoff_delivery_guard"
    );

    expect(guard).toContain("newer_inbound.id <> source_event.id");
    expect(guard).toContain(
      "newer_inbound.occurred_at >= source_event.occurred_at"
    );
    expect(guard).toContain("later_outbound.id <> source_event.id");
    expect(guard).toContain(
      "later_outbound.occurred_at >= source_event.occurred_at"
    );
    expect(guard).not.toContain(
      "(newer_inbound.occurred_at, newer_inbound.id)"
    );
    expect(guard).not.toContain(
      "(later_outbound.occurred_at, later_outbound.id)"
    );
  });

  it("keeps the guarded RPC service-role-only, remains rolling-compatible, and contains no provider operation", () => {
    expect(compact).not.toContain(
      "revoke all on function public.prepare_email_send_intent("
    );
    expect(compact).toContain(
      "grant execute on function public.prepare_email_send_intent_guarded"
    );
    expect(compact).toContain("to service_role");
    expect(sql).not.toMatch(/sendemail|createdraft|updatedraft|deletedraft/);
  });
});

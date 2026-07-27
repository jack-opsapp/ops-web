import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260727005232_bridge_contact_form_draft_recipient_provenance.sql"
);
const sql = readFileSync(migrationPath, "utf8");
const compact = sql.replace(/\s+/g, " ");
const lower = compact.toLowerCase();
const normalizedSignatures = lower
  .replace(/\(\s+/g, "(")
  .replace(/\s+\)/g, ")");

function functionDefinition(signature: string): string {
  const marker = `create or replace function ${signature}`;
  const start = lower.indexOf(marker);
  const end = lower.indexOf("$function$;", start);
  if (start < 0 || end < 0) return "";
  return compact.slice(start, end + "$function$;".length);
}

const recipientResolver = functionDefinition(
  "private.email_assignment_contact_form_draft_canonical_recipient"
);
const enqueue = functionDefinition(
  "private.enqueue_email_assignment_contact_form_draft"
);
const authorization = functionDefinition(
  "private.email_assignment_contact_form_draft_authorized"
);
const attestationRpc = functionDefinition(
  "public.attest_email_contact_form_recipient_as_system"
);

describe("contact-form draft canonical recipient provenance bridge", () => {
  it("is a forward-only transaction with private helper privileges preserved", () => {
    expect(lower.trim().startsWith("begin;")).toBe(true);
    expect(lower.trim().endsWith("commit;")).toBe(true);
    expect(recipientResolver).not.toBe("");
    expect(normalizedSignatures).toContain(
      "revoke all on function private.email_assignment_contact_form_draft_canonical_recipient"
    );
    expect(normalizedSignatures).toContain(
      "revoke all on function private.enqueue_email_assignment_contact_form_draft(uuid, uuid) from public, anon, authenticated, service_role"
    );
    expect(normalizedSignatures).toContain(
      "revoke all on function private.email_assignment_contact_form_draft_authorized(uuid, boolean) from public, anon, authenticated, service_role"
    );
    expect(lower).not.toContain("alter table public.activities");
    expect(lower).not.toContain("update public.activities");
    expect(lower).not.toContain(
      "for assignment_row in select event.id from public.opportunity_assignment_events"
    );
    expect(lower).not.toContain(
      "perform private.enqueue_email_assignment_contact_form_draft( assignment_row.id, null )"
    );
  });

  it("creates immutable exact-source evidence with no authenticated or service-role table access", () => {
    expect(lower).toContain(
      "create table private.email_contact_form_recipient_attestations"
    );
    for (const column of [
      "source_activity_id uuid primary key",
      "company_id uuid not null",
      "opportunity_id uuid not null",
      "connection_id uuid not null",
      "provider_message_id text not null",
      "provider_thread_id text not null",
      "canonical_recipient text not null",
      "provenance_source text not null default 'contact_form'",
      "attested_by_role text not null default 'service_role'",
    ]) {
      expect(lower).toContain(column);
    }
    expect(lower).toContain(
      "alter table private.email_contact_form_recipient_attestations enable row level security"
    );
    expect(lower).toContain(
      "revoke all on table private.email_contact_form_recipient_attestations from public, anon, authenticated, service_role"
    );
    expect(lower).toContain(
      "before update or delete on private.email_contact_form_recipient_attestations"
    );
    expect(lower).toContain(
      "raise exception 'contact_form_recipient_attestation_immutable'"
    );
  });

  it("allows only the service ingestion boundary to attest exact parser evidence", () => {
    expect(lower).toContain(
      "create or replace function public.attest_email_contact_form_recipient_as_system"
    );
    expect(lower).toContain(
      "if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then"
    );
    expect(lower).toContain(
      "raise exception 'service_role_required' using errcode = '42501'"
    );
    expect(lower).toContain("activity.id = p_source_activity_id");
    expect(lower).toContain("activity.company_id = p_company_id");
    expect(lower).toContain("activity.opportunity_id = p_opportunity_id");
    expect(lower).toContain("activity.email_connection_id = p_connection_id");
    expect(lower).toContain(
      "activity.email_message_id = p_provider_message_id"
    );
    expect(lower).toContain("activity.email_thread_id = p_provider_thread_id");
    expect(lower).toContain("connection.status = 'active'");
    expect(lower).toContain("coalesce(connection.sync_enabled, false)");
    expect(attestationRpc).toContain("for update of opportunity");
    expect(lower).toContain(
      "insert into private.email_contact_form_recipient_attestations"
    );
    expect(lower).toContain("on conflict do nothing");
    for (const exactRetryField of [
      "attestation.source_activity_id = p_source_activity_id",
      "attestation.company_id = p_company_id",
      "attestation.opportunity_id = p_opportunity_id",
      "attestation.connection_id = p_connection_id",
      "attestation.provider_message_id = p_provider_message_id",
      "attestation.provider_thread_id = p_provider_thread_id",
      "attestation.canonical_recipient = v_canonical_email",
      "attestation.provenance_source = 'contact_form'",
      "attestation.attested_by_role = 'service_role'",
    ]) {
      expect(lower).toContain(exactRetryField);
    }
    expect(lower).toContain(
      "raise exception 'contact_form_recipient_attestation_conflict'"
    );
    expect(lower).toContain(
      "perform private.enqueue_email_assignment_contact_form_draft("
    );
    expect(normalizedSignatures).toContain(
      "revoke all on function public.attest_email_contact_form_recipient_as_system"
    );
    expect(normalizedSignatures).toContain(
      "grant execute on function public.attest_email_contact_form_recipient_as_system"
    );
    expect(lower).not.toContain(
      "grant select on table private.email_contact_form_recipient_attestations"
    );
    expect(lower).not.toContain(
      "revoke insert on table public.lead_field_provenance"
    );
    expect(lower).not.toContain(
      "revoke update on table public.lead_field_provenance"
    );
    expect(attestationRpc).not.toContain("public.lead_field_provenance");
    expect(attestationRpc.match(/return false/g)?.length ?? 0).toBeGreaterThan(
      4
    );
    expect(attestationRpc).not.toContain(
      "contact_form_recipient_attestation_parser_mismatch"
    );
    expect(attestationRpc).toContain(
      "contact_form_recipient_attestation_conflict"
    );
  });

  it("derives one canonical recipient from the opportunity first and active linked client only as fallback", () => {
    expect(recipientResolver).toContain("public.opportunities");
    expect(recipientResolver).toContain("public.clients");
    expect(recipientResolver).toContain(
      "coalesce(opportunity.client_ref, opportunity.client_id)"
    );
    expect(recipientResolver).toContain("client.deleted_at is null");
    expect(recipientResolver).toContain(
      "v_canonical_email := coalesce(v_opportunity_email, v_client_email)"
    );
    expect(recipientResolver).toMatch(
      /v_client_ref is not null and v_legacy_client_id is not null and v_client_ref <> v_legacy_client_id[\s\S]*?return null/i
    );
    expect(recipientResolver).toMatch(
      /v_opportunity_email is not null and v_client_email is not null and v_opportunity_email <> v_client_email[\s\S]*?return null/i
    );
    expect(recipientResolver).toContain(
      "v_canonical_email !~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'"
    );
  });

  it("accepts either the modern effective sender or immutable exact-source attestation", () => {
    expect(recipientResolver).toContain("v_source_sender = v_canonical_email");
    expect(recipientResolver).toContain(
      "private.email_contact_form_recipient_attestations"
    );
    expect(recipientResolver).toContain(
      "attestation.source_activity_id = p_source_activity_id"
    );
    expect(recipientResolver).toContain(
      "attestation.connection_id = p_connection_id"
    );
    expect(recipientResolver).toContain(
      "attestation.provider_message_id = p_provider_message_id"
    );
    expect(recipientResolver).toContain(
      "attestation.provider_thread_id = p_provider_thread_id"
    );
    expect(recipientResolver).toContain(
      "attestation.canonical_recipient = v_canonical_email"
    );
    expect(recipientResolver).not.toContain("public.lead_field_provenance");
  });

  it("binds provenance to the exact immutable activity and provider identity", () => {
    for (const guard of [
      "activity.id = p_source_activity_id",
      "activity.company_id = p_company_id",
      "activity.opportunity_id = p_opportunity_id",
      "activity.email_connection_id = p_connection_id",
      "activity.email_message_id = p_provider_message_id",
      "activity.email_thread_id = p_provider_thread_id",
      "activity.type = 'email'",
      "activity.direction = 'inbound'",
      "not coalesce(activity.match_needs_review, false)",
      "nullif(btrim(coalesce(activity.body_text, '')), '') is not null",
    ]) {
      expect(recipientResolver).toContain(guard);
    }
  });

  it("enqueues the canonical recipient without relabelling the source activity", () => {
    expect(enqueue).toContain(
      "v_customer_email := private.email_assignment_contact_form_draft_canonical_recipient("
    );
    expect(enqueue).toContain("activity.id");
    expect(enqueue).toContain("activity.email_thread_id");
    expect(enqueue).toContain("v_provider_message_id");
    expect(enqueue).toContain(
      "if v_customer_email is null then return; end if"
    );
    expect(enqueue).not.toContain(
      "v_customer_email := lower(btrim(activity.from_email))"
    );
    expect(enqueue).toContain("source_activity_id");
    expect(enqueue).toContain("source_provider_thread_id");
    expect(enqueue).toContain("source_subject");
    expect(enqueue).toContain("source_body_text");
  });

  it("repeats canonical recipient proof at every existing provider-boundary authorization call", () => {
    expect(authorization).toContain(
      "private.email_assignment_contact_form_draft_canonical_recipient("
    );
    expect(authorization).toContain("= lower(btrim(queue.customer_email))");
    expect(authorization).not.toContain(
      "lower(btrim(coalesce(activity.from_email, ''))) = lower(btrim(queue.customer_email))"
    );

    for (const guard of [
      "queue.assignment_event_id = event.id",
      "queue.assignment_version = opportunity.assignment_version",
      "opportunity.assigned_to = queue.actor_user_id",
      "queue.source_activity_id = activity.id",
      "activity.email_connection_id = connection.id",
      "activity.email_message_id = queue.provider_message_id",
      "activity.email_thread_id = queue.source_provider_thread_id",
      "coalesce(activity.subject, '') = queue.source_subject",
      "activity.body_text = queue.source_body_text",
      "private.user_can_send_opportunity_inbox(",
      "private.email_assignment_contact_form_draft_has_reply(",
      "->> 'primary:CUSTOMER'",
    ]) {
      expect(authorization).toContain(guard);
    }
  });

  it("rendezvouses future guarded orphan adoption without replaying history", () => {
    expect(lower).toContain(
      "create or replace function private.queue_email_assignment_contact_form_draft_from_activity"
    );
    expect(lower).toMatch(
      /if tg_op = 'update' then if old\.opportunity_id is not null or new\.opportunity_id is null[\s\S]*?new\.email_connection_id is distinct from old\.email_connection_id[\s\S]*?new\.email_message_id is distinct from old\.email_message_id[\s\S]*?new\.email_thread_id is distinct from old\.email_thread_id[\s\S]*?then return new/
    );
    expect(lower).not.toContain(
      "new.match_needs_review is distinct from old.match_needs_review"
    );
    expect(lower).toContain(
      "or coalesce(new.match_needs_review, false) then return new"
    );
    expect(lower).toContain(
      "create trigger activities_assignment_contact_form_draft_queue after insert or update of opportunity_id on public.activities"
    );
    expect(lower).not.toContain("do $block$");
  });
});

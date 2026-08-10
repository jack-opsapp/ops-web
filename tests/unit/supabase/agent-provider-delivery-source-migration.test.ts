import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260807224500_agent_provider_delivery_sources.sql"
);

describe("agent provider delivery source migration", () => {
  it("keeps exact raw delivery content private and immutable behind service-only RPCs", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();

    expect(sql).toContain(
      "create table private.agent_provider_delivery_sources"
    );
    expect(sql).toContain(
      "unique (company_id, connection_id, provider_message_id)"
    );
    expect(sql).toContain("attachment_enumeration_complete boolean not null");
    expect(sql).toContain("check (attachment_enumeration_complete)");
    expect(sql).toContain("source_sha256 text not null");
    expect(sql).toContain("octet_length(content_value) <= 8388608");
    expect(sql).toContain("octet_length(p_content_value) > 8388608");
    expect(sql).toContain("extensions.digest");
    expect(sql).toContain(
      "agent_provider_delivery_source_idempotency_conflict"
    );
    expect(sql).toContain(
      "revoke all on table private.agent_provider_delivery_sources from public, anon, authenticated, service_role"
    );
    expect(sql).toMatch(
      /revoke all on function public\.capture_agent_provider_delivery_source_as_system\([\s\S]*?from public, anon, authenticated, service_role/
    );
    expect(sql).toMatch(
      /grant execute on function public\.capture_agent_provider_delivery_source_as_system\([\s\S]*?to service_role/
    );
    expect(sql).toMatch(
      /revoke all on function public\.read_agent_provider_delivery_source_as_system\([\s\S]*?from public, anon, authenticated, service_role/
    );
    expect(sql).toMatch(
      /grant execute on function public\.read_agent_provider_delivery_source_as_system\([\s\S]*?to service_role/
    );
  });

  it("resolves complete provider attachment descriptors to canonical durable ids in the capture transaction", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();

    expect(sql).toContain("p_attachment_descriptors jsonb");
    expect(sql).toContain("jsonb_array_length(p_attachment_descriptors) > 100");
    expect(sql).toContain("p_recipient_identities) > 100");
    expect(sql).toContain("p_cc_recipient_identities) > 100");
    expect(sql).toContain("descriptor_message_id");
    expect(sql).toContain("source_url");
    expect(sql).toContain("octet_length(v_source_url) > 8192");
    expect(sql).toContain("insert into public.email_attachments");
    expect(sql).toContain(
      "on conflict (company_id, connection_id, message_id, attachment_id)"
    );
    expect(sql).toContain(
      "agent_provider_delivery_attachment_idempotency_conflict"
    );
    expect(sql).toContain("v_attachment.filename is distinct from v_filename");
    expect(sql).toContain(
      "v_attachment.provider_kind is distinct from v_provider_kind"
    );
    expect(sql).toContain(
      "v_attachment.occurred_at is distinct from v_occurred_at"
    );
    expect(sql).toContain("'email_attachment:' || v_attachment_id::text");
    expect(sql).toContain(
      "^email_attachment:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    );
    expect(sql).not.toContain("p_attachment_evidence_ids text[]");
    expect(sql).toContain('collate "c"');
  });

  it("offers a service-only receipt preflight without exposing raw delivery content", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();
    const preflightStart = sql.indexOf(
      "create or replace function public.preflight_agent_provider_delivery_source_as_system("
    );
    const preflightEnd = sql.indexOf(
      "revoke all on function public.preflight_agent_provider_delivery_source_as_system(",
      preflightStart
    );
    const preflightDefinition = sql.slice(preflightStart, preflightEnd);

    expect(preflightStart).toBeGreaterThan(-1);
    expect(preflightEnd).toBeGreaterThan(preflightStart);
    expect(sql).toMatch(
      /preflight_agent_provider_delivery_source_as_system\([\s\S]*?p_company_id uuid[\s\S]*?p_connection_id uuid[\s\S]*?p_provider_message_id text[\s\S]*?returns table \([\s\S]*?source_id uuid[\s\S]*?source_sha256 text[\s\S]*?company_id uuid[\s\S]*?connection_id uuid[\s\S]*?provider_message_id text/
    );
    expect(sql).toMatch(
      /preflight_agent_provider_delivery_source_as_system\([\s\S]*?auth\.role\(\) is distinct from 'service_role'/
    );
    expect(sql).toMatch(
      /revoke all on function public\.preflight_agent_provider_delivery_source_as_system\([\s\S]*?from public, anon, authenticated, service_role/
    );
    expect(sql).toMatch(
      /grant execute on function public\.preflight_agent_provider_delivery_source_as_system\([\s\S]*?to service_role/
    );
    expect(preflightDefinition).not.toContain("content_value");
    expect(preflightDefinition).not.toContain("sender_identity");
    expect(preflightDefinition).not.toContain("recipient_identities");
    expect(preflightDefinition).toContain(
      "connection.company_id = p_company_id::text"
    );
    expect(preflightDefinition).toContain("connection.provider = p_provider");
  });

  it("binds OPS-rendered outbound capture to one exact provider-accepted intent", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();

    expect(sql).toContain("p_outbound_intent_kind text");
    expect(sql).toContain("p_outbound_intent_id uuid");
    expect(sql).toContain("'email_send_intent'");
    expect(sql).toContain("'approved_action_email_intent'");
    expect(sql).toContain("from public.email_send_intents");
    expect(sql).toContain("from public.approved_action_email_intents");
    expect(sql).toContain("intent.id = p_outbound_intent_id");
    expect(sql).toContain("intent.rendered_body_hash");
    expect(sql).toContain("intent.provider_message_id = p_provider_message_id");
    expect(sql).toContain(
      "intent.accepted_provider_thread_id = p_provider_thread_id"
    );
    expect(sql).toContain("intent.provider_accepted_at = p_delivered_at");
    expect(sql).toContain("p_content_source_kind = 'ops_rendered_outbound'");
    expect(sql).toContain("extensions.digest");
  });

  it("retires the legacy mailbox-agnostic attachment identity before scoped upserts", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();
    const scopedIndex = sql.indexOf(
      "email_attachments_mailbox_identity_unique"
    );
    const legacyConstraintDrop = sql.indexOf(
      "drop constraint if exists email_attachments_company_id_message_id_attachment_id_key"
    );
    const scopedConflict = sql.indexOf(
      "on conflict (company_id, connection_id, message_id, attachment_id)"
    );

    expect(scopedIndex).toBeGreaterThan(-1);
    expect(legacyConstraintDrop).toBeGreaterThan(scopedIndex);
    expect(scopedConflict).toBeGreaterThan(legacyConstraintDrop);
    expect(sql).toContain(
      "drop constraint if exists attachment_inspections_company_id_message_id_attachment_id_key"
    );
    expect(sql).toContain("attachment_inspections_attachment_unique");
    expect(sql).toContain("attachment_inspections_mailbox_identity_unique");
  });

  it("replaces and verifies the legacy partial inspection mailbox index", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();
    const preflightAt = sql.indexOf("do $attachment_identity_preflight$");
    const ownershipCheckAt = sql.indexOf(
      "agent_provider_delivery_source_prerequisite_invalid: attachment_inspections_mailbox_identity_unique"
    );
    const dropAt = sql.indexOf(
      "drop index if exists public.attachment_inspections_mailbox_identity_unique"
    );
    const createAt = sql.indexOf(
      "create unique index attachment_inspections_mailbox_identity_unique"
    );
    const exactDefinitionCheckAt = sql.indexOf(
      "agent_provider_delivery_source_prerequisite_invalid: exact attachment_inspections_mailbox_identity_unique"
    );

    expect(preflightAt).toBeGreaterThan(-1);
    expect(ownershipCheckAt).toBeGreaterThan(preflightAt);
    expect(dropAt).toBeGreaterThan(ownershipCheckAt);
    expect(createAt).toBeGreaterThan(dropAt);
    expect(exactDefinitionCheckAt).toBeGreaterThan(createAt);
    expect(sql.slice(createAt, exactDefinitionCheckAt)).not.toContain(
      "where connection_id is not null"
    );
    expect(sql).toContain("index_definition.indpred is null");
    expect(sql).toContain("index_definition.indexprs is null");
  });

  it("pins every inspection to the exact canonical attachment identity", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();
    const normalizedSql = sql
      .replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");
    const preflightAt = normalizedSql.indexOf(
      "do $attachment_identity_preflight$"
    );
    const exactRowCheckAt = normalizedSql.indexOf(
      "agent_provider_delivery_source_prerequisite_missing: attachment_inspections exact attachment identity"
    );
    const notNullAt = normalizedSql.indexOf(
      "alter column connection_id set not null",
      preflightAt
    );
    const referenceIdentityAt = normalizedSql.indexOf(
      "unique (company_id, connection_id, message_id, attachment_id, id)"
    );
    const exactForeignKeyAt = normalizedSql.indexOf(
      "foreign key (company_id, connection_id, message_id, attachment_id, email_attachment_id)"
    );

    expect(exactRowCheckAt).toBeGreaterThan(preflightAt);
    expect(notNullAt).toBeGreaterThan(exactRowCheckAt);
    expect(normalizedSql).toContain(
      "alter column email_attachment_id set not null"
    );
    expect(referenceIdentityAt).toBeGreaterThan(notNullAt);
    expect(exactForeignKeyAt).toBeGreaterThan(referenceIdentityAt);
    expect(normalizedSql).toContain(
      "references public.email_attachments (company_id, connection_id, message_id, attachment_id, id)"
    );
  });

  it("stores accepted-outbound authority in one private append-only tenant-bound attestation", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();
    const compact = sql
      .replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");
    const sourceTableStart = sql.indexOf(
      "create table private.agent_provider_delivery_sources"
    );
    const sourceTableEnd = sql.indexOf(
      "comment on table private.agent_provider_delivery_sources",
      sourceTableStart
    );
    const sourceTable = sql.slice(sourceTableStart, sourceTableEnd);

    expect(sql).toContain(
      "create table private.agent_provider_outbound_authority_attestations"
    );
    expect(sql).toContain("primary key (company_id, provider_source_id)");
    expect(sql).toContain("accepted_intent_id uuid generated always as");
    expect(sql).toContain(
      "unique (company_id, accepted_intent_kind, accepted_intent_id)"
    );
    expect(compact).toContain(
      "foreign key (company_id, provider_source_id, source_sha256)"
    );
    expect(compact).toContain(
      "references private.agent_provider_delivery_sources(company_id, id, source_sha256)"
    );
    expect(sql).toContain("foreign key (company_id, email_send_intent_id)");
    expect(sql).toContain(
      "references public.email_send_intents(company_id, id)"
    );
    expect(sql).toContain(
      "foreign key (company_id, approved_action_email_intent_id)"
    );
    expect(sql).toContain(
      "references public.approved_action_email_intents(company_id, id)"
    );
    expect(sql).toContain("foreign key (company_id, actor_user_id)");
    expect(sql).toContain("foreign key (company_id, opportunity_id)");
    expect(sql).toContain("foreign key (company_id, project_id)");
    expect(compact).toContain(
      "revoke all on table private.agent_provider_outbound_authority_attestations from public, anon, authenticated, service_role"
    );
    expect(sql).toContain(
      "create trigger agent_provider_outbound_authority_immutable"
    );
    expect(sql).toMatch(
      /create trigger agent_provider_outbound_authority_immutable[\s\S]*?execute function private\.reject_agent_job_memory_mutation\(\)/
    );
    expect(sourceTable).not.toContain("outbound_intent_kind");
    expect(sourceTable).not.toContain("outbound_actor_user_id");
    expect(sourceTable).not.toContain("outbound_opportunity_id");
    expect(sourceTable).not.toContain("outbound_project_id");
  });

  it("preserves provider evidence across mailbox disconnect and erases it through the audited tenant root", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();
    const compact = sql
      .replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");

    expect(sql).toContain(
      "create table public.agent_control_plane_tenant_roots"
    );
    expect(compact).toContain(
      "company_id uuid not null references public.agent_control_plane_tenant_roots(company_id) on delete cascade"
    );
    expect(compact).not.toContain(
      "connection_id uuid not null references public.email_connections(id)"
    );
    expect(compact).toContain(
      "references public.email_send_intents(company_id, id) on delete restrict"
    );
    expect(compact).toContain(
      "references public.approved_action_email_intents(company_id, id) on delete restrict"
    );
    expect(sql).toContain(
      "insert into public.agent_control_plane_tenant_roots"
    );
    expect(sql).toContain(
      "create trigger agent_control_plane_tenant_root_immutable"
    );
  });

  it("keeps the first immutable exact content while attesting either accepted-outbound race order", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();
    const captureStart = sql.indexOf(
      "create or replace function public.capture_agent_provider_delivery_source_as_system("
    );
    const captureEnd = sql.indexOf(
      "revoke all on function public.capture_agent_provider_delivery_source_as_system(",
      captureStart
    );
    const capture = sql.slice(captureStart, captureEnd);
    const compactCapture = capture.replace(/\s+/g, " ");
    const envelopeStart = capture.indexOf("v_source_envelope :=");
    const envelopeEnd = capture.indexOf("v_source_sha256 :=", envelopeStart);
    const sourceEnvelope = capture.slice(envelopeStart, envelopeEnd);

    expect(capture).toContain(
      "v_existing_source.content_source_kind = p_content_source_kind"
    );
    expect(capture).toMatch(
      /v_existing_source\.content_source_kind = 'ops_rendered_outbound'[\s\S]*?p_content_source_kind in \([\s\S]*?'gmail_mime_part'[\s\S]*?'microsoft_graph_body'[\s\S]*?\)/
    );
    expect(capture).toMatch(
      /p_content_source_kind = 'ops_rendered_outbound'[\s\S]*?v_existing_source\.content_source_kind in \([\s\S]*?'gmail_mime_part'[\s\S]*?'microsoft_graph_body'[\s\S]*?\)/
    );
    expect(compactCapture).toContain(
      "v_existing_source.provider_thread_id is distinct from p_provider_thread_id"
    );
    expect(compactCapture).toContain(
      "v_existing_source.direction is distinct from p_direction"
    );
    expect(capture).toContain(
      "insert into private.agent_provider_outbound_authority_attestations"
    );
    expect(capture).toContain(
      "on conflict (company_id, provider_source_id) do nothing"
    );
    expect(capture).toContain(
      "agent_provider_outbound_authority_idempotency_conflict"
    );
    for (const field of [
      "source_sha256",
      "accepted_intent_kind",
      "accepted_intent_id",
      "actor_user_id",
      "opportunity_id",
      "project_id",
    ]) {
      expect(capture).toContain(`v_existing_authority.${field}`);
    }
    expect(sourceEnvelope).not.toContain("outbound_intent_kind");
    expect(sourceEnvelope).not.toContain("outbound_actor_user_id");
    expect(sourceEnvelope).not.toContain("outbound_opportunity_id");
    expect(sourceEnvelope).not.toContain("outbound_project_id");
  });

  it("auto-attests exactly one accepted intent before provider-native mutable ingest", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();
    const captureStart = sql.indexOf(
      "create or replace function public.capture_agent_provider_delivery_source_as_system("
    );
    const captureEnd = sql.indexOf(
      "revoke all on function public.capture_agent_provider_delivery_source_as_system(",
      captureStart
    );
    const capture = sql.slice(captureStart, captureEnd);
    const deliveryLockAt = capture.indexOf(
      "agent-provider-delivery-source:v1:"
    );
    const explicitIntentValidationAt = capture.indexOf(
      "if p_content_source_kind = 'ops_rendered_outbound' then"
    );
    const autoResolveAt = capture.indexOf(
      "select array(\n      select intent.id\n      from public.email_send_intents"
    );
    const sourceInsertAt = capture.indexOf(
      "insert into private.agent_provider_delivery_sources"
    );

    expect(deliveryLockAt).toBeGreaterThan(-1);
    expect(explicitIntentValidationAt).toBeGreaterThan(deliveryLockAt);
    expect(autoResolveAt).toBeGreaterThan(deliveryLockAt);
    expect(sourceInsertAt).toBeGreaterThan(autoResolveAt);
    expect(capture).toContain("v_email_send_candidate_ids");
    expect(capture).toContain("v_approved_action_candidate_ids");
    expect(capture).toContain("for share");
    expect(capture).toContain(
      "agent_provider_delivery_outbound_intent_ambiguous"
    );
    expect(capture).toContain("private.agent_provider_canonical_identities(");
    expect(capture).toContain("v_outbound_intent_kind := 'email_send_intent'");
    expect(capture).toContain(
      "v_outbound_intent_kind := 'approved_action_email_intent'"
    );
    expect(capture).toContain("if v_outbound_intent_kind is not null then");
  });

  it("binds every immutable source field and rejects non-accepted outbound projections", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();

    for (const field of [
      "provider_thread_id",
      "direction",
      "delivered_at",
      "subject",
      "sender_identity",
      "recipient_identities",
      "cc_recipient_identities",
      "content_media_type",
      "content_value",
      "content_charset",
      "content_source_kind",
      "content_selection_revision",
      "provider_part_id",
      "provider_body_attachment_id",
      "attachment_evidence_ids",
    ]) {
      expect(sql).toContain(field);
    }
    expect(sql).toContain("ops_rendered_outbound");
    expect(sql).toContain("gmail.mime.text-plain-first.charset-decoded.v2");
    expect(sql).toContain("p_content_charset is null");
    expect(sql).toContain("p_content_charset is not null");
    expect(sql).toContain("p_direction <> 'outbound'");
    expect(sql).toContain("auth.role() is distinct from 'service_role'");
    expect(sql).toContain(
      "private.agent_prompt_text_is_safe(sender_identity, false)"
    );
    expect(sql).toContain("private.agent_prompt_text_is_safe(p_value, false)");
  });

  it("returns a turn-ready projection only through an exact activity and correspondence relationship", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();
    const compact = sql.replace(/\s+/g, " ");

    expect(sql).toContain("p_source_activity_id uuid");
    expect(sql).toContain("source_activity_id uuid");
    expect(sql).toContain("activity_opportunity_id uuid");
    expect(sql).toContain("activity_project_id text");
    expect(sql).toContain("actor_user_id uuid");
    expect(sql).toContain("source_correspondence_event jsonb");
    expect(sql).toContain("confirmed_customer_participants jsonb");
    expect(sql).toContain("join public.activities activity");
    expect(sql).toContain(
      "activity.email_connection_id = source.connection_id"
    );
    expect(sql).toContain(
      "activity.email_message_id = source.provider_message_id"
    );
    expect(sql).toContain("event.activity_id = activity.id");
    expect(sql).toContain("event.connection_id = source.connection_id");
    expect(sql).toContain(
      "event.provider_message_id = source.provider_message_id"
    );
    expect(sql).toContain("activity.id = p_source_activity_id");
    expect(sql).toContain(
      "create trigger agent_provider_delivery_sources_immutable"
    );
    expect(sql).toContain(
      "execute function private.reject_agent_job_memory_mutation()"
    );
    expect(sql).toContain("then authority.actor_user_id");
    expect(sql).not.toContain("activity.created_by = authority.actor_user_id");
    expect(compact).toContain(
      "activity.opportunity_id is not distinct from authority.opportunity_id"
    );
    expect(compact).toContain(
      "activity.project_id is not distinct from authority.project_id::text"
    );
    expect(sql).not.toContain("source.outbound_actor_user_id");
  });

  it("allows a project-only activity without inventing a correspondence event", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();

    expect(sql).toContain(
      "left join public.opportunity_correspondence_events event"
    );
    expect(sql).toMatch(
      /activity\.opportunity_id is not null[\s\S]*?event\.id is not null/
    );
    expect(sql).toMatch(
      /activity\.opportunity_id is null[\s\S]*?activity\.project_id is not null/
    );
    expect(sql).toMatch(
      /activity\.opportunity_id is null[\s\S]*?source\.direction = 'outbound'[\s\S]*?authority\.provider_source_id is not null/
    );
    expect(sql).toMatch(
      /activity\.opportunity_id is not null[\s\S]*?event\.id is not null[\s\S]*?or[\s\S]*?activity\.opportunity_id is null/
    );
    expect(sql).not.toMatch(
      /activity\.opportunity_id is null[\s\S]*?source\.content_source_kind = 'ops_rendered_outbound'/
    );
    expect(sql).toMatch(
      /case[\s\S]*?when event\.id is null then null[\s\S]*?jsonb_build_object/
    );
  });

  it("fails closed on an unattested accepted intent while retaining manual provider-native ops mail", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();
    const readStart = sql.indexOf(
      "create or replace function public.read_agent_provider_delivery_source_as_system("
    );
    const readEnd = sql.indexOf(
      "revoke all on function public.read_agent_provider_delivery_source_as_system(",
      readStart
    );
    const read = sql.slice(readStart, readEnd);

    expect(read).toContain("authority.provider_source_id is null");
    expect(read).toContain(
      "source.content_source_kind <> 'ops_rendered_outbound'"
    );
    expect(read).toContain(
      "and not exists (\n          select 1\n          from public.email_send_intents accepted_intent"
    );
    expect(read).toContain(
      "from public.approved_action_email_intents accepted_intent"
    );
    expect(read).toMatch(
      /activity\.opportunity_id is not null[\s\S]*?event\.id is not null/
    );
    expect(read).toMatch(
      /when authority\.provider_source_id is not null[\s\S]*?then authority\.actor_user_id[\s\S]*?else null/
    );
  });

  it("does not synthesize a confirmed participant from thread confidence alone", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();

    expect(sql).toContain(
      "event.linked_contact_kind in ('client', 'sub_client')"
    );
    expect(sql).toContain("event.linked_contact_id is not null");
    expect(sql).toContain(
      "event.linked_contact_kind <> 'high_confidence_related_contact'"
    );
    expect(sql).not.toMatch(
      /'high_confidence_related_contact'[\s\S]{0,300}'related_contact'/
    );
  });
});

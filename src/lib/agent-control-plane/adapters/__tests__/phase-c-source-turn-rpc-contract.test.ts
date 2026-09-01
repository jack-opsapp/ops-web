import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260814190000_agent_phase_c_source_turn_read.sql"
  ),
  "utf8"
).toLowerCase();

describe("Phase C source-turn RPC contract", () => {
  it("exposes a separate fixed service-only final routed-actor fence", () => {
    expect(migration).toContain(
      "create or replace function public.read_phase_c_routed_actor_fence_as_system("
    );
    expect(migration).toMatch(
      /revoke all on function public\.read_phase_c_routed_actor_fence_as_system\([\s\S]*?\) from public, anon, authenticated, service_role;/
    );
    expect(migration).toMatch(
      /grant execute on function public\.read_phase_c_routed_actor_fence_as_system\([\s\S]*?\) to service_role;/
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.read_phase_c_routed_actor_fence_as_system[\s\S]*?to (anon|authenticated)/
    );
  });

  it("revalidates the routed actor, assignment, thread, mailbox, and provider in one statement", () => {
    const normalized = migration.replace(/\s+/g, " ");
    for (const fragment of [
      "actor.id = p_actor_user_id",
      "actor.company_id = p_company_id",
      "actor.deleted_at is null",
      "coalesce(actor.is_active, false)",
      "opportunity.id = p_opportunity_id",
      "opportunity.company_id = p_company_id",
      "opportunity.assigned_to = p_actor_user_id",
      "opportunity.assignment_version = p_assignment_version",
      "opportunity.deleted_at is null",
      "thread.id = p_internal_thread_id",
      "thread.company_id = p_company_id",
      "thread.connection_id = p_connection_id",
      "thread.provider_thread_id = p_provider_thread_id",
      "thread.opportunity_id = p_opportunity_id",
      "connection.id = p_connection_id",
      "connection.company_id = p_company_id::text",
      "connection.provider = p_connection_provider",
      "connection.status = 'active'",
      "connection.sync_enabled is not false",
      "connection.type = 'company'",
      "connection.type = 'individual'",
      "btrim(connection.user_id) = p_actor_user_id::text",
    ]) {
      expect(normalized).toContain(fragment);
    }
    expect(normalized).toMatch(
      /btrim\(connection\.user_id\) ~ '\^\[0-9a-f\]\{8\}.*\[1-5\].*\[89ab\].*\$'/
    );
  });

  it("exposes one fixed service-only source lookup", () => {
    expect(migration).toContain(
      "create or replace function public.read_phase_c_source_turn_as_system("
    );
    expect(migration).toContain("auth.role() = 'service_role'");
    expect(migration).toContain(
      "grant execute on function public.read_phase_c_source_turn_as_system"
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.read_phase_c_source_turn_as_system[\s\S]*to (anon|authenticated)/
    );
    expect(migration).toMatch(/to service_role;[\s\S]*commit;/);
  });

  it("makes one activity resolve to at most one immutable turn", () => {
    expect(migration).toMatch(
      /create unique index[\s\S]*job_conversation_turns_company_source_activity_uidx[\s\S]*\(company_id, source_activity_id\)[\s\S]*where source_activity_id is not null/
    );
    expect(migration).not.toMatch(/\blimit\s+1\b/);
  });

  it("binds company, opportunity, connection, provider thread, provider message, and direction", () => {
    for (const fragment of [
      "turn.company_id = p_company_id",
      "anchor.opportunity_id = p_opportunity_id",
      "opportunity.assigned_to = p_actor_user_id",
      "opportunity.assignment_version = p_assignment_version",
      "turn.source_connection_id = p_connection_id",
      "thread.id = p_internal_thread_id",
      "thread.connection_id = p_connection_id",
      "thread.opportunity_id = p_opportunity_id",
      "activity.email_connection_id = p_connection_id",
      "activity.email_thread_id = p_provider_thread_id",
      "turn.provider_message_id = activity.email_message_id",
      "activity.direction = 'inbound'",
      "turn.direction = 'inbound'",
      "turn.channel = 'email'",
    ]) {
      expect(migration).toContain(fragment);
    }
    expect(migration).toContain("activity.id = p_source_activity_id");
    expect(migration).toContain("activity.opportunity_id = p_opportunity_id");
    expect(migration).toContain("opportunity.deleted_at is null");
    expect(migration).toContain("p_actor_user_id is not null");
    expect(migration).toContain("p_assignment_version is not null");
    expect(migration).toContain("p_assignment_version >= 0");
  });

  it("binds the Phase C route into the current v6 context read in one statement", () => {
    const normalized = migration.replace(/\s+/g, " ");
    const functionName =
      "read_agent_phase_c_job_conversation_context_as_system";

    expect(normalized).toContain(
      `create or replace function public.${functionName}(`
    );
    expect(normalized).toContain(
      `grant execute on function public.${functionName}`
    );
    expect(normalized).toMatch(
      new RegExp(
        `revoke all on function public\\.${functionName}\\([\\s\\S]*?\\) from public, anon, authenticated, service_role;`
      )
    );
    expect(normalized).not.toMatch(
      new RegExp(
        `grant execute on function public\\.${functionName}[\\s\\S]*?to (anon|authenticated)`
      )
    );
    expect(normalized).toContain("returns jsonb");
    expect(normalized).toContain("source_proof as materialized (");
    expect(normalized).toContain("context_snapshot as materialized (");
    expect(normalized).toContain(
      "public.read_phase_c_source_turn_as_system( p_company_id, p_job_id, p_actor_user_id, p_phase_c_assignment_version, p_phase_c_connection_id, p_phase_c_internal_thread_id, p_phase_c_provider_thread_id, p_phase_c_source_activity_id )"
    );
    expect(normalized).toContain("source.turn_id = p_phase_c_source_turn_id");
    expect(normalized).toContain(
      "source.conversation_id = p_phase_c_source_conversation_id"
    );
    expect(normalized).toContain(
      "public.read_agent_job_conversation_context_as_system("
    );
    expect(normalized).toContain(
      "p_capability_manifest_revision is distinct from '2026-08-14.capability-manifest.v6'"
    );
    expect(normalized).toContain(
      "p_capability_id is distinct from 'get_job_conversation_context'"
    );
    expect(normalized).toContain(
      "p_capability_revision is distinct from 'get_job_conversation_context:2026-08-07.v1'"
    );
    expect(normalized).toContain("p_job_kind is distinct from 'opportunity'");
    expect(normalized).toContain(
      "p_required_through_turn_id is distinct from p_phase_c_source_turn_id"
    );
    expect(normalized).toContain(
      "context.snapshot -> 'requested_job' = jsonb_build_object( 'kind', 'opportunity', 'id', p_job_id )"
    );
    expect(normalized).toContain(
      "context.snapshot -> 'required_through' ->> 'turn_id' = source.turn_id::text"
    );
    expect(normalized).not.toContain(
      "read_phase_c_actor_scoped_job_memory_generation_snapshot_as_system"
    );
    expect(normalized).not.toContain(
      "read_actor_scoped_job_memory_generation_snapshot_as_system"
    );
    expect(normalized).not.toContain(
      "public.read_job_conversation_context_as_system("
    );
  });

  it("requires the exact current v6 context RPC and no retired readers", () => {
    const normalized = migration.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "to_regprocedure( 'public.read_agent_job_conversation_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)' )"
    );
    expect(normalized).not.toContain(
      "to_regprocedure( 'public.read_job_conversation_context_as_system("
    );
    expect(normalized).not.toContain(
      "to_regprocedure( 'public.read_actor_scoped_job_memory_generation_snapshot_as_system("
    );
  });

  it("requires the current owner for an individual mailbox while preserving company-owned routing", () => {
    const normalized = migration.replace(/\s+/g, " ");

    expect(normalized).toContain("connection.type = 'company'");
    expect(normalized).toContain("connection.type = 'individual'");
    expect(normalized).toContain(
      "connection.type = 'individual' and btrim(connection.user_id) = p_actor_user_id::text"
    );
  });

  it("joins the turn to the exact immutable provider source id and digest", () => {
    for (const fragment of [
      "private.agent_provider_delivery_sources provider_source",
      "provider_source.id = turn.provider_delivery_source_id",
      "provider_source.source_sha256 = turn.provider_delivery_source_sha256",
      "public.opportunity_correspondence_events event",
      "event.id = turn.source_correspondence_event_id",
      "event.activity_id = activity.id",
      "event.opportunity_id = activity.opportunity_id",
      "event.provider_message_id = turn.provider_message_id",
    ]) {
      expect(migration).toContain(fragment);
    }
    expect(migration).not.toContain(
      "private.agent_provider_delivery_turn_sources"
    );
    expect(migration).not.toContain("provider_source.bcc_recipient_identities");
  });

  it("binds the full immutable delivery envelope to the activity and routed mailbox", () => {
    for (const fragment of [
      "provider_source.company_id = p_company_id",
      "provider_source.connection_id = p_connection_id",
      "provider_source.provider = connection.provider",
      "provider_source.provider_thread_id = p_provider_thread_id",
      "provider_source.provider_message_id = activity.email_message_id",
      "provider_source.direction = 'inbound'",
      "provider_source.delivered_at = turn.delivered_at",
      "provider_source.sender_identity = case",
      "private.normalize_phase_c_email_header_address(activity.from_email)",
      "provider_source.recipient_identities = array(",
      "from unnest( case",
      "provider_source.cc_recipient_identities = array(",
      "cardinality(coalesce(activity.to_emails, '{}'::text[])) <= 100",
      "cardinality(coalesce(activity.cc_emails, '{}'::text[])) <= 100",
      "octet_length(recipient.raw_email) <= 512",
      "octet_length(connection.email) <= 512",
    ]) {
      expect(migration.replace(/\s+/g, " ")).toContain(
        fragment.replace(/\s+/g, " ")
      );
    }
  });

  it("fails closed when any activity recipient cannot be canonically bound", () => {
    expect(migration).toMatch(
      /not exists \([\s\S]*?unnest\([\s\S]*?activity\.to_emails[\s\S]*?normalize_phase_c_email_header_address\(recipient\.raw_email\)[\s\S]*?end is null/
    );
    expect(migration).toMatch(
      /not exists \([\s\S]*?unnest\([\s\S]*?activity\.cc_emails[\s\S]*?normalize_phase_c_email_header_address\(recipient\.raw_email\)[\s\S]*?end is null/
    );
  });

  it("rejects blank, padded, oversized, or control-character provider thread identifiers", () => {
    expect(migration).toContain(
      "p_provider_thread_id = btrim(p_provider_thread_id)"
    );
    expect(migration).toContain("octet_length(p_provider_thread_id) <= 512");
    expect(migration).toContain("p_provider_thread_id !~ '[[:cntrl:]]'");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260901122000_agent_promise_recovery_read.sql"
);

function sql() {
  return readFileSync(migrationPath, "utf8");
}

function compact(value: string) {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-CA");
}

describe("promise-recovery SQL contract", () => {
  it("repairs the historical manifest bridge for a complete known predecessor lineage", () => {
    const source = compact(sql());
    expect(source).toContain(
      "create or replace function private.reprove_agent_read_jsonb_for_manifest"
    );
    expect(source).toContain("2026-08-11.capability-manifest.v3");
    expect(source).toContain("2026-08-22.capability-manifest.v8");
    expect(source).toContain("v_immediate_source_manifest_revision");
    expect(source).toContain("invalid_agent_manifest_reproof_source");
  });

  it("overlays correspondence evidence with the current provider projection and stable attachment fallback", () => {
    const source = compact(sql());
    expect(source).toContain(
      "private.read_agent_correspondence_evidence_page_as_system_v6_core"
    );
    expect(source).toContain("private.agent_provider_delivery_sources");
    expect(source).toContain("provider_source.normalized_plain_text");
    expect(source).toContain("provider_source.normalized_subject");
    expect(source).toContain("provider_source.attachment_evidence_ids");
    expect(source).toContain("provider_source.source_sha256");
    expect(source).toContain(
      "nullif(btrim(provider_source.normalized_plain_text), '') is null"
    );
    expect(source).toContain("metadata_state");
    expect(source).toContain("incomplete");
  });

  it("overlays conversation context recent turns and active evidence from the hash-bound provider projection", () => {
    const source = compact(sql());
    expect(source).toContain(
      "private.read_agent_job_conversation_context_v3_impl"
    );
    expect(source).toContain("v_recent_candidate");
    expect(source).toContain("v_evidence_candidate");
    expect(source).toContain("context_provider_source.normalized_plain_text");
    expect(source).toContain("context_provider_source.normalized_subject");
    expect(source).toContain("context_provider_source.attachment_evidence_ids");
    expect(source).toContain("context_provider_source.source_sha256");
    expect(source).toContain(
      "nullif(btrim(p_normalized_plain_text), '') is null"
    );
    expect(source).toContain("agent_job_context_provider_source_data_invalid");
  });

  it("preflights every table and authority function the read depends on", () => {
    const source = compact(sql());
    for (const dependency of [
      "public.clients",
      "public.activities",
      "public.email_connections",
      "public.sub_clients",
      "public.email_threads",
      "public.job_conversation_turns",
      "private.agent_provider_delivery_sources",
      "private.mcp_oauth_clients",
      "private.mcp_oauth_grants",
      "private.resolve_agent_actor_authority(uuid,uuid,text[])",
    ]) {
      expect(source).toContain(dependency);
    }
  });

  it("rechecks current tenant, grant, scope, and permission authority inside the database", () => {
    const source = compact(sql());
    expect(source).toContain("auth.role() is distinct from 'service_role'");
    expect(source).toContain("2026-09-01.capability-manifest.v12");
    expect(source).toContain("2026-09-01.mcp-exposure.v6");
    expect(source).toContain("check_customer_reply:2026-08-31.v1");
    expect(source).toContain("'ops.correspondence.read'");
    expect(source).toContain("'ops.customer_contacts.read'");
    expect(source).toContain("'ops.customers.read'");
    expect(source).toContain("'clients.view'");
    expect(source).toContain("'email.view'");
    expect(source).toContain("grant_record.company_id = p_company_id");
    expect(source).toContain("grant_record.user_id = p_actor_user_id");
    expect(source).toContain("grant_record.revoked_at is null");
    expect(source).toContain("v_required_scopes <@ grant_record.scopes");
    expect(source).not.toContain(
      "p_granted_scope_ceiling is distinct from v_required_scopes"
    );
  });

  it("uses the current provider source projection and never the copied turn body or raw HTML", () => {
    const source = compact(sql());
    const promiseRead = source.slice(
      source.indexOf(
        "create or replace function public.read_agent_promise_recovery_as_system"
      )
    );
    expect(source).toContain("source.normalized_plain_text");
    expect(source).toContain("source.normalization_status");
    expect(source).toContain("source.normalization_revision");
    expect(promiseRead).not.toContain("turn.normalized_plain_text");
    expect(promiseRead).not.toContain("source.content_value");
    expect(promiseRead).not.toContain("raw_html");
  });

  it("requires direction-aware exact customer attribution and records thread-only gaps", () => {
    const source = compact(sql());
    expect(source).toMatch(
      /source\.direction = 'inbound'.*lower\(btrim\(source\.sender_identity\)\) = any \(identity\.emails\)/u
    );
    expect(source).toMatch(
      /source\.direction = 'outbound'.*lower\(btrim\(recipient_identity\)\) = any \(identity\.emails\)/u
    );
    expect(source).toContain(
      "coalesce(source.recipient_identities, array[]::text[])"
    );
    expect(source).toContain(
      "coalesce(source.cc_recipient_identities, array[]::text[])"
    );
    expect(source).toContain("participant_attribution");
    expect(source).toContain("'thread_only'");
    expect(source).toContain("thread.client_id = v_client_id");
  });

  it("binds outbound authorship to the current operator or marks it unresolved", () => {
    const source = compact(sql());
    expect(source).toContain("operator_attribution");
    expect(source).toContain("activity.created_by = p_actor_user_id");
    expect(source).toContain("connection.type::text = 'individual'");
    expect(source).toContain("connection.user_id = p_actor_user_id::text");
    expect(source).toContain("'unresolved'");
  });

  it("returns exact source, turn-hash, attachment, body-state, and chronology fields within hard bounds", () => {
    const source = compact(sql());
    expect(source).toContain("source.source_sha256");
    expect(source).toContain(
      "turn.provider_delivery_source_sha256 = source.source_sha256"
    );
    expect(source).toContain("source.attachment_enumeration_complete");
    expect(source).toContain("source.attachment_evidence_ids");
    expect(source).toContain(
      "char_length(source.normalized_plain_text) <= 100000"
    );
    expect(source).toContain("2000000");
    expect(source).toContain("body_payload_characters");
    expect(source).toContain("attachment_payload_count");
    expect(source).toContain(
      "order by source.delivered_at desc, source.id desc"
    );
    expect(source).toContain("'payload_bound'");
    expect(source).toContain("least(stats.population_count, 501)");
    expect(source).toContain("limit 500");
    expect(source).toContain("order by source.delivered_at, source.id");
  });

  it("exposes one stable service-role-only read and contains no data mutation", () => {
    const source = compact(sql());
    expect(source).toContain(
      "create or replace function public.read_agent_promise_recovery_as_system"
    );
    expect(source).toContain("language plpgsql stable security definer");
    expect(source).toContain(
      "revoke all on function public.read_agent_promise_recovery_as_system"
    );
    expect(source).toContain(
      "grant execute on function public.read_agent_promise_recovery_as_system"
    );
    expect(source).not.toMatch(/\b(insert|update|delete|merge|truncate)\b/u);
    expect(source).not.toContain("create table");
    expect(source).not.toContain("alter table");
  });
});

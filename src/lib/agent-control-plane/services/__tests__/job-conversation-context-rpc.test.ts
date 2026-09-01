import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_SUFFIX = "_agent_job_conversation_context_read.sql";

function sql(): string {
  const directory = join(process.cwd(), "supabase/migrations");
  const matches = readdirSync(directory)
    .filter((file) => file.endsWith(MIGRATION_SUFFIX))
    .sort();
  expect(matches).toHaveLength(1);
  return readFileSync(join(directory, matches[0]!), "utf8").toLowerCase();
}

function compactSql(): string {
  return sql().replace(/\s+/g, " ");
}

function activeWrapperSql(): string {
  return readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260812120000_agent_operational_schedule_readiness.sql"
    ),
    "utf8"
  )
    .toLowerCase()
    .replace(/\s+/g, " ");
}

describe("agent job conversation context read migration", () => {
  it("is one transactional, service-role-only fixed RPC", () => {
    const source = sql();
    const compact = compactSql();
    expect(source).toMatch(/(?:^|\n)begin;\s/);
    expect(source.trim().endsWith("commit;")).toBe(true);
    expect(compact).toContain(
      "create or replace function public.read_agent_job_conversation_context_as_system("
    );
    expect(compact).toContain(
      "language plpgsql stable security definer set search_path = pg_catalog, public, private, extensions, pg_temp"
    );
    expect(compact).toContain("auth.role()");
    expect(compact).toContain("'service_role'");
    expect(compact).toMatch(
      /revoke all on function public\.read_agent_job_conversation_context_as_system\([\s\S]*?from public, anon, authenticated, service_role/
    );
    expect(compact).toMatch(
      /grant execute on function public\.read_agent_job_conversation_context_as_system\([\s\S]*?to service_role/
    );
  });

  it("pins the current v4 wrapper while retaining every manifest-owned proof in the private implementation", () => {
    const compact = compactSql();
    const wrapper = activeWrapperSql();
    expect(compact).toContain(
      "p_capability_id is distinct from 'get_job_conversation_context'"
    );
    expect(compact).toContain("'get_job_conversation_context:2026-08-07.v1'");
    expect(compact).toContain("'2026-08-11.capability-manifest.v3'");
    expect(wrapper).toContain("'2026-08-12.capability-manifest.v4'");
    expect(wrapper).toContain(
      "private.read_agent_job_conversation_context_v3_impl("
    );
    for (const scope of [
      "ops.correspondence.read",
      "ops.customer_contacts.read",
      "ops.customers.read",
      "ops.jobs.read",
    ]) {
      expect(compact).toContain(`'${scope}'`);
    }
    expect(compact).toContain("p_inbox_scope is distinct from 'all'");
    expect(compact).toContain("p_clients_scope is distinct from 'all'");
    expect(compact).toContain("p_job_scope not in ('all', 'assigned')");
    expect(compact).toContain(
      "private.resolve_agent_actor_authority( p_actor_user_id, p_company_id, p_registered_permission_keys )"
    );
    expect(compact).toContain(
      "'clients.view' = any(p_registered_permission_keys)"
    );
    expect(compact).toContain(
      "p_job_permission = any(p_registered_permission_keys)"
    );
  });

  it("re-resolves current actor, requested job, client, and every source connection in the data statement", () => {
    const compact = compactSql();
    expect(compact).toContain("with current_authority as materialized");
    expect(compact).toContain("requested_anchor as materialized");
    expect(compact).toContain(
      "private.resolve_agent_actor_authority( p_actor_user_id, p_company_id"
    );
    expect(compact).toContain(
      "authority.permission_snapshot_revision = p_permission_snapshot_revision"
    );
    expect(compact).toMatch(
      /private\.agent_user_can_access_entity\( p_actor_user_id, p_company_id, p_job_kind, p_job_id, 'view' \)/
    );
    expect(compact).toMatch(
      /private\.agent_user_can_access_entity\( p_actor_user_id, p_company_id, 'client', client\.id, 'view' \)/
    );
    expect(compact).toContain(
      "private.user_can_view_inbox_connection( p_actor_user_id, p_company_id, turn.source_connection_id"
    );
    expect(compact).toContain("anchor.source_id = p_job_id");
    expect(compact).toContain("anchor.anchor_kind = p_job_kind");
  });

  it("returns the latest N exact turns in chronology, independent of the memory watermark", () => {
    const compact = compactSql();
    expect(compact).toContain("order by turn.turn_sequence desc");
    expect(compact).toContain("limit p_exact_turn_limit");
    expect(compact).toContain("'recent_turns' = any(p_sections)");
    expect(compact).toContain("recent_payload_octets <= 50000");
    expect(compact).toContain("'recent_turns_omitted_count'");
    expect(compact).toContain("order by recent.turn_sequence");
    expect(compact).not.toMatch(
      /recent_id as materialized \([\s\S]*?turn_high_watermark_sequence[\s\S]*?\), required_turn/
    );
    for (const field of [
      "participant_resolution_revision",
      "source_connection_id",
      "provider_message_id",
      "provider_delivery_source_id",
      "provider_delivery_source_sha256",
      "source_activity_id",
      "source_correspondence_event_id",
      "recipient_identities",
      "cc_recipient_identities",
      "normalized_plain_text",
      "original_content_hash",
      "attachment_evidence_ids",
      "evidence_source_revision",
      "evidence_content_hash",
    ]) {
      expect(compact).toContain(`'${field}'`);
    }
  });

  it("applies current redactions before turns, trigger evidence, or participants can leave SQL", () => {
    const compact = compactSql();
    expect(compact).toContain("public.job_conversation_redaction_events");
    expect(compact).toContain("'[content redacted]'");
    expect(compact).toContain("'[subject redacted]'");
    expect(compact).toContain("'[participant redacted]'");
    expect(compact).toContain("'job-participant-redaction:v1:'");
    expect(compact).toMatch(
      /when coalesce\(redaction\.participant_redacted, false\) then '\{\}'::text\[\] else turn\.recipient_identities end as recipient_identities/
    );
    expect(compact).toContain("'ops.redacted-source-version.v2:'");
    expect(compact).toMatch(
      /when coalesce\(redaction\.has_redaction, false\) then null else turn\.provider_delivery_source_sha256 end as provider_delivery_source_sha256/
    );
    expect(compact).toContain("count(event.id) > 0 as has_redaction");
    expect(compact).toContain("'redaction_state_revision'");
    expect(compact).not.toContain("'redaction_event_ids'");
    expect(compact).not.toMatch(/array_agg\( event\.id/);
    expect(compact).not.toMatch(
      /array_agg\( distinct (?:event\.redaction_kind|redaction_kind|link\.relationship)/
    );
    expect(compact).toContain(
      "case when bool_or( event.redaction_kind = 'attachment_redacted' ) then 'attachment_redacted' end"
    );
    expect(compact).toContain(
      "case when bool_or( 'content_redacted' = any(turn.redaction_kinds) ) then 'content_redacted' end"
    );
    expect(compact).toContain("extensions.digest(");
    expect(compact).toContain("invalidated_memory_evidence as materialized");
    expect(compact).toContain("invalidated_evidence_ranked as materialized");
    expect(compact).toContain("invalidated.invalidated_rank <= 100");
    expect(compact).toContain("'invalidated_evidence_total'");
    expect(compact).toContain(
      "redaction.source_state_revision > memory.memory_source_state_revision"
    );
  });

  it("returns canonical trigger and active-claim evidence with explicit hard bounds", () => {
    const compact = compactSql();
    expect(compact).toContain("'job_conversation_turn:' || evidence.id::text");
    expect(compact).toContain("'triggering_turn'");
    expect(compact).toContain("'active_memory_claim'");
    expect(compact).toContain(
      "left(turn.normalized_plain_text, 4001) as bounded_plain_text"
    );
    expect(compact).toContain("'excerpt', evidence.normalized_plain_text");
    expect(compact).toContain("evidence.evidence_rank <= 20");
    expect(compact).toContain("evidence_payload_octets <= 50000");
    expect(compact).toContain("participant.participant_rank <= 50");
    expect(compact).toContain(
      "filter (where turn.evidence_rank <= 50) as evidence_ids"
    );
    expect(compact).toContain("'active_evidence_total'");
    expect(compact).toContain("'participant_total'");
    expect(compact).toContain("'evidence_id_total'");
  });

  it("bounds active-evidence text before materialization instead of retaining full bodies", () => {
    const compact = compactSql();
    expect(compact).toContain("authorized_evidence_turn as materialized");
    expect(compact).toContain(
      "left(turn.normalized_plain_text, 4001) as bounded_plain_text"
    );
    expect(compact).toContain("effective_evidence_turn as materialized");
    expect(compact).toContain("'job-conversation-evidence-projection:v2:'");
    expect(compact).toMatch(
      /evidence_candidate as materialized \([\s\S]*?from effective_evidence_turn turn/
    );
    expect(compact).not.toContain("select turn.*");
    const evidencePath = compact.match(
      /authorized_evidence_turn as materialized \(([\s\S]*?)\), effective_evidence_turn as materialized \(([\s\S]*?)\), recent_payload/
    );
    expect(evidencePath).not.toBeNull();
    expect(evidencePath?.[1]).not.toContain("select turn.*");
    expect(evidencePath?.[2]).not.toContain("select turn.*");
    expect(evidencePath?.[2]).not.toContain(
      "'normalized_plain_text', turn.normalized_plain_text"
    );
    expect(20 * 8_388_608).toBeGreaterThan(160_000_000);
  });

  it("resolves participants through an independently authorized metadata-only path", () => {
    const compact = compactSql();
    expect(compact).toContain("participant_turn as materialized");
    expect(compact).toContain("participant_group_summary as materialized");
    expect(compact).toContain("bounded_participant_group as materialized");
    expect(compact).toContain(
      "bounded_participant_turn_ranked as materialized"
    );
    expect(compact).toContain("'participants' = any(p_sections)");
    expect(compact).toContain("'job-conversation-participant-projection:v1:'");
    expect(compact).toContain("'primary_evidence'");
    expect(compact).toMatch(
      /bounded_participant_group as materialized \([\s\S]*?participant\.participant_rank <= 50[\s\S]*?bounded_participant_turn_ranked as materialized \([\s\S]*?join bounded_participant_group participant/
    );
    expect(compact).not.toMatch(
      /participant_candidate as materialized \([\s\S]*?from effective_turn turn/
    );
    expect(compact).toMatch(
      /bounded_participant_turn_ranked as materialized \([\s\S]*?row_number\(\) over \( partition by turn\.participant_id,[\s\S]*?as evidence_rank/
    );
    expect(compact).toMatch(
      /participant_candidate as materialized \([\s\S]*?from bounded_participant_turn_ranked turn/
    );
    expect(compact).toContain(
      "filter (where turn.evidence_rank <= 50) as evidence_ids"
    );
    expect(compact).not.toContain(")[1:50] as evidence_ids");
    expect(compact).toContain(
      "from participant_group_summary all_participants"
    );
  });

  it("builds only a minimal prior-job seed from independently visible jobs", () => {
    const compact = compactSql();
    expect(compact).toContain("prior_job_candidate as materialized");
    expect(compact).toContain("canonical_prior_job as materialized");
    expect(compact).toContain("as lifecycle_eligible");
    expect(compact).toContain(
      "coalesce( prior_project.client_id, prior_opportunity.client_id ) as client_id"
    );
    expect(compact).toMatch(
      /canonical_prior_job as materialized \([\s\S]*?candidate\.representative_rank = 1[\s\S]*?candidate\.client_id = requested\.client_id[\s\S]*?candidate\.lifecycle_eligible/
    );
    expect(compact).not.toContain(
      "prior_project.client_id = requested.client_id"
    );
    expect(compact).toContain(
      "prior_anchor.conversation_id <> requested.conversation_id"
    );
    expect(compact).toContain(
      "prior_conversation.created_at < requested.conversation_created_at"
    );
    expect(compact).toMatch(
      /lower\(btrim\(coalesce\(prior_project\.status, ''\)\)\) not in \( 'cancelled', 'canceled', 'closed', 'archived' \)/
    );
    expect(compact).toContain("prior_opportunity.archived_at is null");
    expect(compact).toMatch(
      /lower\(btrim\(coalesce\(prior_opportunity\.stage, ''\)\)\) not in \( 'lost', 'closed', 'cancelled', 'canceled', 'discarded' \)/
    );
    expect(compact).toMatch(
      /private\.agent_user_can_access_entity\( p_actor_user_id, p_company_id, candidate\.anchor_kind, candidate\.source_id, 'view' \)/
    );
    expect(compact).toContain("'customer_has_prior_ops_jobs'");
    expect(compact).toContain("'visible_prior_job_count'");
    expect(compact).toContain("'latest_visible_prior_job'");
    expect(compact).toContain("'relationship_continuity'");
    expect(compact).toContain("'customer_job_history:'");
    expect(compact).toContain("'customer-job-history-projection:v1:'");
    expect(compact).toContain("'visible_prior_job_snapshot'");
    expect(compact).toContain(
      "'state', case when projection.client_id is null then 'customer_unresolved' else 'available' end"
    );
    expect(compact).toContain(
      "case when projection.client_id is null then null else jsonb_build_object( 'evidence_id', 'customer_job_history:'"
    );
    expect(compact).not.toContain("prior_memory_document");
    expect(compact).not.toContain("prior.normalized_plain_text");
  });

  it("hashes a constant-size cross-job claim projection instead of every prior job", () => {
    const compact = compactSql();
    const projection = compact.match(
      /cross_job_projection_document as materialized \(([\s\S]*?)\), cross_job_projection as materialized/
    );

    expect(projection).not.toBeNull();
    expect(projection?.[1]).not.toContain("jsonb_agg");
    expect(projection?.[1]).toContain(
      "'permission_snapshot_revision', p_permission_snapshot_revision"
    );
    expect(projection?.[1]).toContain(
      "'visible_prior_job_count', count(visible.conversation_id)::integer"
    );
    expect(projection?.[1]).toContain("'latest_visible_prior_job'");
  });

  it("never delegates to the generation snapshot or returns a sibling anchor", () => {
    const compact = compactSql();
    expect(compact).not.toContain(
      "read_job_memory_generation_snapshot_as_system"
    );
    expect(compact).toContain(
      "'requested_job', jsonb_build_object( 'kind', p_job_kind, 'id', p_job_id )"
    );
    expect(compact).not.toContain("'job_refs'");
  });
});

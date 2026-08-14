import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260813120000_agent_job_communication_participants.sql"
);

function source(): string {
  try {
    return readFileSync(MIGRATION_PATH, "utf8").toLowerCase();
  } catch {
    return "";
  }
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function functionDefinition(sql: string, name: string): string {
  const marker = `create or replace function ${name}(`;
  const start = sql.lastIndexOf(marker);
  if (start < 0) return "";
  const remainder = sql.slice(start);
  const delimiter = /\bas\s+(\$[a-z0-9_]*\$)/.exec(remainder)?.[1];
  if (!delimiter) return "";
  const end = remainder.indexOf(`${delimiter};`);
  return end < 0 ? "" : remainder.slice(0, end + delimiter.length + 1);
}

const SQL = source();
const COMPACT_SQL = compact(SQL);
const RPC = compact(
  functionDefinition(SQL, "public.read_agent_job_participants_as_system")
);
const SNAPSHOT = compact(
  functionDefinition(SQL, "private.read_agent_job_participant_snapshot")
);
const IMPLEMENTATION = `${RPC} ${SNAPSHOT}`;

describe("job participants fixed RPC contract", () => {
  it("ships one current-only service-role RPC with the frozen signature and ACL", () => {
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(RPC).toContain(
      "public.read_agent_job_participants_as_system( p_request_id text, p_actor_user_id uuid, p_company_id uuid, p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_id text, p_capability_revision text, p_capability_manifest_revision text, p_required_oauth_scopes text[], p_inbox_scope text, p_clients_scope text, p_job_permission text, p_job_scope text, p_projects_scope text, p_tasks_scope text, p_job_kind text, p_job_id uuid, p_purpose text ) returns jsonb"
    );
    expect(RPC).not.toContain("p_as_of");
    expect(RPC).not.toContain("p_cursor");
    expect(RPC).not.toContain("p_limit");
    expect(RPC).toContain(
      "language plpgsql stable security definer set search_path = pg_catalog, public, private, extensions, pg_temp"
    );
    expect(RPC).toContain("auth.role() is distinct from 'service_role'");
    expect(RPC).toContain("private.read_agent_job_participant_snapshot(");
    expect(SNAPSHOT).toContain(
      "language plpgsql stable security definer set search_path = pg_catalog, public, private, extensions, pg_temp"
    );
    expect(COMPACT_SQL).toMatch(
      /revoke all on function public\.read_agent_job_participants_as_system\([\s\S]*?from public, anon, authenticated, service_role;/
    );
    expect(COMPACT_SQL).toMatch(
      /grant execute on function public\.read_agent_job_participants_as_system\([\s\S]*?to service_role;/
    );
  });

  it("pins the v5 participant capability and exact unchanged base OAuth scopes", () => {
    expect(RPC).toContain(
      "p_capability_id is distinct from 'resolve_job_participants'"
    );
    expect(RPC).toContain("'resolve_job_participants:2026-08-13.v1'");
    expect(RPC).toContain("'2026-08-13.capability-manifest.v5'");
    expect(RPC).toMatch(
      /p_required_oauth_scopes is distinct from\s+array\[\s*'ops\.correspondence\.read',\s*'ops\.customer_contacts\.read',\s*'ops\.customers\.read',\s*'ops\.jobs\.read'\s*\]::text\[\]/
    );
    expect(RPC).not.toContain("'ops.schedule.read'::text");
    expect(RPC).not.toContain("'ops.photos.read'::text");
  });

  it("reproves base job, client, and inbox authority plus purpose-conditional project/task authority", () => {
    expect(SNAPSHOT).toContain(
      "private.resolve_agent_actor_authority( p_actor_user_id, p_company_id, p_registered_permission_keys )"
    );
    expect(SNAPSHOT).toContain(
      "authority.permission_snapshot_revision = p_permission_snapshot_revision"
    );
    for (const permission of [
      "clients.view",
      "inbox.view",
      "pipeline.view",
      "projects.view",
      "tasks.view",
    ]) {
      expect(SNAPSHOT).toContain(
        `'${permission}' = any(p_registered_permission_keys)`
      );
      expect(SNAPSHOT).toContain(
        `permission.value ->> 'permission' = '${permission}'`
      );
    }
    expect(SNAPSHOT).toContain(
      "p_projects_scope is null or authority.projects_scope = p_projects_scope"
    );
    expect(SNAPSHOT).toContain(
      "p_tasks_scope is null or authority.tasks_scope = p_tasks_scope"
    );
    expect(SNAPSHOT).toMatch(
      /p_purpose in \('schedule', 'assignment'\)[\s\S]{0,180}\(p_projects_scope is null or p_tasks_scope is null\)/
    );
    expect(SNAPSHOT).toMatch(
      /p_purpose in \('communication', 'general'\)[\s\S]{0,500}p_tasks_scope is not null[\s\S]{0,80}invalid/
    );
  });

  it("resolves every participant from one authorized job and visible customer graph in the same statement", () => {
    expect(SNAPSHOT).toContain("with current_authority as materialized");
    expect(SNAPSHOT).toContain("requested_job as materialized");
    expect(SNAPSHOT).toContain("authorized_customer as materialized");
    expect(SNAPSHOT).toContain("bounded_participant as materialized");
    expect(SNAPSHOT).toContain(
      "private.agent_user_can_access_entity( p_actor_user_id, p_company_id, p_job_kind, p_job_id, 'view' )"
    );
    expect(SNAPSHOT).toContain(
      "private.agent_user_can_access_entity( p_actor_user_id, p_company_id, 'client', client.id, 'view' )"
    );
    expect(SNAPSHOT).toContain("sub_client.company_id = p_company_id");
    expect(SNAPSHOT).toContain("sub_client.client_id = client.id");
    expect(SNAPSHOT).toContain("sub_client.deleted_at is null");
    expect(SNAPSHOT).toContain("client.deleted_at is null");
    expect(SNAPSHOT).toContain("client.merged_into_client_id is null");
    expect(SNAPSHOT).toContain(
      "private.resolve_opportunity_client_id( opportunity.client_ref, opportunity.client_id )"
    );
    expect(SNAPSHOT).toMatch(
      /opportunity\.client_ref is not null[\s\S]{0,180}opportunity\.client_ref is distinct from opportunity\.client_id/
    );
    expect(SNAPSHOT).toMatch(
      /opportunity\.project_ref is not null[\s\S]{0,180}opportunity\.project_ref is distinct from opportunity\.project_id/
    );
  });

  it("keeps unresolved and ambiguous evidence participants unconfirmed", () => {
    expect(SNAPSHOT).toContain("public.job_conversation_turns");
    expect(SNAPSHOT).toContain("public.job_conversation_redaction_events");
    expect(SNAPSHOT).toContain("participant_resolution_status");
    expect(SNAPSHOT).toContain("'resolved'");
    expect(SNAPSHOT).toContain("'unresolved'");
    expect(SNAPSHOT).toContain("'ambiguous'");
    expect(SNAPSHOT).toContain("'evidence_ids'");
    expect(SNAPSHOT).toContain("'conversation_ambiguous'");
    expect(SNAPSHOT).toContain("'conversation_unresolved'");
    expect(SNAPSHOT).toContain("'conversation_redacted'");
    expect(SNAPSHOT).toContain("'candidate_count_lower_bound'");
    expect(SNAPSHOT).toContain(
      "'job-participant-resolution:v1'::text as resolution_revision"
    );
    expect(SNAPSHOT).toMatch(
      /when evidence\.participant_resolution_status = 'ambiguous'[\s\S]{0,120}else 'unresolved'/
    );
    expect(SNAPSHOT).not.toContain("high_confidence_related_contact.id");
    expect(SNAPSHOT).toContain(
      "private.agent_provider_outbound_authority_attestations"
    );
    expect(SNAPSHOT).toContain("public.email_send_intents");
    expect(SNAPSHOT).toContain("initiated_by = 'phase_c_auto_send'");
    expect(SNAPSHOT).not.toMatch(
      /when evidence\.participant_id = 'phase_c'[\s\S]{0,240}'phase_c_delivery_origin'/
    );
    expect(SNAPSHOT).not.toMatch(
      /when evidence\.participant_id ~ '\^ops_user:'[\s\S]{0,240}'ops_delivery_actor'/
    );
    expect(SNAPSHOT).toMatch(
      /event\.redaction_kind = 'participant_pseudonymized'[\s\S]{0,180}order by event\.source_state_revision desc, event\.id desc[\s\S]{0,80}limit 1/
    );
    expect(SNAPSHOT).toContain(
      "context.source_state_revision as conversation_source_state_revision"
    );
    expect(SNAPSHOT).toContain(
      "event.source_state_revision <= turn.conversation_source_state_revision"
    );
    expect(SNAPSHOT).not.toContain(
      "event.source_state_revision <= turn.source_state_revision"
    );
    expect(SNAPSHOT).not.toMatch(
      /bool_or\([\s\S]{0,100}event\.redaction_kind = 'participant_pseudonymized'/
    );
    expect(SNAPSHOT).toContain(
      "coalesce(octet_length(actor.first_name), 0) <= 256"
    );
    expect(SNAPSHOT).toContain(
      "coalesce(octet_length(actor.last_name), 0) <= 256"
    );
  });

  it("withholds blocked, ambiguous, and not-evaluated addresses before suppression lookup", () => {
    expect(SNAPSHOT).toContain("visible_contact_address as materialized");
    expect(SNAPSHOT).toContain("'blocked'");
    expect(SNAPSHOT).toContain("'ambiguous'");
    expect(SNAPSHOT).toContain("'not_evaluated'");
    expect(SNAPSHOT).toContain("'state', 'blocked'");
    expect(SNAPSHOT).toContain("'state', 'absent'");
    expect(SNAPSHOT).toMatch(
      /case when coalesce\(suppression\.active, false\)[\s\S]{0,120}then null else address\.email end as normalized_address/
    );
    expect(SNAPSHOT).toContain("lower(suppression.email) = address.email");
    expect(SNAPSHOT).not.toContain(
      "lower(btrim(suppression.email)) = address.email"
    );
    expect(SNAPSHOT).toContain("suppression.list = 'global'");
    expect(SNAPSHOT).not.toContain("suppression.reason");
    expect(SNAPSHOT).not.toContain("suppression.source");
    expect(SNAPSHOT).not.toContain("suppression.metadata");
    expect(SNAPSHOT).not.toContain("'preferred_channel', 'unknown'");
  });

  it("returns privacy-safe absence and fences tenant and visible-address freshness", () => {
    expect(IMPLEMENTATION).toContain("agent_job_participants_not_found");
    expect(IMPLEMENTATION).toContain("using errcode = 'p0002'");
    expect(SNAPSHOT).toContain("authorized_current_fence as materialized");
    expect(IMPLEMENTATION).toContain("'source_revision'");
    expect(IMPLEMENTATION).toContain("'source_fence'");
    expect(IMPLEMENTATION).toContain("'contactability_fence'");
    expect(IMPLEMENTATION).toContain("'contactability_revision'");
    expect(IMPLEMENTATION).toContain("'contactability_digest'");
    expect(IMPLEMENTATION).toContain("extensions.digest(");
    expect(IMPLEMENTATION).not.toMatch(
      /select[\s\S]{0,200}source_revision[\s\S]{0,200}from private\.agent_operational_read_revisions[\s\S]{0,280}raise exception 'agent_job_participants_not_found'/
    );
  });

  it("prebounds participants, crew, evidence, strings, and aggregates with explicit gaps", () => {
    expect(SNAPSHOT).toContain("participant_sentinel as materialized");
    expect(SNAPSHOT).toMatch(
      /participant_sentinel as materialized[\s\S]{0,900}limit 51[\s\S]{0,120}participant_ranked as materialized/
    );
    expect(SNAPSHOT).toMatch(
      /max\(participant\.participant_total\) > 50[\s\S]{0,1200}then 'participant_query_bound'/
    );
    expect(SNAPSHOT).toContain("participant_rank <= 50");
    expect(SNAPSHOT).toContain("occurrence_budgeted as materialized");
    expect(SNAPSHOT).toContain("sum(least(cardinality(coalesce(");
    expect(SNAPSHOT).toContain("as running_raw_assignment_count");
    expect(SNAPSHOT).toContain(
      "where occurrence.running_raw_assignment_count <= 100"
    );
    expect(SNAPSHOT).toContain("evidence_rank <= 5");
    expect(SNAPSHOT).toContain("evidence_total_rank <= 50");
    expect(SNAPSHOT).toContain(
      "coalesce((participant.evidence_ids)[1:1], array[]::text[])"
    );
    expect(SNAPSHOT).toContain(
      "'evidence_id_total', participant.evidence_id_total"
    );
    expect(SNAPSHOT).toMatch(
      /cardinality\(coalesce\(\s*task\.team_member_ids, array\[\]::text\[\]\s*\)\) > 100/
    );
    expect(SNAPSHOT).toContain("crew_rank <= 50");
    expect(SNAPSHOT).toContain("source_query_bound");
    expect(SNAPSHOT).toContain("source_data_invalid");
    expect(IMPLEMENTATION).toContain("octet_length(v_result::text) > 1048576");
    expect(SNAPSHOT).not.toMatch(/\boffset\b/);
    expect(SNAPSHOT).not.toMatch(/\bselect\s+\*/);
  });

  it("projects only source-proven OPS identity and purpose-bound assigned crew", () => {
    expect(SNAPSHOT).toContain("join public.users crew_user");
    expect(SNAPSHOT).toContain("crew_user.company_id = p_company_id");
    expect(SNAPSHOT).toContain("crew_user.deleted_at is null");
    expect(SNAPSHOT).toContain("coalesce(crew_user.is_active, false)");
    expect(SNAPSHOT).toContain("'ops_delivery_user'::text as source_kind");
    expect(SNAPSHOT).toContain("'task_assignment_user'::text as source_kind");
    expect(SNAPSHOT).toContain("'task_assignment'::text as resolution_basis");
    expect(SNAPSHOT).toContain("p_purpose in ('schedule', 'assignment')");
    expect(SNAPSHOT).toContain("null::text as role_label");
    for (const forbidden of [
      "crew_user.email",
      "crew_user.phone",
      "home_address",
      "emergency_contact",
      "auth_id",
      "firebase_uid",
      "device_token",
      "public.ops_contacts",
      "public.contact_messages",
    ]) {
      expect(IMPLEMENTATION).not.toContain(forbidden);
    }
  });

  it("emits canonical participant and collection claims bound to the direct raw wire", () => {
    expect(IMPLEMENTATION).toContain(
      "private.canonical_agent_projection_json("
    );
    expect(IMPLEMENTATION).toContain("extensions.digest(");
    expect(IMPLEMENTATION).toContain("'job_participant_projection'");
    expect(IMPLEMENTATION).toContain(
      "'job-participant-projection:v1:' || participant.source_content_hash"
    );
    for (const field of [
      "purpose",
      "permission_snapshot_revision",
      "source_revision",
      "contactability_digest",
      "contactability_revision",
      "participant",
      "participant_ref",
      "participant_proof_sources",
      "collection",
    ]) {
      expect(IMPLEMENTATION).toContain(`'${field}'`);
    }
    expect(IMPLEMENTATION).toContain("'collection_claim'");
    expect(IMPLEMENTATION).toContain(
      "'job_participants_collection_projection'"
    );
    expect(IMPLEMENTATION).toContain(
      "'job-participants-collection-projection:v1:'"
    );
    expect(IMPLEMENTATION).toContain("'requested_job'");
    expect(IMPLEMENTATION).toContain("'participant_count_completeness'");
    expect(IMPLEMENTATION).toContain("order by participant.kind_rank");
    expect(IMPLEMENTATION).toContain("participant.normalized_name");
    expect(IMPLEMENTATION).toContain("participant.id");
  });

  it("fails participant contactability closed on duplicate or bounded address ownership", () => {
    expect(SNAPSHOT).toContain("visible_owner_count");
    expect(SNAPSHOT).toContain("address.visible_owner_count > 1");
    expect(SNAPSHOT).toContain("'identity_ambiguous'");
    expect(SNAPSHOT).toMatch(
      /select source_query_bound from sub_client_source_state[\s\S]{0,100}then 'query_bound'/
    );
    expect(SNAPSHOT).toContain("'participant_count_completeness'");
    expect(SNAPSHOT).toContain("'lower_bound'");
  });

  it("binds opportunity schedule participants to the exact linked-project customer", () => {
    expect(SNAPSHOT).toMatch(
      /p_job_kind <> 'opportunity'[\s\S]{0,100}project\.client_id = job\.client_id/
    );
    expect(SNAPSHOT).toContain("'related_contact_unconfirmed'");
  });
});

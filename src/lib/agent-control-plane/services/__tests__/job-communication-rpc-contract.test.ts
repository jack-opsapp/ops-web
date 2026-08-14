import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_NAME =
  "20260813120000_agent_job_communication_participants.sql";
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  MIGRATION_NAME
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
  functionDefinition(
    SQL,
    "public.read_agent_job_communication_context_as_system"
  )
);
const SNAPSHOT = compact(
  functionDefinition(SQL, "private.read_agent_job_participant_snapshot")
);
const IMPLEMENTATION = `${RPC} ${SNAPSHOT}`;

describe("job communication fixed RPC contract", () => {
  it("ships one transactional current-only service-role RPC with the frozen signature", () => {
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(RPC).toContain(
      "public.read_agent_job_communication_context_as_system( p_request_id text, p_actor_user_id uuid, p_company_id uuid, p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_id text, p_capability_revision text, p_capability_manifest_revision text, p_required_oauth_scopes text[], p_inbox_scope text, p_clients_scope text, p_job_permission text, p_job_scope text, p_projects_scope text, p_calendar_scope text, p_tasks_scope text, p_photos_scope text, p_job_kind text, p_job_id uuid, p_purpose text ) returns jsonb"
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
      /revoke all on function private\.read_agent_job_participant_snapshot\([\s\S]*?from public, anon, authenticated, service_role;/
    );
    expect(COMPACT_SQL).toMatch(
      /revoke all on function public\.read_agent_job_communication_context_as_system\([\s\S]*?from public, anon, authenticated, service_role;/
    );
    expect(COMPACT_SQL).toMatch(
      /grant execute on function public\.read_agent_job_communication_context_as_system\([\s\S]*?to service_role;/
    );
  });

  it("pins v5 identity and computes the exact purpose-specific OAuth set", () => {
    expect(RPC).toContain(
      "p_capability_id is distinct from 'get_job_communication_context'"
    );
    expect(RPC).toContain("'get_job_communication_context:2026-08-13.v1'");
    expect(RPC).toContain("'2026-08-13.capability-manifest.v5'");
    for (const scope of [
      "ops.correspondence.read",
      "ops.customer_contacts.read",
      "ops.customers.read",
      "ops.jobs.read",
      "ops.photos.read",
      "ops.schedule.read",
    ]) {
      expect(RPC).toContain(`'${scope}'::text`);
    }
    expect(RPC).toContain(
      "select array_agg(requested.scope order by requested.scope)"
    );
    expect(RPC).toContain(
      "p_required_oauth_scopes is distinct from v_expected_oauth_scopes"
    );
    expect(RPC).toMatch(
      /'ops\.schedule\.read'::text[\s\S]{0,160}p_purpose in \('schedule_notice', 'photo_request'\)/
    );
    expect(RPC).toMatch(
      /'ops\.photos\.read'::text[\s\S]{0,160}p_purpose = 'photo_request'/
    );
  });

  it("reproves the complete registry, current actor revision, and conditional permission scopes", () => {
    expect(SNAPSHOT).toContain(
      "private.resolve_agent_actor_authority( p_actor_user_id, p_company_id, p_registered_permission_keys )"
    );
    expect(SNAPSHOT).toContain(
      "authority.permission_snapshot_revision = p_permission_snapshot_revision"
    );
    expect(SNAPSHOT).toContain(
      "select count(distinct registry.permission_key) from unnest(p_registered_permission_keys)"
    );
    for (const permission of [
      "calendar.view",
      "clients.view",
      "inbox.view",
      "photos.view",
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
      "p_calendar_scope is null or authority.calendar_scope = p_calendar_scope"
    );
    expect(SNAPSHOT).toContain(
      "p_tasks_scope is null or authority.tasks_scope = p_tasks_scope"
    );
    expect(SNAPSHOT).toContain(
      "p_photos_scope is null or authority.photos_scope = p_photos_scope"
    );
  });

  it("authorizes the requested job, client, linked project, and every retained task in the data statement", () => {
    expect(SNAPSHOT).toContain("with current_authority as materialized");
    expect(SNAPSHOT).toContain("requested_job as materialized");
    expect(SNAPSHOT).toContain("authorized_customer as materialized");
    expect(SNAPSHOT).toContain(
      "private.agent_user_can_access_entity( p_actor_user_id, p_company_id, p_job_kind, p_job_id, 'view' )"
    );
    expect(SNAPSHOT).toContain(
      "private.agent_user_can_access_entity( p_actor_user_id, p_company_id, 'client', client.id, 'view' )"
    );
    expect(SNAPSHOT).toContain(
      "private.agent_user_can_access_entity( p_actor_user_id, p_company_id, 'project', project.id, 'view' )"
    );
    expect(SNAPSHOT).toContain(
      "private.agent_user_can_access_entity( p_actor_user_id, p_company_id, 'task', task.id, 'view' )"
    );
    expect(SNAPSHOT).toContain("task.status = 'active'");
    expect(SNAPSHOT).toContain("task.deleted_at is null");
    expect(SNAPSHOT).toContain("project.deleted_at is null");
  });

  it("returns privacy-safe not-found and never reveals another tenant's current fence", () => {
    expect(IMPLEMENTATION).toContain(
      "agent_job_communication_context_not_found"
    );
    expect(IMPLEMENTATION).toContain("using errcode = 'p0002'");
    expect(SNAPSHOT).toContain("authorized_current_fence as materialized");
    expect(SNAPSHOT).toContain(
      "authority.permission_snapshot_revision = p_permission_snapshot_revision"
    );
    expect(IMPLEMENTATION).not.toMatch(
      /agent_job_communication_context_cursor_stale[\s\S]{0,800}select[\s\S]{0,240}from private\.agent_operational_read_revisions(?![\s\S]{0,420}permission_snapshot_revision)/
    );
  });

  it("extends tenant freshness and binds active suppression state only after visible address resolution", () => {
    for (const table of [
      "sub_clients",
      "opportunities",
      "job_conversations",
      "job_conversation_turns",
      "job_conversation_redaction_events",
    ]) {
      expect(COMPACT_SQL).toContain(
        `create trigger ${table}_bump_agent_operational_read_revision`
      );
    }
    expect(COMPACT_SQL).toContain(
      "create table if not exists private.agent_contactability_address_revisions"
    );
    expect(COMPACT_SQL).toContain(
      "check (source_revision between 0 and 9007199254740991)"
    );
    expect(COMPACT_SQL).toContain("agent_contactability_revision_exhausted");
    expect(SNAPSHOT).toContain("visible_contact_address as materialized");
    expect(SNAPSHOT).toContain("lower(suppression.email) = address.email");
    expect(SNAPSHOT).not.toContain(
      "lower(btrim(suppression.email)) = address.email"
    );
    expect(COMPACT_SQL).toContain(
      "convert_to(lower(suppression.email), 'utf8')"
    );
    expect(COMPACT_SQL).toContain("convert_to(lower(old.email), 'utf8')");
    expect(COMPACT_SQL).toContain("convert_to(lower(new.email), 'utf8')");
    expect(COMPACT_SQL).not.toContain(
      "convert_to(lower(btrim(suppression.email)), 'utf8')"
    );
    expect(COMPACT_SQL).not.toContain(
      "convert_to(lower(btrim(old.email)), 'utf8')"
    );
    expect(COMPACT_SQL).not.toContain(
      "convert_to(lower(btrim(new.email)), 'utf8')"
    );
    expect(SNAPSHOT).toContain("suppression.list = 'global'");
    expect(SNAPSHOT).toContain(
      "suppression.expires_at is null or suppression.expires_at > statement_timestamp()"
    );
    expect(SNAPSHOT).toContain("'contactability_digest'");
    expect(SNAPSHOT).toContain("extensions.digest(");
    expect(
      SNAPSHOT.indexOf("visible_contact_address as materialized")
    ).toBeLessThan(
      SNAPSHOT.indexOf("from public.email_suppressions suppression")
    );
  });

  it("hard-bounds every participant, occurrence, crew, evidence, and output aggregate before materialization", () => {
    expect(SNAPSHOT).toContain("participant_rank <= 50");
    expect(SNAPSHOT).toContain("occurrence_rank <= 50");
    expect(SNAPSHOT).toContain("evidence_rank <= 5");
    expect(SNAPSHOT).toContain("evidence_total_rank <= 50");
    expect(SNAPSHOT).toMatch(
      /cardinality\(coalesce\(\s*task\.team_member_ids, array\[\]::text\[\]\s*\)\) > 100/
    );
    expect(SNAPSHOT).toContain("crew_rank <= 50");
    expect(SNAPSHOT).toContain("occurrence_budgeted as materialized");
    expect(SNAPSHOT).toContain("sum(least(cardinality(coalesce(");
    expect(SNAPSHOT).toContain("as running_raw_assignment_count");
    expect(SNAPSHOT).toContain(
      "where occurrence.running_raw_assignment_count <= 100"
    );
    expect(SNAPSHOT).toContain("source_query_bound");
    expect(SNAPSHOT).toContain("source_data_invalid");
    expect(IMPLEMENTATION).toContain("octet_length(v_result::text) > 1048576");
    expect(SNAPSHOT).not.toMatch(/\boffset\b/);
    expect(SNAPSHOT).not.toMatch(/\bselect\s+\*/);
  });

  it("projects purpose-minimized safe identities and no raw staff or suppression metadata", () => {
    expect(IMPLEMENTATION).toContain("'schedule_notice'");
    expect(IMPLEMENTATION).toContain("'photo_request'");
    expect(IMPLEMENTATION).toContain("'general'");
    expect(IMPLEMENTATION).toContain("'email_source'");
    expect(IMPLEMENTATION).toContain("'state', 'blocked'");
    expect(IMPLEMENTATION).not.toContain("'preferred_channel', 'unknown'");
    expect(IMPLEMENTATION).toContain("'schedule'");
    expect(IMPLEMENTATION).toContain("'occurrences'");
    expect(SNAPSHOT).toMatch(
      /'local_end_inclusive', case when occurrence\.all_day[\s\S]{0,220}time '23:59:59\.999999'[\s\S]{0,120}'yyyy-mm-dd"t"hh24:mi:ss\.us'/
    );
    expect(IMPLEMENTATION).toContain("'assignments'");
    expect(IMPLEMENTATION).toContain("'site_photos'");
    expect(IMPLEMENTATION).toContain("'status', 'not_evaluated'");
    for (const forbidden of [
      "crew_user.email",
      "crew_user.phone",
      "home_address",
      "emergency_contact",
      "suppression.reason",
      "suppression.source",
      "suppression.metadata",
      "public.ops_contacts",
      "public.contact_messages",
    ]) {
      expect(IMPLEMENTATION).not.toContain(forbidden);
    }
  });

  it("proves assistant identities from accepted outbound authority rather than participant labels", () => {
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
  });

  it("returns canonical context claims whose hashes bind raw context and ordered participant proofs", () => {
    expect(IMPLEMENTATION).toContain(
      "private.canonical_agent_projection_json("
    );
    expect(IMPLEMENTATION).toContain("extensions.digest(");
    expect(IMPLEMENTATION).toContain("'job_communication_context_projection'");
    expect(IMPLEMENTATION).toContain(
      "'job-communication-context-projection:v1:'"
    );
    for (const field of [
      "purpose",
      "permission_snapshot_revision",
      "source_revision",
      "contactability_digest",
      "contactability_revision",
      "job_ref",
      "context",
      "participant_proof_sources",
    ]) {
      expect(IMPLEMENTATION).toContain(`'${field}'`);
    }
    expect(IMPLEMENTATION).toContain("'context_claim'");
    expect(IMPLEMENTATION).toContain("'requested_job'");
    expect(IMPLEMENTATION).toContain("'contactability_fence'");
    expect(IMPLEMENTATION).toContain("'participant_count_completeness'");
    expect(IMPLEMENTATION).toContain("'trust', 'authoritative_ops'");
    expect(IMPLEMENTATION).toContain("'relationship', 'supports'");
  });

  it("emits strict evaluated-or-gap schedule and photo raw sources", () => {
    expect(SNAPSHOT).toContain("'status', 'evaluated'");
    expect(SNAPSHOT).toContain("'source_kind', 'task_schedule'");
    expect(SNAPSHOT).toContain("'source_kind', 'project_photos'");
    expect(SNAPSHOT).toContain("'gap_code', 'source_query_bound'");
    expect(SNAPSHOT).toContain("'gap_code', 'source_data_invalid'");
    expect(SNAPSHOT).toMatch(
      /p_purpose = 'general'[\s\S]{0,100}array\['schedule', 'site_photos'\]/
    );
  });

  it("prebounds all unconstrained source strings before normalization or hashing", () => {
    for (const expression of [
      "octet_length(opportunity.description) <= 4000",
      "octet_length(opportunity.address) <= 2000",
      "octet_length(project.description) <= 4000",
      "octet_length(client.email) <= 320",
      "octet_length(sub_client.email) <= 320",
    ]) {
      expect(SNAPSHOT).toContain(expression);
    }
    expect(SQL).toContain("octet_length(old.email) between 3 and 320");
    expect(SQL).toContain("octet_length(new.email) between 3 and 320");
    expect(RPC).toContain(
      "cardinality(p_required_oauth_scopes) not between 1 and 16"
    );
    expect(RPC).toContain(
      "octet_length(requested.scope) not between 1 and 128"
    );
  });
});

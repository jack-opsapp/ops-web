import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_SUFFIX = "_agent_job_conversation_memory.sql";
const MEMORY_TABLES = [
  "job_conversations",
  "job_conversation_anchors",
  "job_conversation_turns",
  "job_memory_versions",
  "job_memory_version_evidence",
  "job_conversation_redaction_events",
] as const;

function migrationSql(): string {
  const directory = join(process.cwd(), "supabase/migrations");
  const matches = readdirSync(directory)
    .filter((file) => file.endsWith(MIGRATION_SUFFIX))
    .sort();

  expect(
    matches,
    `expected exactly one migration ending in ${MIGRATION_SUFFIX}`
  ).toHaveLength(1);

  return matches.length === 1
    ? readFileSync(join(directory, matches[0]), "utf8").toLowerCase()
    : "";
}

function compactSql(): string {
  return migrationSql().replace(/\s+/g, " ");
}

function allMigrationSql(): string {
  const directory = join(process.cwd(), "supabase/migrations");
  return readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(directory, file), "utf8"))
    .join("\n")
    .toLowerCase();
}

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`create or replace function ${name}(`);
  if (start < 0) return "";
  const next = source.indexOf("create or replace function ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

function latestFunctionBody(source: string, name: string): string {
  const start = source.lastIndexOf(`create or replace function ${name}(`);
  if (start < 0) return "";
  const next = source.indexOf("create or replace function ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

function sourceFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8").toLowerCase();
}

function policyBody(source: string, name: string): string {
  const start = source.indexOf(`create policy ${name}`);
  if (start < 0) return "";
  const next = source.indexOf("create policy ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("agent job conversation memory schema", () => {
  it("creates the six versioned, job-anchored records in one transaction", () => {
    const sql = migrationSql();
    const compact = sql.replace(/\s+/g, " ");

    expect(sql).toMatch(/(?:^|\n)begin;\s/);
    expect(sql.trim().endsWith("commit;")).toBe(true);

    for (const table of MEMORY_TABLES) {
      expect(compact).toContain(`create table public.${table}`);
      expect(compact).toContain(
        `alter table public.${table} enable row level security`
      );
      expect(compact).toContain(
        `alter table public.${table} force row level security`
      );
    }

    for (const table of [
      "job_conversation_turns",
      "job_memory_versions",
      "job_memory_version_evidence",
      "job_conversation_redaction_events",
    ]) {
      expect(compact).toContain(
        `revoke all on table public.${table} from public, anon, authenticated, service_role`
      );
      expect(compact).toContain(
        `grant select on table public.${table} to service_role`
      );
      expect(compact).not.toContain(
        `grant select on table public.${table} to authenticated`
      );
    }
  });

  it("uses UUID job foreign keys and one unique company/type/source anchor", () => {
    const compact = compactSql();

    expect(compact).toMatch(
      /job_conversation_anchors[\s\S]*?anchor_kind text not null[\s\S]*?source_id uuid generated always as \(\s*coalesce\(opportunity_id, project_id\)\s*\) stored/
    );
    expect(compact).toContain("opportunity_id uuid");
    expect(compact).toContain("project_id uuid");
    expect(compact).toContain("unique (company_id, anchor_kind, source_id)");
    expect(compact).toContain(
      "unique (company_id, conversation_id, anchor_kind)"
    );
    expect(compact).toMatch(
      /check \(\s*\(anchor_kind = 'opportunity'[\s\S]*?opportunity_id is not null[\s\S]*?project_id is null[\s\S]*?\)\s*or\s*\(anchor_kind = 'project'[\s\S]*?project_id is not null[\s\S]*?opportunity_id is null/
    );
  });

  it("keeps every job, source, and actor reference in the owning company", () => {
    const compact = compactSql();
    const sourceGuard = functionBody(
      compact,
      "private.enforce_job_conversation_turn_source"
    );

    expect(compact).toContain(
      "create unique index if not exists projects_company_id_id_uidx on public.projects (company_id, id)"
    );
    expect(compact).toMatch(
      /foreign key \(company_id, opportunity_id\)[\s\S]*?references public\.opportunities\(company_id, id\)/
    );
    expect(compact).toMatch(
      /foreign key \(company_id, project_id\)[\s\S]*?references public\.projects\(company_id, id\)/
    );
    expect(compact).toMatch(
      /foreign key \(company_id, source_activity_id\)[\s\S]*?references public\.activities\(company_id, id\)/
    );
    expect(compact).toMatch(
      /foreign key \(company_id, source_correspondence_event_id\)[\s\S]*?references public\.opportunity_correspondence_events\(company_id, id\)/
    );
    expect(compact).toMatch(
      /foreign key \(company_id, actor_user_id\)[\s\S]*?references public\.users\(company_id, id\)/
    );

    expect(sourceGuard).toContain(
      "connection.company_id = new.company_id::text"
    );
    expect(sourceGuard).toContain(
      "activity.email_connection_id = new.source_connection_id"
    );
    expect(sourceGuard).toContain(
      "activity.email_message_id = new.provider_message_id"
    );
    expect(sourceGuard).toContain(
      "event.connection_id = new.source_connection_id"
    );
    expect(sourceGuard).toContain(
      "event.provider_message_id = new.provider_message_id"
    );
    expect(sourceGuard).toContain(
      "from public.job_conversation_anchors anchor"
    );
    expect(compact).toMatch(
      /create trigger job_conversation_turns_source_guard[\s\S]*?before insert or update on public\.job_conversation_turns/
    );
  });

  it("fails closed unless every external composite FK target has the exact live unique index", () => {
    const compact = compactSql();
    const normalized = compact
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .replace(/,\s+/g, ", ");

    for (const [index, table] of [
      ["opportunities_company_id_id_uidx", "opportunities"],
      ["projects_company_id_id_uidx", "projects"],
      ["activities_company_id_id_uidx", "activities"],
      [
        "opportunity_correspondence_events_company_id_id_uidx",
        "opportunity_correspondence_events",
      ],
      ["users_company_id_id_uidx", "users"],
    ]) {
      expect(compact).toMatch(
        new RegExp(`\\(\\s*'${index}',\\s*'${table}'\\s*\\)`)
      );
    }

    for (const invariant of [
      "index_definition.indisunique",
      "index_definition.indimmediate",
      "index_definition.indisvalid",
      "index_definition.indisready",
      "index_definition.indpred is null",
      "index_definition.indexprs is null",
      "index_definition.indnkeyatts = 2",
      "index_definition.indnatts = 2",
      "pg_catalog.pg_get_indexdef(index_definition.indexrelid, 1, true) = 'company_id'",
      "pg_catalog.pg_get_indexdef(index_definition.indexrelid, 2, true) = 'id'",
    ]) {
      expect(normalized).toContain(invariant);
    }

    expect(compact).toContain(
      "agent_job_conversation_memory_prerequisite_invalid_unique_index"
    );
  });

  it("makes every delivered turn idempotent, exact, and immutable without applying the prompt budget to storage", () => {
    const compact = compactSql();
    const ingest = functionBody(
      compact,
      "public.ingest_job_conversation_turn_as_system"
    );

    expect(compact).toMatch(
      /job_conversation_turns[\s\S]*?side text[\s\S]*?participant_resolution_status text not null[\s\S]*?participant_resolution_revision text not null[\s\S]*?direction text not null[\s\S]*?channel text not null[\s\S]*?delivered_at timestamptz not null/
    );
    expect(compact).toMatch(
      /participant_resolution_status = 'resolved'[\s\S]*?direction = 'inbound' and side = 'user'[\s\S]*?direction = 'outbound' and side = 'assistant'[\s\S]*?participant_resolution_status in \('unresolved', 'ambiguous'\)[\s\S]*?side is null/
    );
    expect(compact).toMatch(
      /source_connection_id uuid not null[\s\S]*?references public\.email_connections\(id\)/
    );
    expect(compact).toContain("source_activity_id uuid");
    expect(compact).toContain("source_correspondence_event_id uuid");
    expect(compact).toContain("provider_message_id text not null");
    expect(compact).toContain("subject text");
    expect(compact).toContain("recipient_identities text[] not null");
    expect(compact).toContain("cc_recipient_identities text[] not null");
    expect(compact).toContain("normalized_plain_text text not null");
    expect(compact).toContain("original_content_hash text not null");
    expect(compact).toContain("attachment_evidence_ids text[] not null");
    expect(compact).toContain(
      "unique (company_id, source_connection_id, provider_message_id)"
    );
    expect(compact).not.toContain("char_length(normalized_plain_text)");
    expect(ingest).not.toContain("char_length(p_normalized_plain_text)");
    expect(compact).toMatch(
      /create trigger job_conversation_turns_immutable[\s\S]*?before update or delete on public\.job_conversation_turns/
    );
    expect(ingest).not.toContain("p_subject text");
    expect(ingest).not.toContain("p_recipient_identities text[]");
    expect(ingest).not.toContain("p_cc_recipient_identities text[]");
    expect(ingest).not.toContain("p_normalized_plain_text text");
    expect(ingest).not.toContain("p_original_content_hash text");
    expect(ingest).not.toContain("p_attachment_evidence_ids text[]");
    expect(ingest).toContain(
      "v_existing_turn.subject is distinct from v_provider_source.normalized_subject"
    );
    expect(ingest).toContain(
      "v_existing_turn.recipient_identities is distinct from v_provider_source.recipient_identities"
    );
    expect(ingest).toContain(
      "v_existing_turn.cc_recipient_identities is distinct from v_provider_source.cc_recipient_identities"
    );
    expect(ingest).toContain(
      "v_existing_turn.normalized_plain_text is distinct from v_provider_source.normalized_plain_text"
    );
    expect(ingest).toContain(
      "v_existing_turn.original_content_hash is distinct from v_provider_source.source_sha256"
    );
    expect(ingest).toContain(
      "v_existing_turn.attachment_evidence_ids is distinct from v_provider_source.attachment_evidence_ids"
    );
  });

  it("never guesses an ambiguous participant into a chat side", () => {
    const compact = compactSql();
    const ingest = functionBody(
      compact,
      "public.ingest_job_conversation_turn_as_system"
    );

    expect(ingest).not.toContain("p_participant_resolution_status text");
    expect(ingest).not.toContain("p_participant_id text");
    expect(ingest).not.toContain("p_side text");
    expect(ingest).toContain("v_participant_resolution_status text");
    expect(ingest).toContain("v_participant_resolution_revision text");
    expect(ingest).toMatch(
      /v_provider_source\.direction = 'outbound'[\s\S]*?v_side := 'assistant'[\s\S]*?v_participant_resolution_status := 'resolved'/
    );
    expect(ingest).toMatch(
      /v_provider_source\.direction = 'inbound'[\s\S]*?v_participant_candidate_count = 1[\s\S]*?v_side := 'user'/
    );
    expect(ingest).toContain(
      "v_existing_turn.participant_resolution_status is distinct from v_participant_resolution_status"
    );
  });

  it("uses the control-plane canonical SHA-256 representation everywhere", () => {
    const compact = compactSql();
    const ingest = functionBody(
      compact,
      "public.ingest_job_conversation_turn_as_system"
    );

    expect(compact.match(/\^sha256:\[0-9a-f\]\{64\}\$/g)).toHaveLength(7);
    expect(compact).not.toMatch(/~ '\^\[0-9a-f\]\{64\}\$'/);
    expect(ingest).toContain(
      "v_existing_turn.original_content_hash is distinct from v_provider_source.source_sha256"
    );
  });

  it("keeps memory versions append-only with predecessor and turn watermark integrity", () => {
    const compact = compactSql();

    expect(compact).toContain(
      "unique (company_id, conversation_id, version_number)"
    );
    expect(compact).toMatch(
      /foreign key \(company_id, conversation_id, predecessor_version_id\)[\s\S]*?references public\.job_memory_versions \(company_id, conversation_id, id\)/
    );
    expect(compact).toMatch(
      /foreign key \(company_id, conversation_id, turn_high_watermark_id\)[\s\S]*?references public\.job_conversation_turns \(company_id, conversation_id, id\)/
    );
    expect(compact).toMatch(
      /memory_document jsonb not null[\s\S]*?jsonb_typeof\(memory_document\) = 'object'/
    );
    expect(compact).toMatch(
      /create trigger job_memory_versions_immutable[\s\S]*?before update or delete on public\.job_memory_versions/
    );
    expect(compact).toMatch(
      /foreign key \(company_id, conversation_id, predecessor_version_id\)[\s\S]*?on delete no action[\s\S]*?deferrable initially deferred/
    );
    expect(compact).toMatch(
      /job_conversations_current_memory_version_fkey[\s\S]*?on delete set null \(current_memory_version_id\)/
    );
    expect(compact).toMatch(
      /job_memory_version_evidence[\s\S]*?relationship text not null[\s\S]*?'supports'[\s\S]*?'contradicts'[\s\S]*?'supersedes'/
    );
  });

  it("uses monotonic turn coverage and a source revision that redactions invalidate", () => {
    const compact = compactSql();

    expect(compact).toMatch(
      /job_conversations[\s\S]*?last_turn_sequence bigint not null default 0[\s\S]*?source_state_revision bigint not null default 0/
    );
    expect(compact).toMatch(
      /job_conversation_turns[\s\S]*?turn_sequence bigint not null[\s\S]*?source_state_revision bigint not null/
    );
    expect(compact).toContain(
      "unique (company_id, conversation_id, turn_sequence)"
    );
    expect(compact).toMatch(
      /job_memory_versions[\s\S]*?turn_high_watermark_sequence bigint not null[\s\S]*?source_state_revision bigint not null[\s\S]*?generation_input_hash text not null/
    );
    expect(compact).toMatch(
      /job_conversation_redaction_events[\s\S]*?source_state_revision bigint not null/
    );
    expect(compact).toMatch(
      /create trigger job_conversation_redactions_source_revision[\s\S]*?before insert on public\.job_conversation_redaction_events/
    );
  });

  it("binds every turn to the immutable provider-delivery source and hash", () => {
    const compact = allMigrationSql().replace(/\s+/g, " ");
    const ingest = functionBody(
      compact,
      "public.ingest_job_conversation_turn_as_system"
    );

    expect(compact).toMatch(
      /job_conversation_turns[\s\S]*?provider_delivery_source_id uuid not null[\s\S]*?provider_delivery_source_sha256 text not null/
    );
    expect(compact).toMatch(
      /foreign key \(\s*company_id,\s*provider_delivery_source_id,\s*provider_delivery_source_sha256\s*\)[\s\S]*?references private\.agent_provider_delivery_sources\(\s*company_id,\s*id,\s*source_sha256\s*\)/
    );
    expect(ingest).toContain("p_provider_delivery_source_id uuid");
    expect(ingest).toContain("p_provider_delivery_source_sha256 text");
    expect(ingest).toContain("private.agent_provider_delivery_sources");
  });

  it("reads one bounded generation snapshot and commits one version atomically", () => {
    const compact = allMigrationSql().replace(/\s+/g, " ");
    const snapshot = functionBody(
      compact,
      "public.read_job_memory_generation_snapshot_as_system"
    );
    const commit = functionBody(
      compact,
      "public.commit_job_memory_version_as_system"
    );

    expect(snapshot).toContain("auth.role()");
    expect(snapshot).toContain("'service_role'");
    expect(snapshot).toContain("turn_sequence");
    expect(snapshot).toContain("source_state_revision");
    expect(snapshot).toContain("job_conversation_redaction_events");
    expect(snapshot).toContain("limit p_max_turns");
    expect(snapshot).toContain("'source_participant_id'");
    expect(snapshot).toContain("'source_participant_resolution_status'");
    expect(snapshot).toMatch(
      /participant_redacted, false\)[\s\S]*?then '\[participant redacted\]'[\s\S]*?then 'unresolved'/
    );

    expect(commit).toContain("for update");
    expect(commit).toContain("p_expected_current_memory_version_id");
    expect(commit).toContain("p_expected_source_state_revision");
    expect(commit).toContain("'conflict'::text");
    expect(commit).toContain("extensions.digest");
    expect(commit).toContain("insert into public.job_memory_versions");
    expect(commit).toContain("insert into public.job_memory_version_evidence");
    expect(commit).toContain("update public.job_conversations");
    expect(commit).toContain("private.agent_provider_delivery_sources");

    for (const name of [
      "read_job_memory_generation_snapshot_as_system",
      "commit_job_memory_version_as_system",
    ]) {
      expect(compact).toMatch(
        new RegExp(
          `revoke all on function public\\.${name}\\([\\s\\S]*?from public, anon, authenticated, service_role`
        )
      );
      expect(compact).toMatch(
        new RegExp(
          `grant execute on function public\\.${name}\\([\\s\\S]*?to service_role`
        )
      );
    }
  });

  it("defines a fixed actor-authorized context snapshot instead of reusing the generation read", () => {
    const compact = allMigrationSql().replace(/\s+/g, " ");
    const context = latestFunctionBody(
      compact,
      "public.read_agent_job_conversation_context_as_system"
    );
    const implementation = functionBody(
      compact,
      "public.read_agent_job_conversation_context_as_system"
    );

    expect(context).toContain("auth.role()");
    expect(context).toContain("'service_role'");
    expect(context).toContain("p_request_id text");
    expect(context).toContain("p_actor_user_id uuid");
    expect(context).toContain("p_company_id uuid");
    expect(context).toContain("p_permission_snapshot_revision text");
    expect(context).toContain("p_capability_id text");
    expect(context).toContain("p_capability_revision text");
    expect(context).toContain("p_capability_manifest_revision text");
    expect(context).toContain("p_required_oauth_scopes text[]");
    expect(context).toContain("p_job_kind text");
    expect(context).toContain("p_job_id uuid");
    expect(context).toContain("p_exact_turn_limit integer");
    expect(context).toContain("p_required_through_turn_id uuid");
    expect(context).toContain(
      "v_v6_result := private.read_agent_job_conversation_context_as_system_v6_core("
    );
    expect(context).toContain(
      "p_capability_manifest_revision is null or p_capability_manifest_revision not in ( '2026-08-14.capability-manifest.v6', '2026-08-20.capability-manifest.v7' )"
    );
    expect(context).toContain(
      "if p_capability_manifest_revision = '2026-08-14.capability-manifest.v6' then return v_v6_result; end if;"
    );
    expect(context).toContain(
      "return private.reprove_agent_read_jsonb_for_manifest( v_v6_result, '2026-08-20.capability-manifest.v7' );"
    );
    expect(implementation).toContain(
      "p_capability_id is distinct from 'get_job_conversation_context'"
    );
    expect(implementation).toContain(
      "'get_job_conversation_context:2026-08-07.v1'"
    );
    expect(context).toContain("'2026-08-14.capability-manifest.v6'");
    expect(context).not.toContain(
      "private.read_agent_job_conversation_context_v4_impl("
    );
    expect(implementation).toContain(
      "private.resolve_agent_actor_authority( p_actor_user_id, p_company_id"
    );
    expect(implementation).toContain("'inbox.view'");
    expect(implementation).toContain("'clients.view'");
    expect(implementation).toContain(
      "public.job_conversation_redaction_events"
    );
    expect(implementation).toContain("turn.participant_resolution_revision");
    expect(implementation).toContain("turn.source_connection_id");
    expect(implementation).toContain("turn.provider_message_id");
    expect(implementation).toContain("turn.source_activity_id");
    expect(implementation).toContain("turn.source_correspondence_event_id");
    expect(implementation).toContain("order by turn.turn_sequence desc");
    expect(implementation).toContain("limit p_exact_turn_limit");
    expect(implementation).toContain("order by recent.turn_sequence");
    expect(implementation).toContain(
      "'job_conversation_turn:' || turn.id::text"
    );
    expect(implementation).toContain("private.agent_provider_delivery_sources");
    expect(implementation).not.toContain(
      "read_job_memory_generation_snapshot_as_system"
    );
    expect(compact).toMatch(
      /revoke all on function public\.read_agent_job_conversation_context_as_system\([\s\S]*?from public, anon, authenticated, service_role/
    );
    expect(compact).toMatch(
      /grant execute on function public\.read_agent_job_conversation_context_as_system\([\s\S]*?to service_role/
    );
  });

  it("fails closed when required memory fields or evidence fields are missing", () => {
    const compact = allMigrationSql().replace(/\s+/g, " ");
    const commit = functionBody(
      compact,
      "public.commit_job_memory_version_as_system"
    );
    const requiredKeys = commit.match(
      /not \(p_memory_document \?& array\[(.*?)\]\)/
    );

    expect(requiredKeys).not.toBeNull();
    for (const key of [
      "schema_version",
      "facts",
      "decisions",
      "commitments",
      "preferences",
      "open_questions",
      "contradictions",
      "schedule_assertions",
      "financial_facts",
      "excluded_assumptions",
    ]) {
      expect(requiredKeys![1]).toContain(`'${key}'`);
    }
    expect(commit).toContain(
      "p_memory_document ->> 'schema_version' is distinct from 'ops.job-memory.v1'"
    );
    expect(commit).toContain(
      "jsonb_typeof(p_memory_document -> v_key) is distinct from 'array'"
    );
    expect(commit).toContain(
      "jsonb_typeof(claim.value -> 'evidence') is distinct from 'array'"
    );
    expect(commit).toContain(
      "jsonb_typeof(item.value -> 'competing_claims') is distinct from 'array'"
    );
    expect(commit).toContain("link.relationship is null");
  });

  it("allows only append-only redaction overlays and forbids direct client writes", () => {
    const compact = compactSql();

    expect(compact).toMatch(
      /job_conversation_redaction_events[\s\S]*?target_turn_id uuid not null[\s\S]*?redaction_kind text not null[\s\S]*?reason text not null/
    );
    expect(compact).toMatch(
      /create trigger job_conversation_redaction_events_immutable[\s\S]*?before update or delete on public\.job_conversation_redaction_events/
    );

    for (const table of MEMORY_TABLES) {
      expect(compact).toContain(
        `revoke insert, update, delete on table public.${table} from anon, authenticated, service_role`
      );
    }

    expect(compact).toMatch(
      /create trigger job_conversations_delete_guard[\s\S]*?before delete on public\.job_conversations/
    );
  });

  it("intersects company tenancy with current job visibility for every read", () => {
    const compact = compactSql();
    const visibility = functionBody(
      compact,
      "private.current_user_can_view_job_conversation"
    );

    expect(visibility).toContain("private.get_user_company_id()");
    expect(visibility).toContain("private.current_user_can_view_opportunity(");
    expect(visibility).toContain(
      "private.current_user_can_view_project_scoped("
    );

    for (const table of MEMORY_TABLES) {
      expect(compact).toMatch(
        new RegExp(
          `create policy ${table}_company_select on public\\.${table}[\\s\\S]*?for select[\\s\\S]*?company_id = \\(select private\\.get_user_company_id\\(\\)\\)`
        )
      );
      const jobScope = policyBody(compact, `${table}_job_scope_select`);
      const scopedColumn =
        table === "job_conversations" ? "id" : "conversation_id";
      expect(jobScope).toContain("as restrictive for select to authenticated");
      expect(jobScope).toContain(
        `private.current_user_can_view_job_conversation(${scopedColumn})`
      );
    }
  });

  it("resolves conversion-linked anchors and inserts turns only through a service-only guarded function", () => {
    const compact = compactSql();
    const anchorGuard = functionBody(
      compact,
      "private.enforce_job_conversation_anchor_company"
    );
    const ingest = functionBody(
      compact,
      "public.ingest_job_conversation_turn_as_system"
    );

    expect(anchorGuard).toMatch(
      /from public\.projects project[\s\S]*?project\.id = v_linked_project_id[\s\S]*?project\.company_id = new\.company_id[\s\S]*?project\.opportunity_ref = new\.opportunity_id[\s\S]*?project\.opportunity_id[\s\S]*?new\.opportunity_id::text/
    );
    expect(anchorGuard).toMatch(
      /from public\.opportunities opportunity[\s\S]*?opportunity\.id = v_linked_opportunity_id[\s\S]*?opportunity\.company_id = new\.company_id[\s\S]*?opportunity\.project_ref = new\.project_id[\s\S]*?opportunity\.project_id = new\.project_id/
    );
    expect(ingest).toContain("auth.role()");
    expect(ingest).toContain("'service_role'");
    expect(ingest).toContain("pg_advisory_xact_lock");
    expect(ingest).toContain("from public.opportunities");
    expect(ingest).toContain("from public.projects");
    expect(ingest).toContain("opportunity_ref");
    expect(ingest).toContain("project_ref");
    expect(ingest).toContain(
      "opportunity.project_ref is distinct from opportunity.project_id"
    );
    expect(ingest).toContain(
      "nullif(btrim(project.opportunity_id), '') is distinct from project.opportunity_ref::text"
    );
    expect(ingest).toContain(
      "on conflict (company_id, anchor_kind, source_id)"
    );
    expect(ingest).toContain("insert into public.job_conversation_turns");
    expect(ingest).toContain(
      "on conflict (company_id, source_connection_id, provider_message_id)"
    );
    expect(compact).toMatch(
      /revoke all on function public\.ingest_job_conversation_turn_as_system\([\s\S]*?from public, anon, authenticated, service_role/
    );
    expect(compact).toMatch(
      /grant execute on function public\.ingest_job_conversation_turn_as_system\([\s\S]*?to service_role/
    );
    for (const nullableInput of [
      "p_job_kind",
      "p_provider_delivery_source_id",
      "p_provider_delivery_source_sha256",
    ]) {
      expect(ingest).toContain(`${nullableInput} is null`);
    }
  });

  it("keeps account export and deletion complete before the tables can ship", () => {
    const compact = compactSql();
    const purge = functionBody(compact, "public.purge_company_rows");
    const manifest = sourceFile("src/lib/data/company-data-manifest.ts");
    const scopeSnapshot = sourceFile(
      "src/lib/data/company-data-scope-snapshot.ts"
    );

    expect(purge).toContain("security definer");
    expect(purge).toContain("set search_path = pg_catalog, pg_temp");
    expect(purge).toContain(
      "set_config( 'ops.company_data_purge_company_id', p_company_id::text, true )"
    );
    expect(purge).toContain("v_previous_purge_company_id");

    for (const table of MEMORY_TABLES) {
      expect(purge, `${table} absent from final purge allowlist`).toContain(
        `'${table}'`
      );
      expect(manifest, `${table} absent from account manifest`).toMatch(
        new RegExp(
          `table: "${table}"[\\s\\S]*?deletestrategy: "hard"[\\s\\S]*?export: true`
        )
      );
      expect(scopeSnapshot).toContain(`"${table}"`);
    }

    expect(compact).toMatch(
      /revoke all on function public\.purge_company_rows\(text, uuid\)[\s\S]*?from public, anon, authenticated, service_role/
    );
    expect(compact).toMatch(
      /grant execute on function public\.purge_company_rows\(text, uuid\)[\s\S]*?to service_role/
    );
  });

  it("creates indexes for every foreign key and primary read path", () => {
    const compact = compactSql()
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .replace(/,\s+/g, ", ");

    for (const indexFragment of [
      "job_conversation_anchors_conversation_idx on public.job_conversation_anchors (company_id, conversation_id)",
      "job_conversation_turns_conversation_delivered_idx on public.job_conversation_turns (company_id, conversation_id, delivered_at desc, id desc)",
      "job_conversation_turns_conversation_sequence_idx on public.job_conversation_turns (company_id, conversation_id, turn_sequence)",
      "job_conversation_turns_activity_idx on public.job_conversation_turns (source_activity_id)",
      "job_conversation_turns_correspondence_idx on public.job_conversation_turns (source_correspondence_event_id)",
      "job_memory_versions_conversation_idx on public.job_memory_versions (company_id, conversation_id, version_number desc)",
      "job_memory_versions_predecessor_idx on public.job_memory_versions (predecessor_version_id)",
      "job_memory_versions_watermark_idx on public.job_memory_versions (turn_high_watermark_id)",
      "job_memory_version_evidence_version_idx on public.job_memory_version_evidence (company_id, conversation_id, memory_version_id)",
      "job_conversation_redactions_conversation_idx on public.job_conversation_redaction_events (company_id, conversation_id, created_at desc, id desc)",
      "job_conversation_redactions_turn_idx on public.job_conversation_redaction_events (target_turn_id, created_at desc)",
    ]) {
      expect(compact).toContain(indexFragment);
    }
  });
});

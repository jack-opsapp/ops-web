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

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`create or replace function ${name}(`);
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
      /participant_resolution_status = 'resolved'[\s\S]*?side is not null[\s\S]*?participant_resolution_status in \('unresolved', 'ambiguous'\)[\s\S]*?side is null/
    );
    expect(compact).toMatch(
      /source_connection_id uuid not null[\s\S]*?references public\.email_connections\(id\)/
    );
    expect(compact).toContain("source_activity_id uuid");
    expect(compact).toContain("source_correspondence_event_id uuid");
    expect(compact).toContain("provider_message_id text not null");
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
  });

  it("never guesses an ambiguous participant into a chat side", () => {
    const compact = compactSql();
    const ingest = functionBody(
      compact,
      "public.ingest_job_conversation_turn_as_system"
    );

    expect(ingest).toContain("p_participant_resolution_status text");
    expect(ingest).toContain("p_participant_resolution_status is null");
    expect(ingest).toMatch(
      /p_participant_resolution_status not in \(\s*'resolved',\s*'unresolved',\s*'ambiguous'\s*\)/
    );
    expect(ingest).toMatch(
      /p_participant_resolution_status = 'resolved'[\s\S]*?p_side is null/
    );
    expect(ingest).toMatch(
      /p_participant_resolution_status in \('unresolved', 'ambiguous'\)[\s\S]*?p_side is not null/
    );
    expect(ingest).toContain(
      "v_existing_turn.participant_resolution_status is distinct from p_participant_resolution_status"
    );
  });

  it("uses the control-plane canonical SHA-256 representation everywhere", () => {
    const compact = compactSql();
    const ingest = functionBody(
      compact,
      "public.ingest_job_conversation_turn_as_system"
    );

    expect(compact.match(/\^sha256:\[0-9a-f\]\{64\}\$/g)).toHaveLength(4);
    expect(compact).not.toMatch(/~ '\^\[0-9a-f\]\{64\}\$'/);
    expect(ingest).toContain(
      "p_original_content_hash !~ '^sha256:[0-9a-f]{64}$'"
    );
    expect(ingest).toContain(
      "v_existing_turn.original_content_hash is distinct from p_original_content_hash"
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
      "p_side",
      "p_participant_resolution_status",
      "p_direction",
      "p_channel",
      "p_original_content_hash",
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

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_NAME =
  "20260822015049_agent_discovery_reads_20260820220000.sql";
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  MIGRATION_NAME
);
const MANIFEST_V7 = "2026-08-20.capability-manifest.v7";
const MANIFEST_V6 = "2026-08-14.capability-manifest.v6";
const DISCOVERY_SCHEMA_REVISION = "2026-08-20.v1";

function rawSource(): string {
  try {
    return readFileSync(MIGRATION_PATH, "utf8");
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

function count(value: string, expression: RegExp): number {
  return value.match(expression)?.length ?? 0;
}

const RAW_SQL = rawSource();
const SQL = RAW_SQL.toLowerCase();
const COMPACT_SQL = compact(SQL);
const CUSTOMER_RPC = compact(
  functionDefinition(SQL, "public.read_agent_customer_discovery_as_system")
);
const JOB_RPC = compact(
  functionDefinition(SQL, "public.read_agent_job_discovery_as_system")
);
const TEXT_NORMALIZER = compact(
  functionDefinition(SQL, "private.agent_normalize_discovery_text")
);
const DISPLAY_TRIMMER = compact(
  functionDefinition(SQL, "private.agent_trim_discovery_display_text")
);
const UNICODE15_GATE = compact(
  functionDefinition(SQL, "private.agent_discovery_unicode15_text_is_supported")
);
const QUERY_VALIDATOR = compact(
  functionDefinition(SQL, "private.agent_discovery_query_is_valid")
);
const EMAIL_NORMALIZER = compact(
  functionDefinition(SQL, "private.agent_normalize_discovery_email")
);
const PHONE_NORMALIZER = compact(
  functionDefinition(SQL, "private.agent_normalize_discovery_phone")
);
const PREFIX_UPPER_BOUND = compact(
  functionDefinition(SQL, "private.agent_discovery_prefix_upper_bound")
);
const OPPORTUNITY_SOURCE_VALIDATOR = compact(
  functionDefinition(
    SQL,
    "private.agent_discovery_opportunity_source_is_invalid"
  )
);
const PROJECT_SOURCE_VALIDATOR = compact(
  functionDefinition(SQL, "private.agent_discovery_project_source_is_invalid")
);
const REPROOF = compact(
  functionDefinition(SQL, "private.reprove_agent_read_jsonb_for_manifest")
);
const PROOF_HASH_REPLACER = compact(
  functionDefinition(SQL, "private.agent_replace_agent_proof_hash")
);

const ACTIVE_JSON_READERS = [
  "read_agent_job_conversation_context_as_system",
  "read_agent_scheduled_jobs_as_system",
  "read_agent_job_readiness_issues_as_system",
  "read_agent_job_communication_context_as_system",
  "read_agent_job_participants_as_system",
  "read_agent_customer_jobs_as_system",
  "read_agent_job_summary_as_system",
  "read_agent_job_history_as_system",
  "read_agent_correspondence_evidence_page_as_system",
] as const;

const ACTIVE_JSON_WRAPPERS = Object.fromEntries(
  ACTIVE_JSON_READERS.map((name) => [
    name,
    compact(functionDefinition(SQL, `public.${name}`)),
  ])
) as Record<(typeof ACTIVE_JSON_READERS)[number], string>;

const CUSTOMER_SIGNATURE =
  "public.read_agent_customer_discovery_as_system( p_request_id text, p_actor_user_id uuid, p_company_id uuid, p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_id text, p_capability_revision text, p_capability_manifest_revision text, p_capability_schema_revision text, p_ranking_revision text, p_required_oauth_scopes text[], p_clients_scope text, p_lookup text, p_query text, p_customer_kinds text[], p_read_as_of timestamptz, p_cursor_source_revision bigint, p_cursor_rank_ordinal integer, p_cursor_customer_kind text, p_cursor_customer_id uuid, p_limit integer ) returns jsonb";
const JOB_SIGNATURE =
  "public.read_agent_job_discovery_as_system( p_request_id text, p_actor_user_id uuid, p_company_id uuid, p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_id text, p_capability_revision text, p_capability_manifest_revision text, p_capability_schema_revision text, p_ranking_revision text, p_required_oauth_scopes text[], p_pipeline_scope text, p_projects_scope text, p_query text, p_query_fields text[], p_job_kinds text[], p_lifecycle_states text[], p_opportunity_stages text[], p_project_statuses text[], p_date_field text, p_date_from timestamptz, p_date_to_exclusive timestamptz, p_read_as_of timestamptz, p_cursor_source_revision bigint, p_cursor_rank_ordinal integer, p_cursor_job_kind text, p_cursor_job_id uuid, p_limit integer ) returns jsonb";
const CUSTOMER_TYPE_SIGNATURE =
  "text, uuid, uuid, text, text[], text, text, text, text, text, text[], text, text, text, text[], timestamptz, bigint, integer, text, uuid, integer";
const JOB_TYPE_SIGNATURE =
  "text, uuid, uuid, text, text[], text, text, text, text, text, text[], text, text, text, text[], text[], text[], text[], text[], text, timestamptz, timestamptz, timestamptz, bigint, integer, text, uuid, integer";

describe("MCP discovery read migration", () => {
  it("ships as one guarded transaction with explicit current prerequisites", () => {
    expect(
      SQL,
      `${MIGRATION_NAME} is intentionally RED until implemented`
    ).not.toBe("");
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(COMPACT_SQL).toContain(
      "remove v6 acceptance only in a later migration after every v6 application"
    );
    expect(COMPACT_SQL).toContain(
      "instance, background job, prepared call, and signed cursor is drained"
    );
    expect(COMPACT_SQL).toContain(
      "private v6 cores must remain while any v7 wrapper still delegates to them"
    );
    expect(SQL).toContain("do $prerequisites$");
    for (const prerequisite of [
      "private.resolve_agent_actor_authority(uuid,uuid,text[])",
      "private.agent_user_can_access_entity(uuid,uuid,text,uuid,text)",
      "private.resolve_opportunity_client_id(uuid,uuid)",
      "private.canonical_agent_projection_json(jsonb)",
      "private.agent_rfc3339_utc(timestamp with time zone)",
      "private.agent_uuid_from_legacy_text(text)",
      "private.reprove_agent_read_jsonb_for_manifest(jsonb,text)",
      "public.read_agent_phase_c_job_conversation_context_as_system",
      "private.agent_operational_read_revisions",
      "public.clients",
      "public.sub_clients",
      "public.opportunities",
      "public.projects",
      "public.project_tasks",
      "public.project_notes",
    ]) {
      expect(SQL).toContain(prerequisite);
    }
  });

  it("installs pg_trgm without a version pin and defines immutable strict normalizers", () => {
    expect(COMPACT_SQL).toContain(
      "create extension if not exists pg_trgm with schema extensions;"
    );
    expect(COMPACT_SQL).not.toMatch(
      /create extension[^;]*pg_trgm[^;]*\bversion\b/
    );

    expect(TEXT_NORMALIZER).toContain("language plpgsql immutable strict");
    expect(UNICODE15_GATE).toContain("language sql immutable strict");
    expect(UNICODE15_GATE).toContain("int4multirange");
    expect(UNICODE15_GATE).toContain("ascii(substr(p_value");
    expect(RAW_SQL).toContain(
      "7570877e0fa197c45338f7c41a02636da4e14c8dba6a3611a01cd30bf329d5ca"
    );
    expect(RAW_SQL).toContain(
      "e05c0a2811d113dae4abd832884199a3ea8d187ee1b872d8240a788a96540bfd"
    );
    expect(RAW_SQL).toContain(
      "42e74e70413868b4af535c138449f39f64cb39c73a7cd0d2e70b674e18d4f365"
    );
    expect(RAW_SQL).toContain("707 scalar ranges");
    expect(UNICODE15_GATE).toContain("[64975,64976),[65008,65050)");
    expect(UNICODE15_GATE).toContain("[983040,1048574)");
    expect(UNICODE15_GATE).toContain("[1048576,1114110)");
    expect(TEXT_NORMALIZER).toContain(
      "not private.agent_discovery_unicode15_text_is_supported(p_value)"
    );
    expect(TEXT_NORMALIZER).toContain("normalize(p_value, nfkc)");
    expect(COMPACT_SQL).toContain(
      "from pg_catalog.pg_collation where collname = 'und-x-icu' and collprovider = 'i' and collisdeterministic"
    );
    expect(TEXT_NORMALIZER).toContain('collate "und-x-icu"');
    expect(TEXT_NORMALIZER).toContain(
      'lower(private.agent_trim_discovery_display_text( regexp_replace( normalize(p_value, nfkc) collate "und-x-icu"'
    );
    expect(TEXT_NORMALIZER).toContain("regexp_replace(");
    expect(TEXT_NORMALIZER).toContain("'[[:space:]]+'");
    expect(TEXT_NORMALIZER).toContain(
      "private.agent_trim_discovery_display_text( regexp_replace( normalize(p_value, nfkc)"
    );
    expect(TEXT_NORMALIZER).toContain("lower(");
    expect(TEXT_NORMALIZER).toContain("chr(1564)");
    expect(TEXT_NORMALIZER).toContain("chr(8206)");
    expect(TEXT_NORMALIZER).toContain("chr(8207)");
    expect(TEXT_NORMALIZER).toContain("chr(8234)");
    expect(TEXT_NORMALIZER).toContain("chr(8297)");
    expect(TEXT_NORMALIZER).toContain("chr(65279)");

    expect(QUERY_VALIDATOR).toContain("language plpgsql immutable strict");
    expect(QUERY_VALIDATOR).toContain(
      "private.agent_normalize_discovery_text(p_value)"
    );
    expect(QUERY_VALIDATOR).toContain(
      "char_length(p_value) not between 2 and 200"
    );
    expect(QUERY_VALIDATOR).toContain("cardinality(v_tokens) > 8");
    expect(QUERY_VALIDATOR).toContain(
      "char_length(token.value) not between 2 and 64"
    );

    expect(EMAIL_NORMALIZER).toContain("language plpgsql immutable strict");
    expect(EMAIL_NORMALIZER).toContain("return null");
    expect(EMAIL_NORMALIZER).toContain("@");
    expect(EMAIL_NORMALIZER).toContain(
      "char_length(v_value) not between 3 and 200"
    );
    expect(EMAIL_NORMALIZER).toContain(
      "octet_length(split_part(v_value, '@', 1)) > 64"
    );
    expect(EMAIL_NORMALIZER).toContain(
      "position('@' in v_value) not between 2 and 65"
    );
    expect(EMAIL_NORMALIZER).toContain(
      "^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(?:[.][a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@"
    );
    expect(EMAIL_NORMALIZER).not.toContain("similarity(");
    expect(PHONE_NORMALIZER).toContain("language plpgsql immutable strict");
    expect(PHONE_NORMALIZER).toContain("'+1'");
    expect(PHONE_NORMALIZER).toContain("'^[2-9][0-9]{2}[2-9][0-9]{6}$'");
    expect(PHONE_NORMALIZER).not.toContain("right(");
    expect(PREFIX_UPPER_BOUND).toContain("language plpgsql immutable strict");
    expect(PREFIX_UPPER_BOUND).toContain("v_last_scalar >= 1114111");
    expect(PREFIX_UPPER_BOUND).toContain("v_last_scalar = 55295");
    expect(PREFIX_UPPER_BOUND).toContain("v_last_scalar := 57344");
    expect(DISPLAY_TRIMMER).toContain("language sql immutable strict");
    for (const codePoint of [
      9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8202, 8232, 8233, 8239, 8287,
      12288, 65279,
    ]) {
      expect(DISPLAY_TRIMMER).toContain(`chr(${codePoint})`);
    }
  });

  it("uses the installed pg_trgm operator-class schema instead of assuming extensions", () => {
    expect(COMPACT_SQL).toContain("pg_catalog.pg_extension");
    expect(COMPACT_SQL).toContain("pg_catalog.pg_opclass");
    expect(COMPACT_SQL).toContain("set_config(");
    expect(COMPACT_SQL).not.toContain("extensions.gin_trgm_ops");
    expect(count(COMPACT_SQL, /\) gin_trgm_ops/g)).toBe(6);
  });

  it("canonicalizes every proof-bearing display edge without changing interiors", () => {
    for (const expression of [
      "ranked.display_name",
      "ranked.parent_display_name",
    ]) {
      expect(CUSTOMER_RPC).toMatch(
        new RegExp(
          `private\\.agent_trim_discovery_display_text\\( ${expression.replace(".", "\\.")} \\)`
        )
      );
    }
    for (const expression of [
      "opportunity.title",
      "opportunity.address",
      "project.title",
      "project.address",
      "ranked.title",
      "ranked.address",
    ]) {
      expect(JOB_RPC).toMatch(
        new RegExp(
          `private\\.agent_trim_discovery_display_text\\( ${expression.replace(".", "\\.")} \\)`
        )
      );
    }
    for (const expression of [
      "client.name",
      "sub_client.name",
      "parent.name",
    ]) {
      expect(CUSTOMER_RPC).toMatch(
        new RegExp(
          `octet_length\\( private\\.agent_trim_discovery_display_text\\(${expression.replace(".", "\\.")}\\) \\) > 1000`
        )
      );
    }
    for (const expression of ["opportunity.title", "project.title"]) {
      const validator = expression.startsWith("opportunity")
        ? OPPORTUNITY_SOURCE_VALIDATOR
        : PROJECT_SOURCE_VALIDATOR;
      expect(validator).toContain(
        "octet_length( private.agent_trim_discovery_display_text(p_title) ) > 1000"
      );
    }
    for (const expression of ["opportunity.address", "project.address"]) {
      const validator = expression.startsWith("opportunity")
        ? OPPORTUNITY_SOURCE_VALIDATOR
        : PROJECT_SOURCE_VALIDATOR;
      expect(validator).toContain(
        "octet_length( private.agent_trim_discovery_display_text(p_address) ) > 2000"
      );
    }
  });

  it("creates active exact-prefix and trigram indexes without indexing retired rows", () => {
    for (const sourceName of [
      "clients",
      "sub_clients",
      "opportunities",
      "projects",
    ]) {
      expect(COMPACT_SQL).toMatch(
        new RegExp(
          `create index if not exists ${sourceName}_agent_discovery_[a-z0-9_]+_prefix_idx[\\s\\S]*?left\\(private\\.agent_normalize_discovery_text\\([^)]*\\), 200\\) collate "c"`
        )
      );
      expect(COMPACT_SQL).toMatch(
        new RegExp(
          `create index if not exists ${sourceName}_agent_discovery_[a-z0-9_]+_trgm_idx[\\s\\S]*?using gin[\\s\\S]*?gin_trgm_ops`
        )
      );
    }
    expect(COMPACT_SQL).toMatch(
      /clients_agent_discovery_name_prefix_idx[\s\S]*?where deleted_at is null[\s\S]*?merged_into_client_id is null/
    );
    expect(COMPACT_SQL).toMatch(
      /sub_clients_agent_discovery_name_prefix_idx[\s\S]*?where deleted_at is null/
    );
    expect(COMPACT_SQL).toMatch(
      /opportunities_agent_discovery_title_prefix_idx[\s\S]*?where deleted_at is null[\s\S]*?merged_into_opportunity_id is null/
    );
    expect(COMPACT_SQL).toMatch(
      /projects_agent_discovery_title_prefix_idx[\s\S]*?where deleted_at is null/
    );
    for (const contactIndex of [
      "clients_agent_discovery_exact_email_idx",
      "clients_agent_discovery_exact_phone_idx",
      "sub_clients_agent_discovery_exact_email_idx",
      "sub_clients_agent_discovery_exact_phone_idx",
    ]) {
      expect(COMPACT_SQL).toContain(
        `create index if not exists ${contactIndex}`
      );
    }
    expect(COMPACT_SQL).toContain(
      "opportunities_agent_discovery_created_keyset_idx"
    );
    expect(COMPACT_SQL).toContain(
      "opportunities_agent_discovery_updated_keyset_idx"
    );
    expect(COMPACT_SQL).toContain(
      "projects_agent_discovery_created_keyset_idx"
    );
    expect(COMPACT_SQL).toContain(
      "projects_agent_discovery_updated_keyset_idx"
    );
    for (const index of [
      "opportunities_agent_discovery_updated_stage_archive_idx",
      "opportunities_agent_discovery_invalid_stage_updated_idx",
      "projects_agent_discovery_updated_status_idx",
      "projects_agent_discovery_invalid_status_updated_idx",
    ]) {
      expect(COMPACT_SQL).toContain(`create index if not exists ${index}`);
    }
    for (const source of ["opportunities", "projects"]) {
      for (const field of ["created_at", "updated_at"]) {
        expect(COMPACT_SQL).toMatch(
          new RegExp(
            `${source}_agent_discovery_${field.replace("_at", "")}_keyset_idx on public\\.${source} \\( company_id, date_trunc\\('milliseconds', ${field}, 'utc'\\) desc nulls last, id asc \\)`
          )
        );
      }
    }
    expect(COMPACT_SQL).not.toContain("text_pattern_ops");
    for (const [source, field] of [
      ["clients", "email"],
      ["clients", "phone"],
      ["sub_clients", "email"],
      ["sub_clients", "phone"],
    ] as const) {
      expect(COMPACT_SQL).toMatch(
        new RegExp(
          `${source}_agent_discovery_exact_${field}_idx[\\s\\S]*?agent_normalize_discovery_${field}\\([^)]*\\)[\\s\\S]*?id asc`
        )
      );
      const start = COMPACT_SQL.indexOf(
        `create index if not exists ${source}_agent_discovery_exact_${field}_idx`
      );
      const end = COMPACT_SQL.indexOf(";", start);
      expect(COMPACT_SQL.slice(start, end)).toContain(
        'left(private.agent_normalize_discovery_text(name), 200) collate "c"'
      );
    }
    for (const index of [
      "clients_agent_discovery_invalid_source_idx",
      "sub_clients_agent_discovery_invalid_source_idx",
      "opportunities_agent_discovery_invalid_source_idx",
      "projects_agent_discovery_invalid_source_idx",
    ]) {
      expect(COMPACT_SQL).toContain(`create index if not exists ${index}`);
    }
  });

  it("correlates assigned grants to bounded source searches without materializing every grant", () => {
    expect(COMPACT_SQL).toContain(
      "project_tasks_agent_discovery_team_members_idx"
    );
    expect(COMPACT_SQL).toContain("project_notes_agent_discovery_mentions_idx");
    expect(COMPACT_SQL).toContain("project_tasks_agent_discovery_project_idx");
    expect(COMPACT_SQL).toContain("project_notes_agent_discovery_project_idx");
    expect(COMPACT_SQL).toContain("projects_agent_discovery_client_idx");
    expect(COMPACT_SQL).toContain(
      "opportunities_agent_discovery_assigned_title_prefix_idx"
    );
    expect(COMPACT_SQL).toContain(
      "opportunities_agent_discovery_assigned_address_prefix_idx"
    );
    expect(COMPACT_SQL).toContain(
      "opportunities_agent_discovery_assigned_created_keyset_idx"
    );
    expect(COMPACT_SQL).toContain(
      "opportunities_agent_discovery_assigned_updated_keyset_idx"
    );
    expect(CUSTOMER_RPC).not.toContain("assigned_client_access");
    expect(CUSTOMER_RPC).toContain(
      "task.team_member_ids @> array[p_actor_user_id::text]"
    );
    expect(CUSTOMER_RPC).toContain(
      "and project.client_id = candidate.customer_id"
    );
    expect(JOB_RPC).toContain("task.project_id = candidate.raw_job_id");
    expect(JOB_RPC).toContain(
      "task.team_member_ids @> array[p_actor_user_id::text]"
    );
    expect(JOB_RPC).toContain(
      "note.mentioned_user_ids @> array[p_actor_user_id::text]"
    );
    expect(JOB_RPC).toContain(
      "private.agent_uuid_from_legacy_text(note.project_id) = candidate.raw_job_id"
    );
    expect(JOB_RPC).toContain("candidate.assigned_to = p_actor_user_id");
    expect(JOB_RPC).not.toContain("assigned_project_access");
    for (const rpc of [CUSTOMER_RPC, JOB_RPC]) {
      expect(rpc).toContain("private.agent_user_can_access_entity(");
    }
  });

  it("preserves every active v6 read behind exact v6-or-v7 cutover wrappers", () => {
    expect(REPROOF).toContain(`'${MANIFEST_V7}'`);
    expect(REPROOF).toContain(`'${MANIFEST_V6}'`);
    expect(REPROOF).toContain("private.canonical_agent_projection_json(");
    expect(REPROOF).toContain("extensions.digest(");
    expect(REPROOF).toContain("'source_content_hash'");
    expect(REPROOF).toContain("private.agent_replace_agent_proof_hash(");
    expect(REPROOF).not.toContain("private.agent_replace_jsonb_text(");
    expect(PROOF_HASH_REPLACER).toContain(
      "jsonb_typeof(p_value -> 'projection') = 'object'"
    );
    expect(PROOF_HASH_REPLACER).toContain(
      "p_value ->> 'source_content_hash' = p_from"
    );
    expect(PROOF_HASH_REPLACER).toContain(
      "jsonb_typeof(p_value -> 'source_domain') = 'string'"
    );
    expect(PROOF_HASH_REPLACER).toContain(
      "right(v_version, char_length(p_from)) = p_from"
    );
    expect(PROOF_HASH_REPLACER).not.toContain(
      "replace(p_value #>> '{}', p_from, p_to)"
    );

    for (const name of ACTIVE_JSON_READERS) {
      const wrapper = ACTIVE_JSON_WRAPPERS[name];
      expect(wrapper, `${name} needs a current wrapper`).not.toBe("");
      expect(wrapper).toContain("auth.role() is distinct from 'service_role'");
      expect(wrapper).toContain("p_capability_manifest_revision is null or");
      expect(wrapper).toContain(
        `p_capability_manifest_revision not in ( '${MANIFEST_V6}', '${MANIFEST_V7}' )`
      );
      expect(wrapper).toContain(`v_v6_result := private.${name}_v6_core(`);
      expect(wrapper).toContain(
        `if p_capability_manifest_revision = '${MANIFEST_V6}' then return v_v6_result; end if;`
      );
      expect(wrapper).toContain(
        `return private.reprove_agent_read_jsonb_for_manifest( v_v6_result, '${MANIFEST_V7}' );`
      );
      expect(wrapper).toContain(`'${MANIFEST_V6}'`);
      expect(wrapper).not.toMatch(
        /p_capability_manifest_revision\s*=>\s*p_capability_manifest_revision/
      );
      expect(COMPACT_SQL).toMatch(
        new RegExp(
          `alter function public\\.${name}\\([\\s\\S]*?rename to ${name}_v6_core;`
        )
      );
      expect(COMPACT_SQL).toMatch(
        new RegExp(
          `revoke all on function private\\.${name}_v6_core\\([\\s\\S]*?from public, anon, authenticated, service_role;`
        )
      );
    }
  });

  it("keeps the active raw evidence helper operational for exact v6 or v7 callers", () => {
    const wrapper = compact(
      functionDefinition(
        SQL,
        "public.read_agent_correspondence_evidence_as_system"
      )
    );
    expect(wrapper).toContain(
      "p_capability_id is distinct from 'get_correspondence_evidence'"
    );
    expect(wrapper).toContain(
      "p_capability_revision is distinct from 'get_correspondence_evidence:2026-08-14.v1'"
    );
    expect(wrapper).toContain("p_capability_manifest_revision is null or");
    expect(wrapper).toContain(
      `p_capability_manifest_revision not in ( '${MANIFEST_V6}', '${MANIFEST_V7}' )`
    );
    expect(wrapper).toContain(
      "private.read_agent_correspondence_evidence_as_system_v6_core("
    );
    expect(wrapper).toContain(`'${MANIFEST_V6}'`);
    expect(wrapper).not.toContain(
      "private.reprove_agent_read_jsonb_for_manifest("
    );
  });

  it("keeps the Phase C route and source fence in the same dual-manifest context statement", () => {
    const wrapper = compact(
      functionDefinition(
        SQL,
        "public.read_agent_phase_c_job_conversation_context_as_system"
      )
    );
    const corePatch = compact(
      functionDefinition(SQL, "pg_temp.agent_bridge_phase_c_v6_core")
    );
    expect(wrapper).toContain("p_capability_manifest_revision is null or");
    expect(wrapper).toContain(
      `p_capability_manifest_revision not in ( '${MANIFEST_V6}', '${MANIFEST_V7}' )`
    );
    expect(wrapper).toContain(
      "v_v6_result := private.read_agent_phase_c_job_conversation_context_as_system_v6_core("
    );
    expect(wrapper).toContain(`'${MANIFEST_V6}'`);
    expect(wrapper).toContain(
      `if p_capability_manifest_revision = '${MANIFEST_V6}' then return v_v6_result; end if;`
    );
    expect(wrapper).toContain(
      `return private.reprove_agent_read_jsonb_for_manifest( v_v6_result, '${MANIFEST_V7}' );`
    );
    expect(corePatch).toContain("pg_get_functiondef(");
    expect(corePatch).toContain(
      "private.read_agent_job_conversation_context_as_system_v6_core("
    );
    expect(corePatch).toContain(
      "v_old text := 'public.read_agent_job_conversation_context_as_system('"
    );
    expect(corePatch).toContain("if v_count is distinct from 1 then");
  });

  it("freezes two fixed JSONB discovery RPC signatures and service-role ACLs", () => {
    expect(CUSTOMER_RPC).toContain(CUSTOMER_SIGNATURE);
    expect(JOB_RPC).toContain(JOB_SIGNATURE);
    for (const [name, rpc] of [
      ["read_agent_customer_discovery_as_system", CUSTOMER_RPC],
      ["read_agent_job_discovery_as_system", JOB_RPC],
    ] as const) {
      expect(rpc).toContain(
        "language plpgsql stable security definer set search_path = pg_catalog, public, private, extensions, pg_temp"
      );
      expect(rpc).toContain("set plan_cache_mode = force_custom_plan");
      expect(rpc).toContain("auth.role() is distinct from 'service_role'");
      expect(rpc).toContain(
        `p_capability_manifest_revision is distinct from '${MANIFEST_V7}'`
      );
      expect(rpc).not.toContain(`'${MANIFEST_V6}'`);
      expect(COMPACT_SQL).toMatch(
        new RegExp(
          `revoke all on function public\\.${name}\\([\\s\\S]*?from public, anon, authenticated, service_role;`
        )
      );
      expect(COMPACT_SQL).toMatch(
        new RegExp(
          `grant execute on function public\\.${name}\\([\\s\\S]*?to service_role;`
        )
      );
      expect(COMPACT_SQL).not.toMatch(
        new RegExp(
          `grant execute on function public\\.${name}\\([\\s\\S]*?to (?:anon|authenticated);`
        )
      );
    }
    expect(COMPACT_SQL).toContain(
      `revoke all on function public.read_agent_customer_discovery_as_system( ${CUSTOMER_TYPE_SIGNATURE} ) from public, anon, authenticated, service_role;`
    );
    expect(COMPACT_SQL).toContain(
      `grant execute on function public.read_agent_customer_discovery_as_system( ${CUSTOMER_TYPE_SIGNATURE} ) to service_role;`
    );
    expect(COMPACT_SQL).toContain(
      `revoke all on function public.read_agent_job_discovery_as_system( ${JOB_TYPE_SIGNATURE} ) from public, anon, authenticated, service_role;`
    );
    expect(COMPACT_SQL).toContain(
      `grant execute on function public.read_agent_job_discovery_as_system( ${JOB_TYPE_SIGNATURE} ) to service_role;`
    );
  });

  it("reproves current actor, permissions, company, source revision, and database clock in each search", () => {
    for (const rpc of [CUSTOMER_RPC, JOB_RPC]) {
      expect(rpc).toContain("with current_authority as materialized");
      expect(rpc).toContain(
        "private.resolve_agent_actor_authority( p_actor_user_id, p_company_id, p_registered_permission_keys )"
      );
      expect(rpc).toContain(
        "authority.permission_snapshot_revision = p_permission_snapshot_revision"
      );
      expect(rpc).toContain("private.agent_operational_read_revisions");
      expect(rpc).toContain(
        "date_trunc('milliseconds', statement_timestamp())"
      );
      expect(rpc).toContain("company.deleted_at is null");
      expect(rpc).toContain("private.agent_user_can_access_entity(");
      expect(rpc).toContain("p_cursor_source_revision");
      expect(rpc).toContain("p_read_as_of");
      expect(rpc).toContain(
        "p_read_as_of is not null and p_read_as_of is distinct from date_trunc('milliseconds', p_read_as_of, 'utc')"
      );
      expect(rpc).toContain(
        "p_read_as_of is not null and not isfinite(p_read_as_of)"
      );
      expect(rpc).toContain("p_permission_snapshot_revision is null");
      expect(rpc).toContain("p_limit is null");
      expect(rpc).not.toContain("clock_timestamp()");
    }
    for (const field of ["p_date_from", "p_date_to_exclusive"]) {
      expect(JOB_RPC).toContain(
        `${field} is not null and not isfinite(${field})`
      );
      expect(JOB_RPC).toContain(
        `${field} is not null and ${field} is distinct from date_trunc('milliseconds', ${field}, 'utc')`
      );
    }
    for (const field of [
      "p_read_as_of",
      "p_date_from",
      "p_date_to_exclusive",
    ]) {
      const rpc =
        field === "p_read_as_of" ? `${CUSTOMER_RPC} ${JOB_RPC}` : JOB_RPC;
      expect(rpc).toContain(`${field} is not null and extract(`);
      expect(rpc).toContain(
        `year from ${field} at time zone 'utc' ) not between 1 and 9999`
      );
    }
  });

  it("pins exact customer lookup authority without disclosing the contact key", () => {
    expect(CUSTOMER_RPC).toContain(
      "p_capability_id is distinct from 'search_customers'"
    );
    expect(CUSTOMER_RPC).toContain(
      `'search_customers:${DISCOVERY_SCHEMA_REVISION}'`
    );
    expect(CUSTOMER_RPC).toContain(`'${MANIFEST_V7}'`);
    expect(CUSTOMER_RPC).toContain(
      "p_clients_scope not in ('all', 'assigned')"
    );
    expect(CUSTOMER_RPC).toContain("p_clients_scope is null");
    expect(CUSTOMER_RPC).toContain("'ops.customers.read'::text");
    expect(CUSTOMER_RPC).toContain("'ops.customer_contacts.read'::text");
    expect(CUSTOMER_RPC).toContain("p_lookup = 'name'");
    expect(CUSTOMER_RPC).toContain(
      "p_lookup in ('exact_email', 'exact_phone')"
    );
    expect(CUSTOMER_RPC).toContain(
      "p_required_oauth_scopes is distinct from v_expected_oauth_scopes"
    );
    expect(CUSTOMER_RPC).toContain("private.agent_normalize_discovery_email(");
    expect(CUSTOMER_RPC).toContain("private.agent_normalize_discovery_phone(");
    expect(CUSTOMER_RPC).toContain(
      "p_lookup = 'name' and private.agent_discovery_query_is_valid(p_query) is not true"
    );
    expect(CUSTOMER_RPC).toContain(
      'private.agent_normalize_discovery_text( parent.name ) collate "c" as parent_name'
    );
    expect(CUSTOMER_RPC).toContain("normalized.parent_name is null");
    expect(CUSTOMER_RPC).not.toMatch(
      /jsonb_build_object\([\s\S]{0,500}'(?:email|phone|phone_number)'/
    );
  });

  it("pins cumulative selected-kind job authority and purpose-minimized sources", () => {
    expect(JOB_RPC).toContain("p_capability_id is distinct from 'search_jobs'");
    expect(JOB_RPC).toContain(`'search_jobs:${DISCOVERY_SCHEMA_REVISION}'`);
    expect(JOB_RPC).toContain(`'${MANIFEST_V7}'`);
    expect(JOB_RPC).toContain("'ops.jobs.read'::text");
    expect(JOB_RPC).toContain(
      "('opportunity' = any(p_job_kinds)) is distinct from (p_pipeline_scope is not null)"
    );
    expect(JOB_RPC).toContain(
      "('project' = any(p_job_kinds)) is distinct from (p_projects_scope is not null)"
    );
    expect(JOB_RPC).toContain(
      "'pipeline.view' = any(p_registered_permission_keys)"
    );
    expect(JOB_RPC).toContain(
      "'projects.view' = any(p_registered_permission_keys)"
    );
    for (const forbidden of [
      "public.ops_contacts",
      "public.contact_messages",
      "public.estimates",
      "public.invoices",
      "public.job_conversation_turns",
      "'description'",
      "'notes'",
      "'contact_email'",
      "'contact_phone'",
    ]) {
      expect(JOB_RPC).not.toContain(forbidden);
    }
  });

  it("hard-bounds authorized candidates before stable ranking and page aggregation", () => {
    for (const rpc of [CUSTOMER_RPC, JOB_RPC]) {
      const candidateGate = rpc.indexOf("candidate_gate as materialized (");
      const candidateLimit = rpc.indexOf("limit 501", candidateGate);
      const rank = rpc.indexOf("row_number() over", candidateLimit);
      const page = rpc.indexOf("page_plus_one as materialized", rank);
      const aggregate = rpc.indexOf("jsonb_agg(", page);
      expect(candidateGate).toBeGreaterThan(0);
      expect(candidateLimit).toBeGreaterThan(candidateGate);
      expect(rank).toBeGreaterThan(candidateLimit);
      expect(page).toBeGreaterThan(rank);
      expect(aggregate).toBeGreaterThan(page);
      expect(rpc).toContain("p_cursor_rank_ordinal not between 1 and 500");
      expect(rpc).toContain("limit 500");
      expect(rpc).toContain("limit p_limit + 1");
      expect(rpc).toContain("p_limit not between 1 and 25");
      expect(rpc).not.toMatch(/\boffset\b/);
      expect(rpc).not.toMatch(/\bselect\s+\*/);
    }
  });

  it("bounds customer source matches before probing assigned authority", () => {
    const clientSource = CUSTOMER_RPC.indexOf(
      "client_inspection_source as not materialized"
    );
    const subClientSource = CUSTOMER_RPC.indexOf(
      "sub_client_inspection_source as not materialized"
    );
    const clientGate = CUSTOMER_RPC.indexOf("client_gate as materialized");
    const subClientGate = CUSTOMER_RPC.indexOf(
      "sub_client_gate as materialized"
    );
    const union = CUSTOMER_RPC.indexOf("inspection_candidate as (");
    const inspectionGate = CUSTOMER_RPC.indexOf(
      "inspection_gate as materialized"
    );
    const inspectionState = CUSTOMER_RPC.indexOf(
      "inspection_state as materialized"
    );
    const authorization = CUSTOMER_RPC.indexOf("authorized_candidate as (");
    const globalGate = CUSTOMER_RPC.indexOf("candidate_gate as materialized");
    expect(clientSource).toBeGreaterThan(0);
    expect(subClientSource).toBeGreaterThan(clientSource);
    expect(clientGate).toBeGreaterThan(subClientSource);
    expect(subClientGate).toBeGreaterThan(clientGate);
    expect(union).toBeGreaterThan(subClientGate);
    expect(inspectionGate).toBeGreaterThan(union);
    expect(inspectionState).toBeGreaterThan(inspectionGate);
    expect(authorization).toBeGreaterThan(inspectionState);
    expect(globalGate).toBeGreaterThan(authorization);
    for (const gate of [
      "client_name_exact_gate",
      "client_name_prefix_gate",
      "client_name_all_tokens_gate",
      "client_email_gate",
      "client_phone_gate",
      "client_gate",
      "sub_client_name_exact_gate",
      "sub_client_name_prefix_gate",
      "sub_client_name_all_tokens_gate",
      "sub_client_email_gate",
      "sub_client_phone_gate",
      "sub_client_gate",
      "inspection_gate",
      "candidate_gate",
    ]) {
      const start = CUSTOMER_RPC.indexOf(`${gate} as materialized (`);
      expect(start, gate).toBeGreaterThan(0);
      expect(CUSTOMER_RPC.indexOf("limit 501", start), gate).toBeGreaterThan(
        start
      );
    }
    expect(CUSTOMER_RPC).toContain("from client_gate client");
    expect(CUSTOMER_RPC).toContain("from sub_client_gate sub_client");
    expect(CUSTOMER_RPC).toContain(
      "join inspection_gate candidate on not state.query_bound"
    );
    expect(CUSTOMER_RPC).toContain(
      "select count(*) = 501 from inspection_gate"
    );
    expect(CUSTOMER_RPC).toContain(
      "else count(candidate.customer_id)::integer end as authorized_candidate_count"
    );
    expect(CUSTOMER_RPC).toContain(
      "filter ( where candidate.customer_id is not null )"
    );
  });

  it("pins stable order to fields the repository can independently rederive", () => {
    const customerOrder =
      'order by candidate.match_tier, candidate.customer_kind, candidate.normalized_name collate "c", candidate.customer_id';
    expect(count(CUSTOMER_RPC, new RegExp(customerOrder, "g"))).toBe(6);

    const jobOrder =
      'order by case when p_query is null then candidate.sort_at end desc nulls last, case when p_query is not null then candidate.match_tier end, case when p_query is not null then candidate.field_rank end, candidate.job_kind, case when p_query is not null then candidate.match_value collate "c" end, candidate.job_id';
    expect(count(JOB_RPC, new RegExp(jobOrder, "g"))).toBe(3);
    expect(
      count(
        JOB_RPC,
        /date_trunc\('milliseconds', case when coalesce\(p_date_field, 'updated_at'\) = 'created_at' then (?:opportunity|project)\.created_at else (?:opportunity|project)\.updated_at end, 'utc'\) as sort_at/g
      )
    ).toBe(2);
    expect(CUSTOMER_RPC).not.toMatch(/customer_id::text\s+collate\s+"c"/);
    expect(JOB_RPC).not.toMatch(/job_id::text\s+collate\s+"c"/);
  });

  it("uses literal exact, prefix, and all-token tiers with two-character protection", () => {
    for (const rpc of [CUSTOMER_RPC, JOB_RPC]) {
      expect(rpc).toContain("private.agent_escape_like_literal(");
      expect(rpc).toContain("escape '\\'");
      expect(rpc).toContain("char_length(short_token.value) < 3");
      expect(rpc).toContain("tokens.values[1]");
      expect(rpc).toContain("coalesce(tokens.values[8], tokens.values[1])");
      expect(rpc).not.toContain("bool_and(");
      expect(rpc).not.toContain("similarity(");
      expect(rpc).not.toContain("soundex(");
      expect(rpc).not.toContain("levenshtein(");
      expect(rpc).not.toContain("websearch_to_tsquery(");
    }
    for (const kind of ["exact_name", "prefix_name", "all_tokens_name"]) {
      expect(CUSTOMER_RPC).toContain(`'${kind}'`);
    }
    for (const kind of [
      "exact_title",
      "exact_address",
      "prefix_title",
      "prefix_address",
      "all_tokens_title",
      "all_tokens_address",
      "filter_only",
    ]) {
      expect(JOB_RPC).toContain(`'${kind}'`);
    }
    expect(CUSTOMER_RPC).toContain('collate "c"');
    expect(JOB_RPC).toContain('collate "c"');
    for (const source of ["client", "sub_client"]) {
      const literalKeyset = CUSTOMER_RPC.indexOf(
        `${source}_name_literal_keyset as materialized (`
      );
      const exactGate = CUSTOMER_RPC.indexOf(
        `${source}_name_exact_gate as materialized (`
      );
      const literalBound = CUSTOMER_RPC.indexOf(
        `${source}_name_literal_keyset_bound as materialized (`
      );
      const prefixGate = CUSTOMER_RPC.indexOf(
        `${source}_name_prefix_gate as materialized (`
      );
      expect(literalKeyset, source).toBeGreaterThan(0);
      expect(literalBound, source).toBeGreaterThan(literalKeyset);
      expect(exactGate, source).toBeGreaterThan(literalBound);
      expect(prefixGate, source).toBeGreaterThan(exactGate);
      const keyset = CUSTOMER_RPC.slice(literalKeyset, literalBound);
      expect(keyset).toContain(
        "private.agent_discovery_prefix_upper_bound(p_query)"
      );
      expect(keyset).toContain("limit 501");
      for (const contact of ["email", "phone"]) {
        const contactKeyset = CUSTOMER_RPC.indexOf(
          `${source}_${contact}_keyset as materialized (`
        );
        const contactGate = CUSTOMER_RPC.indexOf(
          `${source}_${contact}_gate as materialized (`
        );
        const contactBound = CUSTOMER_RPC.indexOf(
          `${source}_${contact}_keyset_bound as materialized (`
        );
        expect(contactKeyset, `${source}_${contact}`).toBeGreaterThan(
          prefixGate
        );
        expect(contactBound, `${source}_${contact}`).toBeGreaterThan(
          contactKeyset
        );
        expect(contactGate, `${source}_${contact}`).toBeGreaterThan(
          contactBound
        );
        expect(
          CUSTOMER_RPC.slice(contactKeyset, contactBound),
          `${source}_${contact}`
        ).toContain("limit 501");
      }
    }
    for (const source of ["opportunity", "project"]) {
      for (const field of ["title", "address"]) {
        const literalKeyset = JOB_RPC.indexOf(
          `${source}_${field}_literal_keyset as materialized (`
        );
        const exactGate = JOB_RPC.indexOf(
          `${source}_exact_${field}_gate as materialized (`
        );
        const literalBound = JOB_RPC.indexOf(
          `${source}_${field}_literal_keyset_bound as materialized (`
        );
        expect(literalKeyset, `${source}_${field}`).toBeGreaterThan(0);
        expect(literalBound, `${source}_${field}`).toBeGreaterThan(
          literalKeyset
        );
        expect(exactGate, `${source}_${field}`).toBeGreaterThan(literalBound);
        const keyset = JOB_RPC.slice(literalKeyset, literalBound);
        expect(keyset).toContain(
          "private.agent_discovery_prefix_upper_bound(p_query)"
        );
        expect(keyset).toContain("limit 501");
      }
      const orderedGates = [
        `${source}_exact_title_gate`,
        `${source}_exact_address_gate`,
        `${source}_prefix_title_gate`,
        `${source}_prefix_address_gate`,
        `${source}_all_tokens_title_gate`,
        `${source}_all_tokens_address_gate`,
      ].map((gate) => JOB_RPC.indexOf(`${gate} as materialized (`));
      expect(orderedGates.every((index) => index > 0)).toBe(true);
      expect(orderedGates).toEqual(
        [...orderedGates].sort((left, right) => left - right)
      );
    }
    expect(count(CUSTOMER_RPC, /_name_all_tokens_gate as materialized/g)).toBe(
      2
    );
    expect(
      count(JOB_RPC, /_all_tokens_(?:title|address)_gate as materialized/g)
    ).toBe(4);
    for (const source of ["client", "sub_client"]) {
      expect(CUSTOMER_RPC).toContain(
        `(select count(*) from ${source}_name_exact_gate) + (select count(*) from ${source}_name_prefix_gate) < 501`
      );
    }
    for (const source of ["opportunity", "project"]) {
      expect(JOB_RPC).toContain(
        `(select count(*) from ${source}_exact_title_gate) + (select count(*) from ${source}_exact_address_gate) + (select count(*) from ${source}_prefix_title_gate) + (select count(*) from ${source}_prefix_address_gate) < 501`
      );
      expect(JOB_RPC).toContain(
        `(select count(*) from ${source}_all_tokens_title_gate) + (select count(*) from ${source}_exact_title_gate) + (select count(*) from ${source}_exact_address_gate) + (select count(*) from ${source}_prefix_title_gate) + (select count(*) from ${source}_prefix_address_gate) < 501`
      );
    }
  });

  it("emits only the canonical operational revision fence for stale cursors", () => {
    const expectedFence =
      "jsonb_build_object( 'source_domain', 'operations', 'source_type', 'operational_read_revision', 'source_id', 'private.agent_operational_read_revisions', 'version', 'revision:' || revision.source_revision::text )";
    for (const [rpc, namespace] of [
      [CUSTOMER_RPC, "customer_discovery"],
      [JOB_RPC, "job_discovery"],
    ] as const) {
      const start = rpc.indexOf(
        `raise exception 'agent_${namespace}_cursor_stale'`
      );
      const end = rpc.indexOf("end if;", start);
      const staleBlock = rpc.slice(start, end);
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      expect(staleBlock).toContain("using errcode = '40001'");
      expect(staleBlock).toContain(expectedFence);
      expect(staleBlock).toContain(
        "revision.source_revision between 0 and 9007199254740991"
      );
      expect(count(staleBlock, /jsonb_build_object\(/g)).toBe(1);
      expect(staleBlock).not.toMatch(
        /actor_user_id|capability_id|company_id'|permission_snapshot_revision|canonical_input|query/
      );
    }
  });

  it("ranks job matches only against caller-selected query fields", () => {
    expect(JOB_RPC).not.toContain(
      "when normalized.title = p_query or normalized.address = p_query then 1"
    );
    expect(count(JOB_RPC, /and 'title' = any\(p_query_fields\)/g)).toBe(8);
    expect(count(JOB_RPC, /and 'address' = any\(p_query_fields\)/g)).toBe(8);
    expect(count(JOB_RPC, /'exact_title'::text as match_kind/g)).toBe(2);
    expect(count(JOB_RPC, /'exact_address'::text as match_kind/g)).toBe(2);
  });

  it("derives each job field and tier from the one highest-priority match", () => {
    for (const [kind, field, tier] of [
      ["exact_title", "title", 1],
      ["exact_address", "address", 1],
      ["prefix_title", "title", 2],
      ["prefix_address", "address", 2],
      ["all_tokens_title", "title", 3],
      ["all_tokens_address", "address", 3],
    ] as const) {
      expect(
        count(JOB_RPC, new RegExp(`'${kind}'::text as match_kind`, "g"))
      ).toBe(2);
      expect(
        count(JOB_RPC, new RegExp(`'${field}'::text as match_field`, "g"))
      ).toBeGreaterThanOrEqual(6);
      expect(
        count(JOB_RPC, new RegExp(`${tier}::integer as match_tier`, "g"))
      ).toBeGreaterThanOrEqual(4);
    }
  });

  it("rejects only universally contradictory lifecycle and status filters", () => {
    expect(JOB_RPC).toContain("p_lifecycle_states is not null and not (");
    expect(JOB_RPC).toContain("p_opportunity_stages is null or exists (");
    expect(JOB_RPC).toContain("p_project_statuses is null or exists (");
    expect(JOB_RPC).toContain(
      "when requested.stage = 'discarded' then 'archived' = any(p_lifecycle_states)"
    );
    expect(JOB_RPC).toContain(
      "when requested.stage in ('won', 'lost') then p_lifecycle_states && array['terminal', 'archived']::text[]"
    );
    expect(JOB_RPC).toContain(
      "else p_lifecycle_states && array['active', 'archived']::text[]"
    );
    expect(JOB_RPC).toContain(
      "when requested.status in ('completed', 'closed') then 'terminal' = any(p_lifecycle_states)"
    );
  });

  it("filters opportunity and project sources independently before reciprocal pairing", () => {
    const opportunity = JOB_RPC.indexOf(
      "opportunity_inspection_source as not materialized"
    );
    const project = JOB_RPC.indexOf(
      "project_inspection_source as not materialized"
    );
    const opportunityAuthorization = JOB_RPC.indexOf(
      "opportunity_authorized_gate as materialized"
    );
    const projectAuthorization = JOB_RPC.indexOf(
      "project_authorized_gate as materialized"
    );
    const pairing = JOB_RPC.indexOf("paired_candidate as materialized");
    expect(opportunity).toBeGreaterThan(0);
    expect(project).toBeGreaterThan(opportunity);
    expect(opportunityAuthorization).toBeGreaterThan(project);
    expect(projectAuthorization).toBeGreaterThan(opportunityAuthorization);
    expect(pairing).toBeGreaterThan(projectAuthorization);
    expect(JOB_RPC).toContain("opportunity.deleted_at is null");
    expect(JOB_RPC).toContain("opportunity.merged_into_opportunity_id is null");
    expect(JOB_RPC).toContain("project.deleted_at is null");
    expect(JOB_RPC).toContain(
      "project.raw_job_id = opportunity.linked_project_id"
    );
    expect(JOB_RPC).toContain(
      "project.linked_opportunity_id = opportunity.raw_job_id"
    );
    expect(JOB_RPC).toContain(
      "project.client_id = opportunity.resolved_client_id"
    );
    expect(PROJECT_SOURCE_VALIDATOR).toContain(
      "p_opportunity_id is not null and private.agent_uuid_from_legacy_text(p_opportunity_id) is null"
    );
    for (const conversion of [
      "not_converted",
      "linked_project_not_returned",
      "standalone_project",
      "linked_opportunity_not_returned",
      "converted",
    ]) {
      expect(JOB_RPC).toContain(`'${conversion}'`);
    }
  });

  it("bounds each complete source before pairing and short-circuits at the 501 sentinel", () => {
    const opportunitySource = JOB_RPC.indexOf(
      "opportunity_inspection_source as not materialized"
    );
    const projectSource = JOB_RPC.indexOf(
      "project_inspection_source as not materialized"
    );
    const opportunityPrimary = JOB_RPC.indexOf(
      "opportunity_primary_gate as materialized"
    );
    const projectPrimary = JOB_RPC.indexOf(
      "project_primary_gate as materialized"
    );
    const opportunityQuery = JOB_RPC.indexOf(
      "opportunity_query_gate as materialized"
    );
    const opportunityCreated = JOB_RPC.indexOf(
      "opportunity_filter_created_gate as materialized"
    );
    const opportunityUpdated = JOB_RPC.indexOf(
      "opportunity_filter_updated_gate as materialized"
    );
    const projectQuery = JOB_RPC.indexOf("project_query_gate as materialized");
    const projectCreated = JOB_RPC.indexOf(
      "project_filter_created_gate as materialized"
    );
    const projectUpdated = JOB_RPC.indexOf(
      "project_filter_updated_gate as materialized"
    );
    const inspectionState = JOB_RPC.indexOf("inspection_state as materialized");
    const opportunityAuthorization = JOB_RPC.indexOf(
      "opportunity_authorized_gate as materialized"
    );
    const projectAuthorization = JOB_RPC.indexOf(
      "project_authorized_gate as materialized"
    );
    const sourceState = JOB_RPC.indexOf("source_gate_state as materialized");
    const pairing = JOB_RPC.indexOf("paired_candidate as materialized");

    expect(projectSource).toBeGreaterThan(opportunitySource);
    expect(opportunityQuery).toBeGreaterThan(projectSource);
    expect(opportunityCreated).toBeGreaterThan(opportunityQuery);
    expect(opportunityUpdated).toBeGreaterThan(opportunityCreated);
    expect(opportunityPrimary).toBeGreaterThan(opportunityUpdated);
    expect(projectQuery).toBeGreaterThan(opportunityPrimary);
    expect(projectCreated).toBeGreaterThan(projectQuery);
    expect(projectUpdated).toBeGreaterThan(projectCreated);
    expect(projectPrimary).toBeGreaterThan(opportunityPrimary);
    expect(inspectionState).toBeGreaterThan(projectPrimary);
    expect(opportunityAuthorization).toBeGreaterThan(inspectionState);
    expect(projectAuthorization).toBeGreaterThan(opportunityAuthorization);
    expect(sourceState).toBeGreaterThan(projectAuthorization);
    expect(pairing).toBeGreaterThan(sourceState);
    expect(JOB_RPC).toContain(
      "(select count(*) from opportunity_primary_gate) = 501"
    );
    expect(JOB_RPC).toContain(
      "(select count(*) from project_primary_gate) = 501"
    );
    expect(JOB_RPC).toContain("from opportunity_authorized_gate candidate");
    expect(JOB_RPC).toContain("from project_authorized_gate candidate");
    expect(JOB_RPC).toContain(
      "not ( source_state.query_bound or count(candidate.job_id) = 501 ) and ( source_state.source_data_invalid"
    );
    expect(CUSTOMER_RPC).toContain(
      "select count(*) = 501 from inspection_gate"
    );
    expect(JOB_RPC).toContain(
      "join opportunity_authorized_gate opportunity on not source_state.query_bound"
    );
    expect(JOB_RPC).toContain(
      "join project_authorized_gate project on not source_state.query_bound"
    );
    expect(JOB_RPC).not.toContain("reciprocal_gate");
    expect(JOB_RPC).not.toContain("working_set");

    for (const gate of [
      "opportunity_query_gate",
      "opportunity_filter_created_gate",
      "opportunity_filter_updated_gate",
      "project_query_gate",
      "project_filter_created_gate",
      "project_filter_updated_gate",
    ]) {
      const start = JOB_RPC.indexOf(`${gate} as materialized`);
      const end = JOB_RPC.indexOf("limit 501", start);
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
    }
    expect(JOB_RPC).toContain(
      "where p_query is null and p_date_field = 'created_at' order by candidate.created_sort_at desc nulls last, candidate.raw_job_id"
    );
    expect(JOB_RPC).toContain(
      "order by keyset.updated_sort_at desc nulls last, keyset.raw_job_id limit 501"
    );
    expect(JOB_RPC).toContain(
      "opportunity_filter_updated_no_window_selected_candidate as materialized ( select selected.raw_job_id, selected.updated_sort_at"
    );
    expect(JOB_RPC).toContain(
      "project_filter_updated_no_window_selected_candidate as materialized ( select selected.raw_job_id, selected.updated_sort_at"
    );
    expect(
      count(
        JOB_RPC,
        /\) selected order by selected\.updated_sort_at desc nulls last, selected\.raw_job_id limit 501/g
      )
    ).toBe(2);
    expect(JOB_RPC).toContain(
      "where p_query is null and p_date_field = 'updated_at' order by candidate.updated_sort_at desc nulls last, candidate.raw_job_id"
    );
  });

  it("fails closed on nullable source enums and compares observed time at wire precision", () => {
    expect(JOB_RPC).toContain(
      "opportunity.stage is null or opportunity.stage not in ("
    );
    expect(JOB_RPC).toContain(
      "project.status is null or project.status not in ("
    );
    expect(count(JOB_RPC, /\), true\) as source_data_invalid/g)).toBe(2);
    expect(JOB_RPC).toContain(
      "bool_or(coalesce(candidate.source_data_invalid, true))"
    );
    expect(JOB_RPC).toMatch(
      /date_trunc\( 'milliseconds', opportunity\.updated_at, 'utc' \) > v_read_as_of/
    );
    expect(JOB_RPC).toMatch(
      /date_trunc\( 'milliseconds', project\.updated_at, 'utc' \) > v_read_as_of/
    );
    expect(OPPORTUNITY_SOURCE_VALIDATOR).toContain(
      "p_created_at > p_updated_at"
    );
    expect(PROJECT_SOURCE_VALIDATOR).toContain("p_created_at > p_updated_at");
    for (const expression of [
      "opportunity.created_at",
      "opportunity.updated_at",
      "project.created_at",
      "project.updated_at",
      "project.start_date",
      "project.end_date",
    ]) {
      const validator = expression.startsWith("opportunity.")
        ? OPPORTUNITY_SOURCE_VALIDATOR
        : PROJECT_SOURCE_VALIDATOR;
      const parameter = expression.slice(expression.indexOf(".") + 1);
      expect(validator).toContain(`not isfinite(p_${parameter})`);
      expect(validator).toContain(
        `extract(year from p_${parameter} at time zone 'utc')`
      );
    }
  });

  it("keeps generic filter-only plans indexable without hiding invalid enums", () => {
    expect(JOB_RPC).toContain(
      "array_append(coalesce(p_opportunity_stages, array["
    );
    expect(JOB_RPC).toContain(
      "array_append( coalesce(p_lifecycle_states, array["
    );
    expect(JOB_RPC).toContain(
      "array_append( coalesce(p_project_statuses, array["
    );
    expect(count(JOB_RPC, /then '__invalid__'/g)).toBeGreaterThanOrEqual(4);

    for (const source of ["opportunity", "project"]) {
      expect(JOB_RPC).toContain(
        `${source}_filter_updated_no_window_source as not materialized ( select candidate.* from ${source}_inspection_source candidate where p_query is null and p_date_field is null )`
      );
      expect(JOB_RPC).toContain(
        `${source}_filter_updated_no_window_selector as materialized (`
      );
      expect(JOB_RPC).toContain(
        `${source}_filter_updated_no_window_selected_candidate as materialized (`
      );
      expect(JOB_RPC).toContain(
        `${source}_filter_updated_no_window_invalid_candidate as materialized (`
      );
      expect(JOB_RPC).toContain(
        `${source}_filter_updated_no_window_keyset as materialized ( select candidate.* from (`
      );
      expect(JOB_RPC).toContain(
        `from ${source}_filter_updated_no_window_selected_candidate selected union all select invalid.* from ${source}_filter_updated_no_window_invalid_candidate invalid`
      );
      expect(JOB_RPC).toContain(
        `${source}_filter_updated_window_source as not materialized (`
      );
      expect(JOB_RPC).toContain(
        `${source}_filter_updated_no_window_gate as materialized (`
      );
      expect(JOB_RPC).toContain(
        `from ${source}_filter_updated_no_window_keyset keyset cross join lateral ( select source_candidate.* from ${source}_filter_updated_no_window_source source_candidate where source_candidate.raw_job_id = keyset.raw_job_id limit 1 ) candidate`
      );
      expect(JOB_RPC).toContain(
        `${source}_filter_updated_window_gate as materialized (`
      );
    }

    for (const field of ["created_sort_at", "updated_sort_at"]) {
      expect(
        count(JOB_RPC, new RegExp(`candidate\\.${field} >= p_date_from`, "g"))
      ).toBe(4);
      expect(
        count(
          JOB_RPC,
          new RegExp(`candidate\\.${field} < p_date_to_exclusive`, "g")
        )
      ).toBe(4);
    }
    expect(JOB_RPC).not.toContain("'-infinity'::timestamptz");
    expect(JOB_RPC).not.toContain("'infinity'::timestamptz");
    expect(JOB_RPC).not.toContain(
      "p_date_from is null or candidate.created_sort_at >= p_date_from"
    );
    expect(JOB_RPC).not.toContain(
      "p_date_from is null or candidate.updated_sort_at >= p_date_from"
    );
  });

  it("proof-binds every source-first job selection without widening public raw", () => {
    expect(count(JOB_RPC, /as selection_anchor_base/g)).toBe(2);
    expect(count(JOB_RPC, /as selection_anchor(?:,|\s)/g)).toBe(2);
    expect(JOB_RPC).toContain(
      "'archived', opportunity.archived_at is not null"
    );
    for (const key of [
      "'job_ref'",
      "'display_title'",
      "'address'",
      "'lifecycle_state'",
      "'status'",
      "'dates'",
      "'match_basis'",
    ]) {
      expect(JOB_RPC).toContain(key);
    }
    expect(JOB_RPC).toContain(
      "jsonb_build_object( 'anchors', jsonb_build_array( opportunity.selection_anchor, project.selection_anchor ) )"
    );
    expect(JOB_RPC).toContain(
      "jsonb_build_object( 'anchors', jsonb_build_array(opportunity.selection_anchor) )"
    );
    expect(JOB_RPC).toContain(
      "jsonb_build_object( 'anchors', jsonb_build_array(project.selection_anchor) )"
    );
    expect(
      count(JOB_RPC, /'selection_witness', match\.selection_witness/g)
    ).toBe(2);

    const rawStart = JOB_RPC.indexOf("ranked_raw_match as materialized (");
    const rawObject = JOB_RPC.slice(
      JOB_RPC.indexOf("jsonb_build_object(", rawStart),
      JOB_RPC.indexOf(") as raw", rawStart)
    );
    expect(rawObject).not.toContain("'selection_witness'");
  });

  it("proof-binds exact-contact selection without exposing the contact value", () => {
    expect(CUSTOMER_RPC).toContain(
      "'schema_revision', 'customer-discovery-contact-selection:v1'"
    );
    expect(CUSTOMER_RPC).toContain("'normalized_query', p_query");
    expect(CUSTOMER_RPC).toContain(
      "case when p_lookup = 'name' then null else jsonb_build_object("
    );
    expect(
      count(CUSTOMER_RPC, /'selection_witness', match\.selection_witness/g)
    ).toBe(2);

    const rawStart = CUSTOMER_RPC.indexOf("ranked_raw_match as materialized (");
    const witnessEnd = CUSTOMER_RPC.indexOf("as selection_witness", rawStart);
    const publicRaw = CUSTOMER_RPC.slice(
      CUSTOMER_RPC.indexOf("jsonb_build_object(", witnessEnd),
      CUSTOMER_RPC.indexOf(") as raw", witnessEnd)
    );
    expect(publicRaw).not.toContain("'selection_witness'");
    expect(publicRaw).not.toContain("'normalized_query'");
  });

  it("binds ordered child proofs to one mandatory collection proof including empty pages", () => {
    for (const [rpc, kind] of [
      [CUSTOMER_RPC, "customer"],
      [JOB_RPC, "job"],
    ] as const) {
      expect(rpc).toContain(`'${kind}_discovery_projection'`);
      expect(rpc).toContain(`'${kind}_discovery_projection:v1:'`);
      expect(rpc).toContain(
        `'evidence:${kind}_discovery_projection:' || ranked.${kind}_kind || ':' || ranked.${kind}_id::text || ':ordinal:' || ranked.rank_ordinal::text`
      );
      expect(rpc).toContain("'retained_proof_sources', coalesce((");
      expect(rpc).toContain("'[]'::jsonb");
      expect(rpc).toContain("'collection_claim'");
      expect(rpc).toContain("'source_content_hash'");
      expect(rpc).toContain("private.canonical_agent_projection_json(");
      expect(rpc).toContain("'locator', 'ops://evidence/' || replace(");
      expect(rpc).toContain("'relationship', 'supports'");
      expect(rpc).toContain("'trust', 'authoritative_ops'");
    }
    expect(RAW_SQL).toContain("jsonb_build_array('SOURCE_QUERY_BOUND')");
    expect(RAW_SQL).toContain("jsonb_build_array('SOURCE_DATA_INVALID')");
    expect(RAW_SQL).not.toContain("jsonb_build_array('source_query_bound')");
    expect(RAW_SQL).not.toContain("jsonb_build_array('source_data_invalid')");
    expect(RAW_SQL).toContain("':', '%3A'");
    expect(RAW_SQL).not.toContain("':', '%3a'");
  });

  it("proof-binds the exact signed cursor predecessor without exposing it publicly", () => {
    for (const [rpc, kind] of [
      [CUSTOMER_RPC, "customer"],
      [JOB_RPC, "job"],
    ] as const) {
      expect(rpc).toContain("cursor_anchor as materialized (");
      expect(rpc).toContain(
        "case when p_cursor_rank_ordinal is null then null else ( select jsonb_build_object( 'rank_ordinal', candidate.rank_ordinal, 'raw', candidate.raw )"
      );
      expect(rpc).toContain(`candidate.${kind}_kind = p_cursor_${kind}_kind`);
      expect(rpc).toContain(`candidate.${kind}_id = p_cursor_${kind}_id`);
      expect(rpc).toContain(
        "'cursor_anchor_order_witness', cursor_state.order_witness"
      );
      expect(rpc).toContain("'collection', collection.raw");
      expect(rpc).not.toContain("'cursor_anchor_order_witness', match.raw");
    }
  });

  it("keeps the database wire bound separate from the public prompt reducer", () => {
    for (const [rpc, namespace] of [
      [CUSTOMER_RPC, "customer_discovery"],
      [JOB_RPC, "job_discovery"],
    ] as const) {
      expect(rpc).toContain("octet_length(v_result::text) > 1048576");
      expect(rpc).toContain(`agent_${namespace}_source_query_bound`);
      expect(rpc).toContain(`invalid_agent_${namespace}_request`);
      expect(rpc).toContain(`agent_${namespace}_cursor_stale`);
      expect(rpc).not.toContain("60000");
      expect(rpc).not.toContain("result_character_budget");
    }
  });

  it("defines each active public wrapper exactly once in the new migration", () => {
    for (const name of [
      ...ACTIVE_JSON_READERS,
      "read_agent_correspondence_evidence_as_system",
      "read_agent_phase_c_job_conversation_context_as_system",
      "read_agent_customer_discovery_as_system",
      "read_agent_job_discovery_as_system",
    ]) {
      expect(
        count(
          SQL,
          new RegExp(`create or replace function public\\.${name}\\(`, "g")
        )
      ).toBe(1);
    }
  });
});

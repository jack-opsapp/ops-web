import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_NAME = "20260823072825_agent_manifest_v8_compatibility.sql";
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  MIGRATION_NAME
);
const V7_MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260822015049_agent_discovery_reads_20260820220000.sql"
);
const MANIFEST_V5 = "2026-08-13.capability-manifest.v5";
const MANIFEST_V6 = "2026-08-14.capability-manifest.v6";
const MANIFEST_V7 = "2026-08-20.capability-manifest.v7";
const MANIFEST_V8 = "2026-08-22.capability-manifest.v8";

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

function inputHeader(definition: string): string {
  const returnsAt = definition.indexOf(") returns");
  return returnsAt < 0 ? "" : compact(definition.slice(0, returnsAt + 1));
}

const JSON_READERS = [
  "read_agent_job_communication_context_as_system",
  "read_agent_job_participants_as_system",
  "read_agent_job_conversation_context_as_system",
  "read_agent_scheduled_jobs_as_system",
  "read_agent_job_readiness_issues_as_system",
  "read_agent_phase_c_job_conversation_context_as_system",
  "read_agent_customer_jobs_as_system",
  "read_agent_job_summary_as_system",
  "read_agent_correspondence_evidence_page_as_system",
  "read_agent_job_history_as_system",
] as const;

const DISCOVERY_READERS = [
  "read_agent_customer_discovery_as_system",
  "read_agent_job_discovery_as_system",
] as const;

const RAW_EVIDENCE_READER =
  "read_agent_correspondence_evidence_as_system" as const;

const TYPE_SIGNATURES = {
  read_agent_job_communication_context_as_system:
    "text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,uuid,text",
  read_agent_job_participants_as_system:
    "text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,uuid,text",
  read_agent_job_conversation_context_as_system:
    "text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid",
  read_agent_scheduled_jobs_as_system:
    "text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,timestamptz,timestamptz,text[],text[],text,timestamptz,bigint,timestamptz,uuid,integer",
  read_agent_job_readiness_issues_as_system:
    "text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,timestamptz,timestamptz,text[],timestamptz,bigint,timestamptz,uuid,integer",
  read_agent_correspondence_evidence_as_system:
    "text,uuid,uuid,text,text[],text,text,text,text,text,text[]",
  read_agent_phase_c_job_conversation_context_as_system:
    "text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid,bigint,uuid,uuid,text,uuid,uuid,uuid",
  read_agent_customer_jobs_as_system:
    "text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text[],text[],text[],text,timestamptz,timestamptz,timestamptz,bigint,timestamptz,text,uuid,integer",
  read_agent_job_summary_as_system:
    "text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],text[],text[]",
  read_agent_correspondence_evidence_page_as_system:
    "text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text",
  read_agent_job_history_as_system:
    "text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],jsonb,timestamptz,timestamptz,text[],timestamptz,bigint,bigint,bigint,timestamptz,text,text,integer",
  read_agent_customer_discovery_as_system:
    "text,uuid,uuid,text,text[],text,text,text,text,text,text[],text,text,text,text[],timestamptz,bigint,integer,text,uuid,integer",
  read_agent_job_discovery_as_system:
    "text,uuid,uuid,text,text[],text,text,text,text,text,text[],text,text,text,text[],text[],text[],text[],text[],text,timestamptz,timestamptz,timestamptz,bigint,integer,text,uuid,integer",
} as const;

const RAW_SQL = rawSource();
const SQL = RAW_SQL.toLowerCase();
const V7_SQL = readFileSync(V7_MIGRATION_PATH, "utf8").toLowerCase();
const COMPACT_SQL = compact(SQL);
const REPROOF = compact(
  functionDefinition(SQL, "private.reprove_agent_read_jsonb_for_manifest")
);

describe("manifest v8 compatibility migration", () => {
  it("ships as one replay-safe compatibility-only transaction", () => {
    expect(
      SQL,
      `${MIGRATION_NAME} is intentionally RED until implemented`
    ).not.toBe("");
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(COMPACT_SQL).toContain("do $freeze_v7_cores$");
    expect(COMPACT_SQL).toContain("to_regprocedure(");
    expect(COMPACT_SQL).toContain("if v_private_core is null then");
    expect(COMPACT_SQL).toContain("set schema private");
    expect(COMPACT_SQL).not.toMatch(/\bcreate\s+(?:unlogged\s+)?table\b/);
    expect(COMPACT_SQL).not.toMatch(/\bcreate\s+(?:unique\s+)?index\b/);
    expect(COMPACT_SQL).not.toMatch(/\bcreate\s+trigger\b/);
    expect(COMPACT_SQL).not.toContain("agent_p2_");
    expect(COMPACT_SQL).not.toContain("mcp_exposure");
  });

  it("accepts only complete adjacent manifest sources and fails null or mixed input closed", () => {
    expect(REPROOF).not.toBe("");
    expect(REPROOF).toContain(
      "language plpgsql stable called on null input security definer"
    );
    expect(REPROOF).toContain("called on null input");
    expect(REPROOF).not.toMatch(/\bstrict\b/);
    for (const revision of [
      MANIFEST_V5,
      MANIFEST_V6,
      MANIFEST_V7,
      MANIFEST_V8,
    ]) {
      expect(REPROOF).toContain(`'${revision}'`);
    }
    expect(REPROOF).toContain("p_result is null");
    expect(REPROOF).toContain("v_manifest_count = 0");
    expect(REPROOF).toContain(
      "object_value ->> 'capability_manifest_revision' is distinct from v_source_manifest_revision"
    );
    expect(REPROOF).toContain("invalid_agent_manifest_reproof_request");
    expect(REPROOF).toContain("invalid_agent_manifest_reproof_source");
    expect(REPROOF).toContain("using errcode = '22023'");
    expect(REPROOF).toContain("private.agent_set_jsonb_key_recursive(");
    expect(REPROOF).toContain("private.canonical_agent_projection_json(");
    expect(REPROOF).toContain("private.agent_replace_agent_proof_hash(");
    expect(REPROOF).not.toContain("replace(p_result::text");
  });

  it("freezes and wraps the exact thirteen existing public signatures", () => {
    const allReaders = [
      ...JSON_READERS,
      RAW_EVIDENCE_READER,
      ...DISCOVERY_READERS,
    ] as const;
    expect(allReaders).toHaveLength(13);
    for (const name of allReaders) {
      const signature = TYPE_SIGNATURES[name];
      const wrapper = compact(functionDefinition(SQL, `public.${name}`));
      expect(wrapper, `${name} needs a current public wrapper`).not.toBe("");
      expect(COMPACT_SQL).toContain(`public.${name}(${signature})`);
      expect(COMPACT_SQL).toContain(`private.${name}_v7_core(${signature})`);
      expect(wrapper).toContain("language plpgsql stable security definer");
      expect(wrapper).toContain("auth.role() is distinct from 'service_role'");
      expect(wrapper).toContain(`'${MANIFEST_V8}'`);
      expect(COMPACT_SQL).toContain(
        `revoke all on function public.${name}(${signature}) from public, anon, authenticated, service_role;`
      );
      expect(COMPACT_SQL).toContain(
        `grant execute on function public.${name}(${signature}) to service_role;`
      );
      expect(COMPACT_SQL).toContain(
        `revoke all on function private.${name}_v7_core(${signature}) from public, anon, authenticated, service_role;`
      );
    }
  });

  it("matches every sealed v7 public input header byte-for-byte", () => {
    for (const name of [
      ...JSON_READERS,
      RAW_EVIDENCE_READER,
      ...DISCOVERY_READERS,
    ]) {
      const v7Header = inputHeader(
        functionDefinition(V7_SQL, `public.${name}`)
      );
      const v8Header = inputHeader(functionDefinition(SQL, `public.${name}`));
      expect(v7Header, `${name} needs a sealed v7 source header`).not.toBe("");
      expect(v8Header, `${name} needs a v8 wrapper header`).toBe(v7Header);
    }
  });

  it("delegates legacy JSON reads byte-for-byte and reproofs only v8", () => {
    for (const name of JSON_READERS) {
      const wrapper = compact(functionDefinition(SQL, `public.${name}`));
      expect(wrapper).toContain(
        `p_capability_manifest_revision not in ( '${MANIFEST_V6}', '${MANIFEST_V7}', '${MANIFEST_V8}' )`
      );
      expect(wrapper).toContain(`v_result := private.${name}_v7_core(`);
      expect(wrapper).toContain("p_capability_manifest_revision");
      expect(wrapper).toContain(
        `if p_capability_manifest_revision in ( '${MANIFEST_V6}', '${MANIFEST_V7}' ) then return v_result; end if;`
      );
      expect(wrapper).toContain(
        `return private.reprove_agent_read_jsonb_for_manifest( v_result, '${MANIFEST_V8}' );`
      );
    }
  });

  it("keeps v7-only discovery exact and reproofs v8 from an exact v7 core result", () => {
    for (const name of DISCOVERY_READERS) {
      const wrapper = compact(functionDefinition(SQL, `public.${name}`));
      expect(wrapper).toContain(
        `p_capability_manifest_revision not in ( '${MANIFEST_V7}', '${MANIFEST_V8}' )`
      );
      expect(wrapper).not.toContain(`'${MANIFEST_V6}'`);
      expect(wrapper).toContain(`v_result := private.${name}_v7_core(`);
      expect(wrapper).toContain(`'${MANIFEST_V7}'`);
      expect(wrapper).toContain(
        `if p_capability_manifest_revision = '${MANIFEST_V7}' then return v_result; end if;`
      );
      expect(wrapper).toContain(
        `return private.reprove_agent_read_jsonb_for_manifest( v_result, '${MANIFEST_V8}' );`
      );
      expect(wrapper).toContain(
        "set search_path = pg_catalog, public, private, extensions, pg_temp"
      );
      expect(wrapper).toContain("set plan_cache_mode = force_custom_plan");
    }
  });

  it("keeps raw evidence rows identical and never JSON-reproofs them", () => {
    const wrapper = compact(
      functionDefinition(SQL, `public.${RAW_EVIDENCE_READER}`)
    );
    expect(wrapper).toContain(
      `p_capability_manifest_revision not in ( '${MANIFEST_V6}', '${MANIFEST_V7}', '${MANIFEST_V8}' )`
    );
    expect(wrapper).toContain(
      `case when p_capability_manifest_revision = '${MANIFEST_V6}' then '${MANIFEST_V6}' else '${MANIFEST_V7}' end`
    );
    expect(wrapper).toContain(`private.${RAW_EVIDENCE_READER}_v7_core(`);
    expect(wrapper).not.toContain(
      "private.reprove_agent_read_jsonb_for_manifest("
    );
  });

  it("preserves exact defaults and execution configuration", () => {
    const conversation = compact(
      functionDefinition(
        SQL,
        "public.read_agent_job_conversation_context_as_system"
      )
    );
    expect(conversation).toContain("p_exact_turn_limit integer default 20");
    expect(conversation).toContain(
      "p_sections text[] default array[ 'memory', 'recent_turns', 'participants', 'gaps', 'cross_job_seed' ]::text[]"
    );
    expect(conversation).toContain(
      "p_required_through_turn_id uuid default null"
    );

    const scheduled = compact(
      functionDefinition(SQL, "public.read_agent_scheduled_jobs_as_system")
    );
    expect(scheduled).toContain("p_confirmation_states text[] default null");
    expect(scheduled).toContain("p_display_timezone text default null");
    expect(scheduled).toContain("p_limit integer default 25");

    const readiness = compact(
      functionDefinition(
        SQL,
        "public.read_agent_job_readiness_issues_as_system"
      )
    );
    expect(readiness).toContain("p_scan_limit integer default 50");

    for (const name of [...JSON_READERS, RAW_EVIDENCE_READER]) {
      expect(compact(functionDefinition(SQL, `public.${name}`))).toContain(
        "set search_path = pg_catalog, public, private"
      );
    }
  });
});

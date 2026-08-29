import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_SUFFIX = "_agent_p2_legacy_attention_projections.sql";
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith(MIGRATION_SUFFIX));
const MIGRATION_NAME = migrationNames[0] ?? "MISSING";
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  MIGRATION_NAME
);
const RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-p2-legacy-attention-projections-runtime.sql"
);

function read(path: string): string {
  try {
    return readFileSync(path, "utf8").toLowerCase();
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

const SQL = read(MIGRATION_PATH);
const COMPACT_SQL = compact(SQL);
const RUNTIME_SQL = compact(read(RUNTIME_PATH));
const FUNCTIONS = {
  canonicalText: compact(
    functionDefinition(SQL, "private.agent_p2_optional_canonical_text")
  ),
  lead: compact(
    functionDefinition(SQL, "private.agent_p2_legacy_lead_attention_v1")
  ),
  correspondence: compact(
    functionDefinition(
      SQL,
      "private.agent_p2_legacy_correspondence_attention_v1"
    )
  ),
  schedule: compact(
    functionDefinition(SQL, "private.agent_p2_legacy_schedule_attention_v1")
  ),
};

function sourceMatchInspection(definition: string): string {
  const startMarker = "source_match_inspection as materialized (";
  const endMarker = ") select coalesce(";
  const start = definition.indexOf(startMarker);
  const end = definition.indexOf(endMarker, start + startMarker.length);
  return start < 0 || end < 0
    ? ""
    : definition.slice(start + startMarker.length, end);
}

const SIGNATURES = {
  lead: "private.agent_p2_legacy_lead_attention_v1(uuid,uuid,text,text[],text,timestamp with time zone,integer)",
  correspondence:
    "private.agent_p2_legacy_correspondence_attention_v1(uuid,uuid,text,text[],text,text,text,timestamp with time zone,integer)",
  schedule:
    "private.agent_p2_legacy_schedule_attention_v1(uuid,uuid,text,text[],text,text,text,timestamp with time zone,integer)",
} as const;

describe("P2 legacy attention projection migration", () => {
  it("uses one generated migration and a guarded transaction", () => {
    expect(migrationNames).toHaveLength(1);
    expect(MIGRATION_NAME).toMatch(
      /^\d{14}_agent_p2_legacy_attention_projections\.sql$/
    );
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("do $prerequisites$");
    for (const prerequisite of [
      "private.resolve_agent_actor_authority(uuid,uuid,text[])",
      "private.agent_user_can_access_entity(uuid,uuid,text,uuid,text)",
      "private.user_can_view_inbox_connection(uuid,uuid,uuid,uuid)",
      "private.agent_trim_discovery_display_text(text)",
      "private.agent_discovery_unicode15_text_is_supported(text)",
      "private.agent_prompt_text_is_safe(text,boolean)",
      "private.agent_operational_read_revisions",
      "private.agent_job_history_revisions",
      "public.opportunities",
      "public.email_threads",
      "public.project_tasks",
      "public.projects",
    ]) {
      expect(SQL).toContain(prerequisite);
    }
  });

  it("creates only the three fixed private adapters with frozen signatures", () => {
    expect(COMPACT_SQL).not.toContain("create or replace function public.");
    expect(COMPACT_SQL).not.toContain("public.read_agent_");
    for (const [kind, signature] of Object.entries(SIGNATURES)) {
      const definition = FUNCTIONS[kind as keyof typeof FUNCTIONS];
      expect(definition).not.toBe("");
      expect(COMPACT_SQL).toContain(`revoke all on function ${signature}`);
      expect(COMPACT_SQL).not.toContain(
        `grant execute on function ${signature} to service_role`
      );
      expect(COMPACT_SQL).not.toContain(
        `grant execute on function ${signature} to authenticated`
      );
      expect(COMPACT_SQL).not.toContain(
        `grant execute on function ${signature} to anon`
      );
      expect(definition).toContain(
        "language plpgsql stable security invoker set search_path = ''"
      );
      expect(definition).toContain(
        "auth.role() is distinct from 'service_role'"
      );
      expect(definition).toContain(
        "p_limit is null or p_limit not between 1 and 25"
      );
      expect(definition).toContain("limit 501");
      expect(definition).toContain("least(p_limit + 1, 26)");
      expect(definition).toContain("v_source_match_count >= 501");
      expect(definition).toContain(
        "private.resolve_agent_actor_authority( p_actor_user_id, p_company_id, p_registered_permission_keys )"
      );
      expect(definition).toContain(
        "authority.permission_snapshot_revision = p_permission_snapshot_revision"
      );
    }
  });

  it("accepts only the canonical signed-cursor read-at window", () => {
    for (const kind of ["lead", "correspondence", "schedule"] as const) {
      const definition = FUNCTIONS[kind];
      expect(definition).toContain("not pg_catalog.isfinite(p_read_at)");
      expect(definition).toContain(
        "p_read_at is distinct from pg_catalog.date_trunc( 'milliseconds', p_read_at )"
      );
      expect(definition).toContain(
        "extract(year from p_read_at at time zone 'utc') not between 1 and 9999"
      );
      expect(definition).toContain(
        "p_read_at > pg_catalog.statement_timestamp()"
      );
      expect(definition).toContain(
        "p_read_at <= pg_catalog.statement_timestamp() - interval '15 minutes'"
      );
      expect(definition).not.toContain(
        "p_read_at is distinct from pg_catalog.date_trunc( 'milliseconds', pg_catalog.statement_timestamp() )"
      );
    }
    for (const marker of [
      "legacy attention cursor-window accepted",
      "legacy attention future read-at accepted",
      "legacy attention expired read-at accepted",
      "legacy attention non-millisecond read-at accepted",
      "legacy attention non-finite read-at accepted",
    ]) {
      expect(RUNTIME_SQL).toContain(marker);
    }
  });

  it("projects optional display text through the exact P2 Unicode boundary", () => {
    expect(FUNCTIONS.canonicalText).toContain(
      "language plpgsql immutable strict parallel safe security invoker set search_path = ''"
    );
    expect(FUNCTIONS.canonicalText).toContain(
      "private.agent_trim_discovery_display_text(p_value)"
    );
    expect(FUNCTIONS.canonicalText).toContain(
      "private.agent_discovery_unicode15_text_is_supported(v_value)"
    );
    expect(FUNCTIONS.canonicalText).toContain(
      "private.agent_prompt_text_is_safe( v_value, p_allow_text_whitespace )"
    );
    expect(COMPACT_SQL).toContain(
      "revoke all on function private.agent_p2_optional_canonical_text(text,integer,integer,boolean) from public, anon, authenticated, service_role"
    );
    expect(FUNCTIONS.lead).toContain(
      "private.agent_p2_optional_canonical_text( opportunity.title, 256, 1024, false ) as title"
    );
    expect(FUNCTIONS.correspondence).toContain(
      "private.agent_p2_optional_canonical_text( thread.subject, 512, 2048, false ) as subject"
    );
    expect(FUNCTIONS.correspondence).toContain(
      "private.agent_p2_optional_canonical_text( thread.latest_snippet, 1000, 4000, true ) as latest_snippet"
    );
    expect(FUNCTIONS.schedule).toContain(
      "private.agent_p2_optional_canonical_text( coalesce( nullif(task.custom_title, ''), nullif(task_type.display, ''), project.title ), 256, 1024, false ) as title"
    );
  });

  it("physically caps canonical source matches before any authority helper", () => {
    for (const kind of ["lead", "correspondence", "schedule"] as const) {
      const definition = FUNCTIONS[kind];
      const sourceMatch = sourceMatchInspection(definition);
      expect(sourceMatch).not.toBe("");
      expect(sourceMatch).toContain("limit 501");
      expect(sourceMatch).not.toContain("agent_user_can_access_entity");
      expect(sourceMatch).not.toContain("user_can_view_inbox_connection");
      expect(
        definition.indexOf("source_match_inspection as materialized")
      ).toBeLessThan(definition.indexOf("source_inspection as materialized"));
    }

    const correspondenceSourceMatch = sourceMatchInspection(
      FUNCTIONS.correspondence
    );
    expect(correspondenceSourceMatch).toContain(
      "thread.next_commitment_due_at is not null"
    );
    expect(correspondenceSourceMatch).not.toContain(
      "thread.snoozed_until <= p_read_at"
    );
    expect(correspondenceSourceMatch).not.toContain(
      "thread.next_commitment_due_at <= p_read_at"
    );
    expect(FUNCTIONS.correspondence).toContain(
      "thread.snoozed_until <= p_read_at"
    );

    for (const indexName of [
      "opportunities_agent_p2_legacy_attention_idx",
      "email_threads_agent_p2_legacy_attention_idx",
      "project_tasks_agent_p2_legacy_attention_idx",
    ]) {
      expect(COMPACT_SQL).toContain(`drop index if exists public.${indexName}`);
    }
    expect(COMPACT_SQL).toContain(
      "create index opportunities_agent_p2_legacy_attention_idx"
    );
    expect(COMPACT_SQL).toContain(
      "create index email_threads_agent_p2_legacy_attention_idx"
    );
    expect(COMPACT_SQL).toContain(
      "create index project_tasks_agent_p2_legacy_attention_idx"
    );
  });

  it("uses the canonical project assignment fact without rescanning child tasks", () => {
    expect(FUNCTIONS.schedule).toContain(
      "p_projects_scope = 'all' or p_actor_user_id::text = any( coalesce(project.team_member_ids, array[]::text[]) )"
    );
    expect(FUNCTIONS.schedule).not.toContain(
      "from public.project_tasks project_assignment"
    );
  });

  it("re-proves each source's own authority and emits only its exact legacy revisions", () => {
    expect(FUNCTIONS.lead).toContain(
      "private.agent_user_can_access_entity( p_actor_user_id, p_company_id, 'opportunity', opportunity.id, 'view' )"
    );
    expect(FUNCTIONS.lead).toContain("from public.opportunities opportunity");
    expect(FUNCTIONS.lead).toContain(
      "'source_type', 'operational_read_revision'"
    );
    expect(FUNCTIONS.lead).toContain(
      "'source_id', 'private.agent_operational_read_revisions'"
    );
    expect(FUNCTIONS.lead).toContain("'agent-p2-legacy-lead-attention:v1'");

    expect(FUNCTIONS.correspondence).toContain(
      "private.user_can_view_inbox_connection( p_actor_user_id, p_company_id, thread.connection_id, thread.opportunity_id )"
    );
    expect(FUNCTIONS.correspondence).toContain(
      "private.agent_user_can_access_entity( p_actor_user_id, p_company_id, 'opportunity', thread.opportunity_id, 'view' )"
    );
    expect(FUNCTIONS.correspondence).toContain(
      "from public.email_threads thread"
    );
    expect(FUNCTIONS.correspondence).toContain(
      "'source_type', 'job_history_read_revision'"
    );
    expect(FUNCTIONS.correspondence).toContain(
      "'source_id', 'private.agent_job_history_revisions'"
    );
    expect(FUNCTIONS.correspondence).toContain(
      "'agent-p2-legacy-correspondence-attention:v1'"
    );

    expect(FUNCTIONS.schedule).toContain(
      "private.agent_user_can_access_entity( p_actor_user_id, p_company_id, 'project', task.project_id, 'view' )"
    );
    expect(FUNCTIONS.schedule).toContain(
      "private.agent_user_can_access_entity( p_actor_user_id, p_company_id, 'task', task.id, 'view' )"
    );
    expect(FUNCTIONS.schedule).toContain("from public.project_tasks task");
    expect(FUNCTIONS.schedule).toContain("join public.projects project");
    expect(FUNCTIONS.schedule).toContain(
      "'source_type', 'operational_read_revision'"
    );
    expect(FUNCTIONS.schedule).toContain(
      "'agent-p2-legacy-schedule-attention:v1'"
    );
  });

  it("projects bounded safe cards and excludes private/provider/queue internals", () => {
    for (const definition of [
      FUNCTIONS.lead,
      FUNCTIONS.correspondence,
      FUNCTIONS.schedule,
    ]) {
      expect(definition).toContain("'returned_count'");
      expect(definition).toContain("'has_more'");
      expect(definition).toContain("'source_versions'");
      expect(definition).toContain("'cards'");
      for (const forbidden of [
        "provider_thread_id",
        "participants",
        "latest_sender_email",
        "latest_sender_name",
        "assigned_to",
        "team_member_ids",
        "internal_notes",
        "raw_payload",
        "queue_id",
        "lease_id",
        "retry_count",
      ]) {
        expect(definition).not.toContain(`'${forbidden}'`);
      }
    }
  });

  it("ships a PostgreSQL runtime fixture for ACL, authority, bounds, and deterministic envelopes", () => {
    expect(RUNTIME_SQL).not.toBe("");
    expect(RUNTIME_SQL).toContain("begin;");
    expect(RUNTIME_SQL).toContain("set local role authenticated");
    expect(RUNTIME_SQL).toContain("has_function_privilege");
    expect(RUNTIME_SQL).toContain(
      "array['search_path=', 'search_path=\"\"']::text[]"
    );
    for (const signature of Object.values(SIGNATURES)) {
      expect(RUNTIME_SQL).toContain(signature);
    }
    expect(RUNTIME_SQL).toContain("agent_p2_legacy_attention_runtime_failed");
    expect(RUNTIME_SQL).toContain("null limit allowed");
    expect(RUNTIME_SQL).toContain("unicode text projection mismatch");
    expect(RUNTIME_SQL).toContain("adversarial source-bound explain mismatch");
    expect(RUNTIME_SQL).toContain("generate_series(1, 10001)");
    expect(RUNTIME_SQL).toContain('"actual rows": 501');
    expect(RUNTIME_SQL).toContain(
      "opportunities_agent_p2_legacy_attention_idx"
    );
    expect(RUNTIME_SQL).toContain(
      "email_threads_agent_p2_legacy_attention_idx"
    );
    expect(RUNTIME_SQL).toContain(
      "project_tasks_agent_p2_legacy_attention_idx"
    );
    expect(RUNTIME_SQL.endsWith("rollback;")).toBe(true);
  });
});

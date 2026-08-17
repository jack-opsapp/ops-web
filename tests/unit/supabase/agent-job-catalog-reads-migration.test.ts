import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_NAME = "20260814120000_agent_job_catalog_reads.sql";
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  MIGRATION_NAME
);
const MANIFEST_V6 = "2026-08-14.capability-manifest.v6";
const MANIFEST_V5 = "2026-08-13.capability-manifest.v5";
const MANIFEST_V4 = "2026-08-12.capability-manifest.v4";
const CAPABILITY_SCHEMA = "2026-08-14.v1";

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

function count(sourceText: string, expression: RegExp): number {
  return sourceText.match(expression)?.length ?? 0;
}

const SQL = source();
const COMPACT_SQL = compact(SQL);
const CUSTOMER_JOBS_RPC = compact(
  functionDefinition(SQL, "public.read_agent_customer_jobs_as_system")
);
const JOB_SUMMARY_RPC = compact(
  functionDefinition(SQL, "public.read_agent_job_summary_as_system")
);
const JOB_HISTORY_RPC = compact(
  functionDefinition(SQL, "public.read_agent_job_history_as_system")
);
const EVIDENCE_PAGE_RPC = compact(
  functionDefinition(
    SQL,
    "public.read_agent_correspondence_evidence_page_as_system"
  )
);
const PARTICIPANT_SNAPSHOT_RPC = compact(
  functionDefinition(SQL, "private.read_agent_job_participant_snapshot")
);
const CURRENCY_MINOR_EXPONENT_RPC = compact(
  functionDefinition(SQL, "private.agent_currency_minor_exponent")
);
const MONEY_TO_MINOR_UNITS_RPC = compact(
  functionDefinition(SQL, "private.agent_money_to_minor_units")
);

const PRIOR_READER_NAMES = [
  "read_agent_job_communication_context_as_system",
  "read_agent_job_participants_as_system",
  "read_agent_job_conversation_context_as_system",
  "read_agent_correspondence_evidence_as_system",
  "read_agent_scheduled_jobs_as_system",
  "read_agent_job_readiness_issues_as_system",
] as const;

const PRIOR_READER_RPCS = Object.fromEntries(
  PRIOR_READER_NAMES.map((name) => [
    name,
    compact(functionDefinition(SQL, `public.${name}`)),
  ])
) as Record<(typeof PRIOR_READER_NAMES)[number], string>;

const NEW_RPCS = [
  CUSTOMER_JOBS_RPC,
  JOB_SUMMARY_RPC,
  JOB_HISTORY_RPC,
  EVIDENCE_PAGE_RPC,
] as const;

const LIST_SIGNATURE =
  "public.read_agent_customer_jobs_as_system( p_request_id text, p_actor_user_id uuid, p_company_id uuid, p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_id text, p_capability_revision text, p_capability_manifest_revision text, p_required_oauth_scopes text[], p_clients_scope text, p_pipeline_scope text, p_projects_scope text, p_customer_kind text, p_customer_id uuid, p_job_kinds text[], p_lifecycle_states text[], p_opportunity_stages text[], p_project_statuses text[], p_date_field text, p_date_from timestamptz, p_date_to_exclusive timestamptz, p_read_as_of timestamptz, p_cursor_source_revision bigint, p_cursor_sort_at timestamptz, p_cursor_job_kind text, p_cursor_job_id uuid, p_limit integer ) returns jsonb";
const SUMMARY_SIGNATURE =
  "public.read_agent_job_summary_as_system( p_request_id text, p_actor_user_id uuid, p_company_id uuid, p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_id text, p_capability_revision text, p_capability_manifest_revision text, p_required_oauth_scopes text[], p_inbox_scope text, p_clients_scope text, p_pipeline_scope text, p_projects_scope text, p_calendar_scope text, p_tasks_scope text, p_photos_scope text, p_estimates_scope text, p_invoices_scope text, p_projects_financials_scope text, p_job_kind text, p_job_id uuid, p_sections text[], p_readiness_rule_codes text[], p_financial_components text[] ) returns jsonb";
const HISTORY_SIGNATURE =
  "public.read_agent_job_history_as_system( p_request_id text, p_actor_user_id uuid, p_company_id uuid, p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_id text, p_capability_revision text, p_capability_manifest_revision text, p_required_oauth_scopes text[], p_inbox_scope text, p_clients_scope text, p_pipeline_scope text, p_projects_scope text, p_calendar_scope text, p_tasks_scope text, p_estimates_scope text, p_projects_financials_scope text, p_query text, p_scope_kind text, p_customer_kind text, p_customer_id uuid, p_scope_job_kinds text[], p_job_refs jsonb, p_from timestamptz, p_to_exclusive timestamptz, p_source_types text[], p_read_as_of timestamptz, p_cursor_source_revision bigint, p_cursor_history_revision bigint, p_cursor_rank_micros bigint, p_cursor_occurred_at timestamptz, p_cursor_source_type text, p_cursor_source_id text, p_limit integer ) returns jsonb";
const EVIDENCE_SIGNATURE =
  "public.read_agent_correspondence_evidence_page_as_system( p_request_id text, p_actor_user_id uuid, p_company_id uuid, p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_id text, p_capability_revision text, p_capability_manifest_revision text, p_required_oauth_scopes text[], p_inbox_scope text, p_pipeline_scope text, p_projects_scope text, p_job_kind text, p_job_id uuid, p_evidence_ids text[], p_mode text ) returns jsonb";

describe("Task 13 job catalog read migration", () => {
  it("ships only through the frozen transactional migration and four fixed public RPCs", () => {
    expect(
      SQL,
      `${MIGRATION_NAME} is intentionally RED until implemented`
    ).not.toBe("");
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);

    for (const name of [
      "read_agent_customer_jobs_as_system",
      "read_agent_job_summary_as_system",
      "read_agent_job_history_as_system",
      "read_agent_correspondence_evidence_page_as_system",
    ]) {
      expect(
        count(
          SQL,
          new RegExp(`create or replace function public\\.${name}\\(`, "g")
        )
      ).toBe(1);
    }
  });

  it("freezes the v5-style scalar authorization prefix and capability-specific signatures", () => {
    expect(CUSTOMER_JOBS_RPC).toContain(LIST_SIGNATURE);
    expect(JOB_SUMMARY_RPC).toContain(SUMMARY_SIGNATURE);
    expect(JOB_HISTORY_RPC).toContain(HISTORY_SIGNATURE);
    expect(EVIDENCE_PAGE_RPC).toContain(EVIDENCE_SIGNATURE);

    for (const rpc of NEW_RPCS) {
      expect(rpc).not.toContain("p_manifest_hash");
      expect(rpc).not.toContain("p_capability_manifest_hash");
      expect(rpc).not.toContain("p_permission_policy");
      expect(rpc).not.toContain("p_authorization_policy");
      expect(rpc).not.toContain("p_permission_groups");
    }
  });

  it("pins Task 13 capability identities, manifest v6, and exact OAuth sets", () => {
    for (const [rpc, capability] of [
      [CUSTOMER_JOBS_RPC, "list_customer_jobs"],
      [JOB_SUMMARY_RPC, "get_job_summary"],
      [JOB_HISTORY_RPC, "search_job_history"],
      [EVIDENCE_PAGE_RPC, "get_correspondence_evidence"],
    ] as const) {
      expect(rpc).toContain(`p_capability_id is distinct from '${capability}'`);
      expect(rpc).toContain(`'${capability}:${CAPABILITY_SCHEMA}'`);
      expect(rpc).toContain(`'${MANIFEST_V6}'`);
      expect(rpc).toContain(
        "p_required_oauth_scopes is distinct from v_expected_oauth_scopes"
      );
      expect(rpc).toContain(
        "select array_agg(requested.scope order by requested.scope)"
      );
    }

    expect(CUSTOMER_JOBS_RPC).toMatch(
      /'ops\.customers\.read'::text[\s\S]*?'ops\.jobs\.read'::text/
    );
    expect(EVIDENCE_PAGE_RPC).toMatch(
      /'ops\.correspondence\.read'::text[\s\S]*?'ops\.jobs\.read'::text/
    );
    for (const scope of [
      "ops.correspondence.read",
      "ops.customer_contacts.read",
      "ops.customers.read",
      "ops.financials.read",
      "ops.jobs.read",
      "ops.photos.read",
      "ops.schedule.read",
    ]) {
      expect(`${JOB_SUMMARY_RPC} ${JOB_HISTORY_RPC}`).toContain(
        `'${scope}'::text`
      );
    }
  });

  it("reproves current actor, registry, tenant, entity, and mailbox authority in each read statement", () => {
    for (const rpc of NEW_RPCS) {
      expect(rpc).toContain("with current_authority as materialized");
      expect(rpc).toContain(
        "private.resolve_agent_actor_authority( p_actor_user_id, p_company_id, p_registered_permission_keys )"
      );
      expect(rpc).toContain(
        "authority.permission_snapshot_revision = p_permission_snapshot_revision"
      );
      expect(rpc).toContain(
        "select count(distinct registry.permission_key) from unnest(p_registered_permission_keys)"
      );
      expect(rpc).toContain("company_id = p_company_id");
      expect(rpc).toContain("auth.role() is distinct from 'service_role'");
      expect(rpc).toContain(
        "language plpgsql stable security definer set search_path = pg_catalog, public, private, extensions, pg_temp"
      );
    }

    for (const rpc of [JOB_SUMMARY_RPC, JOB_HISTORY_RPC, EVIDENCE_PAGE_RPC]) {
      expect(rpc).toContain("private.agent_user_can_access_entity(");
    }
    for (const rpc of [JOB_HISTORY_RPC, EVIDENCE_PAGE_RPC]) {
      expect(rpc).toContain("private.user_can_view_inbox_connection(");
    }
  });

  it("revokes every fixed RPC from public roles and grants only service_role", () => {
    for (const name of [
      "read_agent_customer_jobs_as_system",
      "read_agent_job_summary_as_system",
      "read_agent_job_history_as_system",
      "read_agent_correspondence_evidence_page_as_system",
    ]) {
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
  });

  it("advances all six prior public readers to service-role-only manifest-v6 wrappers", () => {
    for (const publicName of PRIOR_READER_NAMES) {
      const wrapper = PRIOR_READER_RPCS[publicName];
      expect(wrapper).not.toBe("");
      expect(wrapper).toContain("auth.role() is distinct from 'service_role'");
      expect(wrapper).toContain(
        `p_capability_manifest_revision is distinct from '${MANIFEST_V6}'`
      );
      expect(wrapper).toContain(
        "language plpgsql stable security definer set search_path = pg_catalog, public, private"
      );
      expect(wrapper).not.toContain("p_manifest_hash");
      expect(wrapper).not.toContain("p_permission_policy");
      expect(COMPACT_SQL).toMatch(
        new RegExp(
          `revoke all on function public\\.${publicName}\\([\\s\\S]*?from public, anon, authenticated, service_role;`
        )
      );
      expect(COMPACT_SQL).toMatch(
        new RegExp(
          `grant execute on function public\\.${publicName}\\([\\s\\S]*?to service_role;`
        )
      );
    }
  });

  it("rebinds every proof-bearing prior result to v6 instead of returning a v5 proof under v6 authorization", () => {
    const proofBearingPriorReaders = [
      "read_agent_job_communication_context_as_system",
      "read_agent_job_participants_as_system",
      "read_agent_job_conversation_context_as_system",
      "read_agent_scheduled_jobs_as_system",
      "read_agent_job_readiness_issues_as_system",
    ] as const;

    for (const publicName of proofBearingPriorReaders) {
      const wrapper = PRIOR_READER_RPCS[publicName];
      expect(wrapper).not.toContain(`'${MANIFEST_V5}'`);
      expect(wrapper).not.toContain(`'${MANIFEST_V4}'`);
      expect(wrapper).not.toMatch(/private\.read_agent_[a-z_]+_v[45]_impl\(/);
      expect(
        wrapper.includes(
          "p_capability_manifest_revision => p_capability_manifest_revision"
        ) || wrapper.includes("private.reprove_agent_read_jsonb_for_manifest(")
      ).toBe(true);
    }

    for (const publicName of [
      "read_agent_job_communication_context_as_system",
      "read_agent_job_participants_as_system",
    ] as const) {
      const wrapper = PRIOR_READER_RPCS[publicName];
      expect(wrapper).toContain("private.read_agent_job_participant_snapshot(");
      expect(wrapper).toContain(
        "p_capability_manifest_revision => p_capability_manifest_revision"
      );
    }
    expect(PARTICIPANT_SNAPSHOT_RPC).toContain(`'${MANIFEST_V6}'`);
    expect(PARTICIPANT_SNAPSHOT_RPC).not.toContain(`'${MANIFEST_V5}'`);
    expect(PARTICIPANT_SNAPSHOT_RPC).not.toContain(`'${MANIFEST_V4}'`);

    if (
      COMPACT_SQL.includes("private.reprove_agent_read_jsonb_for_manifest(")
    ) {
      expect(COMPACT_SQL).toContain(
        "create or replace function private.reprove_agent_read_jsonb_for_manifest("
      );
      expect(COMPACT_SQL).toContain("private.canonical_agent_projection_json(");
      expect(COMPACT_SQL).toContain("extensions.digest(");
      expect(COMPACT_SQL).toContain("'sha256:'");
      expect(COMPACT_SQL).toContain("'capability_manifest_revision'");
      expect(COMPACT_SQL).toContain("'source_content_hash'");
      expect(COMPACT_SQL).toContain("'source_version'");
      expect(COMPACT_SQL).toContain("'evidence'");
      expect(COMPACT_SQL).toContain(
        "revoke all on function private.reprove_agent_read_jsonb_for_manifest("
      );
      expect(COMPACT_SQL).not.toMatch(
        /grant execute on function private\.reprove_agent_read_jsonb_for_manifest\(/
      );
    }
  });

  it("revalidates the v6 evidence identity before bridging to the frozen v5 core", () => {
    const wrapper =
      PRIOR_READER_RPCS.read_agent_correspondence_evidence_as_system;

    expect(wrapper).toContain(
      "p_capability_id is distinct from 'get_correspondence_evidence'"
    );
    expect(wrapper).toContain(
      "p_capability_revision is distinct from 'get_correspondence_evidence:2026-08-14.v1'"
    );
    expect(wrapper).toContain(
      `p_capability_manifest_revision is distinct from '${MANIFEST_V6}'`
    );
    expect(wrapper).toMatch(
      /from private\.read_agent_correspondence_evidence_v5_impl\([\s\S]{0,500}p_capability_id, 'get_correspondence_evidence:2026-08-07\.v1', '2026-08-13\.capability-manifest\.v5'/
    );
    expect(wrapper).not.toMatch(
      /private\.read_agent_correspondence_evidence_v5_impl\([\s\S]{0,500}p_capability_id, p_capability_revision,/
    );
  });

  it("lists only current customer-linked opportunities and projects with explicit subclient-parent semantics", () => {
    for (const sourceName of [
      "public.clients",
      "public.sub_clients",
      "public.opportunities",
      "public.projects",
    ]) {
      expect(CUSTOMER_JOBS_RPC).toContain(sourceName);
    }
    expect(CUSTOMER_JOBS_RPC).toContain("sub_client.client_id = client.id");
    expect(CUSTOMER_JOBS_RPC).toContain("client.deleted_at is null");
    expect(CUSTOMER_JOBS_RPC).toContain("client.merged_into_client_id is null");
    expect(CUSTOMER_JOBS_RPC).toContain("sub_client.deleted_at is null");
    expect(CUSTOMER_JOBS_RPC).toContain("opportunity.deleted_at is null");
    expect(CUSTOMER_JOBS_RPC).toContain(
      "opportunity.merged_into_opportunity_id is null"
    );
    expect(CUSTOMER_JOBS_RPC).toContain("project.deleted_at is null");
    expect(CUSTOMER_JOBS_RPC).toContain("'sub_client_parent'");
    expect(CUSTOMER_JOBS_RPC).toContain(
      "private.resolve_opportunity_client_id( opportunity.client_ref, opportunity.client_id )"
    );
    expect(CUSTOMER_JOBS_RPC).toMatch(
      /opportunity\.client_ref is not null[\s\S]{0,220}opportunity\.client_ref is distinct from opportunity\.client_id/
    );
    expect(CUSTOMER_JOBS_RPC).toMatch(
      /opportunity\.project_ref is not null[\s\S]{0,240}opportunity\.project_ref is distinct from opportunity\.project_id/
    );
    expect(CUSTOMER_JOBS_RPC).toMatch(
      /project\.opportunity_ref is not null[\s\S]{0,320}project\.opportunity_id[\s\S]{0,160}is distinct from project\.opportunity_ref/
    );
    expect(CUSTOMER_JOBS_RPC).toContain("pg_input_is_valid(");
    expect(CUSTOMER_JOBS_RPC).toContain(
      "agent_customer_jobs_source_data_invalid"
    );
    expect(CUSTOMER_JOBS_RPC).toContain("'job_ref'");
    expect(CUSTOMER_JOBS_RPC).toContain("'anchor_refs'");
    expect(CUSTOMER_JOBS_RPC).toContain("'relationship_basis'");
    expect(CUSTOMER_JOBS_RPC).not.toContain("'conversation_id'");
    expect(CUSTOMER_JOBS_RPC).toMatch(
      /project\.start_date[\s\S]{0,120}project\.end_date/
    );
    expect(CUSTOMER_JOBS_RPC).toMatch(
      /'start_date'[\s\S]{0,180}to_char\(retained\.start_date::date, 'yyyy-mm-dd'\)/
    );
    expect(CUSTOMER_JOBS_RPC).toMatch(
      /'end_date'[\s\S]{0,180}to_char\(retained\.end_date::date, 'yyyy-mm-dd'\)/
    );
    expect(CUSTOMER_JOBS_RPC).not.toContain("'start_at'");
    expect(CUSTOMER_JOBS_RPC).not.toContain("'end_at'");
    expect(CUSTOMER_JOBS_RPC).toMatch(
      /where \(select count\(\*\) from requested_customer\) = 1/
    );
  });

  it("validates list filters against the frozen public vocabulary", () => {
    for (const value of ["opportunity", "project"]) {
      expect(CUSTOMER_JOBS_RPC).toContain(`'${value}'`);
    }
    for (const value of ["active", "terminal", "archived"]) {
      expect(CUSTOMER_JOBS_RPC).toContain(`'${value}'`);
    }
    for (const value of [
      "new_lead",
      "qualifying",
      "quoting",
      "quoted",
      "follow_up",
      "negotiation",
      "won",
      "lost",
      "discarded",
    ]) {
      expect(CUSTOMER_JOBS_RPC).toContain(`'${value}'`);
    }
    for (const value of [
      "rfq",
      "estimated",
      "accepted",
      "in_progress",
      "completed",
      "closed",
      "archived",
    ]) {
      expect(CUSTOMER_JOBS_RPC).toContain(`'${value}'`);
    }
    expect(CUSTOMER_JOBS_RPC).toContain(
      "p_date_field not in ('created_at', 'updated_at')"
    );
    expect(CUSTOMER_JOBS_RPC).toMatch(
      /\(p_date_field is null\) is distinct from \(p_date_from is null\)[\s\S]{0,180}\(p_date_to_exclusive is null\)/
    );
    expect(CUSTOMER_JOBS_RPC).toContain("p_date_to_exclusive > p_date_from");
    expect(CUSTOMER_JOBS_RPC).toContain("interval '365 days'");
    expect(CUSTOMER_JOBS_RPC).toMatch(
      /opportunity\.archived_at is not null[\s\S]{0,180}opportunity\.stage = 'discarded'[\s\S]{0,160}'archived'[\s\S]{0,420}opportunity\.stage in \('won', 'lost'\)[\s\S]{0,160}'terminal'/
    );
    expect(CUSTOMER_JOBS_RPC).toMatch(
      /project\.status = 'archived'[\s\S]{0,160}'archived'[\s\S]{0,360}project\.status in \('completed', 'closed'\)[\s\S]{0,160}'terminal'/
    );
  });

  it("collapses a valid converted pair to its canonical project and rejects ambiguous mirror ownership", () => {
    for (const field of [
      "'conversion'",
      "'converted'",
      "'not_converted'",
      "'standalone_project'",
      "'opportunity_ref'",
      "'project_ref'",
    ]) {
      expect(CUSTOMER_JOBS_RPC).toContain(field);
    }
    expect(CUSTOMER_JOBS_RPC).toContain(
      "partition by candidate.canonical_job_kind, candidate.canonical_job_id"
    );
    expect(CUSTOMER_JOBS_RPC).toContain("canonical_job_rank = 1");
    expect(CUSTOMER_JOBS_RPC).toContain(
      "agent_customer_jobs_canonical_conflict"
    );
  });

  it("prebounds list candidates with a 51 sentinel and uses the complete descending keyset", () => {
    const sentinel = CUSTOMER_JOBS_RPC.indexOf("limit 51");
    const firstAggregate = CUSTOMER_JOBS_RPC.indexOf("jsonb_agg(");
    expect(CUSTOMER_JOBS_RPC).toContain("p_limit not between 1 and 50");
    expect(sentinel).toBeGreaterThan(0);
    expect(firstAggregate).toBeGreaterThan(sentinel);
    expect(CUSTOMER_JOBS_RPC).toContain("p_cursor_source_revision");
    expect(CUSTOMER_JOBS_RPC).toContain("p_cursor_sort_at");
    expect(CUSTOMER_JOBS_RPC).toContain("p_cursor_job_kind");
    expect(CUSTOMER_JOBS_RPC).toContain("p_cursor_job_id");
    expect(CUSTOMER_JOBS_RPC).toContain(
      "order by candidate.sort_at desc, candidate.job_kind, candidate.job_id desc"
    );
    expect(CUSTOMER_JOBS_RPC).toMatch(
      /ranked\.sort_at < p_cursor_sort_at[\s\S]{0,220}ranked\.canonical_job_kind > p_cursor_job_kind[\s\S]{0,300}ranked\.canonical_job_id < p_cursor_job_id/
    );
    expect(CUSTOMER_JOBS_RPC).not.toMatch(
      /\(ranked\.sort_at, ranked\.canonical_job_kind,[\s\S]{0,160}\) </
    );
    for (const cursorClaimField of [
      "'source_revision'",
      "'read_as_of'",
      "'sort_at'",
      "'job_kind'",
      "'job_id'",
    ]) {
      expect(CUSTOMER_JOBS_RPC).toContain(cursorClaimField);
    }
    expect(CUSTOMER_JOBS_RPC).toContain("agent_customer_jobs_cursor_stale");
    expect(CUSTOMER_JOBS_RPC).not.toMatch(/\boffset\b/);
    expect(CUSTOMER_JOBS_RPC).not.toMatch(/\bselect\s+\*/);
  });

  it("returns one purpose-minimized same-statement summary and rejects project-only sections for opportunities", () => {
    for (const section of [
      "identity",
      "schedule",
      "readiness",
      "participants",
      "financials",
      "activity",
      "conversation",
    ]) {
      expect(JOB_SUMMARY_RPC).toContain(`'${section}'`);
    }
    expect(JOB_SUMMARY_RPC).toMatch(
      /p_job_kind = 'opportunity'[\s\S]{0,320}(?:'schedule'|'readiness')[\s\S]{0,160}invalid_agent_job_summary_request/
    );
    expect(JOB_SUMMARY_RPC).toMatch(
      /p_readiness_rule_codes is not null[\s\S]{0,320}'readiness' = any\(p_sections\)/
    );
    expect(JOB_SUMMARY_RPC).toContain("'estimate_rollup'");
    expect(JOB_SUMMARY_RPC).toContain("'invoice_rollup'");
    expect(JOB_SUMMARY_RPC).toMatch(
      /p_job_kind = 'opportunity'[\s\S]{0,320}'invoice_rollup'[\s\S]{0,160}invalid_agent_job_summary_request/
    );
    expect(JOB_SUMMARY_RPC).not.toContain(
      "public.read_agent_scheduled_jobs_as_system("
    );
    expect(JOB_SUMMARY_RPC).not.toContain(
      "public.read_agent_job_readiness_issues_as_system("
    );
    expect(JOB_SUMMARY_RPC).not.toContain(
      "public.read_agent_job_participants_as_system("
    );
    expect(JOB_SUMMARY_RPC).not.toContain(
      "public.read_agent_job_conversation_context_as_system("
    );
  });

  it("uses only the locked summary sources and component-gates financial reads", () => {
    for (const sourceName of [
      "public.companies",
      "public.clients",
      "public.opportunities",
      "public.projects",
      "public.project_tasks",
      "public.task_types",
      "public.project_photos",
      "public.estimates",
      "public.invoices",
      "public.stage_transitions",
      "public.project_status_lifecycle_outbox",
      "public.task_mutation_events",
      "public.job_conversations",
      "public.job_conversation_anchors",
    ]) {
      expect(JOB_SUMMARY_RPC).toContain(sourceName);
    }
    expect(JOB_SUMMARY_RPC).toContain(
      "private.read_agent_job_participant_snapshot("
    );
    expect(JOB_SUMMARY_RPC).toMatch(
      /public\.estimates[\s\S]{0,800}'estimate_rollup' = any\(p_financial_components\)/
    );
    expect(JOB_SUMMARY_RPC).toMatch(
      /public\.invoices[\s\S]{0,800}'invoice_rollup' = any\(p_financial_components\)/
    );
    expect(JOB_SUMMARY_RPC).toContain("invoice.amount_paid");
    expect(JOB_SUMMARY_RPC).toContain("invoice.balance_due");
    expect(JOB_SUMMARY_RPC).not.toContain("public.payments");
    expect(JOB_SUMMARY_RPC).toContain("9007199254740991");
    expect(JOB_SUMMARY_RPC).toContain("amount_minor");
    expect(JOB_SUMMARY_RPC).toContain("currency_code");
    expect(JOB_SUMMARY_RPC).toContain("octet_length(");
    expect(JOB_SUMMARY_RPC).toContain("left(");
  });

  it("converts every estimate and invoice amount through exact canonical currency-minor arithmetic", () => {
    expect(CURRENCY_MINOR_EXPONENT_RPC).toMatch(
      /private\.agent_currency_minor_exponent\(\s*p_currency_code text\s*\) returns (?:smallint|integer)/
    );
    expect(CURRENCY_MINOR_EXPONENT_RPC).toContain("immutable");
    expect(CURRENCY_MINOR_EXPONENT_RPC).toContain("strict");
    expect(CURRENCY_MINOR_EXPONENT_RPC).toContain(
      "set search_path = pg_catalog"
    );
    for (const [currencyCode, exponent] of [
      ["jpy", 0],
      ["cad", 2],
      ["bhd", 3],
      ["clf", 4],
    ] as const) {
      expect(CURRENCY_MINOR_EXPONENT_RPC).toMatch(
        new RegExp(`'${currencyCode}'[\\s\\S]{0,80}(?:return|then) ${exponent}`)
      );
    }
    expect(CURRENCY_MINOR_EXPONENT_RPC).toContain(
      "agent_currency_minor_exponent_unknown"
    );

    expect(MONEY_TO_MINOR_UNITS_RPC).toMatch(
      /private\.agent_money_to_minor_units\(\s*p_amount numeric,\s*p_currency_code text\s*\) returns bigint/
    );
    expect(MONEY_TO_MINOR_UNITS_RPC).toContain("immutable");
    expect(MONEY_TO_MINOR_UNITS_RPC).toContain("strict");
    expect(MONEY_TO_MINOR_UNITS_RPC).toContain(
      "private.agent_currency_minor_exponent(p_currency_code)"
    );
    expect(MONEY_TO_MINOR_UNITS_RPC).toContain("power(10::numeric");
    expect(MONEY_TO_MINOR_UNITS_RPC).toContain("trunc(");
    expect(MONEY_TO_MINOR_UNITS_RPC).toContain("9007199254740991::numeric");
    expect(MONEY_TO_MINOR_UNITS_RPC).toContain(
      "agent_money_minor_units_not_exact"
    );
    expect(MONEY_TO_MINOR_UNITS_RPC).toContain(
      "agent_money_minor_units_out_of_range"
    );
    expect(MONEY_TO_MINOR_UNITS_RPC).not.toMatch(
      /\b(?:real|float|double precision)\b/
    );
    expect(MONEY_TO_MINOR_UNITS_RPC).not.toMatch(/\*\s*100(?:\.0+)?\b/);

    for (const amount of [
      "document.total",
      "document.amount_paid",
      "document.balance_due",
    ]) {
      expect(JOB_SUMMARY_RPC).toMatch(
        new RegExp(
          `private\\.agent_money_to_minor_units\\(\\s*${amount.replace(
            ".",
            "\\."
          )},\\s*currency\\.currency_code\\s*\\)`
        )
      );
    }
    expect(JOB_HISTORY_RPC).toMatch(
      /estimate_source_state as materialized[\s\S]{0,2400}private\.agent_money_to_minor_units\(\s*estimate\.total,\s*currency\.currency_code\s*\)/
    );
    expect(COMPACT_SQL).toContain(
      "private.agent_currency_minor_exponent_or_null"
    );
    const financialReads = `${JOB_SUMMARY_RPC} ${JOB_HISTORY_RPC}`;
    expect(financialReads).not.toMatch(
      /(?:estimate|invoice)\.(?:total|amount_paid|balance_due)\s*::\s*(?:bigint|integer)/
    );
    expect(financialReads).not.toMatch(/\*\s*100(?:\.0+)?\b/);
  });

  it("returns an atomic proof-bearing claim for every requested summary section", () => {
    for (const field of [
      "'section_claims'",
      "'summary_claim'",
      "'requested_job'",
      "'section'",
      "'status'",
      "'evaluated'",
      "'not_evaluated'",
      "'value'",
      "'gap_code'",
      "'source_kind'",
      "'evidence_ids'",
    ]) {
      expect(JOB_SUMMARY_RPC).toContain(field);
    }
    expect(JOB_SUMMARY_RPC).toContain(
      "count(*) from section_claims = cardinality(p_sections)"
    );
    expect(JOB_SUMMARY_RPC).toContain("order by requested.section_rank");
  });

  it("searches only the five locked history source types", () => {
    for (const sourceType of [
      "delivered_correspondence",
      "current_memory_summary",
      "job_status_event",
      "task_event",
      "estimate_document",
    ]) {
      expect(JOB_HISTORY_RPC).toContain(`'${sourceType}'`);
    }
    expect(JOB_HISTORY_RPC).not.toMatch(
      /'activity'\s*=\s*any\(p_source_types\)/
    );
    expect(JOB_HISTORY_RPC).not.toMatch(
      /'schedule'\s*=\s*any\(p_source_types\)/
    );
    expect(JOB_HISTORY_RPC).not.toMatch(
      /'estimate'\s*=\s*any\(p_source_types\)/
    );
  });

  it("uses only delivered turns, current memory fragments, typed status/task events, and safe current estimate fields", () => {
    for (const sourceName of [
      "public.companies",
      "public.job_conversation_turns",
      "public.job_conversation_anchors",
      "public.job_conversations",
      "public.job_memory_versions",
      "public.stage_transitions",
      "public.project_status_lifecycle_outbox",
      "public.task_mutation_events",
      "public.estimates",
    ]) {
      expect(JOB_HISTORY_RPC).toContain(sourceName);
    }
    expect(JOB_HISTORY_RPC).toContain(
      "conversation.current_memory_version_id = memory.id"
    );
    for (const fragment of [
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
      expect(JOB_HISTORY_RPC).toContain(`'${fragment}'`);
    }
    for (const estimateField of [
      "estimate.estimate_number",
      "estimate.title",
      "estimate.client_message",
      "estimate.terms",
      "estimate.status",
      "estimate.total",
      "estimate.issue_date",
      "estimate.updated_at",
      "estimate.version",
    ]) {
      expect(JOB_HISTORY_RPC).toContain(estimateField);
    }
  });

  it("labels every history result with its source-specific truth kind", () => {
    for (const sourceType of [
      "delivered_correspondence",
      "job_status_event",
      "task_event",
    ]) {
      expect(JOB_HISTORY_RPC).toMatch(
        new RegExp(
          `'${sourceType}'[\\s\\S]{0,1200}'truth_kind'[\\s\\S]{0,160}'immutable_event'`
        )
      );
    }
    expect(JOB_HISTORY_RPC).toMatch(
      /'current_memory_summary'[\s\S]{0,1200}'truth_kind'[\s\S]{0,160}'derived_summary'/
    );
    expect(JOB_HISTORY_RPC).toMatch(
      /'estimate_document'[\s\S]{0,1200}'truth_kind'[\s\S]{0,160}'current_snapshot'/
    );
  });

  it("applies the latest current redaction before correspondence search, ranking, excerpts, or hashes", () => {
    expect(JOB_HISTORY_RPC).toContain(
      "public.job_conversation_redaction_events"
    );
    expect(JOB_HISTORY_RPC).toMatch(
      /redaction_kind = 'content_redacted'[\s\S]{0,500}order by redaction\.source_state_revision desc, redaction\.id desc[\s\S]{0,120}limit 1/
    );
    expect(JOB_HISTORY_RPC).toContain("then ''::text");
    expect(JOB_HISTORY_RPC).toMatch(
      /current_redacted_turn as materialized[\s\S]*?delivered_source_candidate as materialized[\s\S]*?to_tsvector\('simple'/
    );
  });

  it("prebounds every history source at 501, the union at 2001, and the page at 21 before aggregation", () => {
    expect(JOB_HISTORY_RPC).toContain("p_limit not between 1 and 20");
    expect(count(JOB_HISTORY_RPC, /limit 501/g)).toBeGreaterThanOrEqual(5);
    expect(JOB_HISTORY_RPC).toContain("source_candidate_rank <= 500");
    expect(JOB_HISTORY_RPC).toContain("limit 2001");
    expect(JOB_HISTORY_RPC).toContain("total_candidate_rank <= 2000");
    const pageSentinel = JOB_HISTORY_RPC.indexOf("limit 21");
    const firstAggregate = JOB_HISTORY_RPC.indexOf(
      "jsonb_agg(jsonb_build_object("
    );
    expect(pageSentinel).toBeGreaterThan(0);
    expect(firstAggregate).toBeGreaterThan(pageSentinel);
    expect(JOB_HISTORY_RPC).toContain("source_query_bound");
    expect(JOB_HISTORY_RPC).toContain("total_query_bound");
    expect(JOB_HISTORY_RPC).not.toMatch(/\boffset\b/);
    expect(JOB_HISTORY_RPC).not.toMatch(/\bilike\b/);
    expect(JOB_HISTORY_RPC).not.toMatch(/\bselect\s+\*/);
  });

  it("uses bounded simple-config FTS and a complete quantized-rank keyset", () => {
    expect(JOB_HISTORY_RPC).toContain("char_length(p_query) > 500");
    expect(JOB_HISTORY_RPC).toContain("octet_length(p_query)");
    expect(JOB_HISTORY_RPC).toContain("plainto_tsquery('simple', p_query)");
    expect(JOB_HISTORY_RPC).toContain("numnode(");
    expect(JOB_HISTORY_RPC).toContain("64");
    expect(JOB_HISTORY_RPC).toContain("v_read_as_of - interval '8760 hours'");
    expect(JOB_HISTORY_RPC).not.toContain("v_read_as_of - interval '365 days'");
    expect(JOB_HISTORY_RPC).toContain("rank_micros");
    expect(JOB_HISTORY_RPC).toContain("1000000");
    expect(JOB_HISTORY_RPC).toContain("'score_millionths'");
    expect(JOB_HISTORY_RPC).toContain(
      "order by candidate.rank_micros desc, candidate.occurred_at desc, candidate.source_type, candidate.source_id desc"
    );
    for (const cursorField of [
      "p_cursor_source_revision",
      "p_cursor_history_revision",
      "p_cursor_rank_micros",
      "p_cursor_occurred_at",
      "p_cursor_source_type",
      "p_cursor_source_id",
    ]) {
      expect(JOB_HISTORY_RPC).toContain(cursorField);
    }
    expect(JOB_HISTORY_RPC).toContain(
      "octet_length(p_cursor_source_id) not between 1 and 512"
    );
    for (const cursorClaimField of [
      "'source_revision'",
      "'history_revision'",
      "'read_as_of'",
      "'rank_micros'",
      "'occurred_at'",
      "'source_type'",
      "'source_id'",
    ]) {
      expect(JOB_HISTORY_RPC).toContain(cursorClaimField);
    }
    expect(JOB_HISTORY_RPC).toContain("agent_job_history_cursor_stale");
  });

  it("enforces the discriminated customer-or-jobs scope and current per-source authority", () => {
    expect(JOB_HISTORY_RPC).toContain("p_scope_kind in ('customer', 'jobs')");
    expect(JOB_HISTORY_RPC).toMatch(
      /p_scope_kind = 'customer'[\s\S]{0,600}p_customer_kind[\s\S]{0,300}p_scope_job_kinds/
    );
    expect(JOB_HISTORY_RPC).toMatch(
      /p_scope_kind = 'jobs'[\s\S]{0,500}p_job_refs/
    );
    expect(JOB_HISTORY_RPC).toContain("jsonb_array_length(p_job_refs) > 50");
    expect(JOB_HISTORY_RPC).toContain(
      "(p_scope_kind = 'customer') is distinct from"
    );
    expect(JOB_HISTORY_RPC).toMatch(
      /'delivered_correspondence', 'current_memory_summary'[\s\S]{0,120}is distinct from \(p_inbox_scope is not null\)/
    );
    expect(JOB_HISTORY_RPC).toMatch(
      /'opportunity' = any\(p_scope_job_kinds\)[\s\S]{0,500}is distinct from \(p_pipeline_scope is not null\)/
    );
    expect(JOB_HISTORY_RPC).toMatch(
      /'project' = any\(p_scope_job_kinds\)[\s\S]{0,700}'task_event' = any\(p_source_types\)[\s\S]{0,120}is distinct from \(p_projects_scope is not null\)/
    );
    for (const permission of [
      "clients.view",
      "inbox.view",
      "pipeline.view",
      "projects.view",
      "calendar.view",
      "tasks.view",
      "estimates.view",
    ]) {
      expect(JOB_HISTORY_RPC).toContain(`'${permission}'`);
    }
  });

  it("binds evidence IDs to the requested job and queries turns by parsed UUID", () => {
    expect(EVIDENCE_PAGE_RPC).toContain("cardinality(p_evidence_ids) > 20");
    expect(EVIDENCE_PAGE_RPC).toContain(
      "count(distinct requested.evidence_id)"
    );
    expect(EVIDENCE_PAGE_RPC).toContain(
      "^job_conversation_turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    );
    expect(EVIDENCE_PAGE_RPC).toContain("requested.turn_id");
    expect(EVIDENCE_PAGE_RPC).toContain("turn.id = requested.turn_id");
    expect(EVIDENCE_PAGE_RPC).not.toContain(
      "'job_conversation_turn:' || turn.id::text = any(p_evidence_ids)"
    );
    expect(EVIDENCE_PAGE_RPC).toContain("anchor.anchor_kind = p_job_kind");
    expect(EVIDENCE_PAGE_RPC).toContain("anchor.source_id = p_job_id");
    expect(EVIDENCE_PAGE_RPC).toContain(
      "private.agent_user_can_access_entity( p_actor_user_id, p_company_id, p_job_kind, p_job_id, 'view' )"
    );
    expect(EVIDENCE_PAGE_RPC).toContain(
      "agent_correspondence_evidence_not_found_or_not_visible"
    );
  });

  it("pushes excerpt/full mode into SQL and keeps full text exact-or-too-large", () => {
    expect(EVIDENCE_PAGE_RPC).toContain("p_mode in ('excerpt', 'full_text')");
    expect(EVIDENCE_PAGE_RPC).toContain("2000");
    expect(EVIDENCE_PAGE_RPC).not.toMatch(/\b4000\b/);
    expect(EVIDENCE_PAGE_RPC).toContain("'content'");
    expect(EVIDENCE_PAGE_RPC).toContain("'mode', p_mode");
    expect(EVIDENCE_PAGE_RPC).toContain("'truncated'");
    expect(EVIDENCE_PAGE_RPC).toContain(
      "agent_correspondence_evidence_full_text_too_large"
    );
    expect(EVIDENCE_PAGE_RPC).toContain(
      "agent_correspondence_evidence_source_query_bound"
    );
    expect(EVIDENCE_PAGE_RPC).toContain("text_source_query_bound");
    expect(EVIDENCE_PAGE_RPC).toMatch(
      /octet_length\(turn\.normalized_plain_text\) > 1048576[\s\S]{0,100}text_source_query_bound/
    );
    expect(EVIDENCE_PAGE_RPC).toMatch(
      /when p_mode = 'full_text'[\s\S]{0,120}turn\.safe_normalized_plain_text/
    );
    expect(EVIDENCE_PAGE_RPC).not.toMatch(
      /when p_mode = 'full_text' then[\s\S]{0,300}(?:left|substring)\(/
    );
    expect(EVIDENCE_PAGE_RPC).toContain(
      "public.job_conversation_redaction_events"
    );
    for (const key of [
      "'delivered_at'",
      "'subject'",
      "'original_content_hash'",
      "'normalized_content_hash'",
      "'attachments'",
      "'trust', 'delivered_correspondence'",
      "'evidence_ids'",
    ]) {
      expect(EVIDENCE_PAGE_RPC).toContain(key);
    }
    for (const legacyKey of ["'content_mode'", "'attachment_evidence_ids'"]) {
      expect(EVIDENCE_PAGE_RPC).not.toContain(legacyKey);
    }
    for (const redactionKind of [
      "'subject_redacted'",
      "'content_redacted'",
      "'contact_identity_redacted'",
      "'attachment_metadata_redacted'",
    ]) {
      expect(EVIDENCE_PAGE_RPC).toContain(redactionKind);
    }
    expect(EVIDENCE_PAGE_RPC).toContain(
      "'source_type', 'correspondence_evidence_projection'"
    );
    expect(EVIDENCE_PAGE_RPC).not.toContain(
      "'job_correspondence_evidence_projection'"
    );
    expect(EVIDENCE_PAGE_RPC).toContain(
      "'correspondence_evidence', evidence.raw"
    );
    expect(EVIDENCE_PAGE_RPC).toContain(
      "'atomic_claim_kind', 'correspondence_evidence'"
    );
    expect(EVIDENCE_PAGE_RPC).toContain("'claim_path', 'evidence_claims'");
    expect(EVIDENCE_PAGE_RPC).toContain(
      "'envelope_claim_path', 'collection_claim'"
    );
    expect(EVIDENCE_PAGE_RPC).toContain(
      "returned_evidence_count = requested_evidence_count"
    );
    expect(EVIDENCE_PAGE_RPC).toMatch(
      /attachment_array_state as materialized[\s\S]{0,1200}as data_invalid[\s\S]{0,320}current_turn as materialized/
    );
    expect(EVIDENCE_PAGE_RPC).toMatch(
      /cardinality\(turn\.attachment_evidence_ids\) <= 100[\s\S]{0,420}attachment_evidence_ids\[1:100\]/
    );
  });

  it("keeps observed source times behind the snapshot fence and preserves truly absent content", () => {
    expect(CUSTOMER_JOBS_RPC).toMatch(
      /opportunity\.created_at <= v_read_as_of[\s\S]{0,120}opportunity\.updated_at <= v_read_as_of[\s\S]{0,120}opportunity\.created_at <= opportunity\.updated_at/
    );
    expect(CUSTOMER_JOBS_RPC).toMatch(
      /project\.created_at <= v_read_as_of[\s\S]{0,120}project\.updated_at <= v_read_as_of[\s\S]{0,120}project\.created_at <= project\.updated_at/
    );
    expect(JOB_SUMMARY_RPC).toMatch(
      /job\.created_at > \([\s\S]{0,160}authority_context[\s\S]{0,220}job\.updated_at > \(/
    );
    for (const observedTime of [
      "transition.transitioned_at <= context.read_at",
      "status_event.requested_at <= context.read_at",
      "task_event.created_at <= context.read_at",
      "turn.delivered_at <= context.read_at",
    ]) {
      expect(JOB_SUMMARY_RPC).toContain(observedTime);
    }
    for (const scheduleMetadataTime of [
      "task.task_updated_at > task.read_at",
      "task.project_updated_at > task.read_at",
      "task.schedule_confirmed_at > task.read_at",
    ]) {
      expect(JOB_SUMMARY_RPC).toContain(scheduleMetadataTime);
    }
    for (const observedTime of [
      "turn.delivered_at <= v_read_as_of",
      "memory.created_at <= v_read_as_of",
      "status.occurred_at <= v_read_as_of",
      "task_event.created_at <= v_read_as_of",
      "estimate.updated_at <= v_read_as_of",
    ]) {
      expect(JOB_HISTORY_RPC).toContain(observedTime);
    }
    expect(EVIDENCE_PAGE_RPC).toMatch(
      /turn\.delivered_at is null[\s\S]{0,120}turn\.delivered_at > authority\.read_at[\s\S]{0,120}timestamp_source_invalid/
    );
    expect(EVIDENCE_PAGE_RPC).toMatch(
      /nullif\(btrim\(turn\.safe_normalized_plain_text\), ''\) is null[\s\S]{0,160}'state', 'absent'[\s\S]{0,100}'no_content'/
    );
    expect(EVIDENCE_PAGE_RPC).toContain(
      "left(btrim(turn.normalized_plain_text), 2000)"
    );
  });

  it("never reads forbidden generic, note, internal-note, or provider-identity sources", () => {
    for (const forbidden of [
      "public.activities",
      "public.project_notes",
      "public.spec_internal_notes",
      "estimate.internal_notes",
      "estimate.notes",
      "estimate.pdf_storage_path",
      "estimate.qb_id",
      "estimate.sage_id",
      "provider_message_id",
      "provider_delivery_source_id",
      "recipient_identities",
      "cc_recipient_identities",
      "public.email_threads",
      "public.email_messages",
    ]) {
      expect(
        `${JOB_SUMMARY_RPC} ${JOB_HISTORY_RPC} ${EVIDENCE_PAGE_RPC}`
      ).not.toContain(forbidden);
    }
  });

  it("creates source-aligned keyset and GIN indexes for every new access path", () => {
    for (const indexName of [
      "opportunities_agent_customer_jobs_created_keyset_idx",
      "opportunities_agent_customer_jobs_updated_keyset_idx",
      "projects_agent_customer_jobs_created_keyset_idx",
      "projects_agent_customer_jobs_updated_keyset_idx",
      "job_conversation_turns_agent_history_fts_idx",
      "job_memory_versions_agent_history_fts_idx",
      "stage_transitions_agent_history_keyset_idx",
      "project_status_lifecycle_agent_history_keyset_idx",
      "task_mutation_events_agent_history_keyset_idx",
      "estimates_agent_history_opportunity_keyset_idx",
      "estimates_agent_history_project_keyset_idx",
      "estimates_agent_history_fts_idx",
    ]) {
      expect(COMPACT_SQL).toContain(`create index if not exists ${indexName}`);
    }
    expect(COMPACT_SQL).toContain("using gin");
    expect(COMPACT_SQL).toContain("to_tsvector('simple'");
    expect(COMPACT_SQL).toMatch(
      /opportunities_agent_customer_jobs_updated_keyset_idx[\s\S]{0,500}company_id[\s\S]{0,300}coalesce\(client_ref, client_id\)[\s\S]{0,300}updated_at desc[\s\S]{0,120}id desc/
    );
    expect(COMPACT_SQL).toMatch(
      /projects_agent_customer_jobs_updated_keyset_idx[\s\S]{0,420}company_id[\s\S]{0,180}client_id[\s\S]{0,240}updated_at desc[\s\S]{0,120}id desc/
    );
    expect(COMPACT_SQL).toContain("where deleted_at is null");
  });

  it("extends the existing source fence and adds a distinct private safe-integer history fence", () => {
    expect(COMPACT_SQL).toContain("private.agent_operational_read_revisions");
    expect(COMPACT_SQL).toContain(
      "private.bump_agent_operational_read_revision()"
    );
    for (const table of [
      "estimates",
      "invoices",
      "job_memory_versions",
      "stage_transitions",
      "project_status_lifecycle_outbox",
      "task_mutation_events",
    ]) {
      expect(COMPACT_SQL).toContain(
        `create trigger ${table}_bump_agent_operational_read_revision`
      );
    }

    expect(COMPACT_SQL).toContain(
      "create table if not exists private.agent_job_history_revisions"
    );
    expect(COMPACT_SQL).toContain(
      "check (history_revision between 0 and 9007199254740991)"
    );
    expect(COMPACT_SQL).toContain(
      "company_id uuid primary key references public.companies(id) on delete cascade"
    );
    expect(COMPACT_SQL).toContain(
      "create trigger companies_seed_agent_job_history_revision"
    );
    expect(COMPACT_SQL).toContain(
      "create trigger email_attachments_bump_agent_job_history_revision"
    );
    expect(COMPACT_SQL).toContain("agent_job_history_revision_exhausted");
    expect(COMPACT_SQL).toContain(
      "create or replace function private.bump_agent_job_history_revision()"
    );
    for (const table of [
      "job_conversations",
      "job_conversation_anchors",
      "job_conversation_turns",
      "job_memory_versions",
      "job_conversation_redaction_events",
      "stage_transitions",
      "project_status_lifecycle_outbox",
      "task_mutation_events",
      "estimates",
    ]) {
      expect(COMPACT_SQL).toContain(
        `create trigger ${table}_bump_agent_job_history_revision`
      );
    }
    expect(COMPACT_SQL).toContain(
      "revoke all on table private.agent_job_history_revisions from public, anon, authenticated, service_role"
    );
  });

  it("returns non-index-coupled atomic claims with exact canonical projection hashes", () => {
    for (const [rpc, claimKey] of [
      [CUSTOMER_JOBS_RPC, "'job_claims'"],
      [JOB_SUMMARY_RPC, "'section_claims'"],
      [JOB_HISTORY_RPC, "'event_claims'"],
      [EVIDENCE_PAGE_RPC, "'evidence_claims'"],
    ] as const) {
      expect(rpc).toContain(claimKey);
      expect(rpc).toContain("'raw'");
      expect(rpc).toContain("'proof'");
      expect(rpc).toContain("'source_version'");
      expect(rpc).toContain("'source_content_hash'");
      expect(rpc).toContain("'evidence_id'");
      expect(rpc).toContain("'projection'");
      expect(rpc).toContain("'evidence'");
      expect(rpc).toContain("private.canonical_agent_projection_json(");
      expect(rpc).toContain("extensions.digest(");
      expect(rpc).toContain("'sha256:'");
      expect(rpc).toContain("'actor_user_id'");
      expect(rpc).toContain("'company_id'");
      expect(rpc).toContain("'capability_id'");
      expect(rpc).toContain("'capability_revision'");
      expect(rpc).toContain("'capability_manifest_revision'");
      expect(rpc).toContain("'permission_snapshot_revision'");
      expect(rpc).toContain("'canonical_input'");
      expect(rpc).toContain("'read_at'");
      expect(rpc).toContain("'retained_proof_sources'");
    }
    expect(COMPACT_SQL).not.toContain("'proofs'");
  });

  it("derives every evidence locator only from its exact encoded evidence ID", () => {
    expect(count(COMPACT_SQL, /'locator', 'ops:\/\/evidence\/'/g)).toBe(8);
    expect(COMPACT_SQL).not.toMatch(/'locator', 'ops:\/\/(?:jobs|customers)\//);

    for (const [rpc, exactBinding] of [
      [CUSTOMER_JOBS_RPC, "replace(item.evidence_id, ':', '%3a')"],
      [JOB_SUMMARY_RPC, "replace(section.evidence_id, ':', '%3a')"],
      [JOB_HISTORY_RPC, "replace(event.evidence_id, ':', '%3a')"],
      [EVIDENCE_PAGE_RPC, "replace(evidence.evidence_id, ':', '%3a')"],
    ] as const) {
      expect(rpc).toContain(exactBinding);
    }

    for (const [rpc, collectionLocator] of [
      [
        CUSTOMER_JOBS_RPC,
        "'locator', 'ops://evidence/' || replace( 'evidence:customer_jobs_collection_projection:'",
      ],
      [
        JOB_SUMMARY_RPC,
        "'locator', 'ops://evidence/' || replace( 'evidence:job_summary_projection:'",
      ],
      [
        JOB_HISTORY_RPC,
        "'locator', 'ops://evidence/' || replace( 'evidence:job_history_collection_projection:'",
      ],
      [
        EVIDENCE_PAGE_RPC,
        "'locator', 'ops://evidence/' || replace( 'evidence:correspondence_evidence_collection_projection:'",
      ],
    ] as const) {
      expect(rpc).toContain(collectionLocator);
    }
  });

  it("binds an envelope claim even for empty collections and never hashes a cursor token", () => {
    for (const rpc of [CUSTOMER_JOBS_RPC, JOB_HISTORY_RPC, EVIDENCE_PAGE_RPC]) {
      expect(rpc).toContain("'collection_claim'");
      expect(rpc).toContain("coalesce(");
      expect(rpc).toContain("'retained_proof_sources'");
      expect(rpc).not.toContain("'cursor', p_cursor");
    }
    expect(JOB_SUMMARY_RPC).toContain("'summary_claim'");
    expect(JOB_SUMMARY_RPC).not.toContain("'cursor'");
    expect(CUSTOMER_JOBS_RPC).toContain("'next_cursor_claims'");
    expect(JOB_HISTORY_RPC).toContain("'next_cursor_claims'");
    expect(EVIDENCE_PAGE_RPC).not.toContain("'next_cursor_claims'");
  });

  it("exposes source/history fences, explicit gaps, and the 60k atomic reduction contract", () => {
    for (const rpc of NEW_RPCS) {
      expect(rpc).toContain("'gaps'");
      expect(rpc).toContain("'prompt_reduction'");
      expect(rpc).toContain("'max_output_characters', 60000");
      expect(rpc).toContain("'atomic_claim_kind'");
      expect(rpc).toContain("'retention'");
      expect(rpc).toContain("'claim_path'");
      expect(rpc).toContain("'envelope_claim_path'");
      expect(rpc).toContain("octet_length(v_result::text) > 1048576");
    }
    for (const rpc of [CUSTOMER_JOBS_RPC, JOB_SUMMARY_RPC, JOB_HISTORY_RPC]) {
      expect(rpc).toContain("'source_fence'");
    }
    for (const rpc of [JOB_SUMMARY_RPC, JOB_HISTORY_RPC, EVIDENCE_PAGE_RPC]) {
      expect(rpc).toContain("'history_fence'");
    }
    expect(CUSTOMER_JOBS_RPC).toContain(
      "'retention', 'maximal_ordered_prefix'"
    );
    expect(JOB_HISTORY_RPC).toContain("'retention', 'maximal_ordered_prefix'");
    expect(JOB_SUMMARY_RPC).toContain("'retention', 'all_or_error'");
    expect(EVIDENCE_PAGE_RPC).toContain("'retention', 'all_or_error'");
  });

  it("contains no dynamic SQL or caller-controlled relation resolution", () => {
    expect(COMPACT_SQL).not.toMatch(/\bexecute\s+format\s*\(/);
    expect(COMPACT_SQL).not.toMatch(/\bexecute\s+immediate\b/);
    expect(COMPACT_SQL).not.toContain("quote_ident(");
    expect(COMPACT_SQL).not.toContain("p_table_name");
    expect(COMPACT_SQL).not.toContain("p_relation");
  });
});

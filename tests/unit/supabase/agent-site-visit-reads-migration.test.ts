import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_NAME = "20260828211605_agent_site_visit_reads.sql";
const BODY_PATH = join(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/site-visits/sql/agent_site_visit_reads.body.sql"
);
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  MIGRATION_NAME
);
const RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-site-visit-reads-runtime.sql"
);

function read(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function compact(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function replaceExactly(
  value: string,
  oldFragment: string,
  newFragment: string,
  expectedCount: number
) {
  expect(value.split(oldFragment).length - 1).toBe(expectedCount);
  return value.split(oldFragment).join(newFragment);
}

function canonicalTimestamp(expression: string) {
  return `pg_catalog.date_bin( interval '1 millisecond', ${expression}, timestamptz '2000-01-01 00:00:00+00' )`;
}

function repairNullableClientVisibility(value: string) {
  let repaired = replaceExactly(
    value,
    `        raw.opportunity_id is not null
        and raw.client_id is not null
`,
    `        raw.opportunity_id is not null
`,
    4
  );
  repaired = replaceExactly(
    repaired,
    `               visit.opportunity_id,
               coalesce(
                 visit.client_ref,`,
    `               visit.opportunity_id,
               (
                 visit.client_ref is not null
                 or visit.client_id is not null
               ) as has_client_reference,
               (
                 visit.client_id is not null
                 and private.agent_p2_site_visit_uuid_from_text(
                   visit.client_id
                 ) is null
                 or visit.client_ref is not null
                    and visit.client_id is not null
                    and visit.client_ref is distinct from
                      private.agent_p2_site_visit_uuid_from_text(
                        visit.client_id
                      )
               ) as client_reference_invalid,
               coalesce(
                 visit.client_ref,`,
    4
  );
  repaired = replaceExactly(
    repaired,
    "\n        and client.id is not null",
    "",
    2
  );
  repaired = replaceExactly(
    repaired,
    `    left join public.clients client
      on client.id = raw.client_id`,
    `    left join public.clients client
      on client.id = coalesce(
        raw.client_id,
        opportunity.client_ref,
        opportunity.client_id
      )`,
    2
  );
  repaired = replaceExactly(
    repaired,
    `        or raw.opportunity_id is null
           and raw.project_ref is null
           and raw.project_id is null
           and p_resolved_permission_scopes ->> 'pipeline.view' = 'all'`,
    `        or raw.opportunity_id is null
           and raw.project_ref is null
           and raw.project_id is null
           and not raw.has_client_reference
           and p_resolved_permission_scopes ->> 'pipeline.view' = 'all'`,
    2
  );
  repaired = replaceExactly(
    repaired,
    `        and private.agent_user_can_access_entity(
          p_actor_user_id,
          p_company_id,
          'client',
          raw.client_id,
          'view'
        )`,
    `        and (
          not raw.has_client_reference
          and opportunity.client_ref is null
          and opportunity.client_id is null
          or not raw.client_reference_invalid
             and (
               opportunity.client_ref is null
               or opportunity.client_id is null
               or opportunity.client_ref = opportunity.client_id
             )
             and (
               raw.client_id is null
               or coalesce(
                    opportunity.client_ref,
                    opportunity.client_id
                  ) is null
               or raw.client_id = coalesce(
                    opportunity.client_ref,
                    opportunity.client_id
                  )
             )
             and coalesce(
               raw.client_id,
               opportunity.client_ref,
               opportunity.client_id
             ) is not null
             and client.id is not null
             and private.agent_user_can_access_entity(
               p_actor_user_id,
               p_company_id,
               'client',
               coalesce(
                 raw.client_id,
                 opportunity.client_ref,
                 opportunity.client_id
               ),
               'view'
             )
        )`,
    2
  );
  repaired = replaceExactly(
    repaired,
    `    select visit.*,
           coalesce(
             visit.client_ref,`,
    `    select visit.*,
           (
             visit.client_ref is not null
             or visit.client_id is not null
           ) as has_client_reference,
           (
             visit.client_id is not null
             and private.agent_p2_site_visit_uuid_from_text(
               visit.client_id
             ) is null
             or visit.client_ref is not null
                and visit.client_id is not null
                and visit.client_ref is distinct from
                  private.agent_p2_site_visit_uuid_from_text(
                    visit.client_id
                  )
           ) as client_reference_invalid,
           coalesce(
             visit.client_ref,`,
    1
  );
  repaired = replaceExactly(
    repaired,
    `
      and source.resolved_client_id is not null
      and client.id is not null`,
    "",
    1
  );
  repaired = replaceExactly(
    repaired,
    `  ), selected_visit as materialized (
    select source.*
    from visit_source_gate source`,
    `  ), selected_visit as materialized (
    select source.*,
           coalesce(
             source.resolved_client_id,
             opportunity.client_ref,
             opportunity.client_id
           ) as effective_client_id
    from visit_source_gate source`,
    1
  );
  repaired = replaceExactly(
    repaired,
    `    left join public.clients client
      on client.id = source.resolved_client_id`,
    `    left join public.clients client
      on client.id = coalesce(
        source.resolved_client_id,
        opportunity.client_ref,
        opportunity.client_id
      )`,
    1
  );
  repaired = replaceExactly(
    repaired,
    `      or p_expected_anchor = 'unlinked'
         and source.opportunity_id is null
         and source.project_ref is null
         and source.project_id is null
         and p_resolved_permission_scopes ->> 'pipeline.view' = 'all'`,
    `      or p_expected_anchor = 'unlinked'
         and source.opportunity_id is null
         and source.project_ref is null
         and source.project_id is null
         and not source.has_client_reference
         and p_resolved_permission_scopes ->> 'pipeline.view' = 'all'`,
    1
  );
  repaired = replaceExactly(
    repaired,
    `      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'client',
        source.resolved_client_id,
        'view'
      )`,
    `      and (
        not source.has_client_reference
        and opportunity.client_ref is null
        and opportunity.client_id is null
        or not source.client_reference_invalid
           and (
             opportunity.client_ref is null
             or opportunity.client_id is null
             or opportunity.client_ref = opportunity.client_id
           )
           and (
             source.resolved_client_id is null
             or coalesce(
                  opportunity.client_ref,
                  opportunity.client_id
                ) is null
             or source.resolved_client_id = coalesce(
                  opportunity.client_ref,
                  opportunity.client_id
                )
           )
           and coalesce(
             source.resolved_client_id,
             opportunity.client_ref,
             opportunity.client_id
           ) is not null
           and client.id is not null
           and private.agent_user_can_access_entity(
             p_actor_user_id,
             p_company_id,
             'client',
             coalesce(
               source.resolved_client_id,
               opportunity.client_ref,
               opportunity.client_id
             ),
             'view'
           )
      )`,
    1
  );
  return replaceExactly(
    repaired,
    `           selected.resolved_client_id,
           selected.site_visit_revision,`,
    `           selected.effective_client_id as resolved_client_id,
           selected.site_visit_revision,`,
    1
  );
}

function definition(sql: string, name: string) {
  const marker = `create or replace function ${name}(`;
  const start = sql.lastIndexOf(marker);
  if (start < 0) return "";
  const tail = sql.slice(start);
  const delimiter = /\bas\s+(\$[a-z0-9_]*\$)/.exec(tail)?.[1];
  if (!delimiter) return "";
  const end = tail.indexOf(`${delimiter};`);
  return end < 0 ? "" : tail.slice(0, end + delimiter.length + 1);
}

function between(value: string, start: string, end: string) {
  const startIndex = value.indexOf(start);
  if (startIndex < 0) return "";
  const endIndex = value.indexOf(end, startIndex + start.length);
  return endIndex < 0 ? "" : value.slice(startIndex, endIndex);
}

const BODY_EXACT = read(BODY_PATH);
const MIGRATION_EXACT = read(MIGRATION_PATH);
const SQL = BODY_EXACT.toLowerCase();
const COMPACT = compact(BODY_EXACT);
const SIGNATURE_COMPACT = COMPACT.replace(/\s*([(),])\s*/g, "$1");
const ATTENTION_TYPE_SIGNATURE =
  "uuid,uuid,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,timestamp with time zone,integer,integer";
const LIST_PRIVATE = compact(
  definition(SQL, "private.agent_p2_site_visit_list_v1")
);
const CONTEXT_PRIVATE = compact(
  definition(SQL, "private.agent_p2_site_visit_context_v1")
);
const ATTENTION_PRIVATE = compact(
  definition(SQL, "private.agent_p2_site_visit_attention_v1")
);
const SUMMARY_PRIVATE = compact(
  definition(SQL, "private.agent_p2_site_visit_summary_v1")
);
const LIST_PUBLIC = compact(
  definition(SQL, "public.read_agent_site_visits_as_system")
);
const CONTEXT_PUBLIC = compact(
  definition(SQL, "public.read_agent_site_visit_context_as_system")
);
const BOOKED_GATE = between(
  LIST_PRIVATE,
  "from public.site_visits visit where p_view_kind = 'booked_appointments'",
  "union all"
);
const HISTORY_GATE = between(
  LIST_PRIVATE,
  "from public.site_visits visit where p_view_kind = 'visit_history'",
  ") candidate"
);
const BOOKED_FILTER = between(
  BOOKED_GATE,
  "where p_view_kind = 'booked_appointments'",
  "order by pg_catalog.date_bin"
);
const HISTORY_FILTER = between(
  HISTORY_GATE,
  "where p_view_kind = 'visit_history'",
  "order by pg_catalog.date_bin"
);
const LIST_RAW_SOURCE_GATE = between(
  LIST_PRIVATE,
  "raw_source_gate as materialized (",
  "), raw_source_state as materialized ("
);
const LIST_SELECTED_SOURCE = between(
  LIST_PRIVATE,
  "selected_source as materialized (",
  "), authorized_source as materialized ("
);
const ATTENTION_RAW_SOURCE_GATE = between(
  ATTENTION_PRIVATE,
  "raw_source_gate as materialized (",
  "), raw_source_state as materialized ("
);
const ATTENTION_SELECTED_SOURCE = between(
  ATTENTION_PRIVATE,
  "selected_source as materialized (",
  "), authorized_source as materialized ("
);
const ARTIFACT_CONTEXT_REVISIONS = between(
  CONTEXT_PRIVATE,
  "v_source_revisions := case when v_artifact_selected then",
  "else pg_catalog.jsonb_build_array"
);
const RUNTIME = compact(read(RUNTIME_PATH));
const RESERVED_MIGRATIONS = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith("_agent_site_visit_reads.sql"));

describe("P2 site-visit read SQL body", () => {
  it("keeps the official reservation immutable and derives the current body exactly", () => {
    expect(RESERVED_MIGRATIONS).toEqual([MIGRATION_NAME]);
    expect(BODY_EXACT).not.toBe("");
    const canonicallyOrdered = replaceExactly(
      MIGRATION_EXACT,
      "scope.value order by scope.value)",
      'scope.value order by scope.value collate "C")',
      2
    );
    const postgresUuidCompatible = replaceExactly(
      canonicallyOrdered,
      "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
      "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
      1
    );
    expect(repairNullableClientVisibility(postgresUuidCompatible)).toBe(
      BODY_EXACT
    );
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("task 12 canonical site-visit read body");
    expect(SQL).toContain("do $prerequisites$");
    expect(SQL).toContain("do $postflight$");
  });

  it("defines fixed private projections and exactly two service-only public readers", () => {
    for (const value of [
      LIST_PRIVATE,
      CONTEXT_PRIVATE,
      ATTENTION_PRIVATE,
      LIST_PUBLIC,
      CONTEXT_PUBLIC,
    ]) {
      expect(value).not.toBe("");
      expect(value).toContain("stable");
      expect(value).toContain("set search_path = ''");
    }
    for (const value of [LIST_PRIVATE, CONTEXT_PRIVATE, ATTENTION_PRIVATE]) {
      expect(value).toContain("security invoker");
    }
    for (const value of [LIST_PUBLIC, CONTEXT_PUBLIC]) {
      expect(value).toContain("security definer");
      expect(value).toContain("auth.role() is distinct from 'service_role'");
    }
    expect(
      COMPACT.match(/create or replace function public\.read_agent_/g)
    ).toHaveLength(2);
    expect(COMPACT).toContain(
      "grant execute on function public.read_agent_site_visits_as_system"
    );
    expect(COMPACT).toContain(
      "grant execute on function public.read_agent_site_visit_context_as_system"
    );
    expect(COMPACT).not.toContain(
      "grant execute on function private.agent_p2_site_visit"
    );
    expect(COMPACT).toContain("to service_role");
  });

  it("re-proves the current OAuth grant, client ceiling, actor policy, and revision fence in each statement", () => {
    for (const value of [LIST_PRIVATE, CONTEXT_PRIVATE]) {
      expect(value).toContain("private.mcp_oauth_grants");
      expect(value).toContain("private.mcp_oauth_clients");
      expect(value).toContain("p_oauth_grant_id");
      expect(value).toContain("p_oauth_client_id");
      expect(value).toContain("p_grant_revision");
      expect(value).toContain("revoked_at is null");
      expect(value).toContain("disabled_at is null");
      expect(value).toContain("p_granted_scope_ceiling");
      expect(value).toContain("p_required_oauth_scopes");
      expect(value).toContain("consent_catalog_revision");
      expect(value).toContain("exposure_revision");
      expect(value).toContain("private.resolve_agent_actor_authority(");
      expect(value).toContain(
        "authority.permission_snapshot_revision = p_permission_snapshot_revision"
      );
      expect(value).toContain("p_resolved_permission_scopes");
      expect(value).toContain("private.agent_read_domain_revisions");
      expect(value).toContain("'site_visits'");
    }
    expect(CONTEXT_PRIVATE).toContain("'artifacts'");
  });

  it("enforces exact linked and genuinely-unlinked visit authority without caller-selected nominal authority", () => {
    for (const value of [LIST_PRIVATE, CONTEXT_PRIVATE, ATTENTION_PRIVATE]) {
      expect(value).toContain("left join public.opportunities");
      expect(value).toContain("left join public.clients");
      expect(value).toContain("opportunity.company_id = p_company_id");
      expect(value).toContain("opportunity.deleted_at is null");
      expect(value).toContain("opportunity.merged_into_opportunity_id is null");
      expect(value).toContain("client.company_id = p_company_id");
      expect(value).toContain("client.deleted_at is null");
      expect(value).toContain("client.merged_into_client_id is null");
      expect(value).toContain("private.agent_user_can_access_entity(");
      expect(value).toContain("'opportunity'");
      expect(value).toContain("'client'");
      expect(value).toContain(
        "p_resolved_permission_scopes ->> 'calendar.view' = 'all'"
      );
      expect(value).toMatch(/\b(?:visit|source|raw)\.created_by/);
      expect(value).toMatch(/\b(?:visit|source|raw)\.assignee_ids/);
      expect(value).toMatch(/\b(?:visit|source|raw)\.opportunity_id is null/);
      expect(value).toMatch(/\b(?:visit|source|raw)\.project_ref is null/);
      expect(value).toMatch(/\b(?:visit|source|raw)\.project_id is null/);
      expect(value).toContain(
        "p_resolved_permission_scopes ->> 'pipeline.view' = 'all'"
      );
    }
    for (const value of [LIST_PRIVATE, ATTENTION_PRIVATE]) {
      expect(value).toMatch(
        /\b(?:visit|source|raw)\.opportunity_id is not null/
      );
    }
    expect(CONTEXT_PRIVATE).toContain(
      "p_expected_anchor not in ('opportunity', 'unlinked')"
    );
    expect(CONTEXT_PRIVATE).toMatch(
      /p_expected_anchor = 'opportunity' and (?:visit|source|selected)\.opportunity_id = p_expected_opportunity_id/
    );
    expect(CONTEXT_PRIVATE).toContain(
      "(p_expected_anchor = 'opportunity') is distinct from (p_expected_opportunity_id is not null)"
    );
  });

  it("uses booked_at-only ascending and created_at-only descending physical keysets", () => {
    expect(BOOKED_GATE).not.toBe("");
    expect(BOOKED_GATE).toContain("visit.booked_at is not null");
    expect(BOOKED_GATE).toContain(
      `${canonicalTimestamp("visit.booked_at")} >= p_window_from`
    );
    expect(BOOKED_GATE).toContain(
      `${canonicalTimestamp("visit.booked_at")} < p_window_to`
    );
    expect(BOOKED_GATE).toContain(
      `( ${canonicalTimestamp("visit.booked_at")}, visit.id ) > (p_after_order_at, p_after_site_visit_id)`
    );
    expect(BOOKED_GATE).toContain(
      `order by ${canonicalTimestamp("visit.booked_at")}, visit.id`
    );
    expect(BOOKED_GATE).toContain("limit 501");
    expect(BOOKED_FILTER).not.toContain("scheduled_at");
    expect(BOOKED_FILTER).not.toContain("created_at");

    expect(HISTORY_GATE).not.toBe("");
    expect(HISTORY_GATE).toContain("visit.created_at is not null");
    expect(HISTORY_GATE).toContain(
      `${canonicalTimestamp("visit.created_at")} >= p_window_from`
    );
    expect(HISTORY_GATE).toContain(
      `${canonicalTimestamp("visit.created_at")} < p_window_to`
    );
    expect(HISTORY_GATE).toContain(
      `( ${canonicalTimestamp("visit.created_at")}, visit.id ) < (p_after_order_at, p_after_site_visit_id)`
    );
    expect(HISTORY_GATE).toContain(
      `order by ${canonicalTimestamp("visit.created_at")} desc, visit.id desc`
    );
    expect(HISTORY_GATE).toContain("limit 501");
    expect(HISTORY_FILTER).not.toContain("booked_at");
    expect(HISTORY_FILTER).not.toContain("scheduled_at");
  });

  it("applies every non-indexed selector only after the fail-closed 501-row physical gate", () => {
    for (const gate of [LIST_RAW_SOURCE_GATE, ATTENTION_RAW_SOURCE_GATE]) {
      expect(gate).not.toBe("");
      expect(gate).not.toContain("p_statuses");
      expect(gate).not.toContain("p_include_unlinked");
      expect(gate).not.toContain("p_assignee_user_id");
      expect(gate).not.toContain("p_opportunity_id");
      expect(gate).not.toMatch(/and visit\.opportunity_id is (?:not )?null/);
      expect(gate).not.toMatch(/and visit\.project_(?:ref|id) is null/);
    }

    expect(LIST_SELECTED_SOURCE).not.toBe("");
    expect(LIST_SELECTED_SOURCE).toContain("from raw_source_gate raw");
    expect(LIST_SELECTED_SOURCE).toContain("raw_state.source_count < 501");
    expect(LIST_SELECTED_SOURCE).toContain("raw.status = any(p_statuses)");
    expect(LIST_SELECTED_SOURCE).toContain("p_include_unlinked");
    expect(LIST_SELECTED_SOURCE).toContain("p_assignee_user_id");
    expect(LIST_SELECTED_SOURCE).toContain("p_opportunity_id");
    expect(LIST_PRIVATE).toContain("from selected_source raw");

    expect(ATTENTION_SELECTED_SOURCE).not.toBe("");
    expect(ATTENTION_SELECTED_SOURCE).toContain("from raw_source_gate raw");
    expect(ATTENTION_SELECTED_SOURCE).toContain("state.source_count < 501");
    expect(ATTENTION_SELECTED_SOURCE).toContain("raw.status = any(p_statuses)");
    expect(ATTENTION_SELECTED_SOURCE).toContain("p_include_unlinked");
    expect(ATTENTION_PRIVATE).toContain("from selected_source raw");
    expect(ATTENTION_PRIVATE).toContain("from selected_source source");
  });

  it("canonicalizes production microseconds before summaries, proofs, cursors, and attention", () => {
    for (const expression of [
      "p_booked_at",
      "p_scheduled_at",
      "p_created_at",
      "p_completed_at",
    ]) {
      expect(SUMMARY_PRIVATE).toContain(canonicalTimestamp(expression));
    }
    expect(LIST_PRIVATE).toContain(
      `${canonicalTimestamp("visit.booked_at")} as order_at`
    );
    expect(LIST_PRIVATE).toContain(canonicalTimestamp("visit.created_at"));
    expect(CONTEXT_PRIVATE).toContain(
      `${canonicalTimestamp("selected.created_at")} as created_at`
    );
    expect(ATTENTION_PRIVATE).toContain(
      `${canonicalTimestamp("visit.booked_at")} as attention_at`
    );
    expect(ATTENTION_PRIVATE).toContain(canonicalTimestamp("visit.created_at"));
    expect(COMPACT).not.toContain("agent_p2_site_visit_canonical_timestamp");
    expect(COMPACT).not.toContain(
      "p_created_at is distinct from pg_catalog.date_trunc( 'milliseconds', p_created_at )"
    );
    expect(COMPACT).not.toContain(
      "p_completed_at is distinct from pg_catalog.date_trunc( 'milliseconds', p_completed_at )"
    );
  });

  it("treats the canonical empty history status vector as all closed statuses", () => {
    expect(LIST_PRIVATE).toContain(
      "pg_catalog.cardinality(p_statuses) not between 0 and 4"
    );
    expect(LIST_PRIVATE).toContain(
      "p_statuses is distinct from coalesce(( select pg_catalog.array_agg(status.value order by status.value)"
    );
    expect(LIST_PRIVATE).toContain("), array[]::text[])");
    expect(LIST_SELECTED_SOURCE).toContain(
      "pg_catalog.cardinality(p_statuses) = 0 or raw.status = any(p_statuses)"
    );
  });

  it("pins 25/26/501 bounds, cursor echo, and fixed attention selectors", () => {
    expect(LIST_PRIVATE).toContain("p_item_limit not between 1 and 25");
    expect(LIST_PRIVATE).toContain(
      "p_page_fetch_limit is distinct from p_item_limit + 1"
    );
    expect(LIST_PRIVATE).toContain("p_page_fetch_limit not between 2 and 26");
    expect(LIST_PRIVATE).toContain("p_source_limit is distinct from 501");
    expect(LIST_PRIVATE).toContain("agent_site_visit_source_query_bound");
    expect(LIST_PRIVATE).toContain("agent_site_visit_read_stale");
    expect(LIST_PRIVATE).toContain("'cursor_source_revisions'");
    expect(LIST_PRIVATE).toContain("'cursor_predecessor'");
    expect(ATTENTION_PRIVATE).toContain(
      "p_view_kind not in ('booked_appointments', 'visit_history')"
    );
    expect(ATTENTION_PRIVATE).toContain("p_item_limit not between 1 and 25");
    expect(ATTENTION_PRIVATE).toContain("p_source_limit is distinct from 501");
    expect(ATTENTION_PRIVATE).toContain("'source_domain', 'site_visits'");
    expect(SIGNATURE_COMPACT).toContain(
      `private.agent_p2_site_visit_attention_v1(${ATTENTION_TYPE_SIGNATURE})`
    );
    for (const key of [
      "'projection_revision'",
      "'selector'",
      "'read_at'",
      "'source_versions'",
      "'source_inspected_count'",
      "'returned_count'",
      "'has_more'",
      "'cards'",
      "'card_kind', 'site_visit'",
      "'site_visit_ref'",
      "'opportunity_ref'",
      "'status'",
      "'booking_state'",
      "'attention_at'",
    ]) {
      expect(ATTENTION_PRIVATE).toContain(key);
    }
    expect(ATTENTION_PRIVATE).toContain("'agent-p2-site-visit-attention:v1'");
    expect(ATTENTION_PRIVATE).toContain(
      `${canonicalTimestamp("visit.booked_at")} as attention_at`
    );
    expect(ATTENTION_PRIVATE).toContain(canonicalTimestamp("visit.created_at"));
    expect(ATTENTION_PRIVATE).toContain(
      `order by ${canonicalTimestamp("visit.booked_at")}, visit.id`
    );
    expect(ATTENTION_PRIVATE).toContain(
      `order by ${canonicalTimestamp("visit.created_at")} desc, visit.id desc`
    );

    const rawGate = ATTENTION_PRIVATE.indexOf(
      "raw_source_gate as materialized"
    );
    const rawLimit = ATTENTION_PRIVATE.indexOf("limit 501", rawGate);
    const selectorGate = ATTENTION_PRIVATE.indexOf(
      "selected_source as materialized",
      rawGate
    );
    const authorityGate = ATTENTION_PRIVATE.indexOf(
      "authorized_source as materialized",
      rawGate
    );
    expect(rawGate).toBeGreaterThanOrEqual(0);
    expect(rawLimit).toBeGreaterThan(rawGate);
    expect(selectorGate).toBeGreaterThan(rawLimit);
    expect(authorityGate).toBeGreaterThan(selectorGate);
  });

  it("keeps notes, measurements, and checklist values opt-in, bounded, and marked untrusted", () => {
    expect(CONTEXT_PRIVATE).toContain("'notes' = any(p_sections)");
    expect(CONTEXT_PRIVATE).toContain("'measurements' = any(p_sections)");
    expect(CONTEXT_PRIVATE).toContain("'checklist_answers' = any(p_sections)");
    expect(CONTEXT_PRIVATE).toContain("'checklist_summary' = any(p_sections)");
    expect(CONTEXT_PRIVATE).toContain("answer.company_id = p_company_id::text");
    expect(CONTEXT_PRIVATE).toContain(
      "p_checklist_answer_fetch_limit = p_checklist_answer_limit + 1"
    );
    expect(CONTEXT_PRIVATE).toContain(
      "p_checklist_answer_limit between 1 and 25"
    );
    expect(CONTEXT_PRIVATE).toContain(
      "'content_kind', 'untrusted_business_data'"
    );
    expect(CONTEXT_PRIVATE).toContain("public.site_visit_checklist_answers");
    expect(CONTEXT_PRIVATE).toContain("answer.answer_value");
    expect(CONTEXT_PRIVATE).toContain("answer.sort_order");
    const checklistGate = CONTEXT_PRIVATE.indexOf(
      "raw_checklist_gate as materialized"
    );
    const checklistLimit = CONTEXT_PRIVATE.indexOf("limit 501", checklistGate);
    const checklistProjection = CONTEXT_PRIVATE.indexOf(
      "projected as materialized",
      checklistGate
    );
    expect(checklistGate).toBeGreaterThanOrEqual(0);
    expect(checklistLimit).toBeGreaterThan(checklistGate);
    expect(checklistProjection).toBeGreaterThan(checklistLimit);
  });

  it("uses Task 10's frozen private artifact projection with a server-derived nominal visit variant", () => {
    expect(COMPACT).toContain(
      "private.agent_p2_artifact_private_evidence_v1(uuid,uuid,text,text[],jsonb,text,uuid,text[],integer)"
    );
    expect(CONTEXT_PRIVATE).toContain(
      "private.agent_p2_artifact_private_evidence_v1("
    );
    expect(CONTEXT_PRIVATE).toMatch(
      /case when [a-z0-9_.]+\.opportunity_id is null then 'site_visit_unlinked' else 'site_visit_linked' end/
    );
    expect(CONTEXT_PRIVATE).toContain("array['site_visit_artifact']::text[]");
    expect(CONTEXT_PRIVATE).toContain("p_artifact_source_limit");
    expect(CONTEXT_PRIVATE).not.toContain("agent_artifact_source_query_bound");
    expect(CONTEXT_PRIVATE).toContain(
      "p_resolved_permission_scopes ->> 'photos.view'"
    );
    expect(CONTEXT_PRIVATE).toContain(
      "'deck_builder.view', case when v_deck_selected"
    );
    expect(CONTEXT_PRIVATE).toContain(
      "v_deck_selected and ( p_resolved_permission_scopes ->> 'deck_builder.view' is distinct from 'all' and p_resolved_permission_scopes ->> 'deck_builder.view' is distinct from 'assigned' )"
    );
    expect(CONTEXT_PRIVATE).toContain(
      "v_deck_selected and p_resolved_permission_scopes ->> 'deck_builder.view' is distinct from 'all'"
    );
    expect(CONTEXT_PRIVATE).toContain(
      "v_deck_selected and not ('deck_builder.view' = any(p_registered_permission_keys))"
    );
    expect(CONTEXT_PRIVATE).toContain(
      "v_expected_permission_scopes ? ( permission.value ->> 'permission' )"
    );
    expect(CONTEXT_PRIVATE).toContain("'artifact_summary'");
    expect(CONTEXT_PRIVATE).toContain("'deck_design_refs'");
    expect(CONTEXT_PRIVATE).toContain("artifact.artifact_kind");
    expect(CONTEXT_PRIVATE).toContain("artifact.review_state");
    expect(CONTEXT_PRIVATE).toContain("artifact.deck_design_ref");
    expect(ARTIFACT_CONTEXT_REVISIONS).not.toBe("");
    expect(
      ARTIFACT_CONTEXT_REVISIONS.indexOf("'domain', 'artifacts'")
    ).toBeGreaterThanOrEqual(0);
    expect(
      ARTIFACT_CONTEXT_REVISIONS.indexOf("'domain', 'artifacts'")
    ).toBeLessThan(
      ARTIFACT_CONTEXT_REVISIONS.indexOf("'domain', 'site_visits'")
    );
  });

  it("projects only safe summaries and opaque deck references", () => {
    expect(CONTEXT_PRIVATE).toContain("'source_count'");
    expect(CONTEXT_PRIVATE).toContain("'kind_counts'");
    expect(CONTEXT_PRIVATE).toContain("'review_inclusion'");
    expect(CONTEXT_PRIVATE).toContain("'deck_design_ref'");
    expect(CONTEXT_PRIVATE).not.toContain("public.deck_designs");
    for (const forbidden of [
      "'drawing_data'",
      "'geometry'",
      "'appointment_attendees'",
      "'appointment_handoff_id'",
      "'google_calendar_event_id'",
      "'google_calendar_id'",
      "'calendar_event_id'",
      "'provider_id'",
      "'internal_notes'",
      "'identity_drafts'",
      "'photos'",
      "'asset_url'",
      "'rendered_asset_url'",
      "'thumbnail_url'",
      "'raw_locator'",
      "'inline_text'",
      "'dimensions'",
      "'layers'",
    ]) {
      expect(LIST_PRIVATE).not.toContain(forbidden);
      expect(CONTEXT_PRIVATE).not.toContain(forbidden);
      expect(LIST_PUBLIC).not.toContain(forbidden);
      expect(CONTEXT_PUBLIC).not.toContain(forbidden);
      expect(ATTENTION_PRIVATE).not.toContain(forbidden);
    }
  });

  it("binds exact list/context proofs to authority, query, source revisions, source counts, and returned children", () => {
    for (const value of [LIST_PRIVATE, CONTEXT_PRIVATE]) {
      for (const binding of [
        "'actor_user_id', p_actor_user_id",
        "'company_id', p_company_id",
        "'oauth_grant_id', p_oauth_grant_id",
        "'oauth_client_id', p_oauth_client_id",
        "'grant_revision', p_grant_revision",
        "'granted_scope_ceiling'",
        "'permission_snapshot_revision'",
        "'capability_manifest_revision'",
        "'required_oauth_scopes'",
        "'calendar_scope'",
        "'clients_scope'",
        "'deck_builder_scope'",
        "'pipeline_scope'",
        "'photos_scope'",
        "'read_at'",
        "'source_revisions'",
        "'source_inspected'",
      ]) {
        expect(value).toContain(binding);
      }
      expect(value).toContain("private.agent_p2_site_visit_hash_ref(");
      expect(value).toContain("'ops_proof:v1:'");
      expect(value).toContain("'ops_evidence:v1:'");
    }
    expect(COMPACT).toContain("private.canonical_agent_projection_json(");
    expect(LIST_PRIVATE).toContain("'site_visit_list_entity'");
    expect(LIST_PRIVATE).toContain("'site_visit_list_evidence'");
    expect(LIST_PRIVATE).toContain("'site_visit_list_collection'");
    expect(LIST_PRIVATE).toContain("'returned_count'");
    expect(LIST_PRIVATE).toContain("'has_more'");
    expect(LIST_PRIVATE).toContain("'children'");
    expect(CONTEXT_PRIVATE).toContain("'site_visit_context_entity'");
    expect(CONTEXT_PRIVATE).toContain("'site_visit_context_evidence'");
    expect(CONTEXT_PRIVATE).toContain("'selected_sections'");
    expect(CONTEXT_PRIVATE).toContain("'checklist_answer_limit'");
    expect(CONTEXT_PRIVATE).toContain("'timeline_limit'");
  });

  it("catalog-audits canonical signatures, function attributes, owners, and least-privilege ACLs", () => {
    expect(COMPACT).toContain("do $canonical_acl$");
    expect(COMPACT).toContain("pg_catalog.aclexplode(");
    expect(COMPACT).toContain("agent_site_visit_function_signature_set_failed");
    expect(COMPACT).toContain("agent_site_visit_function_shape_failed");
    expect(COMPACT).toContain("agent_site_visit_function_acl_failed");
    expect(COMPACT).toContain("owner to current_user");
    expect(COMPACT).toContain("service_role:execute:false");
    expect(COMPACT).toContain(
      "revoke all on function public.read_agent_site_visits_as_system"
    );
    expect(COMPACT).toContain(
      "revoke all on function public.read_agent_site_visit_context_as_system"
    );
    for (const parserOnlyForm of [
      "nullif",
      "coalesce",
      "greatest",
      "least",
      "substring",
    ]) {
      expect(COMPACT).not.toContain(`pg_catalog.${parserOnlyForm}(`);
    }
  });

  it("supplies a rollback-only PostgreSQL 17 fixture for ACL, auth, bounds, plans, and churn", () => {
    expect(RUNTIME.startsWith("begin;")).toBe(true);
    expect(RUNTIME.endsWith("rollback;")).toBe(true);
    expect(RUNTIME).toContain("runtime_requires_postgresql_17");
    expect(RUNTIME).toContain("set local role authenticated");
    expect(RUNTIME).toContain("has_function_privilege");
    expect(RUNTIME).toContain("read_agent_site_visits_as_system");
    expect(RUNTIME).toContain("read_agent_site_visit_context_as_system");
    expect(RUNTIME).toContain("agent_site_visit_runtime_failed");
    expect(RUNTIME).toContain("revoked grant accepted");
    expect(RUNTIME).toContain("assert_site_visit_oauth_reads_rejected");
    expect(RUNTIME).toContain("disabled-client");
    expect(RUNTIME).toContain("narrowed-client-ceiling");
    expect(RUNTIME).toContain("consent-revision-mismatch");
    expect(RUNTIME).toContain("exposure-revision-mismatch");
    expect(RUNTIME).toContain("corrupted-accepted-labels");
    expect(RUNTIME).toContain("unlinked current-parent design excluded");
    expect(RUNTIME).toContain("deck section without deck authority accepted");
    expect(RUNTIME).toContain("artifact summary minted deck reference");
    expect(RUNTIME).toContain("converted-parent site visit deck");
    expect(RUNTIME).toContain("deleted design bridge");
    expect(RUNTIME).toContain("cross-company design bridge");
    expect(RUNTIME).toContain("% list accepted");
    expect(RUNTIME).toContain("% context accepted");
    expect(RUNTIME).toContain("cross-company site visit leaked");
    expect(RUNTIME).toContain("corrupt cross-tenant job links");
    expect(RUNTIME).toContain("booked_at keyset plan did not use index");
    expect(RUNTIME).toContain("created_at keyset plan did not use index");
    expect(RUNTIME).toContain("source bound not enforced");
    expect(RUNTIME).toContain("artifact source bound not propagated");
    expect(RUNTIME).toContain("agent_artifact_source_query_bound");
    expect(RUNTIME).toContain("attention source bound not enforced");
    expect(RUNTIME).toContain("hostile physical source bound not enforced");
    expect(RUNTIME).toContain("hostile status");
    expect(RUNTIME).toContain("hostile assignee");
    expect(RUNTIME).toContain("hostile opportunity");
    expect(RUNTIME).toContain("unlinked excluded");
    expect(RUNTIME).toContain("project-linked excluded");
    for (const hostileAttentionCase of [
      "attention booked hostile status",
      "attention booked hostile assignee authority",
      "attention booked missing opportunity authority",
      "attention booked unlinked excluded",
      "attention booked project-linked excluded",
      "attention history hostile status",
      "attention history hostile assignee authority",
      "attention history missing opportunity authority",
      "attention history unlinked excluded",
      "attention history project-linked excluded",
    ]) {
      expect(RUNTIME).toContain(hostileAttentionCase);
    }
    expect(RUNTIME).toContain(
      `'{"calendar.view":"own","clients.view":"all","pipeline.view":"all"}'::jsonb`
    );
    expect(RUNTIME).toContain("history attention projection invalid");
    expect(RUNTIME).toContain("site visit revision did not advance");
    expect(RUNTIME).toContain("unrelated legacy revision changed");
    expect(RUNTIME).toContain("idx_site_visits_agent_booked_order_v1");
    expect(RUNTIME).toContain("idx_site_visits_agent_history_order_v1");
    expect(RUNTIME).toContain("explain (analyze, buffers, format json)");
    expect(RUNTIME).toContain("assert_site_visit_hostile_plan");
    expect(RUNTIME).toContain("v_index_tuple_work is distinct from 501");
    expect(RUNTIME).toContain("v_index_loops is distinct from 1");
    expect(RUNTIME).toContain("rows removed by join filter");
    expect(RUNTIME).toContain("rows removed by index recheck");
    expect(RUNTIME).toContain("v_removed_tuple_work > 501");
    expect(RUNTIME).toContain("v_shared_blocks > 2048");
    expect(RUNTIME).toContain("v_temp_blocks <> 0");
    expect(RUNTIME).toContain("v_sort_nodes <> 0");
    expect(RUNTIME).toContain("hostile physical plan unbounded");
    expect(RUNTIME).toContain("production microsecond timestamp rejected");
    expect(RUNTIME).toContain("production microsecond source missing");
    expect(RUNTIME).toContain("production microsecond list invalid");
    expect(RUNTIME).toContain("production microsecond attention invalid");
    expect(RUNTIME).toContain("same-millisecond booked pagination invalid");
    expect(RUNTIME).toContain("same-millisecond history pagination invalid");
    expect(RUNTIME).toContain("same-millisecond attention ordering invalid");
    expect(RUNTIME).toContain("authenticated writer insert/update failed");
    expect(RUNTIME).toContain("service_role writer insert/update failed");
    expect(RUNTIME).toContain("set local role service_role");
  });
});

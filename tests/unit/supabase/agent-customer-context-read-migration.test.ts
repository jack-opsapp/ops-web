import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_customer_context_read.sql";
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith(SUFFIX));
const MIGRATION = join(
  process.cwd(),
  "supabase/migrations",
  migrationNames[0] ?? "MISSING"
);
const RUNTIME = join(
  process.cwd(),
  "tests/sql/agent-customer-context-runtime.sql"
);
const REPLAY_RUNTIME = join(
  process.cwd(),
  "tests/sql/agent-customer-context-replay-runtime.sql"
);
function read(path: string) {
  try {
    return readFileSync(path, "utf8").toLowerCase();
  } catch {
    return "";
  }
}
function readExact(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
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

const SQL = read(MIGRATION);
const COMPACT = compact(SQL);
const PRIVATE_SUMMARY = compact(
  definition(SQL, "private.agent_p2_customer_summary_v1")
);
const PUBLIC_READ = compact(
  definition(SQL, "public.read_agent_customer_context_as_system")
);
const RUNTIME_SQL = compact(read(RUNTIME));
const RUNTIME_EXACT_SQL = compact(readExact(RUNTIME));
const REPLAY_RUNTIME_SQL = compact(read(REPLAY_RUNTIME));
const PRIVATE_SIGNATURE =
  "private.agent_p2_customer_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,text,text,text,uuid,text[],text,text[],timestamp with time zone,integer,integer)";
const PUBLIC_SIGNATURE =
  "public.read_agent_customer_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text,text[],integer,integer)";

describe("P2 customer-context read migration", () => {
  it("does not schema-qualify PostgreSQL parser-only SQL forms", () => {
    for (const sql of [SQL, RUNTIME_SQL, REPLAY_RUNTIME_SQL]) {
      for (const parserOnlyForm of [
        "nullif",
        "coalesce",
        "greatest",
        "least",
        "substring",
      ]) {
        expect(sql).not.toContain(`pg_catalog.${parserOnlyForm}(`);
      }
    }
  });

  it("uses one generated guarded migration with exact private/public functions", () => {
    expect(migrationNames).toHaveLength(1);
    expect(migrationNames[0]).toMatch(
      /^\d{14}_agent_customer_context_read\.sql$/
    );
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("do $prerequisites$");
    expect(PRIVATE_SUMMARY).not.toBe("");
    expect(PUBLIC_READ).not.toBe("");
    expect(COMPACT).toContain(`revoke all on function ${PRIVATE_SIGNATURE}`);
    expect(COMPACT).toContain(`revoke all on function ${PUBLIC_SIGNATURE}`);
    expect(COMPACT).toContain(
      `grant execute on function ${PUBLIC_SIGNATURE} to service_role`
    );
    expect(COMPACT).not.toContain(
      `grant execute on function ${PRIVATE_SIGNATURE} to service_role`
    );
    expect(COMPACT).toContain("pg_catalog.aclexplode(");
    expect(COMPACT).toContain("execute pg_catalog.format(");
    expect(COMPACT).toContain("revoke all privileges on function");
  });

  it("keeps both layers fixed, stable, service-only, and same-statement authoritative", () => {
    expect(PRIVATE_SUMMARY).toContain(
      "language plpgsql stable security invoker set search_path = ''"
    );
    expect(PUBLIC_READ).toContain(
      "language plpgsql stable security definer set search_path = ''"
    );
    for (const value of [PRIVATE_SUMMARY, PUBLIC_READ]) {
      expect(value).toContain("auth.role() is distinct from 'service_role'");
    }
    expect(PRIVATE_SUMMARY).toContain(
      "private.resolve_agent_actor_authority( p_actor_user_id, p_company_id, p_registered_permission_keys )"
    );
    expect(PRIVATE_SUMMARY).toContain(
      "authority.permission_snapshot_revision = p_permission_snapshot_revision"
    );
    expect(PRIVATE_SUMMARY).toContain("private.agent_user_can_access_entity(");
    expect(PRIVATE_SUMMARY).toContain(
      "('contacts' = any(p_sections)) is distinct from (p_contact_purpose is not null)"
    );
    expect(PRIVATE_SUMMARY).toContain(
      "('job_rollup' = any(p_sections)) is distinct from (pg_catalog.cardinality(p_job_kinds) > 0)"
    );
    expect(PUBLIC_READ).toContain("statement_timestamp()");
    expect(PUBLIC_READ).toContain("private.agent_p2_customer_summary_v1(");
    expect(PRIVATE_SUMMARY).toContain(
      "join private.mcp_oauth_grants oauth_grant"
    );
    expect(PRIVATE_SUMMARY).toContain(
      "join private.mcp_oauth_clients oauth_client"
    );
    expect(PRIVATE_SUMMARY).toContain("oauth_grant.id = p_oauth_grant_id");
    expect(PRIVATE_SUMMARY).toContain(
      "oauth_grant.client_id = p_oauth_client_id"
    );
    expect(PRIVATE_SUMMARY).toContain(
      "oauth_grant.revision = p_grant_revision"
    );
    expect(PRIVATE_SUMMARY).toContain("oauth_grant.revoked_at is null");
    expect(PRIVATE_SUMMARY).toContain("oauth_client.disabled_at is null");
    expect(PRIVATE_SUMMARY).toContain(
      "oauth_grant.scopes = p_granted_scope_ceiling"
    );
    expect(PRIVATE_SUMMARY).toContain(
      "p_required_oauth_scopes <@ oauth_grant.scopes"
    );
    expect(PRIVATE_SUMMARY).toContain(
      "oauth_grant.scopes <@ oauth_client.scope_ceiling"
    );
    expect(PRIVATE_SUMMARY).toContain(
      "oauth_grant.consent_catalog_revision = oauth_client.consent_catalog_revision"
    );
    expect(PRIVATE_SUMMARY).toContain(
      "oauth_grant.exposure_revision = oauth_client.exposure_revision"
    );
  });

  it("pins exact capability identity, consent union, selectors, and scope branches", () => {
    expect(PUBLIC_READ).toContain(
      "p_capability_id is distinct from 'get_customer_context'"
    );
    expect(PUBLIC_READ).toContain("'get_customer_context:2026-08-22.v1'");
    expect(PUBLIC_READ).toContain("'2026-08-22.capability-manifest.v8'");
    expect(PUBLIC_READ).toContain("'ops.customers.read'");
    expect(PUBLIC_READ).toContain("'ops.customer_contacts.read'");
    expect(PUBLIC_READ).toContain("'ops.jobs.read'");
    expect(PUBLIC_READ).toContain("'business_address'");
    expect(PUBLIC_READ).toContain("p_clients_scope not in ('all', 'assigned')");
    expect(PUBLIC_READ).toContain(
      "('opportunity' = any(p_job_kinds)) is distinct from (p_pipeline_scope is not null)"
    );
    expect(PUBLIC_READ).toContain(
      "('project' = any(p_job_kinds)) is distinct from (p_projects_scope is not null)"
    );
    expect(PUBLIC_READ).toContain(
      "('contacts' = any(p_sections)) is distinct from (p_contact_purpose is not null)"
    );
  });

  it("physically gates each raw source at 501 before entity authority and fails rather than returning partial aggregates", () => {
    expect(
      PRIVATE_SUMMARY.match(/limit p_source_limit/g)?.length
    ).toBeGreaterThanOrEqual(4);
    expect(PRIVATE_SUMMARY).toContain("p_source_limit is distinct from 501");
    expect(PRIVATE_SUMMARY).toContain("p_item_limit is distinct from 25");
    expect(PRIVATE_SUMMARY).toContain(
      "agent_customer_context_source_query_bound"
    );
    expect(PRIVATE_SUMMARY).toContain("source_inspected");
    for (const [start, end] of [
      [
        "contact_raw_source_gate as materialized (",
        "), contact_raw_source_state as materialized (",
      ],
      [
        "duplicate_raw_source_gate as materialized (",
        "), duplicate_raw_source_state as materialized (",
      ],
      [
        "opportunity_raw_source_gate as materialized (",
        "), opportunity_raw_source_state as materialized (",
      ],
      [
        "project_raw_source_gate as materialized (",
        "), project_raw_source_state as materialized (",
      ],
    ] as const) {
      const gate = between(PRIVATE_SUMMARY, start, end);
      expect(gate).not.toBe("");
      expect(gate).not.toContain("private.agent_user_can_access_entity(");
      expect(gate).toContain("limit p_source_limit");
    }
    for (const authorized of [
      "contact_authorized as materialized (",
      "duplicate_authorized as materialized (",
      "opportunity_authorized as materialized (",
      "project_authorized as materialized (",
    ]) {
      expect(PRIVATE_SUMMARY).toContain(authorized);
    }
    expect(
      PRIVATE_SUMMARY.match(/private\.agent_user_can_access_entity\(/g)?.length
    ).toBeGreaterThanOrEqual(5);
  });

  it("uses independent authorized 26-row selectors and 25-row retained projections for contacts and duplicates", () => {
    for (const prefix of ["contact", "duplicate"]) {
      const selector = between(
        PRIVATE_SUMMARY,
        `${prefix}_selector_gate as materialized (`,
        `), ${prefix}_detail_gate as materialized (`
      );
      expect(selector).not.toBe("");
      expect(selector).toContain("limit p_item_limit + 1");
      const detail = between(
        PRIVATE_SUMMARY,
        `${prefix}_detail_gate as materialized (`,
        `), ${prefix}_retained as materialized (`
      );
      expect(detail).not.toBe("");
      expect(detail).toContain(`from ${prefix}_selector_gate`);
      const retained = between(
        PRIVATE_SUMMARY,
        `${prefix}_retained as materialized (`,
        `), ${prefix}_package as materialized (`
      );
      expect(retained).not.toBe("");
      expect(retained).toContain("limit p_item_limit");
    }
    expect(PRIVATE_SUMMARY).toContain("'source_has_more'");
    for (const fragment of [
      "from contact_selector_gate",
      "from duplicate_selector_gate",
      "from opportunity_authorized",
      "from project_authorized",
      "'contacts', final.contact_authorized_inspected_count",
      "'duplicate_candidates', final.duplicate_authorized_inspected_count",
      "'opportunities', final.opportunity_authorized_inspected_count",
      "'projects', final.project_authorized_inspected_count",
    ]) {
      expect(PRIVATE_SUMMARY).toContain(fragment);
    }
    expect(PRIVATE_SUMMARY).toContain(
      "v_project_raw_source_count >= p_source_limit"
    );
    expect(PRIVATE_SUMMARY).not.toContain(
      "'projects', final.project_raw_source_count"
    );
  });

  it("projects current direct contacts with duplicate-safe contactability and no suppression reason leak", () => {
    expect(PRIVATE_SUMMARY).toContain("join public.sub_clients sub_client");
    expect(PRIVATE_SUMMARY).toContain(
      "private.agent_normalize_discovery_email"
    );
    expect(PRIVATE_SUMMARY).toContain(
      "private.agent_normalize_discovery_phone"
    );
    expect(PRIVATE_SUMMARY).toContain(
      "from public.email_suppressions suppression"
    );
    expect(PRIVATE_SUMMARY).toContain(
      "private.agent_contactability_address_revisions"
    );
    expect(PRIVATE_SUMMARY).toContain("visible_owner_count > 1");
    expect(PRIVATE_SUMMARY).toContain("'state', 'blocked'");
    expect(PRIVATE_SUMMARY).not.toContain("'signals'");
    expect(PRIVATE_SUMMARY).not.toContain("'winner_id'");
    expect(PRIVATE_SUMMARY).not.toContain("'resolved_by'");
    expect(PRIVATE_SUMMARY).not.toContain("'suppression_reason'");
  });

  it("uses only current canonical duplicate candidates and mirrors list_customer_jobs conversion semantics", () => {
    expect(PRIVATE_SUMMARY).toContain("join public.duplicate_reviews review");
    expect(PRIVATE_SUMMARY).toContain("review.status = 'pending'");
    expect(PRIVATE_SUMMARY).toContain("candidate.deleted_at is null");
    expect(PRIVATE_SUMMARY).toContain(
      "candidate.merged_into_client_id is null"
    );
    expect(PRIVATE_SUMMARY).toContain("join public.opportunities opportunity");
    expect(PRIVATE_SUMMARY).toContain("join public.projects project");
    expect(PRIVATE_SUMMARY).toContain(
      "project.raw_job_id = opportunity.linked_project_id"
    );
    expect(PRIVATE_SUMMARY).toContain(
      "opportunity.raw_job_id = project.linked_opportunity_id"
    );
    expect(PRIVATE_SUMMARY).toContain("canonical_job_rank = 1");
    expect(PRIVATE_SUMMARY).toContain("canonical_job_count > 2");
  });

  it("emits only the exact customer/selected legacy revisions, private notes marker, and proof digest", () => {
    expect(PRIVATE_SUMMARY).toContain("private.agent_read_domain_revisions");
    expect(PRIVATE_SUMMARY).toContain("'domain', 'customer'");
    expect(PRIVATE_SUMMARY).toContain(
      "'source_type', 'operational_read_revision'"
    );
    expect(PRIVATE_SUMMARY).toContain(
      "'source_type', 'contactability_revision'"
    );
    expect(PRIVATE_SUMMARY).toContain(
      "'content_kind', 'untrusted_business_data'"
    );
    expect(PRIVATE_SUMMARY).toContain("'business_notes'");
    expect(PUBLIC_READ).toContain("'ops_proof:v1:'");
    expect(PUBLIC_READ).toContain("'oauth_grant_id', p_oauth_grant_id");
    expect(PUBLIC_READ).toContain("'oauth_client_id', p_oauth_client_id");
    expect(PUBLIC_READ).toContain("'grant_revision', p_grant_revision");
    expect(PUBLIC_READ).toContain(
      "'granted_scope_ceiling', pg_catalog.to_jsonb(p_granted_scope_ceiling)"
    );
    expect(PUBLIC_READ).toContain(
      "private.canonical_agent_projection_json( v_envelope )"
    );
    expect(PUBLIC_READ).not.toContain("v_envelope - 'source_inspected'");
    const profileProjection = between(
      PRIVATE_SUMMARY,
      "'profile', pg_catalog.jsonb_build_object(",
      "|| case when 'business_address' = any(p_sections)"
    );
    expect(profileProjection).not.toBe("");
    expect(profileProjection).not.toContain("'address'");
    for (const forbidden of [
      "'financials'",
      "'estimate_total'",
      "'invoice_total'",
      "'signals'",
      "'migration_manifest'",
      "'deleted_at'",
      "'raw_payload'",
      "'provider_id'",
    ]) {
      expect(PRIVATE_SUMMARY).not.toContain(forbidden);
    }
  });

  it("ships rollback runtime proof for ACL, soft delete, consent, bounds, ordering, duplicates, and revision fences", () => {
    expect(RUNTIME_SQL).not.toBe("");
    expect(RUNTIME_SQL.startsWith("begin;")).toBe(true);
    expect(RUNTIME_SQL.endsWith("rollback;")).toBe(true);
    expect(RUNTIME_SQL).toContain("set local role authenticated");
    expect(RUNTIME_SQL).toContain("has_function_privilege");
    expect(RUNTIME_SQL).toContain(PRIVATE_SIGNATURE);
    expect(RUNTIME_SQL).toContain(PUBLIC_SIGNATURE);
    expect(RUNTIME_SQL).toContain("agent_customer_context_runtime_failed");
    expect(RUNTIME_SQL).toContain("soft-deleted contact leaked");
    expect(RUNTIME_SQL).toContain("suppressed address leaked");
    expect(RUNTIME_SQL).toContain("duplicate address leaked");
    expect(RUNTIME_SQL).toContain("unauthorized job count leaked");
    expect(RUNTIME_SQL).toContain("source bound not enforced");
    expect(RUNTIME_SQL).toContain("stale oauth grant allowed");
    expect(RUNTIME_SQL).toContain("revoked oauth grant allowed");
    expect(RUNTIME_SQL).toContain("contact selector did not retain 25");
    expect(RUNTIME_SQL).toContain("duplicate selector did not retain 25");
    expect(RUNTIME_SQL).toContain("implicit business address leaked");
    expect(RUNTIME_SQL).toContain("v_result - 'proof_ref'");
    expect(RUNTIME_EXACT_SQL).toContain(
      "'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'"
    );
    expect(RUNTIME_EXACT_SQL).not.toContain(
      "'^[0-9]{4}-[0-9]{2}-[0-9]{2}t[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}z$'"
    );
    expect(RUNTIME_SQL).toContain("explain (analyze, buffers, format json)");
    expect(RUNTIME_SQL).toContain("customer revision did not advance");
    expect(REPLAY_RUNTIME_SQL).toContain("grant execute on function");
    expect(REPLAY_RUNTIME_SQL).toContain("pg_monitor with grant option");
    expect(REPLAY_RUNTIME_SQL).toContain(
      "unexpected role grant survived replay"
    );
    expect(REPLAY_RUNTIME_SQL.startsWith("begin;")).toBe(true);
    expect(REPLAY_RUNTIME_SQL.endsWith("rollback;")).toBe(true);
  });

  it("postflights the exact owner, language, volatility, security, strictness, parallelism, search_path, signatures, return type, and exploded ACL", () => {
    for (const fragment of [
      "function_row.proowner = current_user::regrole",
      "language_row.lanname = expected.language_name",
      "function_row.prokind = 'f'::\"char\"",
      "function_row.proisstrict = expected.is_strict",
      'function_row.proparallel = expected.parallel_safety::"char"',
      "function_row.prosecdef = expected.security_definer",
      'function_row.provolatile = expected.volatility::"char"',
      "pg_catalog.pg_get_function_result(function_row.oid)",
      "pg_catalog.aclexplode(",
      "search_path=",
    ]) {
      expect(COMPACT).toContain(fragment);
    }
  });
});

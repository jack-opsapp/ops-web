import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260715160000_lead_assignment_foundation.sql"
);

function sql(): string {
  return readFileSync(migrationPath, "utf8");
}

function functionBody(source: string, name: string): string {
  const marker = `create or replace function ${name}`;
  const lower = source.toLowerCase();
  const start = lower.indexOf(marker);
  expect(start, `${name} missing`).toBeGreaterThanOrEqual(0);
  const next = lower.indexOf(
    "create or replace function ",
    start + marker.length
  );
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

describe("lead-assignment foundation migration", () => {
  it("adds the version, restrictive assignee FK, and active assigned-list index", () => {
    const source = sql();

    expect(source).toMatch(
      /alter table public\.opportunities[\s\S]*?add column if not exists assignment_version bigint not null default 0/i
    );
    expect(source).toMatch(
      /foreign key \(assigned_to\)[\s\S]*?references public\.users\s*\(id\)[\s\S]*?on delete restrict/i
    );
    expect(source).toMatch(
      /create index if not exists opportunities_company_assignee_active_idx[\s\S]*?\(company_id, assigned_to, created_at desc\)[\s\S]*?where assigned_to is not null[\s\S]*?deleted_at is null[\s\S]*?archived_at is null/i
    );
  });

  it("creates immutable versioned assignment history with identity snapshots", () => {
    const source = sql();

    expect(source).toMatch(
      /create table(?: if not exists)? public\.opportunity_assignment_events/i
    );
    expect(source).toMatch(/unique\s*\(opportunity_id, assignment_version\)/i);
    expect(source).toMatch(/previous_assignee_snapshot jsonb/i);
    expect(source).toMatch(/new_assignee_snapshot jsonb/i);
    expect(source).toMatch(/actor_snapshot jsonb/i);
    expect(source).toMatch(
      /source text[\s\S]*?check\s*\(source in \([\s\S]*?'manual'[\s\S]*?'suggestion_accept'[\s\S]*?'manual_create'[\s\S]*?'personal_mailbox'[\s\S]*?'deactivation'[\s\S]*?'permission_change'[\s\S]*?'admin_correction'[\s\S]*?'system_repair'[\s\S]*?\)\)/i
    );
    expect(source).toMatch(
      /revoke update, delete on table public\.opportunity_assignment_events from anon, authenticated, service_role/i
    );
  });

  it("creates non-authoritative suggestions with bounded confidence and resolution state", () => {
    const source = sql();

    expect(source).toMatch(
      /create table(?: if not exists)? public\.opportunity_assignment_suggestions/i
    );
    expect(source).toMatch(
      /confidence double precision[\s\S]*?confidence >= 0[\s\S]*?confidence <= 1/i
    );
    expect(source).toMatch(/signals jsonb/i);
    expect(source).toMatch(/generator_version text/i);
    expect(source).toMatch(
      /resolution_state text[\s\S]*?'pending'[\s\S]*?'accepted'[\s\S]*?'rejected'[\s\S]*?'invalidated'[\s\S]*?'superseded'/i
    );
  });

  it("creates addressed delivery rows whose recipient can read without lead access", () => {
    const source = sql();

    expect(source).toMatch(
      /create table(?: if not exists)? public\.opportunity_assignment_deliveries/i
    );
    expect(source).toMatch(
      /unique\s*\(assignment_event_id, recipient_user_id\)/i
    );
    expect(source).toMatch(/access_after boolean not null/i);
    expect(source).toMatch(/notify boolean not null/i);
    expect(source).toMatch(
      /state text[\s\S]*?'pending'[\s\S]*?'processing'[\s\S]*?'delivered'[\s\S]*?'failed'/i
    );
    expect(source).toMatch(
      /create policy opportunity_assignment_deliveries_recipient_select[\s\S]*?recipient_user_id\s*=\s*private\.get_current_user_id\(\)/i
    );
    expect(source).not.toMatch(
      /create policy opportunity_assignment_deliveries_recipient_select[\s\S]*?using\s*\([^;]*?opportunities/i
    );
    expect(source).toMatch(
      /revoke insert, update, delete on table public\.opportunity_assignment_deliveries from anon, authenticated, service_role/i
    );
    expect(source).not.toMatch(
      /grant insert, update(?:, delete)? on table public\.opportunity_assignment_deliveries[\s\S]*?to service_role/i
    );
  });

  it("creates the idempotent post-conversion integration seam", () => {
    const source = sql();

    expect(source).toMatch(
      /create table(?: if not exists)? public\.opportunity_conversion_events/i
    );
    expect(source).toMatch(
      /event_type text not null default 'converted_to_project'/i
    );
    expect(source).toMatch(
      /unique\s*\(opportunity_id, project_id, event_type\)/i
    );
    expect(source).toMatch(/assignment_version bigint not null/i);
    expect(source).toMatch(
      /revoke insert, update, delete on table public\.opportunity_conversion_events from anon, authenticated/i
    );
  });
});

describe("guarded assignment operations", () => {
  it("exposes the exact human and service signatures", () => {
    const source = sql();

    expect(source).toMatch(
      /create or replace function public\.change_opportunity_assignment\(\s*p_opportunity_id uuid,\s*p_expected_assignment_version bigint,\s*p_expected_assigned_to uuid,\s*p_new_assigned_to uuid,\s*p_source text,\s*p_suggestion_id uuid default null,\s*p_metadata jsonb default '\{\}'::jsonb\s*\) returns jsonb/i
    );
    expect(source).toMatch(
      /create or replace function public\.change_opportunity_assignment_as_system\(\s*p_opportunity_id uuid,\s*p_expected_assignment_version bigint,\s*p_expected_assigned_to uuid,\s*p_new_assigned_to uuid,\s*p_system_source text,\s*p_actor_user_id uuid default null,\s*p_suggestion_id uuid default null,\s*p_metadata jsonb default '\{\}'::jsonb\s*\) returns jsonb/i
    );
  });

  it("derives the human actor and company and restricts human sources", () => {
    const body = functionBody(sql(), "public.change_opportunity_assignment");

    expect(body).toMatch(/private\.get_current_user_id\(\)/i);
    expect(body).toMatch(/private\.get_user_company_id\(\)/i);
    expect(body).toMatch(/p_source not in \('manual', 'suggestion_accept'\)/i);
    expect(body).not.toMatch(/p_actor_user_id|p_company_id/i);
    expect(body).toMatch(/private\.change_opportunity_assignment_core/i);
  });

  it("keeps system assignment service-only and validates its source and actor", () => {
    const source = sql();
    const body = functionBody(
      source,
      "public.change_opportunity_assignment_as_system"
    );

    expect(body).toMatch(/auth\.role\(\)[\s\S]*?'service_role'/i);
    expect(body).toMatch(
      /p_system_source not in \([\s\S]*?'personal_mailbox'[\s\S]*?'deactivation'[\s\S]*?'permission_change'[\s\S]*?'admin_correction'[\s\S]*?'system_repair'[\s\S]*?\)/i
    );
    expect(body).toMatch(
      /p_actor_user_id[\s\S]*?public\.users[\s\S]*?company_id[\s\S]*?deleted_at is null[\s\S]*?coalesce\([a-z]+\.is_active, false\)/i
    );
    expect(source).toMatch(
      /revoke all on function public\.change_opportunity_assignment_as_system\(uuid, bigint, uuid, uuid, text, uuid, uuid, jsonb\) from public, anon, authenticated/i
    );
    expect(source).toMatch(
      /grant execute on function public\.change_opportunity_assignment_as_system\(uuid, bigint, uuid, uuid, text, uuid, uuid, jsonb\) to service_role/i
    );
  });

  it("uses one locked core with dual optimistic conflict checks", () => {
    const source = sql();
    const core = functionBody(
      source,
      "private.change_opportunity_assignment_core"
    );

    expect(core).toMatch(
      /from public\.opportunities[\s\S]*?where[\s\S]*?for update/i
    );
    expect(core).toMatch(
      /assignment_version is distinct from p_expected_assignment_version[\s\S]*?assigned_to is distinct from p_expected_assigned_to/i
    );
    expect(core).toMatch(/'ok', false[\s\S]*?'conflict', true/i);
    expect(core).toMatch(
      /'assigned_to', v_opportunity\.assigned_to[\s\S]*?'assignment_version', v_opportunity\.assignment_version/i
    );
    expect(
      functionBody(source, "public.change_opportunity_assignment")
    ).toMatch(/return private\.change_opportunity_assignment_core\s*\(/i);
    expect(
      functionBody(source, "public.change_opportunity_assignment_as_system")
    ).toMatch(/return private\.change_opportunity_assignment_core\s*\(/i);
    expect(
      source.match(/return private\.change_opportunity_assignment_core\s*\(/gi)
    ).toHaveLength(2);
  });

  it("enforces all/assigned semantics, terminal protection, and target eligibility", () => {
    const core = functionBody(
      sql(),
      "private.change_opportunity_assignment_core"
    );

    expect(core).toMatch(
      /private\.current_user_scope_for\('pipeline\.assign'\)/i
    );
    expect(core).toMatch(
      /private\.should_use_pipeline_manage_compat\([\s\S]*?p_actor_user_id[\s\S]*?'pipeline\.assign'/i
    );
    expect(core).toMatch(
      /v_scope = 'assigned'[\s\S]*?v_opportunity\.assigned_to is distinct from p_actor_user_id/i
    );
    expect(core).toMatch(
      /v_scope = 'assigned'[\s\S]*?v_opportunity\.assigned_to is distinct from p_actor_user_id[\s\S]*?assignment_access_lost/i
    );
    expect(core.indexOf("assignment_access_lost")).toBeLessThan(
      core.indexOf("update public.opportunities")
    );
    expect(core).toMatch(
      /v_scope = 'assigned'[\s\S]*?p_new_assigned_to is null/i
    );
    expect(core).toMatch(
      /v_scope = 'assigned'[\s\S]*?v_opportunity\.stage in \('won', 'lost', 'discarded'\)/i
    );
    expect(core).toMatch(
      /from public\.users[\s\S]*?company_id = v_opportunity\.company_id[\s\S]*?deleted_at is null[\s\S]*?coalesce\((?:[a-z]+\.)?is_active, false\)[\s\S]*?public\.has_permission\(\s*p_new_assigned_to,\s*'pipeline\.view',\s*'assigned'/i
    );
  });

  it("never lets manage compatibility override an explicit granular revoke", () => {
    const source = sql();
    const compatibility = functionBody(
      source,
      "private.should_use_pipeline_manage_compat"
    );
    const core = functionBody(
      source,
      "private.change_opportunity_assignment_core"
    );
    const create = functionBody(source, "public.create_opportunity_guarded");

    expect(compatibility).toMatch(
      /not exists \([\s\S]*?public\.user_permission_overrides[\s\S]*?user_id = p_actor_user_id[\s\S]*?company_id = p_actor_company_id[\s\S]*?permission = p_permission/i
    );
    expect(compatibility).toMatch(
      /not upo\.granted\s+or\s+upo\.scope is not null/i
    );
    expect(compatibility).toMatch(
      /not exists \([\s\S]*?public\.user_roles[\s\S]*?public\.role_permissions[\s\S]*?permission = p_permission/i
    );
    expect(compatibility).toMatch(
      /public\.has_permission\(\s*p_actor_user_id,\s*'pipeline\.manage',\s*'all'/i
    );
    expect(core).toMatch(
      /private\.should_use_pipeline_manage_compat\([\s\S]*?'pipeline\.assign'/i
    );
    expect(create).toMatch(
      /private\.should_use_pipeline_manage_compat\([\s\S]*?'pipeline\.create'/i
    );
    expect(create).toMatch(
      /private\.should_use_pipeline_manage_compat\([\s\S]*?'pipeline\.assign'/i
    );
  });

  it("returns a true no-op for the same target", () => {
    const core = functionBody(
      sql(),
      "private.change_opportunity_assignment_core"
    );
    const noOp = core.match(
      /if v_opportunity\.assigned_to is not distinct from p_new_assigned_to then([\s\S]*?)end if;/i
    )?.[1];

    expect(noOp).toBeDefined();
    expect(noOp).toMatch(/'ok', true[\s\S]*?'conflict', false/i);
    expect(noOp).toMatch(/'event_id', null/i);
    expect(noOp).not.toMatch(/update public\.opportunities|insert into/i);
  });

  it("advances exactly once and atomically writes event, suggestion resolution, and deliveries", () => {
    const core = functionBody(
      sql(),
      "private.change_opportunity_assignment_core"
    );

    expect(core).toMatch(
      /set assigned_to = p_new_assigned_to,\s*assignment_version = assignment_version \+ 1/i
    );
    expect(core).toMatch(/returning assignment_version into v_new_version/i);
    expect(core).toMatch(/insert into public\.opportunity_assignment_events/i);
    expect(core).toMatch(
      /update public\.opportunity_assignment_suggestions[\s\S]*?resolution_state/i
    );
    expect(core).toMatch(
      /insert into public\.opportunity_assignment_deliveries[\s\S]*?access_after[\s\S]*?notify/i
    );
    expect(core).toMatch(
      /v_previous_access_after\s*:=\s*exists \([\s\S]*?from public\.users[\s\S]*?company_id = v_opportunity\.company_id[\s\S]*?deleted_at is null[\s\S]*?coalesce\([a-z_]+\.is_active, false\)[\s\S]*?public\.has_permission\([\s\S]*?'pipeline\.view'[\s\S]*?'all'[\s\S]*?or private\.should_use_pipeline_manage_compat/i
    );
    expect(core).toMatch(
      /v_opportunity\.assigned_to,\s*v_previous_access_after,\s*false/i
    );
    expect(core).toMatch(
      /v_new_notify\s*:=\s*not \([\s\S]*?not p_is_system[\s\S]*?p_new_assigned_to = p_actor_user_id/i
    );
    expect(core).toMatch(
      /false\s*\)[\s\S]*?on conflict \(assignment_event_id, recipient_user_id\) do nothing/i
    );
  });
});

describe("direct-write enforcement and guarded create", () => {
  it("uses a private single-use transaction marker and has no service-role bypass", () => {
    const source = sql();
    const core = functionBody(
      source,
      "private.change_opportunity_assignment_core"
    );
    const guard = functionBody(
      source,
      "private.guard_opportunity_assignment_mutation"
    );

    expect(source).toMatch(
      /create table(?: if not exists)? private\.opportunity_assignment_write_tokens/i
    );
    expect(core).toMatch(
      /insert into private\.opportunity_assignment_write_tokens/i
    );
    expect(guard).toMatch(
      /delete from private\.opportunity_assignment_write_tokens[\s\S]*?txid_current\(\)[\s\S]*?pg_backend_pid\(\)[\s\S]*?returning/i
    );
    expect(guard).not.toMatch(/auth\.role\(\)[\s\S]*?service_role/i);
  });

  it("allows only null/version-zero ordinary inserts and exact guarded increments", () => {
    const guard = functionBody(
      sql(),
      "private.guard_opportunity_assignment_mutation"
    );

    expect(guard).toMatch(
      /tg_op = 'INSERT'[\s\S]*?new\.assigned_to is null[\s\S]*?new\.assignment_version = 0/i
    );
    expect(guard).toMatch(
      /new\.assigned_to is not distinct from old\.assigned_to[\s\S]*?new\.assignment_version is distinct from old\.assignment_version/i
    );
    expect(guard).toMatch(
      /new\.assignment_version <> old\.assignment_version \+ 1/i
    );
    expect(guard).toMatch(/assignment_write_forbidden/i);
  });

  it("installs the assignment guard for inserts and both protected update columns", () => {
    expect(sql()).toMatch(
      /create trigger trg_opportunities_guard_assignment_mutation\s+before insert or update of assigned_to, assignment_version on public\.opportunities/i
    );
  });

  it("exposes the exact guarded-create contract and modes", () => {
    const source = sql();
    const body = functionBody(source, "public.create_opportunity_guarded");

    expect(source).toMatch(
      /create or replace function public\.create_opportunity_guarded\(\s*p_opportunity jsonb,\s*p_assignment_mode text default 'self',\s*p_initial_assigned_to uuid default null,\s*p_metadata jsonb default '\{\}'::jsonb\s*\) returns jsonb/i
    );
    expect(body).toMatch(/private\.get_current_user_id\(\)/i);
    expect(body).toMatch(/private\.get_user_company_id\(\)/i);
    expect(body).toMatch(
      /p_assignment_mode not in \('self', 'unassigned', 'explicit'\)/i
    );
    expect(body).toMatch(
      /p_assignment_mode in \('unassigned', 'explicit'\)[\s\S]*?pipeline\.assign[\s\S]*?all/i
    );
    expect(body).toMatch(/'manual_create'/i);
  });

  it("rejects system-owned keys and uses an explicit lead-create whitelist", () => {
    const body = functionBody(sql(), "public.create_opportunity_guarded");
    const allowedKeys = body.match(
      /v_allowed_keys\s+text\[\]\s*:=\s*array\[([\s\S]*?)\];/i
    )?.[1];

    expect(body).toMatch(
      /jsonb_object_keys\(p_opportunity\)[\s\S]*?not \(key = any \(v_allowed_keys\)\)[\s\S]*?unsupported_opportunity_field/i
    );
    expect(allowedKeys).toBeDefined();
    for (const forbidden of [
      "company_id",
      "assigned_to",
      "assignment_version",
      "project_id",
      "project_ref",
      "actual_value",
      "actual_close_date",
      "lost_reason",
      "lost_notes",
      "source_email_id",
      "source_message_id",
      "source_metadata",
      "correspondence_count",
      "ai_summary",
      "images",
      "created_at",
      "updated_at",
      "deleted_at",
    ]) {
      expect(allowedKeys, `${forbidden} must not be whitelisted`).not.toMatch(
        new RegExp(`'${forbidden}'`, "i")
      );
    }
    expect(body).toMatch(
      /insert into public\.opportunities\s*\([\s\S]*?company_id[\s\S]*?title[\s\S]*?contact_name[\s\S]*?contact_email[\s\S]*?contact_phone[\s\S]*?assigned_to[\s\S]*?assignment_version/i
    );
  });
});

describe("guarded opportunity conversion", () => {
  it("replaces the legacy overload with the exact version-guarded signature and grants", () => {
    const source = sql();

    expect(source).toMatch(
      /drop function if exists public\.convert_opportunity_to_project\(\s*uuid,\s*uuid,\s*numeric,\s*text,\s*uuid,\s*text,\s*text,\s*uuid,\s*text,\s*boolean,\s*text,\s*jsonb\s*\)/i
    );
    expect(source).toMatch(
      /create or replace function public\.convert_opportunity_to_project\(\s*p_company_id uuid,\s*p_opportunity_id uuid,\s*p_actual_value numeric default null(?:::\w+)?,\s*p_expected_stage text default null(?:::\w+)?,\s*p_decided_by uuid default null(?:::\w+)?,\s*p_notes text default null(?:::\w+)?,\s*p_title_override text default null(?:::\w+)?,\s*p_link_to_project_id uuid default null(?:::\w+)?,\s*p_source_path text default null(?:::\w+)?,\s*p_win_opportunity boolean default true,\s*p_project_status text default null(?:::\w+)?,\s*p_evidence jsonb default '\{\}'::jsonb,\s*p_expected_assignment_version bigint default null(?:::\w+)?\s*\) returns jsonb/i
    );
    expect(source).toMatch(
      /revoke all on function public\.convert_opportunity_to_project\(\s*uuid,\s*uuid,\s*numeric,\s*text,\s*uuid,\s*text,\s*text,\s*uuid,\s*text,\s*boolean,\s*text,\s*jsonb,\s*bigint\s*\)\s+from public, anon/i
    );
    expect(source).toMatch(
      /grant execute on function public\.convert_opportunity_to_project\(\s*uuid,\s*uuid,\s*numeric,\s*text,\s*uuid,\s*text,\s*text,\s*uuid,\s*text,\s*boolean,\s*text,\s*jsonb,\s*bigint\s*\)\s+to authenticated, service_role/i
    );
  });

  it("locks before authorizing and derives human identity while validating service actors", () => {
    const body = functionBody(sql(), "public.convert_opportunity_to_project");
    const lockIndex = body.search(
      /select[\s\S]*?from public\.opportunities[\s\S]*?for update/i
    );
    const scopeIndex = body.search(
      /private\.current_user_scope_for\('pipeline\.convert'\)/i
    );

    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(scopeIndex).toBeGreaterThan(lockIndex);
    expect(body).toMatch(/private\.get_current_user_id\(\)/i);
    expect(body).toMatch(/private\.get_user_company_id\(\)/i);
    expect(body).toMatch(
      /p_decided_by is not null[\s\S]*?p_decided_by is distinct from v_actor_user_id[\s\S]*?access_denied/i
    );
    expect(body).toMatch(
      /auth\.role\(\)[\s\S]*?'service_role'[\s\S]*?p_decided_by[\s\S]*?from public\.users[\s\S]*?company_id = p_company_id[\s\S]*?deleted_at is null[\s\S]*?coalesce\((?:[a-z_]+\.)?is_active, false\)/i
    );
    expect(body).toMatch(
      /private\.should_use_pipeline_manage_compat\([\s\S]*?'pipeline\.convert'/i
    );
    expect(body).toMatch(
      /v_convert_scope = 'assigned'[\s\S]*?v_opp\.assigned_to is distinct from v_actor_user_id/i
    );
  });

  it("returns no-write assignment and stage snapshot guards from the locked row", () => {
    const body = functionBody(sql(), "public.convert_opportunity_to_project");
    const assignmentGuard = body.match(
      /if p_expected_assignment_version is not null[\s\S]*?end if;/i
    )?.[0];

    expect(assignmentGuard).toBeDefined();
    expect(assignmentGuard).toMatch(
      /v_opp\.assignment_version is distinct from p_expected_assignment_version/i
    );
    expect(assignmentGuard).toMatch(
      /'guard_reason', 'assignment_snapshot_mismatch'/i
    );
    expect(assignmentGuard).toMatch(
      /'assigned_to', v_opp\.assigned_to[\s\S]*?'assignment_version', v_opp\.assignment_version/i
    );
    expect(assignmentGuard).not.toMatch(/update |insert into /i);
    expect(body).toMatch(
      /p_expected_stage is not null[\s\S]*?v_opp\.stage is distinct from p_expected_stage[\s\S]*?'guard_reason', 'snapshot_mismatch'/i
    );
  });

  it("repairs all four link mirrors and validates conflicting links", () => {
    const body = functionBody(sql(), "public.convert_opportunity_to_project");

    expect(body).toMatch(
      /v_opp\.project_ref is not null[\s\S]*?v_opp\.project_id is not null[\s\S]*?project mirrors disagree/i
    );
    expect(body).toMatch(
      /linked project belongs to another opportunity|link target project already belongs to another opportunity/i
    );
    expect(body).toMatch(
      /update public\.projects[\s\S]*?set opportunity_ref = p_opportunity_id,\s*opportunity_id = p_opportunity_id::text/i
    );
    expect(body).toMatch(
      /update public\.opportunities[\s\S]*?set project_ref = v_project_id,\s*project_id = v_project_id/i
    );
  });

  it("uses an unforgeable one-use seam for assigned-scope project link writes", () => {
    const source = sql();
    const conversion = functionBody(
      source,
      "public.convert_opportunity_to_project"
    );
    const invariant = functionBody(
      source,
      "public.enforce_project_opportunity_link"
    );

    expect(source).toMatch(
      /create table(?: if not exists)? private\.opportunity_conversion_project_link_tokens/i
    );
    expect(source).toMatch(
      /revoke all on table private\.opportunity_conversion_project_link_tokens\s+from public, anon, authenticated, service_role/i
    );
    expect(conversion).toMatch(
      /insert into private\.opportunity_conversion_project_link_tokens[\s\S]*?update public\.projects|insert into private\.opportunity_conversion_project_link_tokens[\s\S]*?insert into public\.projects/i
    );
    expect(invariant).toMatch(
      /delete from private\.opportunity_conversion_project_link_tokens[\s\S]*?txid_current\(\)[\s\S]*?pg_backend_pid\(\)[\s\S]*?returning true/i
    );
    const consumeIndex = invariant.search(
      /delete from private\.opportunity_conversion_project_link_tokens/i
    );
    const ordinaryAuthOffset = invariant
      .slice(consumeIndex)
      .search(
        /private\.current_user_has_permission\('pipeline\.manage', 'all'\)/i
      );
    expect(consumeIndex).toBeGreaterThanOrEqual(0);
    expect(ordinaryAuthOffset).toBeGreaterThanOrEqual(0);
    expect(invariant).toMatch(
      /if coalesce\(v_conversion_link_owned, false\) then\s*return new/i
    );
    expect(conversion).not.toMatch(
      /set_config\('ops\.skip_project_opportunity_invariant'/i
    );
  });

  it("runs retry-safe estimate, task, media, and deck projections after either link path", () => {
    const body = functionBody(sql(), "public.convert_opportunity_to_project");
    const projectionStart = body.indexOf(
      "-- Common idempotent conversion projections"
    );
    const alreadyConvertedAssignment = body.search(
      /v_already_converted\s*:=\s*true/i
    );

    expect(alreadyConvertedAssignment).toBeGreaterThanOrEqual(0);
    expect(projectionStart).toBeGreaterThan(alreadyConvertedAssignment);
    expect(body.slice(0, projectionStart)).not.toMatch(
      /v_already_converted\s*:=\s*true[\s\S]*?return jsonb_build_object/i
    );
    expect(body.slice(projectionStart)).toMatch(
      /update public\.estimates[\s\S]*?project_ref = v_project_id[\s\S]*?project_id = v_project_id::text/i
    );
    expect(body.slice(projectionStart)).toMatch(
      /insert into public\.project_tasks[\s\S]*?team_member_ids[\s\S]*?array\[\]::text\[\]/i
    );
    expect(body.slice(projectionStart)).toMatch(
      /from public\.site_visits[\s\S]*?insert into public\.project_photos|insert into public\.project_photos[\s\S]*?from public\.site_visits/i
    );
    expect(body.slice(projectionStart)).toMatch(
      /unnest\(coalesce\(v_opp\.images, array\[\]::text\[\]\)\)[\s\S]*?insert into public\.project_photos|insert into public\.project_photos[\s\S]*?unnest\(coalesce\(v_opp\.images, array\[\]::text\[\]\)\)/i
    );
    expect(body.slice(projectionStart)).toMatch(
      /update public\.deck_designs[\s\S]*?set project_id = v_project_id[\s\S]*?where opportunity_id = p_opportunity_id/i
    );

    const taskDedupe = body.match(
      /and not exists \(\s*select 1\s*from public\.project_tasks[\s\S]*?\n\s*\);/i
    )?.[0];
    expect(taskDedupe).toBeDefined();
    expect(taskDedupe).not.toMatch(/deleted_at/i);

    const photoDedupes = [
      ...body.matchAll(
        /and not exists \(\s*select 1\s*from public\.project_photos[\s\S]*?\n\s*\);/gi
      ),
    ].map((match) => match[0]);
    expect(photoDedupes).toHaveLength(2);
    for (const dedupe of photoDedupes) {
      expect(dedupe).not.toMatch(/deleted_at/i);
    }
  });

  it("reuses historical conversion disposition instead of rewriting later state", () => {
    const body = functionBody(sql(), "public.convert_opportunity_to_project");
    const lookup = body.match(
      /select od\.id[\s\S]*?from public\.opportunity_dispositions od[\s\S]*?for update;/i
    )?.[0];

    expect(lookup).toBeDefined();
    expect(lookup).toMatch(
      /od\.disposition = 'converted_to_project'[\s\S]*?od\.converted_project_ref = v_project_id/i
    );
    expect(lookup).not.toMatch(/od\.superseded_at is null/i);
    expect(body).toMatch(
      /if v_disposition_id is null then[\s\S]*?set superseded_at = now\(\)[\s\S]*?insert into public\.opportunity_dispositions/i
    );
  });

  it("maps OPS actors to auth creators without email and leaves generated work unstaffed", () => {
    const body = functionBody(sql(), "public.convert_opportunity_to_project");

    expect(body).toMatch(
      /from public\.users[\s\S]*?(?:join|from) auth\.users[\s\S]*?auth_id[\s\S]*?firebase_uid/i
    );
    expect(body).not.toMatch(/lower\([^)]*email|email\s*=/i);
    expect(body).not.toMatch(
      /project_owner|project_assignee|project_membership/i
    );
    expect(body).toMatch(/team_member_ids[\s\S]*?array\[\]::text\[\]/i);
  });

  it("records and returns one immutable conversion event on first conversion and repair", () => {
    const body = functionBody(sql(), "public.convert_opportunity_to_project");
    const eventInsert = body.match(
      /insert into public\.opportunity_conversion_events[\s\S]*?on conflict \(opportunity_id, project_id, event_type\) do nothing/i
    )?.[0];

    expect(eventInsert).toBeDefined();
    expect(eventInsert).toMatch(/v_opp\.assignment_version/i);
    expect(body).toMatch(
      /select[\s\S]*?from public\.opportunity_conversion_events[\s\S]*?event_type = 'converted_to_project'/i
    );
    expect(body).toMatch(/'conversion_event_id', v_conversion_event_id/i);
    expect(body).toMatch(/'already_converted', v_already_converted/i);
  });
});

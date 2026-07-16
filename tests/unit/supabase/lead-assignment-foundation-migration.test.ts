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
  const next = lower.indexOf("create or replace function ", start + marker.length);
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
    expect(source).toMatch(
      /unique\s*\(opportunity_id, assignment_version\)/i
    );
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
    expect(source).toMatch(/unique\s*\(assignment_event_id, recipient_user_id\)/i);
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
      /revoke insert, update, delete on table public\.opportunity_assignment_deliveries from anon, authenticated/i
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
    expect(source).toMatch(/unique\s*\(opportunity_id, project_id, event_type\)/i);
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
    ).toHaveLength(
      2
    );
  });

  it("enforces all/assigned semantics, terminal protection, and target eligibility", () => {
    const core = functionBody(
      sql(),
      "private.change_opportunity_assignment_core"
    );

    expect(core).toMatch(/private\.current_user_scope_for\('pipeline\.assign'\)/i);
    expect(core).toMatch(
      /public\.has_permission\(p_actor_user_id, 'pipeline\.manage', 'all'\)/i
    );
    expect(core).toMatch(
      /v_scope = 'assigned'[\s\S]*?v_opportunity\.assigned_to is distinct from p_actor_user_id/i
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
      /v_new_notify\s*:=\s*not \([\s\S]*?not p_is_system[\s\S]*?p_new_assigned_to = p_actor_user_id/i
    );
    expect(core).toMatch(/false\s*\)[\s\S]*?on conflict \(assignment_event_id, recipient_user_id\) do nothing/i);
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

    expect(source).toMatch(/create table(?: if not exists)? private\.opportunity_assignment_write_tokens/i);
    expect(core).toMatch(/insert into private\.opportunity_assignment_write_tokens/i);
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
    expect(guard).toMatch(/new\.assignment_version <> old\.assignment_version \+ 1/i);
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
    expect(body).toMatch(/p_assignment_mode not in \('self', 'unassigned', 'explicit'\)/i);
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

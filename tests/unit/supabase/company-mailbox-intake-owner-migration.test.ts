import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260723191000_company_mailbox_intake_owner.sql"
);

function sql(): string {
  expect(
    existsSync(migrationPath),
    "company mailbox intake owner migration missing"
  ).toBe(true);
  return readFileSync(migrationPath, "utf8").toLowerCase();
}

function functionBody(source: string, qualifiedName: string): string {
  const marker = `create or replace function ${qualifiedName}`;
  const start = source.indexOf(marker);
  expect(start, `${qualifiedName} missing`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf(
    "create or replace function ",
    start + marker.length
  );
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

describe("company mailbox intake owner migration", () => {
  it("adds a nullable UUID owner FK and guards company-mailbox ownership invariants", () => {
    const source = sql();

    expect(source).toMatch(
      /alter table public\.email_connections[\s\S]*add column if not exists default_intake_owner_id uuid/
    );
    expect(source).toMatch(
      /foreign key \(default_intake_owner_id\)[\s\S]*references public\.users \(id\)[\s\S]*on delete set null/
    );
    expect(source).toMatch(
      /create index email_connections_default_intake_owner_id_idx[\s\S]*on public\.email_connections \(default_intake_owner_id\)[\s\S]*where default_intake_owner_id is not null/
    );
    expect(source).toContain("private.guard_company_mailbox_intake_owner");
    expect(source).toMatch(
      /before insert or update of default_intake_owner_id, company_id, type[\s\S]*on public\.email_connections/
    );

    const guard = functionBody(
      source,
      "private.guard_company_mailbox_intake_owner"
    );
    expect(guard).toContain("new.default_intake_owner_id is null");
    expect(guard).toContain("new.type::text <> 'company'");
    expect(guard).toContain("private.try_parse_uuid(new.company_id)");
    expect(guard).toMatch(
      /owner\.company_id is distinct from private\.try_parse_uuid\(new\.company_id\)/
    );
    expect(guard).toContain("private.company_mailbox_intake_owner_is_eligible");
  });

  it("requires active same-company view, edit, and inbox-send assigned authority", () => {
    const eligibility = functionBody(
      sql(),
      "private.company_mailbox_intake_owner_is_eligible"
    );

    expect(eligibility).toMatch(
      /from public\.users[\s\S]*company_id = p_company_id[\s\S]*deleted_at is null[\s\S]*coalesce\([^)]*is_active, false\)/
    );
    for (const permission of ["pipeline.view", "pipeline.edit", "inbox.send"]) {
      expect(eligibility).toMatch(
        new RegExp(
          `public\\.has_permission\\(\\s*p_user_id,\\s*'${permission.replace(".", "\\.")}',\\s*'assigned'`,
          "i"
        )
      );
    }
  });

  it("configures only through a stale-safe service RPC with assignment-policy authority", () => {
    const source = sql();
    const configure = functionBody(
      source,
      "public.configure_company_mailbox_intake_owner_as_system"
    );

    expect(configure).toContain("service_role");
    expect(configure).toMatch(
      /from public\.users actor[\s\S]*actor\.id = p_actor_user_id[\s\S]*actor\.deleted_at is null[\s\S]*coalesce\(actor\.is_active, false\)/
    );
    expect(configure).toMatch(
      /public\.has_permission\(\s*p_actor_user_id,\s*'settings\.integrations',\s*'all'/
    );
    expect(configure).toMatch(
      /public\.has_permission\(\s*p_actor_user_id,\s*'pipeline\.assign',\s*'all'/
    );
    expect(configure).toContain(
      "private.lock_lead_assignment_company(v_company_id)"
    );
    expect(configure).toMatch(
      /current_connection\.default_intake_owner_id\s+is distinct from p_expected_owner_id/
    );
    expect(configure).toContain("'conflict', true");
    expect(configure).toContain(
      "private.company_mailbox_intake_owner_is_eligible"
    );

    const companyLookup = configure.indexOf("into v_company_id");
    const companyLock = configure.indexOf(
      "private.lock_lead_assignment_company(v_company_id)"
    );
    const connectionLock = configure.indexOf("for update", companyLock);
    expect(companyLookup).toBeGreaterThanOrEqual(0);
    expect(companyLock).toBeGreaterThan(companyLookup);
    expect(connectionLock).toBeGreaterThan(companyLock);
  });

  it("adds company_mailbox_default to every assignment source gate", () => {
    const source = sql();
    const core = functionBody(
      source,
      "private.change_opportunity_assignment_core"
    );
    const systemFacade = functionBody(
      source,
      "private.change_assignment_system_company_serialized_internal"
    );

    expect(source).toContain(
      "private.change_assignment_system_company_serialized_internal(uuid,bigint,uuid,uuid,text,uuid,uuid,jsonb)"
    );
    expect(source).toMatch(
      /drop constraint if exists opportunity_assignment_events_source_check[\s\S]*add constraint opportunity_assignment_events_source_check[\s\S]*'company_mailbox_default'/
    );
    expect(source).toMatch(
      /drop constraint if exists opportunity_assignment_events_actor_required[\s\S]*add constraint opportunity_assignment_events_actor_required[\s\S]*'company_mailbox_default'/
    );
    expect(core).toMatch(
      /p_source not in \([\s\S]*'personal_mailbox'[\s\S]*'company_mailbox_default'/
    );
    expect(systemFacade).toMatch(
      /p_system_source not in \([\s\S]*'personal_mailbox'[\s\S]*'company_mailbox_default'/
    );
  });

  it("derives the company-mailbox target and serializes before connection or opportunity locks", () => {
    const assign = functionBody(
      sql(),
      "private.assign_new_company_mailbox_opportunity_internal"
    );

    expect(assign).toContain("service_role");
    expect(assign).toContain("current_connection.default_intake_owner_id");
    expect(assign.slice(0, assign.indexOf(") returns jsonb"))).not.toContain(
      "p_new_assigned_to"
    );
    expect(assign).toContain(
      "private.lock_lead_assignment_company(v_company_id)"
    );

    const companyLookup = assign.indexOf("into v_company_id");
    const companyLock = assign.indexOf(
      "private.lock_lead_assignment_company(v_company_id)"
    );
    const connectionLock = assign.indexOf("for update", companyLock);
    const opportunityRead = assign.indexOf(
      "from public.opportunities opportunity",
      connectionLock
    );
    const opportunityLock = assign.indexOf("for update", opportunityRead);
    expect(companyLookup).toBeGreaterThanOrEqual(0);
    expect(companyLock).toBeGreaterThan(companyLookup);
    expect(connectionLock).toBeGreaterThan(companyLock);
    expect(opportunityRead).toBeGreaterThan(connectionLock);
    expect(opportunityLock).toBeGreaterThan(opportunityRead);
  });

  it("uses the canonical guarded core, preserves metadata, and never writes assigned_to directly", () => {
    const assign = functionBody(
      sql(),
      "private.assign_new_company_mailbox_opportunity_internal"
    );

    expect(assign).toContain(
      "private.change_assignment_system_company_serialized_internal"
    );
    expect(assign).toContain("'company_mailbox_default'");
    expect(assign).toContain("coalesce(p_metadata, '{}'::jsonb)");
    expect(assign).toContain("'connection_id'");
    expect(assign).toContain("provider_mutations_disabled");
    expect(assign).not.toMatch(
      /update\s+public\.opportunities[\s\S]*set[\s\S]*assigned_to/
    );
  });

  it("returns optimistic conflicts without overwriting assignments or manual unassignments", () => {
    const assign = functionBody(
      sql(),
      "private.assign_new_company_mailbox_opportunity_internal"
    );

    expect(assign).toMatch(
      /opportunity\.assignment_version\s+is distinct from p_expected_assignment_version/
    );
    expect(assign).toContain(
      "opportunity.assigned_to is distinct from p_expected_assigned_to"
    );
    expect(assign).toContain("'conflict', true");
    expect(assign).toContain("'prompt_count', 0");
    expect(assign).toMatch(
      /opportunity\.assignment_version <> 0[\s\S]*'manual_override'/
    );
  });

  it("atomically assigns or enqueues fallback prompts for an initial email opportunity", () => {
    const assign = functionBody(
      sql(),
      "private.assign_new_company_mailbox_opportunity_internal"
    );

    expect(assign).toContain("opportunity.source is distinct from 'email'");
    expect(assign).toContain(
      "opportunity.stage in ('won', 'lost', 'discarded')"
    );
    expect(assign).toContain(
      "private.enqueue_unassigned_lead_assignment_deliveries"
    );
    expect(assign).toContain("'reason', 'owner_missing'");
    expect(assign).toContain("'reason', 'owner_ineligible'");
    expect(assign).toContain("'prompt_count'");
  });

  it("accepts only a complete, typed, allowlisted company-mailbox create payload", () => {
    const create = functionBody(
      sql(),
      "public.create_company_mailbox_email_opportunity_as_system"
    );
    const allowlistStart = create.indexOf("where payload_key not in");
    const allowlistEnd = create.indexOf(") then", allowlistStart);
    const allowlist = create.slice(allowlistStart, allowlistEnd);
    const expectedKeys = [
      "client_id",
      "title",
      "stage",
      "source_thread_key",
      "contact_name",
      "contact_email",
      "contact_phone",
      "address",
      "estimated_value",
      "detected_value",
      "description",
      "source_email_id",
      "source_message_id",
      "source_metadata",
      "tags",
      "ai_stage_signals",
      "ai_stage_confidence",
    ];

    expect(create).toContain("service_role");
    expect(create).toContain("p_ingestion_source is null");
    expect(create).toContain(
      "p_ingestion_source not in ('email_sync', 'email_recovery')"
    );
    expect(
      [...allowlist.matchAll(/'([^']+)'/g)].map((match) => match[1])
    ).toEqual(expectedKeys);
    for (const forbidden of [
      "company_id",
      "source",
      "assigned_to",
      "assignment_version",
      "stage_manually_set",
    ]) {
      expect(allowlist).not.toContain(`'${forbidden}'`);
    }
    expect(create).toContain(
      "company_mailbox_opportunity_payload_field_forbidden"
    );
    expect(create).toMatch(
      /jsonb_array_elements\([\s\S]*p_opportunity -> 'tags'[\s\S]*\) tag_element\(value\)[\s\S]*jsonb_typeof\(tag_element\.value\) <> 'string'/
    );
    expect(create).toMatch(
      /jsonb_array_elements\([\s\S]*p_opportunity -> 'ai_stage_signals'[\s\S]*\) signal_element\(value\)[\s\S]*jsonb_typeof\(signal_element\.value\) <> 'string'/
    );
    expect(create).toContain("v_stage is null");
  });

  it("binds thread source keys to the provider thread and locks company then connection before insert", () => {
    const create = functionBody(
      sql(),
      "public.create_company_mailbox_email_opportunity_as_system"
    );

    expect(create).toMatch(
      /split_part\(v_source_thread_key, ':', 4\)\s*=\s*'thread'[\s\S]*split_part\(v_source_thread_key, ':', 5\)\s+is distinct from p_provider_thread_id/
    );
    expect(create).toMatch(
      /split_part\(v_source_thread_key, ':', 4\)[\s\S]*not in \('thread', 'message'\)/
    );
    expect(create).toContain(
      "nullif(split_part(v_source_thread_key, ':', 5), '') is null"
    );
    expect(create).toContain(
      "cardinality(string_to_array(v_source_thread_key, ':')) <> 5"
    );

    const companyLookup = create.indexOf("into v_company_id");
    const companyLock = create.indexOf(
      "private.lock_lead_assignment_company(v_company_id)"
    );
    const connectionLock = create.indexOf("for update", companyLock);
    const insert = create.indexOf("insert into public.opportunities");
    expect(companyLookup).toBeGreaterThanOrEqual(0);
    expect(companyLock).toBeGreaterThan(companyLookup);
    expect(connectionLock).toBeGreaterThan(companyLock);
    expect(insert).toBeGreaterThan(connectionLock);
  });

  it("adopts only the exact source-key winner and never backfills assignment on retries", () => {
    const create = functionBody(
      sql(),
      "public.create_company_mailbox_email_opportunity_as_system"
    );
    const firstExistingRead = create.indexOf(
      "from public.opportunities opportunity_row"
    );
    const clientRead = create.indexOf("from public.clients client");
    const noBackfillBranch = create.slice(firstExistingRead, clientRead);

    expect(noBackfillBranch).toContain(
      "opportunity_row.company_id = v_company_id"
    );
    expect(noBackfillBranch).toContain(
      "opportunity_row.source_thread_key = v_source_thread_key"
    );
    expect(noBackfillBranch).toContain("'created', false");
    expect(noBackfillBranch).toContain("'reason', 'source_key_exists'");
    expect(noBackfillBranch).toContain("'assignment', null");
    expect(noBackfillBranch).not.toContain(
      "private.assign_new_company_mailbox_opportunity_internal"
    );

    expect(create).toContain("exception");
    expect(create).toContain("when unique_violation then");
    expect(create).toContain(
      "get stacked diagnostics v_unique_constraint = constraint_name"
    );
    expect(create).toMatch(
      /v_unique_constraint is distinct from\s+'opportunities_company_source_thread_key_key'\s+then\s+raise;/
    );
    expect(create).not.toContain(
      "on conflict (company_id, source_thread_key) do nothing"
    );
  });

  it("creates and assigns or durably prompts in the same public RPC transaction", () => {
    const create = functionBody(
      sql(),
      "public.create_company_mailbox_email_opportunity_as_system"
    );

    expect(create).toContain("insert into public.opportunities");
    expect(create).toContain(
      "private.assign_new_company_mailbox_opportunity_internal"
    );
    expect(create).toContain("'provider_mutations_disabled'");
    expect(create).toContain("'assigned'");
    expect(create).toContain("'owner_missing'");
    expect(create).toContain("'owner_ineligible'");
    expect(create).toMatch(
      /v_assignment_reason in \('owner_missing', 'owner_ineligible'\)[\s\S]*v_prompt_count < 1/
    );
    expect(create).toContain("company_mailbox_atomic_assignment_failed");
    expect(create).toContain("'created_assigned'");
    expect(create).toContain("'created_prompted'");
  });

  it("creates a fully revoked RLS outbox with durable lease and retry state", () => {
    const source = sql();

    expect(source).toContain(
      "create table public.unassigned_lead_assignment_deliveries"
    );
    expect(source).toMatch(
      /create index unassigned_lead_assignment_deliveries_connection_idx[\s\S]*on public\.unassigned_lead_assignment_deliveries \(connection_id\)/
    );
    expect(source).toMatch(
      /create index unassigned_lead_assignment_deliveries_recipient_idx[\s\S]*on public\.unassigned_lead_assignment_deliveries \(recipient_user_id\)/
    );
    expect(source).toMatch(
      /create index unassigned_lead_assignment_deliveries_notification_idx[\s\S]*on public\.unassigned_lead_assignment_deliveries \(notification_id\)[\s\S]*where notification_id is not null/
    );
    expect(source).toMatch(/unique \(opportunity_id, recipient_user_id\)/);
    expect(source).toMatch(
      /state text[\s\S]*'pending'[\s\S]*'processing'[\s\S]*'delivered'[\s\S]*'failed'/
    );
    expect(source).toContain("lease_token uuid");
    expect(source).toContain("lease_expires_at timestamptz");
    expect(source).toContain("max_attempts integer");
    expect(source).toContain("notification_id uuid");
    expect(source).toMatch(
      /alter table public\.unassigned_lead_assignment_deliveries\s+enable row level security/
    );
    expect(source).toMatch(
      /alter table public\.unassigned_lead_assignment_deliveries\s+force row level security/
    );
    expect(source).toMatch(
      /revoke all on table public\.unassigned_lead_assignment_deliveries[\s\S]*from public, anon, authenticated, service_role/
    );
    expect(source).not.toMatch(
      /create policy[\s\S]*on public\.unassigned_lead_assignment_deliveries/
    );
  });

  it("addresses only active company admins with company-wide view, edit, and assignment", () => {
    const enqueue = functionBody(
      sql(),
      "private.enqueue_unassigned_lead_assignment_deliveries"
    );

    expect(enqueue).toContain("private.permission_user_is_admin");
    for (const permission of [
      "pipeline.view",
      "pipeline.edit",
      "pipeline.assign",
    ]) {
      expect(enqueue).toMatch(
        new RegExp(
          `private\\.raw_pipeline_scope_for_user\\([\\s\\S]*?'${permission.replace(".", "\\.")}'[\\s\\S]*?\\)\\s*=\\s*'all'`,
          "i"
        )
      );
    }
    expect(enqueue).toMatch(
      /recipient\.deleted_at is null[\s\S]*coalesce\(recipient\.is_active, false\)/
    );
    expect(enqueue).toContain(
      "on conflict (opportunity_id, recipient_user_id) do nothing"
    );
  });

  it("claims with company-first locking, stale suppression, and exact recipient reauthorization", () => {
    const claim = functionBody(
      sql(),
      "public.claim_unassigned_lead_assignment_deliveries"
    );

    expect(claim).toContain("service_role");
    expect(claim).toContain(
      "private.lock_lead_assignment_company(v_company_id)"
    );
    expect(claim).toContain("for update of candidate skip locked");
    expect(claim).toContain("lease_expires_at <= now()");
    expect(claim).toContain("attempts < candidate.max_attempts");
    expect(claim).toContain("opportunity.assigned_to is not null");
    expect(claim).toContain("opportunity.assignment_version <> 0");
    expect(claim).toContain("private.permission_user_is_admin");
    expect(claim).toContain("private.raw_pipeline_scope_for_user");
    expect(claim).toContain("'stale'");
    expect(claim).toContain("'inaccessible'");
    expect(claim).toContain("'terminal_failure'");
  });

  it("materializes one persistent assignment prompt before exposing a push claim", () => {
    const source = sql();
    const claim = functionBody(
      source,
      "public.claim_unassigned_lead_assignment_deliveries"
    );

    expect(source).toMatch(
      /create unique index[\s\S]*notifications[\s\S]*dedupe_key[\s\S]*unassigned-lead-assignment-delivery:/
    );
    expect(claim).toContain("insert into public.notifications");
    expect(claim).toContain("'lead_assignment_required'");
    expect(claim).toContain("'lead needs an owner'");
    expect(claim).toContain("'assign '");
    expect(claim).toContain("true");
    expect(claim).toContain("'/pipeline?opportunityid='");
    expect(claim).toContain("'assign lead'");
    expect(claim).toContain("'lead'");
    expect(claim).toContain("unassigned-lead-assignment-delivery:");
    expect(claim).toContain("on conflict do nothing");
    expect(claim).toContain("notification_id");
  });

  it("keeps the persistent rail prompt independent while lead-assignment preferences gate push", () => {
    const claim = functionBody(
      sql(),
      "public.claim_unassigned_lead_assignment_deliveries"
    );

    expect(claim).toContain("notification_preferences");
    expect(claim).toContain("push_enabled");
    expect(claim).toContain("'{lead_assignments,push}'");
    expect(claim).toContain("v_should_push");
    expect(claim).not.toMatch(
      /insert into public\.notifications[\s\S]+where[^;]+push_enabled/
    );
  });

  it("resolves every prompt and materialized notification after canonical assignment", () => {
    const source = sql();
    const resolve = functionBody(
      source,
      "private.resolve_unassigned_lead_assignment_deliveries"
    );

    expect(source).toMatch(
      /after insert on public\.opportunity_assignment_events[\s\S]*private\.resolve_unassigned_lead_assignment_deliveries/
    );
    expect(resolve).toContain("new.new_assignee_id is null");
    expect(resolve).toContain("update public.notifications");
    expect(resolve).toContain("is_read = true");
    expect(resolve).toContain("resolved_at = now()");
    expect(resolve).toContain(
      "resolution_reason = 'lead_assignment_completed'"
    );
    expect(resolve).toContain(
      "update public.unassigned_lead_assignment_deliveries"
    );
    expect(resolve).toContain("disposition = 'assigned'");
  });

  it("completes and fails only active leases with stale resolution and bounded backoff", () => {
    const source = sql();
    const complete = functionBody(
      source,
      "public.complete_unassigned_lead_assignment_delivery"
    );
    const fail = functionBody(
      source,
      "public.fail_unassigned_lead_assignment_delivery"
    );

    expect(complete).toContain("service_role");
    expect(complete).toContain("for update");
    expect(complete).toContain("lease_token is distinct from p_lease_token");
    expect(complete).toContain("public.notifications");
    expect(complete).toContain("persistent is true");
    expect(complete).toContain("private.permission_user_is_admin");
    expect(complete).toContain("resolved_at = now()");
    expect(complete).toContain("'suppressed', true");

    expect(fail).toContain("service_role");
    expect(fail).toContain("for update");
    expect(fail).toContain("lease_token is distinct from p_lease_token");
    expect(fail).toContain("p_retryable");
    expect(fail).toContain("max_attempts");
    expect(fail).toContain("make_interval");
    expect(fail).toContain("power(");
    expect(fail).toContain("terminal_at");
  });

  it("exposes only the stable service-role integration RPCs", () => {
    const source = sql();
    const compactSource = source
      .replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");

    for (const signature of [
      "configure_company_mailbox_intake_owner_as_system(uuid, uuid, uuid, uuid)",
      "create_company_mailbox_email_opportunity_as_system(uuid, jsonb, text, text, boolean)",
      "claim_unassigned_lead_assignment_deliveries(uuid, integer, integer)",
      "complete_unassigned_lead_assignment_delivery(uuid, uuid, text)",
      "fail_unassigned_lead_assignment_delivery(uuid, uuid, text, boolean)",
    ]) {
      expect(compactSource).toContain(
        `revoke all on function public.${signature}`
      );
      expect(compactSource).toContain(
        `grant execute on function public.${signature} to service_role`
      );
    }

    expect(compactSource).toContain(
      "revoke all on function private.assign_new_company_mailbox_opportunity_internal(uuid, uuid, bigint, uuid, jsonb)"
    );
    expect(compactSource).not.toContain(
      "grant execute on function private.assign_new_company_mailbox_opportunity_internal"
    );
    expect(source).not.toContain(
      "create or replace function public.assign_new_company_mailbox_opportunity"
    );
    expect(compactSource).not.toContain(
      "grant execute on function public.assign_new_company_mailbox_opportunity"
    );
  });

  it("creates dependencies in order and commits exactly once at the end", () => {
    const source = sql();
    const markers = [
      "create or replace function public.configure_company_mailbox_intake_owner_as_system",
      "alter table public.opportunity_assignment_events",
      "create or replace function private.change_opportunity_assignment_core",
      "create table public.unassigned_lead_assignment_deliveries",
      "create or replace function private.enqueue_unassigned_lead_assignment_deliveries",
      "create or replace function private.assign_new_company_mailbox_opportunity_internal",
      "create or replace function public.create_company_mailbox_email_opportunity_as_system",
      "create or replace function private.resolve_unassigned_lead_assignment_deliveries",
      "create trigger opportunity_assignment_events_resolve_unassigned_prompts",
      "create or replace function public.claim_unassigned_lead_assignment_deliveries",
      "create or replace function public.complete_unassigned_lead_assignment_delivery",
      "create or replace function public.fail_unassigned_lead_assignment_delivery",
      "revoke all on function private.company_mailbox_intake_owner_is_eligible",
    ];

    let previousIndex = -1;
    for (const marker of markers) {
      const markerIndex = source.indexOf(marker);
      expect(markerIndex, `${marker} missing`).toBeGreaterThan(previousIndex);
      previousIndex = markerIndex;
    }

    expect(source.match(/\bcommit;/g)).toHaveLength(1);
    expect(source.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("contains no historical opportunity assignment or prompt backfill", () => {
    const source = sql();
    const beforeFirstFunction = source.slice(
      0,
      source.indexOf("create or replace function")
    );

    expect(beforeFirstFunction).not.toMatch(
      /update public\.opportunities[\s\S]*assigned_to/
    );
    expect(beforeFirstFunction).not.toMatch(
      /insert into public\.unassigned_lead_assignment_deliveries[\s\S]*select[\s\S]*from public\.opportunities/
    );
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260715180500_notification_creation_hardening.sql"
  ),
  "utf8"
).toLowerCase();
const databaseTypes = readFileSync(
  join(process.cwd(), "src/lib/types/database.types.ts"),
  "utf8"
);
const lifecycleService = readFileSync(
  join(
    process.cwd(),
    "src/lib/api/services/personal-email-connection-lifecycle-service.ts"
  ),
  "utf8"
);

function functionBody(name: string): string {
  const match = sql.match(
    new RegExp(
      `create or replace function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\)\\s*returns[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`
    )
  );
  expect(match, `${name} is missing`).toBeTruthy();
  return match?.[1] ?? "";
}

describe("email signature notification lifecycle migration", () => {
  it("resolves a saved signature before enforcing active transport creation gates", () => {
    const body = functionBody(
      "public.sync_email_signature_notification_as_system"
    );
    const signatureCheck = body.indexOf("from public.email_signatures");
    const signatureResolution = body.indexOf(
      "resolution_reason = 'signature_available'"
    );
    const sendPathCheck = body.indexOf("v_has_current_send_path :=");

    expect(signatureCheck).toBeGreaterThanOrEqual(0);
    expect(signatureResolution).toBeGreaterThan(signatureCheck);
    expect(sendPathCheck).toBeGreaterThan(signatureResolution);
    expect(body).toContain("n.dedupe_key = v_dedupe_key");
    expect(body).toContain("n.user_id = p_actor_user_id::text");
    expect(body).toContain("n.company_id = v_company_id::text");
  });

  it("resolves disabled or access-lost prompts and only creates on a canonical current send path", () => {
    const body = functionBody(
      "public.sync_email_signature_notification_as_system"
    );
    const eligibility = functionBody(
      "private.user_has_email_signature_notification_path"
    );
    const accessLost = body.indexOf(
      "resolution_reason = 'signature_access_lost'"
    );
    const creator = body.indexOf("public.sync_email_signature_notification(");

    expect(body).toContain(
      "private.user_has_email_signature_notification_path("
    );
    expect(eligibility).toContain("connection.status = 'active'");
    expect(eligibility).toContain("coalesce(connection.sync_enabled, false)");
    expect(eligibility).toContain("private.user_can_send_inbox_connection(");
    expect(eligibility).not.toMatch(
      /public\.has_permission\([\s\S]*?'inbox\.send'/
    );
    expect(eligibility).toContain("connection.type = 'individual'");
    expect(eligibility).toMatch(
      /nullif\(btrim\(v_connection\.user_id\), ''\) = p_actor_user_id::text/
    );
    expect(eligibility).toContain(
      "connection.type::text in ('company', 'individual')"
    );
    expect(eligibility).toContain("'settings.integrations'");
    expect(eligibility).toContain("private.user_can_send_opportunity_inbox(");
    expect(accessLost).toBeGreaterThanOrEqual(0);
    expect(creator).toBeGreaterThan(accessLost);
  });

  it("keeps a prompt when any other sendable opportunity remains for the actor and connection", () => {
    const body = functionBody(
      "private.user_has_email_signature_notification_path"
    );

    expect(body).toMatch(
      /select exists \([\s\S]*?from public\.opportunities o[\s\S]*?o\.company_id = v_company_id[\s\S]*?o\.deleted_at is null[\s\S]*?o\.archived_at is null[\s\S]*?private\.user_can_send_opportunity_inbox\([\s\S]*?p_actor_user_id,[\s\S]*?o\.id,[\s\S]*?p_connection_id[\s\S]*?\)[\s\S]*?\) into v_has_sendable_opportunity/
    );
  });

  it("keeps personal-owner prompts when assigned-scope send is authorized through a lead", () => {
    const body = functionBody(
      "private.user_has_email_signature_notification_path"
    );

    expect(body).toMatch(
      /if v_connection\.type = 'individual' then[\s\S]*?v_connection\.user_id[\s\S]*?v_standalone_send[\s\S]*?or v_has_sendable_opportunity/
    );
  });

  it("uses canonical standalone send authorization for all-scope users and respects granular inbox revokes", () => {
    const body = functionBody(
      "private.user_has_email_signature_notification_path"
    );

    expect(body).toMatch(
      /private\.user_can_send_inbox_connection\([\s\S]*?p_actor_user_id,[\s\S]*?v_company_id,[\s\S]*?p_connection_id,[\s\S]*?null[\s\S]*?\)/
    );
    expect(body).not.toMatch(
      /public\.has_permission\([\s\S]*?p_actor_user_id,[\s\S]*?'inbox\.send'/
    );
  });

  it("durably queues old and new assignees without writing notifications in the assignment transaction", () => {
    expect(sql).toContain(
      "create table if not exists public.email_signature_notification_lifecycle_outbox"
    );
    expect(sql).toContain(
      "primary key (actor_user_id, connection_id, company_id)"
    );
    expect(sql).toContain(
      "after insert on public.opportunity_assignment_events"
    );

    const body = functionBody(
      "public.queue_email_signature_assignment_reconciliation"
    );
    expect(body).toContain("new.previous_assignee_id");
    expect(body).toContain("new.new_assignee_id");
    expect(body).toContain("new.opportunity_id");
    expect(body).toContain(
      "public.enqueue_email_signature_notification_lifecycle("
    );
    expect(body).not.toContain("update public.notifications");
    expect(body).not.toContain(
      "public.sync_email_signature_notification_as_system("
    );
  });

  it("queues disabled connections and deactivated or permission-changed actors for retryable reconciliation", () => {
    expect(sql).toContain(
      "after update of status, sync_enabled, user_id, type, company_id, email on public.email_connections"
    );
    expect(sql).toContain(
      "after update of is_active, deleted_at, is_company_admin, company_id on public.users"
    );
    expect(sql).toContain("on public.user_permission_overrides");
    expect(sql).toContain("on public.user_roles");
    expect(sql).toContain("on public.role_permissions");
    expect(sql).toContain(
      "create or replace function public.process_email_signature_notification_lifecycle"
    );
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("processed_at = null");
  });

  it("queues first-time eligible actors on activation and permission changes without requiring prompt history", () => {
    const actorQueue = functionBody(
      "public.queue_email_signature_notification_history_for_actor"
    );
    const connectionQueue = functionBody(
      "public.queue_email_signature_notification_history_for_connection"
    );

    expect(actorQueue).toContain("join public.email_connections connection");
    expect(actorQueue).toContain("connection.type::text = 'company'");
    expect(actorQueue).toContain("connection.user_id = p_actor_user_id::text");
    expect(connectionQueue).toContain("join public.users actor");
    expect(connectionQueue).toContain("connection.type::text = 'company'");
    expect(connectionQueue).toContain("connection.user_id = actor.id::text");
    expect(sql).toContain("after insert on public.email_connections");
  });

  it("durably resolves old-tenant prompts after a connection company change", () => {
    const connectionQueue = functionBody(
      "public.queue_email_signature_connection_reconciliation"
    );
    const processor = functionBody(
      "public.process_email_signature_notification_lifecycle"
    );

    expect(connectionQueue).toContain("old.company_id");
    expect(connectionQueue).toContain(
      "public.enqueue_email_signature_notification_lifecycle_for_company("
    );
    expect(processor).toContain(
      "event.company_id is distinct from v_current_company_id"
    );
    expect(processor).toContain("resolution_reason = 'signature_access_lost'");
    expect(processor).toContain(
      "notification.company_id = v_event.company_id::text"
    );
  });

  it("backfills current candidates before the reserved Operator activation", () => {
    expect(sql).toContain("'migration_candidate_backfill'");
    expect(sql).toMatch(
      /from public\.email_connections connection[\s\S]*?join public\.users actor[\s\S]*?connection\.type::text = 'company'[\s\S]*?connection\.type::text = 'individual'[\s\S]*?connection\.user_id = actor\.id::text[\s\S]*?on conflict \(actor_user_id, connection_id, company_id\) do update/
    );
    expect(sql).toContain("before the reserved 181000");
  });

  it("reconciles canonical admin grants, revokes, and actor tenant changes", () => {
    expect(sql).toContain(
      "after update of is_active, deleted_at, is_company_admin, company_id on public.users"
    );
    expect(sql).toContain(
      "after update of account_holder_id, admin_ids on public.companies"
    );
    const actorTrigger = functionBody(
      "public.queue_email_signature_actor_reconciliation"
    );
    const companyTrigger = functionBody(
      "public.queue_email_signature_company_admin_reconciliation"
    );
    expect(actorTrigger).toContain("old.company_id");
    expect(actorTrigger).toContain(
      "public.enqueue_email_signature_notification_lifecycle_for_company("
    );
    expect(companyTrigger).toContain("old.account_holder_id");
    expect(companyTrigger).toContain("new.account_holder_id");
    expect(companyTrigger).toContain("old.admin_ids");
    expect(companyTrigger).toContain("new.admin_ids");
  });

  it("queues opportunity creation, archive, delete, and tenant transitions", () => {
    expect(sql).toContain("on public.opportunities");
    expect(sql).toContain("after insert or delete on public.opportunities");
    expect(sql).toContain(
      "after update of archived_at, deleted_at, company_id on public.opportunities"
    );
    const body = functionBody(
      "public.queue_email_signature_opportunity_reconciliation"
    );
    expect(body).toContain(
      "public.queue_email_signature_notification_history_for_connection("
    );
    expect(body).toContain("old.company_id");
    expect(body).toContain("new.company_id");
  });

  it("backs off failed work and guards failure annotation by exact event version", () => {
    expect(sql).toContain("available_at timestamptz not null");
    expect(sql).toContain(
      "create or replace function public.fail_email_signature_notification_lifecycle"
    );
    const body = functionBody(
      "public.fail_email_signature_notification_lifecycle"
    );
    expect(sql).toMatch(
      /public\.fail_email_signature_notification_lifecycle\([\s\S]*?p_expected_requested_at timestamptz/
    );
    expect(body).toContain("event.requested_at = p_expected_requested_at");
    expect(body).toContain("attempt_count = event.attempt_count + 1");
    expect(body).toContain("available_at = clock_timestamp() + make_interval(");
    expect(sql).toMatch(
      /on conflict \(actor_user_id, connection_id, company_id\) do update[\s\S]*?attempt_count = 0[\s\S]*?available_at = clock_timestamp\(\)[\s\S]*?last_error = null/
    );
    expect(sql).toMatch(
      /create or replace function public\.process_email_signature_notification_lifecycle\(\s*p_actor_user_id uuid,\s*p_connection_id uuid\s*\)[\s\S]*?return public\.process_email_signature_notification_lifecycle\(\s*p_actor_user_id,\s*p_connection_id,\s*v_company_id\s*\)/
    );
    expect(sql).toMatch(
      /revoke all on table public\.email_signature_notification_lifecycle_outbox[\s\S]*?service_role;[\s\S]*?grant select\s+on table public\.email_signature_notification_lifecycle_outbox\s+to service_role/
    );
    expect(sql).not.toMatch(
      /grant select, update\s+on table public\.email_signature_notification_lifecycle_outbox/
    );
    expect(lifecycleService).toContain(
      '"fail_email_signature_notification_lifecycle"'
    );
    expect(lifecycleService).not.toMatch(
      /\.from\(SIGNATURE_LIFECYCLE_OUTBOX\)[\s\S]*?\.update\(/
    );
  });

  it("durably queues signature saves and deactivations even if immediate runtime reconciliation fails", () => {
    expect(sql).toContain("on public.email_signatures");
    expect(sql).toContain(
      "create or replace function public.queue_email_signature_record_reconciliation"
    );
    const body = functionBody(
      "public.queue_email_signature_record_reconciliation"
    );
    expect(body).toContain(
      "public.enqueue_email_signature_notification_lifecycle("
    );
    expect(body).toContain(
      "public.queue_email_signature_notification_history_for_connection("
    );
    expect(body).not.toContain("update public.notifications");
  });

  it("publishes generated table and service RPC contracts", () => {
    expect(databaseTypes).toContain(
      "email_signature_notification_lifecycle_outbox: {"
    );
    expect(databaseTypes).toContain(
      "enqueue_email_signature_notification_lifecycle: {"
    );
    expect(databaseTypes).toContain(
      "process_email_signature_notification_lifecycle: {"
    );
    expect(databaseTypes).toContain(
      "fail_email_signature_notification_lifecycle: {"
    );
    expect(databaseTypes).toContain("p_actor_user_id: string");
    expect(databaseTypes).toContain("p_connection_id: string");
  });
});

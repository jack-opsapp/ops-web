import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260722120000_guarded_exact_email_message_reparent.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compact = sql.replace(/\s+/g, " ");

describe("guarded exact email-message reparent migration", () => {
  it("exposes a service-only exact-ingest authorization bridge that intersects mailbox, create, and company-wide edit authority", () => {
    expect(compact).toContain(
      "create or replace function public.authorize_email_exact_message_ingest_as_system"
    );
    expect(compact).toMatch(
      /public\.authorize_email_inbox_action_as_system\(\s*p_actor_user_id,\s*p_connection_id,\s*null,\s*'view'\s*\)/
    );
    expect(compact).toMatch(
      /private\.user_can_create_opportunity\(\s*p_actor_user_id,\s*p_company_id\s*\)/
    );
    expect(compact).toMatch(
      /private\.effective_pipeline_scope_for_user\(\s*p_actor_user_id,\s*p_company_id,\s*'pipeline\.edit'\s*\) is distinct from 'all'/
    );
    expect(compact).toMatch(
      /revoke all on function public\.authorize_email_exact_message_ingest_as_system\(\s*uuid, uuid, uuid\s*\) from public, anon, authenticated, service_role/
    );
    expect(compact).toMatch(
      /grant execute on function public\.authorize_email_exact_message_ingest_as_system\(\s*uuid, uuid, uuid\s*\) to service_role/
    );
  });

  it("claims a legacy activity mailbox only inside a service-role RPC that locks and re-proves the exact correspondence event", () => {
    const claimStart = compact.indexOf(
      "create or replace function public.claim_legacy_email_activity_connection_as_system"
    );
    const claimEnd = compact.indexOf(
      "revoke all on function public.claim_legacy_email_activity_connection_as_system",
      claimStart
    );
    const claim = compact.slice(claimStart, claimEnd);
    const eventLock = claim.indexOf("select event.* into locked_event");
    const activityLock = claim.indexOf(
      "select activity.* into locked_activity"
    );

    expect(claimStart).toBeGreaterThanOrEqual(0);
    expect(claim).toContain("auth.role() is distinct from 'service_role'");
    expect(eventLock).toBeGreaterThanOrEqual(0);
    expect(activityLock).toBeGreaterThan(eventLock);
    expect(claim).toContain("from public.activities activity");
    expect(claim).toContain("for update");
    expect(claim).toContain("event.activity_id = p_activity_id");
    expect(claim).toContain("event.connection_id = p_connection_id");
    expect(claim).toContain("event.provider_thread_id = p_provider_thread_id");
    expect(claim).toContain(
      "event.provider_message_id = p_provider_message_id"
    );
    expect(claim).toContain(
      "locked_event.opportunity_id is distinct from locked_activity.opportunity_id"
    );
    expect(claim).toContain("legacy_email_activity_connection_conflict");
    expect(claim).toContain("legacy_email_activity_connection_unproven");
    expect(claim).toContain(
      "update public.activities activity set email_connection_id = p_connection_id"
    );
    expect(compact).toMatch(
      /revoke all on function public\.claim_legacy_email_activity_connection_as_system\(\s*uuid, uuid, uuid, text, text\s*\) from public, anon, authenticated, service_role/
    );
    expect(compact).toMatch(
      /grant execute on function public\.claim_legacy_email_activity_connection_as_system\(\s*uuid, uuid, uuid, text, text\s*\) to service_role/
    );
  });

  it("is transactional and records one content-addressed application per mailbox message", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(compact).toContain(
      "create table private.email_exact_message_recovery_applications"
    );
    expect(compact).toContain(
      "primary key (company_id, connection_id, provider_message_id)"
    );
    expect(compact).toContain("manifest_sha256");
    expect(compact).toContain("entry_sha256");
    expect(compact).toContain("actor_user_id");
    expect(compact).toContain("target_resolution");
    expect(compact).toContain("target_source_thread_key");
    expect(compact).toContain("target_initial_title");
    expect(compact).toContain("target_initial_contact_name");
    expect(compact).toContain(
      "revoke all on table private.email_exact_message_recovery_applications from public, anon, authenticated, service_role"
    );
  });

  it("exposes only a service-role read proof for an exact content-addressed recovery application", () => {
    const proofStart = compact.indexOf(
      "create or replace function public.inspect_exact_message_recovery_application_as_system"
    );
    const proofEnd = compact.indexOf(
      "revoke all on function public.inspect_exact_message_recovery_application_as_system",
      proofStart
    );
    const proof = compact.slice(proofStart, proofEnd);

    expect(proofStart).toBeGreaterThanOrEqual(0);
    expect(proof).toContain("auth.role()) is distinct from 'service_role'");
    expect(proof).toContain(
      "from private.email_exact_message_recovery_applications application"
    );
    for (const identity of [
      "application.company_id = p_company_id",
      "application.connection_id = p_connection_id",
      "application.provider_thread_id = p_provider_thread_id",
      "application.provider_message_id = p_provider_message_id",
      "application.manifest_sha256 = p_manifest_sha256",
      "application.entry_sha256 = p_entry_sha256",
    ]) {
      expect(proof).toContain(identity);
    }
    expect(compact).toMatch(
      /revoke all on function public\.inspect_exact_message_recovery_application_as_system\(\s*uuid, uuid, text, text, text, text\s*\) from public, anon, authenticated, service_role/
    );
    expect(compact).toMatch(
      /grant execute on function public\.inspect_exact_message_recovery_application_as_system\(\s*uuid, uuid, text, text, text, text\s*\) to service_role/
    );
  });

  it("persists immutable all-action recovery work and advances only ordered service-role steps", () => {
    const workStart = compact.indexOf(
      "create table private.email_exact_message_recovery_work"
    );
    const workEnd = compact.indexOf(
      "revoke all on table private.email_exact_message_recovery_work",
      workStart
    );
    const workTable = compact.slice(workStart, workEnd);

    expect(workStart).toBeGreaterThanOrEqual(0);
    expect(workTable).toContain(
      "id uuid primary key default gen_random_uuid()"
    );
    expect(workTable).toContain("message_payload jsonb not null");
    expect(compact).toMatch(
      /create unique index email_exact_message_recovery_work_active_message_uidx on private\.email_exact_message_recovery_work \( company_id, connection_id, provider_message_id \) where abandoned_at is null/
    );
    expect(workTable).toContain("manifest_generated_at timestamptz not null");
    expect(workTable).toContain("manifest_cutoff_at timestamptz not null");
    expect(workTable).toContain("attachment_scan_generation bigint");
    expect(workTable).toContain("attachment_ids uuid[]");
    expect(workTable).toContain("superseded_by_manifest_sha256");
    for (const state of [
      "ingest_pending",
      "mutation_pending",
      "attachment_scan_pending",
      "repair_pending",
      "draft_projection_pending",
      "abandoned",
      "complete",
    ]) {
      expect(compact).toContain(`'${state}'`);
    }
    for (const functionName of [
      "inspect_exact_message_recovery_work_as_system",
      "register_exact_message_recovery_work_as_system",
      "abandon_exact_message_recovery_work_as_system",
      "mark_exact_message_recovery_work_step_as_system",
    ]) {
      expect(compact).toContain(
        `create or replace function public.${functionName}`
      );
      expect(compact).toMatch(
        new RegExp(
          `revoke all on function public\\.${functionName}\\([^)]*\\) from public, anon, authenticated, service_role`
        )
      );
      expect(compact).toMatch(
        new RegExp(
          `grant execute on function public\\.${functionName}\\([^)]*\\) to service_role`
        )
      );
    }
    expect(compact).toContain("exact_recovery_attachment_step_out_of_order");
    expect(compact).toContain("exact_recovery_repair_step_out_of_order");
    expect(compact).toContain("exact_recovery_draft_step_out_of_order");
    expect(compact).toContain(
      "v_work.message_payload is distinct from p_message_payload"
    );
    expect(compact).toContain(
      "exact_recovery_started_work_cannot_be_superseded"
    );
    expect(compact).toContain("superseded_by_manifest_sha256");
    expect(compact).toContain("event.direction = 'inbound'");
    expect(compact).toContain("event.party_role = 'customer'");
    expect(compact).toContain("event.is_meaningful is true");
  });

  it("exposes only an actor-aware service-role RPC", () => {
    const reparentStart = compact.indexOf(
      "create or replace function public.reparent_opportunity_email_message_guarded"
    );
    const reparentEnd = compact.indexOf(
      "revoke all on function public.reparent_opportunity_email_message_guarded",
      reparentStart
    );
    const reparentRpc = compact.slice(reparentStart, reparentEnd);

    expect(compact).toContain(
      "create or replace function public.reparent_opportunity_email_message_guarded"
    );
    expect(compact).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(compact).toContain("p_actor_user_id uuid");
    expect(compact).toContain("p_company_id uuid");
    expect(compact).toContain("p_connection_id uuid");
    expect(compact).toContain("p_provider_thread_id text");
    expect(compact).toContain("p_provider_message_id text");
    expect(compact).toMatch(
      /private\.user_can_edit_opportunity\(\s*p_actor_user_id,\s*p_source_opportunity_id\s*\)/
    );
    expect(compact).toMatch(
      /private\.user_can_edit_opportunity\(\s*p_actor_user_id,\s*p_target_opportunity_id\s*\)/
    );
    expect(compact).toMatch(
      /public\.authorize_email_inbox_action_as_system\(\s*p_actor_user_id,\s*p_connection_id,\s*null,\s*'view'\s*\)/
    );
    expect(compact).toContain("recovery_actor_cannot_view_mailbox");
    expect(reparentRpc).toMatch(
      /from public\.users actor[\s\S]*?actor\.id = p_actor_user_id[\s\S]*?actor\.company_id = p_company_id[\s\S]*?actor\.deleted_at is null[\s\S]*?coalesce\(actor\.is_active, false\)[\s\S]*?for share/
    );
    expect(reparentRpc.indexOf("from public.users actor")).toBeLessThan(
      reparentRpc.indexOf("private.user_can_edit_opportunity")
    );
    expect(compact).toMatch(
      /revoke all on function public\.reparent_opportunity_email_message_guarded\([\s\S]*?\) from public, anon, authenticated, service_role/
    );
    expect(compact).toMatch(
      /grant execute on function public\.reparent_opportunity_email_message_guarded\([\s\S]*?\) to service_role/
    );
  });

  it("creates or converges on one canonical unassigned target before calling guarded reparent in the same transaction", () => {
    const createStart = compact.indexOf(
      "create or replace function public.create_target_and_reparent_opportunity_email_message_guarded"
    );
    const createEnd = compact.indexOf(
      "revoke all on function public.create_target_and_reparent_opportunity_email_message_guarded",
      createStart
    );
    const createRpc = compact.slice(createStart, createEnd);

    expect(createStart).toBeGreaterThanOrEqual(0);
    expect(createRpc).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(createRpc).toMatch(
      /private\.user_can_create_opportunity\(\s*p_actor_user_id,\s*p_company_id\s*\)/
    );
    expect(createRpc).toMatch(
      /private\.user_can_edit_opportunity\(\s*p_actor_user_id,\s*p_source_opportunity_id\s*\)/
    );
    expect(createRpc).toMatch(
      /private\.effective_pipeline_scope_for_user\(\s*p_actor_user_id,\s*p_company_id,\s*'pipeline\.edit'\s*\) is distinct from 'all'/
    );
    expect(createRpc).toContain("locked_event.direction <> 'inbound'");
    expect(createRpc).toContain("locked_event.party_role <> 'customer'");
    expect(createRpc).toContain("locked_event.is_meaningful is not true");
    expect(createRpc).toContain(
      "lower(btrim(coalesce(locked_event.from_email, '')))"
    );
    expect(createRpc).toContain(
      "lower(btrim(coalesce(locked_activity.from_email, '')))"
    );
    expect(createRpc).toMatch(
      /format\(\s*'email:%s:%s:message:%s',\s*lower\(locked_connection\.provider\),\s*p_connection_id,\s*p_provider_message_id\s*\)/
    );
    expect(createRpc).toContain("insert into public.opportunities (");
    const insertStart = createRpc.indexOf("insert into public.opportunities (");
    const insertEnd = createRpc.indexOf(") values (", insertStart);
    expect(createRpc.slice(insertStart, insertEnd)).not.toContain(
      "assigned_to"
    );
    expect(createRpc).toContain(
      "on conflict (company_id, source_thread_key) do nothing"
    );
    expect(createRpc).toContain("locked_connection.type::text = 'individual'");
    expect(createRpc).toContain("private.permission_try_parse_uuid(");
    expect(createRpc).toContain(
      "public.change_opportunity_assignment_as_system("
    );
    expect(createRpc).toContain("'personal_mailbox'");
    expect(createRpc).toContain("'provider_mutations_disabled', true");
    expect(createRpc).not.toContain("set assigned_to =");
    expect(createRpc).toContain(
      "source_thread_key = p_target_source_thread_key"
    );
    expect(createRpc).toContain(
      "public.reparent_opportunity_email_message_guarded("
    );
    expect(
      createRpc.indexOf("insert into public.opportunities (")
    ).toBeLessThan(
      createRpc.indexOf("public.reparent_opportunity_email_message_guarded(")
    );
    expect(createRpc).toContain("target_resolution = v_target_resolution");
    expect(createRpc).toContain(
      "target_source_thread_key = p_target_source_thread_key"
    );
    expect(compact).toMatch(
      /revoke all on function public\.create_target_and_reparent_opportunity_email_message_guarded\([\s\S]*?\) from public, anon, authenticated, service_role/
    );
    expect(compact).toMatch(
      /grant execute on function public\.create_target_and_reparent_opportunity_email_message_guarded\([\s\S]*?\) to service_role/
    );
  });

  it("locks the company, exact connection, sorted opportunities, activity, and event before mutation", () => {
    expect(compact).toContain(
      "perform private.lock_lead_assignment_company(p_company_id)"
    );
    expect(compact).toContain("from public.email_connections connection");
    expect(compact).toContain("connection.id = p_connection_id");
    expect(compact).toContain("for update");
    expect(compact).toMatch(
      /opportunity\.id = any\(\s*array\[p_source_opportunity_id, p_target_opportunity_id\]\s*\)/
    );
    expect(compact).toContain("order by opportunity.id");
    expect(compact).toContain("activity.id = p_expected_activity_id");
    expect(compact).toContain("event.id = p_expected_correspondence_event_id");
  });

  it("binds both rows to the exact company, mailbox, thread, message, and current source owner", () => {
    for (const identity of [
      "activity.company_id = p_company_id",
      "activity.email_connection_id = p_connection_id",
      "activity.email_thread_id = p_provider_thread_id",
      "activity.email_message_id = p_provider_message_id",
      "activity.opportunity_id = p_source_opportunity_id",
      "event.company_id = p_company_id",
      "event.connection_id = p_connection_id",
      "event.provider_thread_id = p_provider_thread_id",
      "event.provider_message_id = p_provider_message_id",
      "event.opportunity_id = p_source_opportunity_id",
      "event.activity_id = p_expected_activity_id",
    ]) {
      expect(compact).toContain(identity);
    }
    expect(compact).toContain("event.opportunity_projection_applied");
  });

  it("claims a proven legacy NULL mailbox activity only after the exact event locks the requested connection", () => {
    const rpcStart = compact.indexOf(
      "create or replace function public.reparent_opportunity_email_message_guarded"
    );
    const rpcEnd = compact.indexOf(
      "revoke all on function public.reparent_opportunity_email_message_guarded",
      rpcStart
    );
    const rpc = compact.slice(rpcStart, rpcEnd);
    const legacyClaim = rpc.indexOf(
      "update public.activities activity set email_connection_id = p_connection_id"
    );
    const eventLock = rpc.lastIndexOf(
      "select event.* into locked_event",
      legacyClaim
    );

    expect(rpcStart).toBeGreaterThanOrEqual(0);
    expect(rpc).toMatch(
      /\(\s*activity\.email_connection_id = p_connection_id\s+or activity\.email_connection_id is null\s*\)/
    );
    expect(eventLock).toBeGreaterThanOrEqual(0);
    expect(legacyClaim).toBeGreaterThan(eventLock);
    expect(rpc.slice(legacyClaim)).toContain(
      "activity.email_connection_id is null"
    );
    expect(rpc.slice(legacyClaim)).toContain(
      "activity.email_thread_id = p_provider_thread_id"
    );
    expect(rpc.slice(legacyClaim)).toContain(
      "activity.email_message_id = p_provider_message_id"
    );
    expect(rpc).toContain("exact_recovery_legacy_connection_claim_race");
  });

  it("uses CAS snapshots and preserves stage, manual locks, assignment, and projects", () => {
    for (const casField of [
      "p_expected_source_updated_at",
      "p_expected_target_updated_at",
      "p_expected_source_stage",
      "p_expected_target_stage",
      "p_expected_source_stage_manually_set",
      "p_expected_target_stage_manually_set",
      "p_expected_source_assigned_to",
      "p_expected_target_assigned_to",
      "p_expected_source_assignment_version",
      "p_expected_target_assignment_version",
      "p_expected_source_project_id",
      "p_expected_target_project_id",
    ]) {
      expect(compact).toContain(casField);
    }
    expect(compact).not.toContain("set assigned_to =");
    expect(compact).not.toContain("set stage =");
    expect(compact).not.toContain("set stage_manually_set =");
    expect(compact).not.toContain("set project_ref =");
    expect(compact).not.toContain("set project_id =");
    expect(compact).toContain("protected opportunity fields changed");
  });

  it("validates the approved target email against the exact activity and persisted customer identity", () => {
    expect(compact).toContain("p_target_email text");
    expect(compact).toContain("activity.from_email");
    expect(compact).toContain("unnest(");
    expect(compact).toContain("activity.to_emails");
    expect(compact).toContain("activity.cc_emails");
    expect(compact).toContain("opportunity.contact_email");
    expect(compact).toContain("owning_client.email");
    expect(compact).toContain("from public.sub_clients alternate_contact");
    expect(compact).toContain("target_email_mismatch");
  });

  it("mints row-scoped capabilities, moves only the exact event/activity, and recomputes both projections", () => {
    expect(compact).toContain(
      "insert into private.opportunity_child_reparent_tokens"
    );
    expect(compact).toContain("'activities'");
    expect(compact).toContain("'opportunity_correspondence_events'");
    expect(compact).toContain(
      "update public.activities activity set opportunity_id = p_target_opportunity_id"
    );
    expect(compact).toContain(
      "update public.opportunity_correspondence_events event set opportunity_id = p_target_opportunity_id"
    );
    expect(compact).toMatch(
      /private\.recompute_exact_message_opportunity_projection\(\s*p_company_id,\s*p_source_opportunity_id,/
    );
    expect(compact).toMatch(
      /private\.recompute_exact_message_opportunity_projection\(\s*p_company_id,\s*p_target_opportunity_id,/
    );
    expect(compact).toMatch(
      /private\.recompute_exact_message_lifecycle_projection\(\s*p_company_id,\s*p_source_opportunity_id,\s*p_expected_correspondence_event_id\s*\)/
    );
    expect(compact).toMatch(
      /private\.recompute_exact_message_lifecycle_projection\(\s*p_company_id,\s*p_target_opportunity_id,\s*p_expected_correspondence_event_id\s*\)/
    );
  });

  it("requeues exact attachment attribution and revokes stale materialization", () => {
    expect(compact).toContain(
      "activities_requeue_email_attachment_attribution"
    );
    expect(compact).toContain("activities_revoke_email_conversion_photos");
    expect(compact).toContain("from public.email_attachments attachment");
    expect(compact).toContain("for update of job");
    expect(compact).toContain("for update of object_row");
    expect(compact).toContain("attachment.opportunity_id is not null");
    expect(compact).toContain("attachment.attribution_status <> 'pending'");
    expect(compact).toContain("scan.status = 'pending'");
    expect(compact).toContain("exact_recovery_attachment_requeue_failed");
    expect(compact).toContain(
      "exact_recovery_attachment_materialization_not_revoked"
    );
    expect(compact).toContain("exact_recovery_attachment_object_not_revoked");
    expect(compact).toContain("exact_recovery_attachment_photo_not_hidden");
    expect(compact).toContain("pending_attachment_attribution");
    expect(compact).toContain("status in ('attachment_pending', 'complete')");
    expect(compact).toContain("attachment.attribution_status = 'needs_review'");
    expect(compact).toContain("exact_recovery_attachment_needs_review");
    expect(compact).toContain("attachment.attribution_status = 'pending'");
    expect(compact).toContain("v_scan_status <> 'complete'");
    expect(
      compact.indexOf(
        "update public.activities activity set opportunity_id = p_target_opportunity_id"
      )
    ).toBeLessThan(compact.indexOf("exact_recovery_attachment_requeue_failed"));
  });

  it("binds completion to the exact post-move scan generation and final attachment identities", () => {
    const helperStart = compact.indexOf(
      "create or replace function private.exact_message_recovery_attachment_state"
    );
    const helperEnd = compact.indexOf(
      "revoke all on function private.exact_message_recovery_attachment_state",
      helperStart
    );
    const helper = compact.slice(helperStart, helperEnd);

    expect(compact).toContain("attachment_scan_generation bigint not null");
    expect(compact).toContain(
      "attachment_ids uuid[] not null default '{}'::uuid[]"
    );
    expect(helper).toContain("p_expected_scan_generation bigint");
    expect(helper).toContain(
      "v_scan_generation is distinct from p_expected_scan_generation"
    );
    expect(helper).not.toContain("if v_attachment_count = 0 then");
    expect(compact).toContain("into v_prior_scan_generation");
    expect(compact).toContain("v_prior_scan_generation + 1");
    expect(compact).toContain("'attachment_pending', 0,");
    expect(compact).toContain(
      "array_agg(attachment.id order by attachment.id)"
    );
    expect(compact).toContain(
      "existing.attachment_ids is distinct from v_attachment_ids"
    );
  });

  it("fails closed on non-passive lifecycle history instead of guessing erased counters", () => {
    const helperStart = compact.indexOf(
      "create or replace function private.assert_exact_message_lifecycle_recomputable"
    );
    const helperEnd = compact.indexOf(
      "revoke all on function private.assert_exact_message_lifecycle_recomputable",
      helperStart
    );
    const helper = compact.slice(helperStart, helperEnd);

    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helper).toContain("opportunity_lifecycle_action_audit");
    expect(helper).toContain("opportunity_follow_up_drafts");
    expect(helper).toContain("unanswered_follow_up_count <> 0");
    expect(helper).toContain("second_follow_up_sent_at is not null");
    expect(helper).toContain("operator_follow_up_miss_at is not null");
    expect(helper).toContain("stale_status is not null");
    expect(helper).toContain("exact_recovery_lifecycle_not_reconstructible");
    expect(helper).not.toContain("unanswered_follow_up_count = 0");
    expect(helper).not.toContain("second_follow_up_sent_at = null");
    expect(helper).not.toContain("operator_follow_up_miss_at = null");
    expect(compact).toMatch(
      /private\.assert_exact_message_lifecycle_recomputable\(\s*p_company_id,\s*p_source_opportunity_id\s*\)/
    );
    expect(compact).toMatch(
      /private\.assert_exact_message_lifecycle_recomputable\(\s*p_company_id,\s*p_target_opportunity_id\s*\)/
    );
  });

  it("recomputes lifecycle atomically before returning attachment-pending", () => {
    const moveStart = compact.indexOf(
      "update public.activities activity set opportunity_id = p_target_opportunity_id"
    );
    const lifecycleStart = compact.indexOf(
      "perform private.recompute_exact_message_lifecycle_projection(",
      moveStart
    );
    const pendingStart = compact.indexOf(
      "'pending_attachment_attribution', true",
      lifecycleStart
    );

    expect(lifecycleStart).toBeGreaterThan(moveStart);
    expect(pendingStart).toBeGreaterThan(lifecycleStart);
    expect(compact.slice(pendingStart)).toContain("return");
    expect(compact).toContain("application.status = 'attachment_pending'");
    expect(compact).toContain("set status = 'complete'");

    const pendingRetryStart = compact.indexOf(
      "if existing.status = 'complete' then"
    );
    const firstSnapshotCas = compact.indexOf(
      "if source_opportunity.updated_at is distinct from",
      pendingRetryStart
    );
    expect(compact.slice(pendingRetryStart, firstSnapshotCas)).not.toContain(
      "assert_exact_message_lifecycle_recomputable"
    );
  });

  it("is retry-idempotent and rejects a conflicting reuse of the same provider message", () => {
    expect(compact).toContain("already_applied");
    expect(compact).toContain("recovery_manifest_conflict");
    expect(compact).toContain(
      "existing.entry_sha256 is distinct from p_entry_sha256"
    );
    expect(compact).toContain(
      "existing.manifest_sha256 is distinct from p_manifest_sha256"
    );
    expect(compact).toContain("on conflict");
    expect(compact).toContain(
      "delete from private.opportunity_child_reparent_tokens"
    );
  });
});

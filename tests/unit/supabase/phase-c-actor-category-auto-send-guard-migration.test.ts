import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260721128000_phase_c_actor_category_auto_send_guard.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compact = sql.replace(/\s+/g, " ");

function functionBody(name: string): string {
  const start = compact.indexOf(`create or replace function ${name}(`);
  if (start < 0) return "";
  const next = compact.indexOf("create or replace function ", start + 1);
  return compact.slice(start, next < 0 ? undefined : next);
}

describe("Phase C actor-category auto-send guard migration", () => {
  it("is forward-only after the provider identity guard and requires no pending-send backfill", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(compact).toContain(
      "add column if not exists category_snapshot text"
    );
    expect(compact).toContain("pending_auto_sends_category_actionable_check");
    expect(compact).toMatch(
      /add constraint pending_auto_sends_category_actionable_check check \(.+?\) not valid;/
    );
    expect(compact).not.toMatch(
      /update public\.pending_auto_sends set category_snapshot/
    );
  });

  it("computes calibration only from recent proof-backed human outcomes for the exact actor and mailbox", () => {
    const profiles = functionBody("private.phase_c_category_profile_types");
    const categoryPolicy = functionBody(
      "private.phase_c_category_level_allowed"
    );
    const graduated = functionBody(
      "private.phase_c_actor_mailbox_category_graduated"
    );

    for (const profile of [
      "client_new_inquiry",
      "client_quoting",
      "client_active_project",
      "client_followup",
      "vendor_ordering",
      "vendor_inquiry",
      "subtrade_coordination",
    ]) {
      expect(profiles).toContain(`'${profile}'`);
    }
    expect(categoryPolicy).toContain("when 'customer'");
    expect(categoryPolicy).toContain("'auto_follow_up'");
    expect(categoryPolicy).toContain("when 'legal'");
    expect(categoryPolicy).toContain("when 'platform_bid'");
    expect(graduated).toContain("queue.company_id = p_company_id::text");
    expect(graduated).toContain("queue.connection_id = p_connection_id");
    expect(graduated).toContain("queue.user_id = p_actor_user_id::text");
    expect(graduated).toContain(
      "queue.learning_authority = 'operator_approved'"
    );
    expect(graduated).toContain("queue.apply_learning is true");
    expect(graduated).toContain("sentwithoutchanges");
    expect(graduated).toContain("limit 50");
    expect(graduated).toContain("v_sample_size >= 20");
    expect(graduated).toContain("v_unchanged * 100 >= v_sample_size * 95");
    expect(graduated).toContain("connection.type::text <> 'individual'");
    expect(graduated).toContain(
      "btrim(coalesce(connection.user_id, '')) = p_actor_user_id::text"
    );
    expect(graduated).toContain(
      "queue.category_snapshot = upper(btrim(p_category))"
    );
  });

  it("snapshots the exact learning thread category forward-only and keeps shared profiles isolated", () => {
    const snapshot = functionBody(
      "private.capture_phase_c_learning_category_snapshot"
    );
    const accuracy = functionBody(
      "public.get_human_draft_accuracy_for_category_as_system"
    );

    expect(compact).toContain(
      "alter table public.email_outbound_learning_queue add column if not exists category_snapshot text"
    );
    expect(compact).not.toMatch(
      /update public\.email_outbound_learning_queue set category_snapshot/
    );
    expect(snapshot).toContain("thread.connection_id = new.connection_id");
    expect(snapshot).toContain(
      "thread.provider_thread_id = new.provider_thread_id"
    );
    expect(snapshot).toContain("thread.company_id::text = new.company_id");
    expect(snapshot).toContain(
      "new.opportunity_id is null or thread.opportunity_id = new.opportunity_id"
    );
    expect(snapshot).toContain("old.category_snapshot is not null");
    expect(snapshot).toContain("old.category_snapshot is null");
    expect(snapshot).toContain("return new");
    expect(snapshot).toContain(
      "new.category_snapshot is distinct from old.category_snapshot"
    );
    expect(compact).toContain(
      "before insert or update of company_id, connection_id, provider_thread_id, opportunity_id, status, category_snapshot on public.email_outbound_learning_queue"
    );
    expect(snapshot).toContain(
      "new.company_id is distinct from old.company_id"
    );
    expect(snapshot).toContain(
      "new.connection_id is distinct from old.connection_id"
    );
    expect(snapshot).toContain(
      "new.provider_thread_id is distinct from old.provider_thread_id"
    );
    expect(snapshot).toContain("v_opportunity_enrichment boolean");
    expect(snapshot).toContain("old.opportunity_id is null");
    expect(snapshot).toContain("new.opportunity_id is not null");
    expect(snapshot).toContain(
      "new.opportunity_id is distinct from old.opportunity_id and not v_opportunity_enrichment"
    );
    expect(snapshot).toContain("thread.opportunity_id = new.opportunity_id");
    expect(snapshot).toContain(
      "upper(thread.primary_category::text) is not distinct from old.category_snapshot"
    );
    expect(snapshot).toContain("for share");
    expect(snapshot).toContain(
      "if tg_op = 'update' and old.category_snapshot is not null then"
    );
    expect(snapshot).toContain(
      "new.category_snapshot := old.category_snapshot"
    );
    expect(snapshot).toContain("if v_derived_category is null then");

    expect(accuracy).toContain("p_primary_category text");
    expect(accuracy).toContain(
      "queue.category_snapshot = upper(btrim(p_primary_category))"
    );
    expect(accuracy).toContain(
      "queue.profile_type = any (private.phase_c_category_profile_types(v_category))"
    );
  });

  it("repairs mailbox-actor activity lookup without casting the UUID company column to text", () => {
    const resolver = functionBody(
      "public.resolve_email_outbound_learning_mailbox_actor_as_system"
    );

    expect(resolver).toContain("connection.company_id = p_company_id::text");
    expect(resolver).toContain("outbound.company_id = p_company_id");
    expect(resolver).not.toContain("outbound.company_id = p_company_id::text");
  });

  it("requires an explicit acceptance for the exact actor-mailbox-category", () => {
    const acceptance = functionBody(
      "private.phase_c_actor_category_acceptance_active"
    );
    const prompt = functionBody(
      "public.record_phase_c_graduation_prompt_as_system"
    );
    const scheduleGuard = functionBody(
      "private.enforce_phase_c_auto_send_category_calibration"
    );
    const providerClaim = functionBody(
      "public.claim_email_send_provider_delivery"
    );
    const approvedAction = functionBody(
      "private.approved_action_email_intent_is_authorized"
    );
    const configureAccess = functionBody(
      "private.phase_c_actor_can_configure_connection"
    );

    expect(compact).toContain(
      "create table if not exists public.phase_c_category_auto_send_acceptances"
    );
    expect(compact).toContain(
      "unique (company_id, connection_id, actor_user_id, primary_category)"
    );
    expect(acceptance).toContain("acceptance.actor_user_id = p_actor_user_id");
    expect(acceptance).toContain("acceptance.connection_id = p_connection_id");
    expect(acceptance).toContain("acceptance.primary_category = upper");
    expect(acceptance).toContain("acceptance.revoked_at is null");
    expect(prompt).toContain(
      "not private.phase_c_actor_category_acceptance_active("
    );
    expect(scheduleGuard).toContain(
      "private.phase_c_actor_category_acceptance_active("
    );
    expect(providerClaim).toContain(
      "private.phase_c_actor_category_acceptance_active("
    );
    expect(approvedAction).toContain(
      "private.phase_c_actor_category_acceptance_active("
    );
    expect(configureAccess).toContain("public.has_permission(");
    expect(configureAccess).toContain("settings.integrations");
    expect(configureAccess).toContain(
      "private.user_can_send_opportunity_inbox("
    );
  });

  it("derives and persists category plus autonomy level, then cancels a claim if either policy snapshot changed", () => {
    const guard = functionBody(
      "private.enforce_phase_c_auto_send_category_calibration"
    );
    const schedule = functionBody("public.schedule_phase_c_auto_send");
    const claim = functionBody("public.claim_phase_c_auto_sends");

    expect(compact).toContain(
      "before insert or update of status, category_snapshot, autonomy_level_snapshot, profile_type_snapshot on public.pending_auto_sends"
    );
    expect(guard).toContain("thread.primary_category");
    expect(guard).toContain("new.category_snapshot := v_category");
    expect(guard).toContain("new.autonomy_level_snapshot := v_level");
    expect(guard).toContain("old.category_snapshot");
    expect(guard).toContain("old.autonomy_level_snapshot");
    expect(guard).toContain("old.profile_type_snapshot");
    expect(guard).toContain("'primary:' || v_category");
    expect(guard).toContain("in ('auto_send', 'auto_follow_up')");
    expect(guard).toContain(
      "private.phase_c_actor_mailbox_category_graduated("
    );
    expect(guard).toContain("phase_c_auto_send_category_changed");
    expect(guard).toContain("phase_c_auto_send_level_changed");
    expect(guard).toContain("phase_c_auto_send_not_graduated");
    expect(guard).toContain("phase_c_auto_send_profile_category_mismatch");
    expect(guard).toContain(
      "coalesce(nullif(btrim(new.profile_type_snapshot), ''), '') = any (private.phase_c_category_profile_types(v_category))"
    );
    expect(guard).toContain("new.status := 'cancelled'");

    expect(schedule).toContain(
      "public.schedule_phase_c_auto_send_pre_category_guard("
    );
    expect(schedule).toContain("v_queue.category_snapshot");
    expect(schedule).toContain("v_queue.autonomy_level_snapshot");
    expect(claim).toContain(
      "public.claim_phase_c_auto_sends_pre_category_guard("
    );
    expect(claim).toContain("v_queue.status = 'leased'");
  });

  it("atomically updates accepted settings and resolves only the exact actor-mailbox-category prompt", () => {
    const prompt = functionBody(
      "public.record_phase_c_graduation_prompt_as_system"
    );
    const update = functionBody(
      "public.update_phase_c_auto_send_settings_as_system"
    );
    expect(prompt).toContain("for update");
    expect(prompt).toContain("afo.feature_key = 'ai_auto_send'");
    expect(prompt).toContain("afo.enabled");
    expect(prompt).toContain("'primary:' || v_category");
    expect(prompt).toContain(
      "not in ( 'auto_draft', 'auto_send', 'auto_follow_up' )"
    );
    expect(prompt).toContain(
      "private.phase_c_actor_mailbox_category_graduated("
    );
    expect(update).toContain("auth.role() is distinct from 'service_role'");
    expect(update).toContain("private.phase_c_actor_can_configure_connection(");
    expect(update).toContain("for update");
    expect(update).toContain("pg_timezone_names");
    expect(update).toContain("auto_send_settings_business_hours_invalid");
    expect(update).toContain("auto_send_settings_delay_invalid");
    expect(update).toContain("left(v_category_key, 8) = 'primary:'");
    expect(update).toContain("v_level is null or v_level not in (");
    expect(update).toContain("auto_send_settings_legacy_send_forbidden");
    expect(update).toContain("private.phase_c_category_level_allowed(");
    expect(update).not.toContain(
      "private.phase_c_actor_mailbox_globally_graduated("
    );
    expect(update).toContain("afo.feature_key = 'ai_auto_send'");
    expect(update).toContain("agent_can_send_from = v_enable_transport");
    expect(update).toContain("'{enabled}'");
    expect(update).toContain("auto_send_settings = v_next_settings");
    expect(update).toContain("phase-c-graduation:v1:");
    expect(update).toContain("notification.user_id = p_actor_user_id::text");
    expect(update).toContain("notification.resolved_at is null");
    expect(update).toContain("resolved_at = clock_timestamp()");
    expect(update).toContain("status in ('pending', 'leased')");
    expect(update).toContain("phase_c_auto_send_disabled");
    expect(update).toContain("auto_send_suggested = true");
    expect(update).toContain(
      "insert into public.phase_c_category_auto_send_acceptances"
    );
    expect(update).toContain("accepted_level = excluded.accepted_level");
    expect(update).toContain("revoked_at = null");
  });

  it("reopens the exact graduation prompt when prior consent was revoked", () => {
    const prompt = functionBody(
      "public.record_phase_c_graduation_prompt_as_system"
    );

    expect(prompt).toContain("update public.notifications notification");
    expect(prompt).toContain("resolved_at = null");
    expect(prompt).toContain("is_read = false");
    expect(prompt).toContain("notification.user_id = p_actor_user_id::text");
    expect(prompt).toContain("notification.company_id = p_company_id::text");
    expect(prompt).toContain("notification.dedupe_key = v_dedupe_key");
    expect(prompt).toContain("notification.resolved_at is not null");
    expect(prompt).toContain("if v_reopened = 1 then return true");
  });

  it("turns the ai_auto_send override into a durable transport kill switch", () => {
    const killSwitch = functionBody(
      "private.enforce_phase_c_ai_auto_send_kill_switch"
    );
    const scheduleGuard = functionBody(
      "private.enforce_phase_c_auto_send_category_calibration"
    );

    expect(killSwitch).toContain("feature_key = 'ai_auto_send'");
    expect(killSwitch).toContain("update public.email_connections");
    expect(killSwitch).toContain("'{enabled}'");
    expect(killSwitch).toContain("agent_can_send_from = false");
    expect(killSwitch).toContain("update public.pending_auto_sends");
    expect(killSwitch).toContain("status in ('pending', 'leased')");
    expect(killSwitch).toContain("phase_c_auto_send_feature_disabled");
    expect(killSwitch).toContain(
      "update public.phase_c_category_auto_send_acceptances"
    );
    expect(killSwitch).toContain("revoked_at = clock_timestamp()");
    expect(compact).toContain(
      "after insert or update of enabled or delete on public.admin_feature_overrides"
    );
    expect(scheduleGuard).toContain("afo.feature_key = 'ai_auto_send'");
    expect(scheduleGuard).toContain("phase_c_auto_send_feature_disabled");
  });

  it("revalidates the exact Phase C queue, category, profile, lease, and proof before provider delivery", () => {
    const claim = functionBody("public.claim_email_send_provider_delivery");

    expect(compact).toContain(
      "alter function public.claim_email_send_provider_delivery(uuid) rename to claim_email_send_provider_delivery_pre_phase_c_guard"
    );
    expect(claim).toContain("intent.status <> 'prepared'");
    expect(claim).toContain("from public.pending_auto_sends pending");
    expect(claim).toContain("for update");
    expect(claim).toContain("queue.status <> 'leased'");
    expect(claim).toContain(
      "queue.lease_token is distinct from intent.pending_auto_send_lease_token"
    );
    expect(claim).toContain("queue.lease_expires_at <= v_now");
    expect(claim).toContain("thread.id = intent.source_email_thread_id");
    expect(claim).toContain(
      "thread.primary_category::text) is distinct from queue.category_snapshot"
    );
    expect(claim).toContain("'primary:' || queue.category_snapshot");
    expect(claim).toContain(
      "v_level is distinct from queue.autonomy_level_snapshot"
    );
    expect(claim).toContain("queue.autonomy_level_snapshot");
    expect(claim).toContain("in ('auto_send', 'auto_follow_up')");
    expect(claim).toContain("queue.profile_type_snapshot = any (");
    expect(claim).toContain(
      "private.phase_c_category_profile_types(queue.category_snapshot)"
    );
    expect(claim).toContain("private.phase_c_category_level_allowed(");
    expect(claim).toContain(
      "private.phase_c_actor_mailbox_category_graduated("
    );
    expect(claim).toContain(
      "public.claim_email_send_provider_delivery_pre_phase_c_guard(p_intent_id)"
    );
  });

  it("replaces the approved-action global milestone with exact CUSTOMER readiness", () => {
    const approvedAction = functionBody(
      "private.approved_action_email_intent_is_authorized"
    );

    expect(compact).toContain(
      "alter function private.approved_action_email_intent_is_authorized(uuid, boolean) rename to approved_action_email_intent_is_authorized_pre_phase_c_guard"
    );
    expect(approvedAction).toContain(
      "private.approved_action_email_intent_is_authorized_pre_phase_c_guard("
    );
    expect(approvedAction).toContain("'primary:customer'");
    expect(approvedAction).toContain(
      "private.phase_c_actor_mailbox_category_graduated("
    );
    expect(approvedAction).not.toContain("m.auto_send_suggested");
  });

  it("atomically leases graduation work so completion failures cannot starve later scopes", () => {
    const claim = functionBody(
      "public.claim_phase_c_graduation_actor_scopes_as_system"
    );
    const complete = functionBody(
      "public.complete_phase_c_graduation_scope_check_as_system"
    );
    expect(compact).toContain("graduation_lease_token uuid");
    expect(compact).toContain("graduation_lease_expires_at timestamptz");
    expect(claim).toContain("for update of milestone skip locked");
    expect(claim).toContain("graduation_last_attempt_at = v_now");
    expect(claim).toContain("graduation_lease_token = gen_random_uuid()");
    expect(complete).toContain("p_lease_token uuid");
    expect(complete).toContain(
      "milestone.graduation_lease_token = p_lease_token"
    );
    expect(complete).toContain("graduation_lease_token = null");
    const legacyList = functionBody(
      "public.list_phase_c_graduation_actor_scopes_as_system"
    );
    expect(legacyList).not.toContain(
      "public.claim_phase_c_graduation_actor_scopes_as_system("
    );
    expect(compact).toContain("graduation_scope_lease_token_required");
    expect(compact).not.toContain(
      "select milestone.graduation_lease_token into v_lease_token"
    );
  });

  it("keeps the public schedule and claim RPC signatures rolling-deploy compatible", () => {
    expect(compact).toContain(
      "revoke all on function public.schedule_phase_c_auto_send(text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text, text[], text[], text, text, text, text, text, uuid, text, text, uuid, text, text, timestamptz)"
    );
    expect(compact).toContain(
      "grant execute on function public.schedule_phase_c_auto_send(text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text, text[], text[], text, text, text, text, text, uuid, text, text, uuid, text, text, timestamptz) to service_role"
    );
    expect(compact).toContain(
      "grant execute on function public.claim_phase_c_auto_sends(integer, integer) to service_role"
    );
  });
});

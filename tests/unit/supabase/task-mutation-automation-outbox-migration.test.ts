import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260715181600_task_mutation_automation_outbox.sql"
  ),
  "utf8"
).toLowerCase();

describe("task mutation automation outbox migration", () => {
  it("uses a trigger-owned monotonic schedule version as outbox identity", () => {
    expect(source).toContain(
      "add column if not exists schedule_version bigint not null default 0"
    );
    expect(source).toContain("private.bump_project_task_schedule_version");
    expect(source).toContain(
      "when v_schedule_changed then old.schedule_version + 1"
    );
    expect(source).toContain("task_schedule_automation_identity_idx");
    expect(source).toContain("task_id,\n    task_schedule_version,\n    kind");
    expect(source).toContain("task_updated_at timestamptz");
    expect(source).not.toContain("unique (task_id, task_updated_at, kind)");
  });

  it("shares one exact schedule-change predicate between versioning and enqueue", () => {
    const bump = source.slice(
      source.indexOf(
        "create or replace function private.bump_project_task_schedule_version"
      ),
      source.indexOf(
        "revoke all on function private.bump_project_task_schedule_version"
      )
    );
    const enqueue = source.slice(
      source.indexOf(
        "create or replace function private.enqueue_task_schedule_automation()"
      ),
      source.indexOf(
        "revoke all on function private.enqueue_task_schedule_automation()"
      )
    );

    expect(bump).toContain("private.project_task_schedule_changed(old, new)");
    expect(enqueue).toContain(
      "private.project_task_schedule_changed(old, new)"
    );
  });

  it("durably captures scheduled creates and meaningful schedule updates", () => {
    expect(source).toContain(
      "create table if not exists public.task_schedule_automation_outbox"
    );
    expect(source).toContain("after insert or update on public.project_tasks");
    expect(source).toContain("full_auto_confirmation");
    expect(source).toContain("schedule_cascade");
    expect(source).toContain("confirmed_reschedule");
    expect(source).toContain("private.get_current_user_id()");
  });

  it("commits immutable task assignment, completion and schedule proof with delivery", () => {
    expect(source).toContain(
      "create table if not exists public.task_mutation_events"
    );
    expect(source).toContain("task_mutation_events_are_immutable");
    expect(source).toContain(
      "before update or delete on public.task_mutation_events"
    );
    expect(source).toContain("private.enqueue_task_mutation_event");
    expect(source).toContain("'task_assigned', null, new");
    expect(source).toContain("'task_assigned', old, new");
    expect(source).toContain("'task_completed', old, new");
    expect(source).toContain("'schedule_change', old, new");
    expect(source).toContain("task_mutation_event_id uuid unique");
    expect(source).toContain("task_mutation_event_id = p_event_id");
    expect(source).toContain("revoke all on table public.task_mutation_events");
    expect(source).toContain(
      "event_sequence bigint generated always as identity unique"
    );
    expect(source).toContain(
      "on public.task_mutation_events (task_id, event_sequence)"
    );
  });

  it("keeps task-notification rail dedupe durable after read or resolution", () => {
    expect(source).toContain("notifications_task_mutation_dedupe_idx");
    expect(source).toContain(
      "on public.notifications (user_id, company_id, dedupe_key)"
    );
    expect(source).toContain("where dedupe_key like 'task-mutation:%'");
  });

  it("reenqueues full-auto whenever an unconfirmed task becomes or remains scheduled", () => {
    const enqueue = source.slice(
      source.indexOf(
        "create or replace function private.enqueue_task_schedule_automation()"
      ),
      source.indexOf(
        "revoke all on function private.enqueue_task_schedule_automation()"
      )
    );

    expect(enqueue).toContain(
      "if new.start_date is not null and new.deleted_at is null then"
    );
    expect(enqueue).toContain(
      "if new.start_date is not null and new.schedule_confirmed_at is null then"
    );
    expect(enqueue).toContain("'full_auto_confirmation', old, new");
  });

  it("snapshots every schedule dimension and treats crew order as semantic equality", () => {
    for (const field of [
      "start_date",
      "end_date",
      "start_time",
      "end_time",
      "all_day",
      "duration",
      "team_member_ids",
      "project_id",
      "status",
      "schedule_confirmed_at",
    ]) {
      expect(source).toContain(field);
    }
    expect(source).toContain("unnest(coalesce");
    expect(source).toContain("order by member_id");
    const snapshotMatch = source.slice(
      source.indexOf(
        "create or replace function private.task_schedule_automation_snapshot_matches"
      ),
      source.indexOf(
        "revoke all on function private.task_schedule_automation_snapshot_matches"
      )
    );
    expect(snapshotMatch).toContain("coalesce(");
    expect(snapshotMatch).toContain("'null'::jsonb");
  });

  it("coalesces rapid pending changes while preserving the earliest before snapshot", () => {
    expect(source).toContain("status = 'pending'");
    expect(source).toMatch(
      /update public\.task_schedule_automation_outbox[\s\S]*?after_snapshot =[\s\S]*?where[\s\S]*?status = 'pending'/
    );
    expect(source).toContain("v_earliest_before_snapshot");
  });

  it("uses fenced service-only leases and permanent task-automation action idempotency", () => {
    expect(source).toContain("for update skip locked");
    expect(source).toContain("claim_task_schedule_automation_events");
    expect(source).toContain("complete_task_schedule_automation_event");
    expect(source).toContain("fail_task_schedule_automation_event");
    expect(source).toContain("event.lease_token = p_lease_token");
    expect(source).toContain("auth.role() is distinct from 'service_role'");
    expect(source).toContain("task_automation_agent_actions_unique");
    expect(source).toContain("source_id like 'task-automation:%'");
    expect(source).toContain("p_limit integer default 1");
    expect(source).toContain("p_limit is distinct from 1");
  });

  it("persists task actions and notifications atomically behind the live lease", () => {
    const guard = source.slice(
      source.indexOf(
        "create or replace function private.require_current_task_automation_event"
      ),
      source.indexOf(
        "revoke all on function private.require_current_task_automation_event"
      )
    );
    const action = source.slice(
      source.indexOf(
        "create or replace function public.persist_task_automation_agent_action"
      ),
      source.indexOf(
        "create or replace function public.persist_task_automation_notification"
      )
    );
    const notification = source.slice(
      source.indexOf(
        "create or replace function public.persist_task_automation_notification"
      ),
      source.indexOf(
        "revoke all on function public.persist_task_automation_agent_action"
      )
    );

    expect(guard).toContain("private.lock_lead_assignment_company");
    expect(guard).toContain("from public.projects project");
    expect(guard).toContain("for share");
    expect(guard).toContain("for update");
    expect(guard).toContain("event.lease_token = p_lease_token");
    expect(guard).toContain("event.lease_expires_at > now()");
    expect(action).toContain(
      "v_event := private.require_current_task_automation_event"
    );
    expect(action).toContain("'source_task_schedule_version'");
    expect(action).toContain("task.schedule_version = p_task_schedule_version");
    expect(notification).toContain(
      "v_event := private.require_current_task_automation_event"
    );
    expect(notification).toContain("create_notification_if_new_with_status");
  });

  it("derives ordinary task notification recipients, access, copy and preferences server-side", () => {
    const notification = source.slice(
      source.indexOf(
        "create or replace function public.persist_task_mutation_notification_as_system"
      ),
      source.indexOf(
        "revoke all on function public.persist_task_automation_agent_action"
      )
    );

    expect(notification).toContain(
      "auth.role() is distinct from 'service_role'"
    );
    expect(notification).toContain("private.lock_lead_assignment_company");
    expect(notification).toContain("from public.task_mutation_events mutation");
    expect(notification).toContain("private.user_can_view_task");
    expect(notification).toContain("coalesce(recipient.is_active, false)");
    expect(notification).toContain("join public.notification_preferences");
    expect(notification).toContain("on preference.user_id = candidate.user_id");
    expect(notification).toContain(
      "preference.company_id = v_event.company_id"
    );
    expect(notification).not.toContain(
      "preference.user_id = candidate.user_id::text"
    );
    expect(notification).not.toContain(
      "preference.company_id = v_event.company_id::text"
    );
    expect(notification).toContain("create_notification_if_new_with_status");
    expect(notification).toContain("'task-mutation:' || v_event.id::text");
    expect(notification).toContain(
      "candidate.user_id is distinct from v_event.actor_user_id"
    );
    expect(notification).toContain("v_event.event_type = 'schedule_change'");
    expect(notification).toContain("v_preference.has_task_view");
    expect(notification).toContain(
      "a task was changed or removed from your schedule."
    );
    expect(notification).toContain(
      "case when v_preference.has_task_view then v_action_url else null end"
    );
    expect(notification).toContain(
      "v_in_app_ids := array_append(v_in_app_ids, v_preference.user_id)"
    );
    expect(notification).not.toContain(
      "if v_preference.wants_push or v_preference.wants_email"
    );
    expect(notification).not.toContain("p_recipient");
    expect(notification).not.toContain("p_title");
    expect(notification).not.toContain("p_body");
  });

  it("revalidates the source schedule version before provider email claim", () => {
    const currentIntent = source.slice(
      source.indexOf(
        "create or replace function private.task_automation_email_intent_is_current"
      ),
      source.indexOf(
        "revoke all on function private.task_automation_email_intent_is_current"
      )
    );
    const providerClaim = source.slice(
      source.indexOf(
        "create or replace function public.claim_approved_action_email_delivery"
      ),
      source.indexOf(
        "revoke all on function public.claim_approved_action_email_delivery"
      )
    );

    expect(currentIntent).toContain(
      "event.task_schedule_version = v_schedule_version"
    );
    expect(currentIntent).toContain(
      "private.task_schedule_automation_snapshot_matches"
    );
    expect(currentIntent).toContain("private.user_can_edit_task");
    expect(providerClaim).toContain(
      "private.task_automation_email_intent_is_current(p_intent_id)"
    );
    expect(providerClaim).toContain("status = 'sending'");
  });

  it("reports exhausted leases through a separate observable finalizer", () => {
    expect(source).toContain(
      "finalize_exhausted_task_schedule_automation_events"
    );
    const claim = source.slice(
      source.indexOf(
        "create or replace function public.claim_task_schedule_automation_events"
      ),
      source.indexOf(
        "create or replace function public.complete_task_schedule_automation_event"
      )
    );
    expect(claim).not.toContain("set status = 'failed'");
  });

  it("exposes one actor-aware task authorization bridge with project-membership parity", () => {
    expect(source).toContain("private.user_can_edit_task");
    expect(source).toContain("private.user_can_change_task_status");
    expect(source).toContain("public.authorize_task_action_as_system");
    expect(source).toContain("public.has_permission");
    expect(source).toContain("from public.project_tasks assigned_task");
    expect(source).toContain("auth.role() is distinct from 'service_role'");
    expect(source).toContain(
      "revoke all on function private.user_can_edit_task"
    );
    const taskAuth = source.slice(
      source.indexOf(
        "create or replace function private.user_is_project_member_for_task"
      ),
      source.indexOf("-- approval actions run under service_role")
    );
    expect(taskAuth).not.toContain("project.team_member_ids");
    expect(taskAuth).toContain("'tasks.view'");
    expect(taskAuth).toContain("private.user_can_view_task");
    expect(taskAuth).toContain("assigned_task.status = 'active'");
    expect(taskAuth).toContain("p_action is distinct from 'edit'");
  });

  it("creates approval tasks through an actor-attributed idempotent service RPC", () => {
    expect(source).toContain("public.create_task_with_event_as_system");
    expect(source).toContain("ops.task_mutation_actor_id");
    expect(source).toContain("on conflict (id) do nothing");
    expect(source).toContain("task_id_conflict");
    expect(source).toContain("'tasks.create'");
    expect(source).toContain("'tasks.assign'");
    expect(source).toContain("private.lock_lead_assignment_company");
  });

  it("serializes guarded task create and update with the parent project lifecycle", () => {
    const create = source.slice(
      source.indexOf(
        "create or replace function private.create_task_with_event_for_actor"
      ),
      source.indexOf(
        "create or replace function public.create_task_with_event("
      )
    );
    const update = source.slice(
      source.indexOf(
        "create or replace function private.update_task_with_event_for_actor"
      ),
      source.indexOf(
        "create or replace function public.update_task_with_event("
      )
    );

    for (const guardedMutation of [create, update]) {
      expect(guardedMutation).toContain("private.lock_lead_assignment_company");
      expect(guardedMutation).toContain("from public.projects project");
      expect(guardedMutation).toContain("for share");
      expect(guardedMutation).toContain("coalesce(actor.is_active, false)");
    }
    expect(update).toContain("for update");
    expect(update).toContain("private.user_can_edit_task");
    expect(update).not.toContain("calendar_event_id");
  });

  it("guards legacy task writes with a locked same-company open parent", () => {
    const parentGuard = source.slice(
      source.indexOf(
        "create or replace function private.guard_project_task_parent_lifecycle"
      ),
      source.indexOf(
        "revoke all on function private.guard_project_task_parent_lifecycle"
      )
    );

    expect(parentGuard).toContain("from public.projects project");
    expect(parentGuard).toContain("where project.id = new.project_id");
    expect(parentGuard).toContain("for share");
    expect(parentGuard).toContain(
      "v_project_company_id is distinct from new.company_id"
    );
    expect(parentGuard).toContain("v_project_deleted_at is not null");
    expect(parentGuard).toContain(
      "lower(coalesce(v_project_status, '')) in ('closed', 'archived')"
    );
    expect(parentGuard).toContain("new.deleted_at is null");
    expect(parentGuard).toContain("'completed'");
    expect(parentGuard).toContain("'cancelled'");
    expect(parentGuard).toContain("closed_project_task_mutation_denied");
    expect(source).toContain(
      "before insert or update of project_id, company_id, status, deleted_at"
    );
    expect(source).toContain(
      "execute function private.guard_project_task_parent_lifecycle()"
    );
  });

  it("rejects inactive or cross-company actor snapshots and canonicalizes duplicate crew ids", () => {
    expect(source).toContain("actor.company_id = new.company_id");
    expect(source).toContain("coalesce(actor.is_active, false)");
    expect(source).toMatch(
      /select distinct member_id[\s\S]*?old\.team_member_ids[\s\S]*?select distinct member_id[\s\S]*?new\.team_member_ids/
    );
  });

  it("emits one immutable schedule/removal event for removal-only updates", () => {
    const enqueue = source.slice(
      source.indexOf(
        "create or replace function private.enqueue_task_schedule_automation()"
      ),
      source.indexOf(
        "revoke all on function private.enqueue_task_schedule_automation()"
      )
    );

    expect(enqueue).toContain("v_assignment_removed := exists");
    expect(enqueue).toContain(
      "v_notification_schedule_changed or v_assignment_removed"
    );
    expect(enqueue).toContain("'schedule_change', old, new");
    expect(enqueue).not.toContain(
      "v_notification_schedule_changed or v_assignment_added"
    );
  });

  it("preserves a safe removed-assignee delivery across rapid A-to-B-to-C edits", () => {
    const notification = source.slice(
      source.indexOf(
        "create or replace function public.persist_task_mutation_notification_as_system"
      ),
      source.indexOf(
        "revoke all on function public.persist_task_automation_agent_action"
      )
    );

    expect(notification).toContain("v_schedule_is_current :=");
    expect(notification).toContain(
      "(v_schedule_is_current and v_schedule_fields_changed)"
    );
    expect(notification).toContain("before_member.value = member.value");
    expect(notification).toContain("after_member.value = member.value");
    expect(notification).toContain(
      "member.value = any(\n                coalesce(v_task.team_member_ids"
    );
    expect(notification).toContain("or not v_schedule_fields_changed");
    expect(notification).toContain(
      "else 'a task was changed or removed from your schedule.'"
    );
    expect(notification).toContain(
      "case when v_preference.has_task_view then v_action_url else null end"
    );
  });

  it("uses monotonic per-recipient ordering to suppress stale queued ABA deliveries", () => {
    const notification = source.slice(
      source.indexOf(
        "create or replace function public.persist_task_mutation_notification_as_system"
      ),
      source.indexOf(
        "revoke all on function public.persist_task_automation_agent_action"
      )
    );

    expect(notification).toContain(
      "later.event_sequence > v_event.event_sequence"
    );
    expect(notification).toMatch(
      /later\.event_type = 'task_assigned'[\s\S]*?later\.event_sequence > v_event\.event_sequence[\s\S]*?later_after\.value = member\.value[\s\S]*?later_before\.value = member\.value/
    );
    expect(notification).toMatch(
      /later\.event_type = 'schedule_change'[\s\S]*?later\.event_sequence > v_event\.event_sequence[\s\S]*?later_before\.value = member\.value[\s\S]*?later_after\.value = member\.value/
    );
    expect(notification).not.toContain(
      "(later.created_at, later.id) > (v_event.created_at, v_event.id)"
    );
  });
});

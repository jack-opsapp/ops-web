import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260812120000_agent_operational_schedule_readiness.sql"
  ),
  "utf8"
).toLowerCase();
const PERSISTENCE = readFileSync(
  join(
    process.cwd(),
    "src/lib/api/services/task-automation-persistence-service.ts"
  ),
  "utf8"
);
const APPROVAL = readFileSync(
  join(process.cwd(), "src/lib/api/services/approval-queue-service.ts"),
  "utf8"
);
const WORKER = readFileSync(
  join(
    process.cwd(),
    "src/lib/api/services/task-mutation-automation-outbox-service.ts"
  ),
  "utf8"
);
const COMMS = readFileSync(
  join(
    process.cwd(),
    "src/lib/api/services/client-scheduling-comms-service.ts"
  ),
  "utf8"
);

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function functionDefinition(source: string, name: string): string {
  const marker = `create or replace function ${name}(`;
  const createMarker = `create function ${name}(`;
  const start = Math.max(
    source.lastIndexOf(marker),
    source.lastIndexOf(createMarker)
  );
  if (start < 0) return "";
  const remainder = source.slice(start);
  const delimiter = /\bas\s+(\$[a-z0-9_]*\$)/.exec(remainder)?.[1];
  if (!delimiter) return "";
  const end = remainder.indexOf(`${delimiter};`);
  return end < 0 ? "" : remainder.slice(0, end + delimiter.length + 1);
}

const PREPARE = compact(
  functionDefinition(MIGRATION, "public.prepare_schedule_dispatch_as_system")
);
const SCHEDULE_VERSION_TRIGGER = compact(
  functionDefinition(MIGRATION, "private.bump_project_task_schedule_version")
);
const PROJECT_CLIENT_GUARD = compact(
  functionDefinition(
    MIGRATION,
    "private.guard_confirmed_project_client_identity"
  )
);
const ENQUEUE = compact(
  functionDefinition(
    MIGRATION,
    "private.enqueue_schedule_confirmation_dispatch"
  )
);
const AUTOMATION_PRODUCER = compact(
  functionDefinition(MIGRATION, "private.enqueue_task_schedule_automation")
);
const FULL_AUTO = compact(
  functionDefinition(
    MIGRATION,
    "public.confirm_full_auto_project_task_schedule_as_system"
  )
);
const AUTOMATIC_CONFIRM = compact(
  functionDefinition(
    MIGRATION,
    "public.confirm_automatic_project_task_schedule_as_system"
  )
);
const SHARED_SNAPSHOT = compact(
  functionDefinition(MIGRATION, "private.task_schedule_automation_snapshot")
);
const SHARED_SNAPSHOT_MATCH = compact(
  functionDefinition(
    MIGRATION,
    "private.task_schedule_automation_snapshot_matches"
  )
);
const CONFIRM_PERSIST = compact(
  functionDefinition(
    MIGRATION,
    "public.persist_schedule_confirmation_action_as_system"
  )
);
const UNCONFIRM_PERSIST = compact(
  functionDefinition(
    MIGRATION,
    "public.persist_schedule_unconfirmation_action_as_system"
  )
);
const UNCONFIRM_NOTIFICATION = compact(
  functionDefinition(
    MIGRATION,
    "public.persist_schedule_unconfirmation_notification_as_system"
  )
);
const GENERIC_ACTION = compact(
  functionDefinition(MIGRATION, "public.persist_task_automation_agent_action")
);
const GENERIC_NOTIFICATION = compact(
  functionDefinition(MIGRATION, "public.persist_task_automation_notification")
);

describe("purpose-bound schedule dispatch contracts", () => {
  it("rejects task tenant or project reparenting before schedule proof comparison", () => {
    const parentGuard = SCHEDULE_VERSION_TRIGGER.indexOf(
      "new.company_id is distinct from old.company_id"
    );
    const projectGuard = SCHEDULE_VERSION_TRIGGER.indexOf(
      "new.project_id is distinct from old.project_id"
    );
    const scheduleComparison = SCHEDULE_VERSION_TRIGGER.indexOf(
      "private.project_task_schedule_changed(old, new)"
    );

    expect(parentGuard).toBeGreaterThan(-1);
    expect(projectGuard).toBeGreaterThan(-1);
    expect(parentGuard).toBeLessThan(scheduleComparison);
    expect(projectGuard).toBeLessThan(scheduleComparison);
    expect(SCHEDULE_VERSION_TRIGGER).toContain(
      "raise exception 'project_task_parent_immutable'"
    );
  });

  it("invalidates confirmation proof across terminal and reopen transitions", () => {
    expect(SCHEDULE_VERSION_TRIGGER).toContain(
      "private.project_task_schedule_changed(old, new) or old.status is distinct from new.status"
    );
    expect(SCHEDULE_VERSION_TRIGGER).toContain(
      "if v_schedule_changed then new.schedule_confirmed_at := null"
    );
    expect(AUTOMATION_PRODUCER).toContain(
      "v_schedule_changed := private.project_task_schedule_changed(old, new)"
    );
    expect(AUTOMATION_PRODUCER).not.toContain(
      "v_schedule_changed := private.project_task_schedule_changed(old, new) or old.status"
    );
    expect(
      functionDefinition(
        MIGRATION,
        "public.confirm_project_task_schedule_as_system"
      )
    ).toContain("and task.status = 'active'");
    expect(AUTOMATIC_CONFIRM).toContain("and task.status = 'active'");
  });

  it("requires exact task proofs to be cleared before a project changes client", () => {
    expect(PROJECT_CLIENT_GUARD).toContain(
      "new.client_id is distinct from old.client_id"
    );
    expect(PROJECT_CLIENT_GUARD).toContain(
      "task.confirmed_schedule_version = task.schedule_version"
    );
    expect(PROJECT_CLIENT_GUARD).toContain(
      "task.schedule_confirmed_at is not null"
    );
    expect(PROJECT_CLIENT_GUARD).toContain("task.deleted_at is null");
    expect(PROJECT_CLIENT_GUARD).toContain(
      "raise exception 'confirmed_project_client_change_forbidden'"
    );
    expect(MIGRATION).toContain(
      "create trigger guard_confirmed_project_client_identity\nbefore update of client_id on public.projects"
    );
  });

  it("atomically replaces confirmed schedule-edit effects with one exact purpose unconfirmation", () => {
    expect(AUTOMATION_PRODUCER).toContain(
      "old.schedule_confirmed_at is not null"
    );
    expect(AUTOMATION_PRODUCER).toContain(
      "old.confirmed_schedule_version = old.schedule_version"
    );
    expect(AUTOMATION_PRODUCER).toContain(
      "private.user_can_edit_task(v_actor_user_id, new.id)"
    );
    expect(AUTOMATION_PRODUCER).toContain(
      "private.enqueue_schedule_confirmation_dispatch( 'schedule_unconfirmation_dispatch', new, v_actor_user_id, 'schedule_edit', old.schedule_confirmed_at, old.schedule_confirmed_by, old.confirmed_schedule_version, old )"
    );
    expect(AUTOMATION_PRODUCER).not.toContain("'confirmed_reschedule'");
    expect(AUTOMATION_PRODUCER).toContain(
      "v_enqueued_schedule_unconfirmation := true"
    );
    expect(AUTOMATION_PRODUCER).toContain(
      "if not v_enqueued_schedule_unconfirmation and new.start_date is not null"
    );
    expect(ENQUEUE).toContain(
      "p_dispatch_origin not in ('explicit_admin', 'schedule_edit')"
    );
    expect(ENQUEUE).toContain(
      "'schedule_unconfirmation_origin', p_dispatch_origin"
    );
    expect(ENQUEUE).toContain(
      "private.task_schedule_automation_snapshot(p_previous_task)"
    );
    expect(ENQUEUE).toContain(
      "p_previous_task.schedule_version = p_previous_confirmed_version"
    );
    expect(ENQUEUE).toContain(
      "p_task.schedule_version = p_previous_task.schedule_version + 1"
    );
    expect(PREPARE).toContain(
      "v_event.after_snapshot ->> 'schedule_unconfirmation_origin'"
    );
    expect(PREPARE).toContain(
      "v_origin = 'explicit_admin' and not private.user_is_company_admin("
    );
    expect(PREPARE).toContain(
      "v_origin = 'schedule_edit' and not private.user_can_edit_task("
    );
    expect(PREPARE).toContain(
      "'schedule_unconfirmation_origin', case when v_event.kind = 'schedule_unconfirmation_dispatch' then v_origin else null end"
    );
  });

  it("preserves an unscheduled confirmed visit as an exact purpose communication", () => {
    expect(PREPARE).toContain(
      "v_task.start_date is null and not ( v_event.kind = 'schedule_unconfirmation_dispatch' and v_origin = 'schedule_edit' )"
    );
    expect(ENQUEUE).toContain("'change_kind', case");
    expect(ENQUEUE).toContain("p_dispatch_origin = 'schedule_edit'");
    expect(ENQUEUE).toContain("p_task.start_date is null then 'unscheduled'");
    expect(PREPARE).toContain(
      "v_change_kind := v_event.after_snapshot ->> 'change_kind'"
    );
    expect(PREPARE).toContain(
      "'scheduled_date', case when v_task.start_date is null then null"
    );
    expect(UNCONFIRM_PERSIST).toContain("v_change_kind = 'unscheduled'");
    expect(UNCONFIRM_PERSIST).toContain(
      "jsonb_typeof(p_action_data -> 'new_date') = 'null'"
    );
    expect(UNCONFIRM_PERSIST).toContain("v_change_kind = 'rescheduled'");
    expect(COMMS).toContain('prepared.changeKind === "unscheduled"');
    expect(COMMS).toContain('"scheduleUnscheduled.fallback"');
    expect(COMMS).toContain(
      'type: isUnscheduled ? "schedule_unscheduled" : "schedule_changed"'
    );
    expect(COMMS).toContain("change_kind: prepared.changeKind");
  });

  it("persists unconfirmation notifications only through the leased fixed-copy RPC", () => {
    expect(UNCONFIRM_NOTIFICATION).toContain(
      "auth.role() is distinct from 'service_role'"
    );
    expect(UNCONFIRM_NOTIFICATION).toContain(
      "event.kind = 'schedule_unconfirmation_dispatch'"
    );
    expect(UNCONFIRM_NOTIFICATION).toContain("event.status = 'processing'");
    expect(UNCONFIRM_NOTIFICATION).toContain("event.lease_expires_at > now()");
    expect(UNCONFIRM_NOTIFICATION).toContain(
      "event.actor_user_id = p_actor_user_id"
    );
    expect(UNCONFIRM_NOTIFICATION).toContain("event.company_id = p_company_id");
    expect(UNCONFIRM_NOTIFICATION).toContain(
      "private.user_is_company_admin(p_actor_user_id, p_company_id)"
    );
    expect(UNCONFIRM_NOTIFICATION).toContain(
      "private.user_can_edit_task(p_actor_user_id, p_task_id)"
    );
    expect(UNCONFIRM_NOTIFICATION).toContain("p_expected_schedule_version < 0");
    expect(UNCONFIRM_NOTIFICATION).toContain(
      "'task-automation-notification:' || p_event_id::text"
    );
    expect(UNCONFIRM_NOTIFICATION).not.toContain("p_title");
    expect(UNCONFIRM_NOTIFICATION).not.toContain("p_body");
    for (const fixedCopy of [
      "confirmed task rescheduled",
      "a previously-confirmed appointment was changed",
      "tarea confirmada reprogramada",
      "una cita previamente confirmada ha cambiado",
    ]) {
      expect(UNCONFIRM_NOTIFICATION).toContain(fixedCopy);
    }
    expect(MIGRATION).toMatch(
      /revoke all on function public\.persist_schedule_unconfirmation_notification_as_system\([\s\S]*?from public, anon, authenticated, service_role;/
    );
    expect(MIGRATION).toMatch(
      /grant execute on function public\.persist_schedule_unconfirmation_notification_as_system\([\s\S]*?to service_role;/
    );
  });

  it("binds company and actor in the nominal guard and never sends caller copy to the purpose RPC", () => {
    expect(WORKER).toContain("companyId: claim.company_id");
    expect(WORKER).toContain("actorUserId: claim.actor_user_id!");
    expect(PERSISTENCE).toContain("p_actor_user_id: guard.actorUserId");
    expect(PERSISTENCE).toContain("p_company_id: guard.companyId");
    const purposeCall = PERSISTENCE.slice(
      PERSISTENCE.indexOf(
        '"persist_schedule_unconfirmation_notification_as_system"'
      ),
      PERSISTENCE.indexOf(
        ': await supabase.rpc("persist_task_automation_notification"'
      )
    );
    expect(purposeCall).not.toContain("p_title");
    expect(purposeCall).not.toContain("p_body");
  });

  it("blocks every purpose kind from both generic persistence writers", () => {
    for (const purposeKind of [
      "schedule_confirmation_dispatch",
      "schedule_unconfirmation_dispatch",
    ]) {
      expect(GENERIC_ACTION).toContain(`'${purposeKind}'`);
      expect(GENERIC_NOTIFICATION).toContain(`'${purposeKind}'`);
    }
    expect(GENERIC_ACTION).toContain(
      "task_automation_confirmation_requires_purpose_dispatch"
    );
    expect(GENERIC_NOTIFICATION).toContain(
      "task_automation_notification_requires_purpose_dispatch"
    );
    expect(MIGRATION).toMatch(
      /revoke all on function public\.persist_task_automation_(?:agent_action|notification)_unversioned_impl\([\s\S]*?from public, anon, authenticated, service_role;/
    );
  });

  it("rechecks exact confirmation authority, current mailbox sendability, and canonical prepared claims", () => {
    expect(CONFIRM_PERSIST).toContain(
      "private.user_can_edit_task(p_actor_user_id, p_task_id)"
    );
    expect(CONFIRM_PERSIST).toContain(
      "coalesce(connection.sync_enabled, false)"
    );
    expect(FULL_AUTO).toContain("coalesce(connection.sync_enabled, false)");
    expect(CONFIRM_PERSIST).toContain(
      "private.user_can_send_inbox_connection( p_actor_user_id, p_company_id, connection.id, null )"
    );
    expect(CONFIRM_PERSIST).toContain("nullif(btrim(project.title), '')");
    expect(CONFIRM_PERSIST).toContain(
      "coalesce(nullif(btrim(client.name), ''), '')"
    );
    expect(CONFIRM_PERSIST).toContain("nullif(btrim(task.custom_title), '')");
    expect(CONFIRM_PERSIST).toContain(
      "task.start_date at time zone 'utc', 'yyyy-mm-dd'"
    );
    expect(PREPARE).toContain(
      "'scheduled_date', case when v_task.start_date is null then null else to_char(v_task.start_date at time zone 'utc', 'yyyy-mm-dd') end"
    );
    expect(COMMS).toContain("const CANONICAL_CIVIL_DATE_PATTERN");
    expect(COMMS).toContain('timeZone: "UTC"');
    expect(PREPARE).toContain(
      "v_task.duration is not null and (v_task.duration < 1 or v_task.duration > 365)"
    );
    expect(PREPARE).toContain(
      "'duration_hours', greatest(coalesce(v_task.duration, 1), 1) * 8"
    );
    expect(CONFIRM_PERSIST).toContain(
      "(greatest(coalesce(task.duration, 1), 1) * 8)::text"
    );
  });

  it("bounds purpose crew before every legacy snapshot materialization", () => {
    const enqueueBound = ENQUEUE.indexOf("cardinality(");
    const enqueueSnapshot = ENQUEUE.indexOf(
      "private.task_schedule_automation_snapshot(p_task)"
    );
    const prepareBound = PREPARE.indexOf("cardinality(");
    const prepareSnapshot = PREPARE.indexOf(
      "private.task_schedule_automation_snapshot_matches("
    );
    const fullAutoBound = FULL_AUTO.indexOf("cardinality(");
    const fullAutoSnapshot = FULL_AUTO.indexOf(
      "private.task_schedule_automation_snapshot_matches("
    );
    for (const [bound, snapshot] of [
      [enqueueBound, enqueueSnapshot],
      [prepareBound, prepareSnapshot],
      [fullAutoBound, fullAutoSnapshot],
    ]) {
      expect(bound).toBeGreaterThanOrEqual(0);
      expect(snapshot).toBeGreaterThan(bound);
    }
    expect(ENQUEUE).toContain(
      "coalesce(p_task.team_member_ids, array[]::text[]) ) > 100"
    );
    expect(PREPARE).toContain(
      "'reason', case when found then 'crew_source_query_bound'"
    );
    expect(FULL_AUTO).toContain(
      "'reason', case when found then 'crew_source_query_bound'"
    );
    for (const helper of [SHARED_SNAPSHOT, SHARED_SNAPSHOT_MATCH]) {
      expect(helper).toContain(
        "cardinality( coalesce(p_task.team_member_ids, array[]::text[]) ) > 100"
      );
      expect(helper).toContain(
        "(coalesce(p_task.team_member_ids, array[]::text[]))[1:100]"
      );
      expect(helper.indexOf("cardinality(")).toBeLessThan(
        helper.indexOf("from unnest(")
      );
    }
  });

  it("rejects oversized assignment sources before every legacy trigger comparator", () => {
    const newBound = SCHEDULE_VERSION_TRIGGER.indexOf(
      "cardinality(coalesce(new.team_member_ids, array[]::text[])) > 100"
    );
    const oldBound = SCHEDULE_VERSION_TRIGGER.indexOf(
      "cardinality(coalesce(old.team_member_ids, array[]::text[])) > 100"
    );
    const legacyComparator = SCHEDULE_VERSION_TRIGGER.indexOf(
      "private.project_task_schedule_changed(old, new)"
    );
    expect(newBound).toBeGreaterThanOrEqual(0);
    expect(oldBound).toBeGreaterThan(newBound);
    expect(legacyComparator).toBeGreaterThan(oldBound);
    expect(SCHEDULE_VERSION_TRIGGER).toContain(
      "project_task_assignment_source_query_bound"
    );
    expect(SCHEDULE_VERSION_TRIGGER).toContain("errcode = '22023'");
  });

  it("recovers committed actions by immutable purpose proof, not regenerated draft copy", () => {
    expect(CONFIRM_PERSIST).not.toContain("action.action_data = p_action_data");
    expect(CONFIRM_PERSIST).toContain(
      "action.action_data ->> 'confirmed_schedule_version' = p_expected_schedule_version::text"
    );
    expect(CONFIRM_PERSIST).toContain(
      "action.action_data ->> 'confirmation_origin' = v_confirmation_origin"
    );
    const unconfirmPersist = compact(
      functionDefinition(
        MIGRATION,
        "public.persist_schedule_unconfirmation_action_as_system"
      )
    );
    expect(unconfirmPersist).not.toContain(
      "action.action_data = p_action_data"
    );
    expect(unconfirmPersist).toContain(
      "action.action_data #>> '{task_automation_guard,event_id}' = p_event_id::text"
    );
    expect(unconfirmPersist).toContain(
      "action.action_data ->> 'previous_schedule_confirmed_at' = to_char("
    );
  });

  it("keeps action timing DB-owned and the application RPC arguments exact", () => {
    const confirmCall = APPROVAL.slice(
      APPROVAL.indexOf('"persist_schedule_confirmation_action_as_system"'),
      APPROVAL.indexOf(
        "if (error)",
        APPROVAL.indexOf('"persist_schedule_confirmation_action_as_system"')
      )
    );
    expect(confirmCall).not.toContain("p_auto_execute_at");
    expect(CONFIRM_PERSIST).not.toContain("p_auto_execute_at");
    expect(CONFIRM_PERSIST).toContain("v_auto_execute_at := case");
    for (const settingsProjection of [PREPARE, CONFIRM_PERSIST]) {
      expect(settingsProjection).toMatch(
        /appointment_confirmation,send_delay_minutes[\s\S]*?else 15 end/
      );
    }
    expect(CONFIRM_PERSIST).not.toMatch(
      /appointment_confirmation,send_delay_minutes[\s\S]*?else 5 end/
    );
  });

  it("requires current task edit authority before automatic grace can stamp", () => {
    expect(AUTOMATIC_CONFIRM).toContain(
      "private.user_can_edit_task(p_actor_user_id, p_task_id)"
    );
    expect(
      AUTOMATIC_CONFIRM.indexOf("private.user_can_edit_task")
    ).toBeLessThan(
      AUTOMATIC_CONFIRM.indexOf(
        "private.bind_project_task_schedule_confirmation("
      )
    );
  });
});

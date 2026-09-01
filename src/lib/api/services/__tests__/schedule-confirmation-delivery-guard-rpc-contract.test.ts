import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260812121000_agent_schedule_confirmation_delivery_guard.sql"
  ),
  "utf8"
).toLowerCase();
const FOUNDATION = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260812120000_agent_operational_schedule_readiness.sql"
  ),
  "utf8"
).toLowerCase();
const PRIOR_DELIVERY_GUARDS = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260721122000_payment_reminder_delivery_guards.sql"
  ),
  "utf8"
).toLowerCase();

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function functionDefinition(source: string, name: string): string {
  const marker = `create or replace function ${name}(`;
  const start = source.lastIndexOf(marker);
  if (start < 0) return "";
  const remainder = source.slice(start);
  const delimiter = /\bas\s+(\$[a-z0-9_]*\$)/.exec(remainder)?.[1];
  if (!delimiter) return "";
  const end = remainder.indexOf(`${delimiter};`);
  return end < 0 ? "" : remainder.slice(0, end + delimiter.length + 1);
}

const COMPACT_MIGRATION = compact(MIGRATION);
const GUARD = compact(
  functionDefinition(
    MIGRATION,
    "private.schedule_confirmation_email_intent_is_current"
  )
);
const CREW_GUARD = compact(
  functionDefinition(
    MIGRATION,
    "private.schedule_dispatch_crew_names_are_current"
  )
);
const PURPOSE_IDENTITY = compact(
  functionDefinition(
    MIGRATION,
    "private.purpose_schedule_email_action_identity_is_exact"
  )
);
const ACTION_IMMUTABILITY_GUARD = compact(
  functionDefinition(
    MIGRATION,
    "private.guard_purpose_schedule_email_action_update"
  )
);
const UNCONFIRMATION_GUARD = compact(
  functionDefinition(
    MIGRATION,
    "private.schedule_unconfirmation_email_intent_is_current"
  )
);
const AUTHORIZATION = compact(
  functionDefinition(
    MIGRATION,
    "private.approved_action_email_intent_is_authorized"
  )
);
const PREPARE = compact(
  functionDefinition(MIGRATION, "public.prepare_approved_action_email_intent")
);
const CLAIM = compact(
  functionDefinition(MIGRATION, "public.claim_approved_action_email_delivery")
);
const RETRY_RESET = compact(
  functionDefinition(
    MIGRATION,
    "public.reset_purpose_schedule_email_action_for_retry_as_system"
  )
);
const RETRY_SELECTOR = compact(
  functionDefinition(
    MIGRATION,
    "public.list_due_purpose_schedule_email_action_retries_as_system"
  )
);
const PERSIST = compact(
  functionDefinition(
    FOUNDATION,
    "public.persist_schedule_confirmation_action_as_system"
  )
);

describe("schedule-confirmation approved-email delivery guard", () => {
  it("is a later atomic migration with a closed privilege surface", () => {
    expect(MIGRATION).toMatch(/^--[\s\S]*?\nbegin;/);
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
    expect(COMPACT_MIGRATION).toContain(
      "revoke all on function private.schedule_confirmation_email_intent_is_current(uuid) from public, anon, authenticated, service_role"
    );
    expect(COMPACT_MIGRATION).toContain(
      "grant execute on function public.prepare_approved_action_email_intent( uuid, text, uuid, text, text, text, text ) to service_role"
    );
    expect(COMPACT_MIGRATION).toContain(
      "grant execute on function public.claim_approved_action_email_delivery(uuid) to service_role"
    );
    expect(COMPACT_MIGRATION).toContain(
      "revoke all on function public.list_due_purpose_schedule_email_action_retries_as_system() from public, anon, authenticated, service_role"
    );
    expect(COMPACT_MIGRATION).toContain(
      "grant execute on function public.list_due_purpose_schedule_email_action_retries_as_system() to service_role"
    );
    for (const identifier of [
      "approved_action_email_intent_is_authorized_pre_schedule_guard",
      "prepare_approved_action_email_intent_pre_schedule_guard",
      "claim_approved_action_email_delivery_pre_schedule_guard",
    ]) {
      expect(identifier.length).toBeLessThanOrEqual(63);
    }
  });

  it("wraps, rather than replaces, every previously accumulated authorization guard", () => {
    expect(COMPACT_MIGRATION).toContain(
      "alter function private.approved_action_email_intent_is_authorized(uuid, boolean) rename to approved_action_email_intent_is_authorized_pre_schedule_guard"
    );
    expect(AUTHORIZATION).toContain(
      "private.approved_action_email_intent_is_authorized_pre_schedule_guard( p_intent_id, p_require_signature )"
    );
    expect(AUTHORIZATION).toContain(
      "private.schedule_confirmation_email_intent_is_current(p_intent_id)"
    );
    expect(AUTHORIZATION).toContain(
      "private.schedule_unconfirmation_email_intent_is_current(p_intent_id)"
    );
    expect(AUTHORIZATION.indexOf("pre_schedule_guard")).toBeLessThan(
      AUTHORIZATION.indexOf("schedule_confirmation_email_intent_is_current")
    );
    const priorClaim = compact(
      functionDefinition(
        PRIOR_DELIVERY_GUARDS,
        "public.claim_approved_action_email_delivery"
      )
    );
    expect(priorClaim).toContain(
      "private.approved_action_email_intent_is_authorized(p_intent_id, true)"
    );
    expect(priorClaim).toContain(
      "private.task_automation_email_intent_is_current(p_intent_id)"
    );
    expect(priorClaim).toContain(
      "private.payment_reminder_email_intent_is_current(p_intent_id)"
    );
    expect(GUARD).toContain(
      "if v_action.source_id not like 'schedule-confirmation:%' then return false"
    );
    expect(GUARD).toContain(
      "if v_action.context_source is distinct from 'task_scheduled' then return false"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "v_action.source_id !~* ( '^task-automation:[0-9a-f]{8}-[0-9a-f]{4}-' || '[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:' || 'schedule-unconfirmation$' )"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "v_action.context_source is distinct from 'task_scheduled' then return true"
    );
  });

  it("requires the exact canonical confirmation proof and deterministic action source", () => {
    for (const field of [
      "task_id",
      "schedule_version",
      "confirmed_schedule_version",
      "schedule_confirmed_at",
      "schedule_confirmed_by",
      "confirmation_origin",
      "project_id",
      "client_id",
      "client_email",
      "connection_id",
    ]) {
      expect(GUARD).toContain(`'${field}'`);
    }
    expect(GUARD).toContain("pg_input_is_valid");
    expect(GUARD).toContain("jsonb_typeof");
    expect(GUARD).toContain("9007199254740991");
    expect(GUARD).toContain('yyyy-mm-dd"t"hh24:mi:ss.ms"z"');
    expect(GUARD).toContain(
      "task.confirmed_schedule_version = task.schedule_version"
    );
    expect(GUARD).toContain(
      "task.schedule_confirmed_at = v_schedule_confirmed_at"
    );
    expect(GUARD).toContain(
      "task.schedule_confirmed_by is not distinct from v_schedule_confirmed_by"
    );
    expect(GUARD).toContain(
      "'schedule-confirmation:' || v_task_id::text || ':v' || v_schedule_version::text || ':'"
    );
    expect(GUARD).toContain(
      "v_data ->> 'confirmation_origin' not in ( 'manual', 'automatic_grace', 'full_auto' )"
    );
    expect(GUARD).toContain(
      "event.after_snapshot ->> 'confirmation_origin' = v_confirmation_origin"
    );
    expect(GUARD).toContain(
      "pg_input_is_valid( event.after_snapshot ->> 'schedule_confirmed_at', 'timestamp with time zone' )"
    );
  });

  it("supports the exact automatic null-confirmer proof without accepting a missing key", () => {
    expect(GUARD).toContain("v_data ? 'schedule_confirmed_by'");
    expect(GUARD).toContain(
      "jsonb_typeof(v_data -> 'schedule_confirmed_by') = 'null'"
    );
    expect(PERSIST).toContain(
      "p_action_data ->> 'confirmed_schedule_version' is distinct from p_expected_schedule_version::text"
    );
    expect(PERSIST).toContain(
      "p_action_data ->> 'schedule_confirmed_by' is distinct from p_expected_confirmed_by::text"
    );
    expect(PERSIST.indexOf("schedule_confirmed_by")).toBeLessThan(
      PERSIST.indexOf("insert into public.agent_actions")
    );
  });

  it("re-resolves the current active task, project, client, recipient, and mailbox", () => {
    expect(GUARD).toContain("from public.project_tasks task");
    expect(GUARD).toContain("join public.projects project");
    expect(GUARD).toContain("join public.clients client");
    expect(GUARD).toContain("join public.email_connections connection");
    expect(GUARD).toContain("task.status = 'active'");
    expect(GUARD).toContain("task.deleted_at is null");
    expect(GUARD).toContain("project.deleted_at is null");
    expect(GUARD).toContain("client.deleted_at is null");
    expect(GUARD).toContain("client.merged_into_client_id is null");
    expect(GUARD).toContain("connection.status = 'active'");
    expect(GUARD).toContain("coalesce(connection.sync_enabled, false)");
    expect(GUARD).toContain("connection.agent_can_send_from");
    expect(GUARD).toContain("join public.users source_actor");
    expect(GUARD).toContain(
      "private.user_can_edit_task(v_action.user_id, v_task_id)"
    );
    expect(GUARD).toContain(
      "private.user_can_send_inbox_connection( v_action.user_id, v_intent.company_id, v_intent.connection_id, null )"
    );
    expect(GUARD).toContain("cardinality(v_intent.to_emails) <> 1");
    expect(GUARD).toContain(
      "lower(btrim(v_intent.to_emails[1])) = lower(btrim(client.email))"
    );
    expect(GUARD).toContain(
      "lower(btrim(v_data ->> 'client_email')) = lower(btrim(client.email))"
    );
    expect(GUARD).toContain("connection.id = v_intent.connection_id");
    expect(GUARD).toContain("project.id = v_intent.project_id");
    expect(GUARD).toContain("client.id = v_intent.client_id");
    expect(GUARD).toContain(
      "lower(btrim(v_intent.client_from_address_snapshot)) = lower(btrim(connection.email))"
    );
    expect(GUARD).toContain("for share of task, project, client, connection");
  });

  it("revalidates immutable origin, current Phase C policy, and both admin actors", () => {
    expect(GUARD).toContain("feature.feature_key = 'phase_c'");
    expect(GUARD).toContain("feature.enabled");
    expect(GUARD).toContain("v_confirmation_origin = 'manual'");
    expect(GUARD).toContain("v_schedule_confirmed_by is not null");
    expect(GUARD).toContain("v_action.user_id = v_schedule_confirmed_by");
    const manualPolicy = GUARD.slice(
      GUARD.indexOf("v_confirmation_origin = 'manual'"),
      GUARD.indexOf("or v_confirmation_origin = 'automatic_grace'")
    );
    expect(manualPolicy).toContain(
      "private.user_is_company_admin( v_intent.actor_user_id, v_intent.company_id )"
    );
    expect(manualPolicy).toContain(
      "private.user_is_company_admin( v_action.user_id, v_intent.company_id )"
    );
    expect(GUARD).toContain("v_confirmation_origin = 'automatic_grace'");
    expect(GUARD).toContain(
      "private.agent_effective_confirmation_mode( company.client_comms_settings ) = 'automatic'"
    );
    expect(GUARD).toContain("v_confirmation_origin = 'full_auto'");
    expect(GUARD).toContain("event.status <> 'failed'");
    expect(GUARD).toContain(
      "private.agent_effective_confirmation_level( company.client_comms_settings ) = 'full_auto'"
    );
  });

  it("rejects mutable prompt-source drift instead of sending stale customer copy", () => {
    for (const comparison of [
      "v_data ->> 'project_title' is not distinct from nullif(btrim(project.title), '')",
      "v_data ->> 'project_address' is not distinct from nullif(btrim(project.address), '')",
      "v_data ->> 'client_name' is not distinct from coalesce(nullif(btrim(client.name), ''), '')",
      "nullif(btrim(task.custom_title), '')",
      "nullif(btrim(task_type.display), '')",
      "v_data ->> 'scheduled_date' = to_char( task.start_date at time zone 'utc', 'yyyy-mm-dd' )",
      "v_data ->> 'scheduled_time' is not distinct from",
      "v_data ->> 'scheduled_end_time' is not distinct from",
      "v_data ->> 'duration_hours' is not distinct from (greatest(coalesce(task.duration, 1), 1) * 8)::text",
    ]) {
      expect(GUARD).toContain(comparison);
    }
    expect(GUARD).toContain(
      "private.schedule_dispatch_crew_names_are_current( v_intent.company_id, task.team_member_ids, v_data -> 'crew_names' )"
    );
    expect(GUARD).toContain("to_char(task.start_time, 'hh24:mi')");
    expect(GUARD).toContain("to_char(task.end_time, 'hh24:mi')");
    expect(GUARD).not.toContain(
      "private.agent_parse_schedule_wall_time(task.start_time)"
    );
    expect(GUARD).not.toContain(
      "private.agent_parse_schedule_wall_time(task.end_time)"
    );
  });

  it("bounds crew before materialization and rejects every invalid reference", () => {
    const bound = CREW_GUARD.indexOf("v_raw_count > 100");
    const firstUnnest = CREW_GUARD.indexOf("unnest(");
    expect(bound).toBeGreaterThan(0);
    expect(firstUnnest).toBeGreaterThan(bound);
    expect(CREW_GUARD).toContain("with raw_member as materialized");
    expect(CREW_GUARD).toContain("validated.user_id is not null");
    expect(CREW_GUARD).toContain("validated.user_id <> ''");
    expect(CREW_GUARD).toContain(
      "validated.user_id = btrim(validated.user_id)"
    );
    expect(CREW_GUARD).toContain(
      "pg_input_is_valid(validated.user_id, 'uuid')"
    );
    expect(CREW_GUARD).toContain("validated.crew_id is not null");
    expect(CREW_GUARD).toContain(
      "char_length(validated.display_name) between 1 and 256"
    );
    expect(CREW_GUARD).toContain("v_unique_count > 50");
    expect(CREW_GUARD).toContain("order by current_member.first_ordinality");
  });

  it("classifies recovery work only from complete deterministic purpose identities", () => {
    expect(PURPOSE_IDENTITY).toContain(
      "p_context_source is distinct from 'task_scheduled'"
    );
    expect(PURPOSE_IDENTITY).toContain(
      "jsonb_typeof(p_action_data) is distinct from 'object'"
    );
    expect(PURPOSE_IDENTITY).toContain(
      "p_action_type = 'send_appointment_confirmation'"
    );
    expect(PURPOSE_IDENTITY).toContain(
      "p_action_type is distinct from 'send_schedule_changed'"
    );
    for (const proofField of [
      "task_id",
      "schedule_version",
      "confirmed_schedule_version",
      "schedule_confirmed_at",
      "schedule_confirmed_by",
      "confirmation_origin",
      "previous_schedule_confirmed_at",
      "source_task_id",
      "source_task_schedule_version",
      "source_task_automation_event_id",
      "task_automation_guard",
      "schedule_unconfirmation_origin",
    ]) {
      expect(PURPOSE_IDENTITY).toContain(`'${proofField}'`);
    }
    expect(PURPOSE_IDENTITY).toContain(
      "jsonb_typeof(p_action_data -> 'task_id') <> 'string'"
    );
    expect(PURPOSE_IDENTITY).toContain("9007199254740991");
    expect(PURPOSE_IDENTITY).toContain(
      "'schedule-confirmation:' || v_task_id::text || ':v' || v_schedule_version::text || ':'"
    );
    expect(PURPOSE_IDENTITY).toContain(
      "p_action_data -> 'task_automation_guard' = jsonb_build_object( 'event_id', v_event_id, 'task_id', v_task_id, 'schedule_version', v_schedule_version )"
    );
    expect(PURPOSE_IDENTITY).toContain(
      "'task-automation:' || v_event_id::text || ':schedule-unconfirmation'"
    );
    expect(COMPACT_MIGRATION).toContain(
      "revoke all on function private.purpose_schedule_email_action_identity_is_exact( text, text, text, jsonb ) from public, anon, authenticated, service_role"
    );
  });

  it("prevents direct callers from editing a purpose-bound schedule proposal", () => {
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "old.action_type = 'send_appointment_confirmation'"
    );
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "old.action_type = 'send_schedule_changed'"
    );
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "new.action_type = 'send_appointment_confirmation'"
    );
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "new.action_type = 'send_schedule_changed'"
    );
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "old.action_data ? 'schedule_unconfirmation_origin'"
    );
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "new.action_data ? 'schedule_unconfirmation_origin'"
    );
    expect(ACTION_IMMUTABILITY_GUARD).not.toContain(
      "old.action_type = 'send_appointment_confirmation' and"
    );
    expect(ACTION_IMMUTABILITY_GUARD).not.toContain(
      "new.action_type = 'send_appointment_confirmation' and"
    );
    expect(ACTION_IMMUTABILITY_GUARD).toContain("schedule-unconfirmation$");
    for (const immutableColumn of [
      "id",
      "company_id",
      "user_id",
      "action_type",
      "action_data",
      "context_summary",
      "context_source",
      "source_id",
      "confidence",
      "priority",
      "expires_at",
      "auto_execute_at",
      "created_at",
    ]) {
      expect(ACTION_IMMUTABILITY_GUARD).toContain(
        `new.${immutableColumn} is distinct from old.${immutableColumn}`
      );
    }
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "new.auto_execute_at is distinct from old.auto_execute_at and not ( old.status = 'approved' and new.status = 'pending' and old.reviewed_by is not null and new.auto_execute_at is null )"
    );
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "raise exception 'purpose_schedule_email_action_immutable'"
    );
    const trigger = compact(
      MIGRATION.slice(
        MIGRATION.indexOf(
          "create trigger guard_purpose_schedule_email_action_update"
        ),
        MIGRATION.indexOf(
          "execute function private.guard_purpose_schedule_email_action_update();"
        ) +
          "execute function private.guard_purpose_schedule_email_action_update();"
            .length
      )
    );
    for (const immutableColumn of [
      "action_data",
      "action_type",
      "company_id",
      "context_source",
      "source_id",
      "user_id",
    ]) {
      expect(trigger).toContain(immutableColumn);
    }
    for (const guardedApprovalColumn of [
      "status",
      "reviewed_by",
      "reviewed_at",
    ]) {
      expect(trigger).toContain(guardedApprovalColumn);
    }
    for (const mutableDeliveryColumn of ["error", "execution_result"]) {
      expect(trigger).not.toContain(mutableDeliveryColumn);
    }
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "old.status = 'pending' and new.status = 'approved'"
    );
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "auth.role() is distinct from 'service_role'"
    );
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "new.status is distinct from old.status and auth.role() is distinct from 'service_role'"
    );
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "old.status = 'pending' and new.status in ('approved', 'rejected', 'cancelled', 'expired')"
    );
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "old.status = 'approved' and new.status in ('pending', 'executed', 'failed')"
    );
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "old.status = 'failed' and new.status = 'executed'"
    );
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "new.status is not distinct from old.status"
    );
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "private.user_is_company_admin( new.reviewed_by, new.company_id )"
    );
    expect(ACTION_IMMUTABILITY_GUARD).toContain("new.reviewed_at is null");
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "new.status = 'approved' and old.status <> 'approved'"
    );
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "old.status = 'approved' and new.status = 'pending'"
    );
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "new.auto_execute_at is distinct from (case when old.reviewed_by is not null then null else old.auto_execute_at end)"
    );
    expect(ACTION_IMMUTABILITY_GUARD).toContain(
      "from public.approved_action_email_intents intent where intent.action_id = old.id"
    );
    expect(ACTION_IMMUTABILITY_GUARD).toContain("old.status = 'approved'");
    expect(COMPACT_MIGRATION).toContain(
      "revoke all on function private.guard_purpose_schedule_email_action_update() from public, anon, authenticated, service_role"
    );
  });

  it("resets only an exact pre-provider purpose action through a closed service RPC", () => {
    expect(RETRY_RESET).toContain(
      "auth.role() is distinct from 'service_role'"
    );
    expect(RETRY_RESET).toContain("char_length(coalesce(p_error, '')) > 10000");
    expect(RETRY_RESET).toContain("where action.id = p_action_id for update");
    expect(RETRY_RESET).toContain(
      "from public.approved_action_email_intents intent where intent.action_id = v_action.id for update"
    );
    for (const exactConfirmationField of [
      "task_id",
      "schedule_version",
      "confirmed_schedule_version",
      "schedule_confirmed_at",
      "confirmation_origin",
    ]) {
      expect(RETRY_RESET).toContain(`v_data ? '${exactConfirmationField}'`);
    }
    expect(RETRY_RESET).toContain(
      "'schedule-confirmation:' || v_task_id::text || ':v' || v_schedule_version::text || ':'"
    );
    for (const exactUnconfirmationField of [
      "source_task_id",
      "source_task_schedule_version",
      "source_task_automation_event_id",
      "task_automation_guard",
      "schedule_unconfirmation_origin",
    ]) {
      expect(RETRY_RESET).toContain(`v_data ? '${exactUnconfirmationField}'`);
    }
    expect(RETRY_RESET).toContain(
      "'task-automation:' || v_event_id::text || ':schedule-unconfirmation'"
    );
    expect(RETRY_RESET).toContain(
      "v_intent.status not in ('awaiting_signature', 'prepared')"
    );
    expect(RETRY_RESET).toContain(
      "v_intent.company_id is distinct from v_action.company_id"
    );
    expect(RETRY_RESET).toContain(
      "v_intent.action_type is distinct from v_action.action_type"
    );
    expect(RETRY_RESET).toContain(
      "v_intent.action_data_snapshot is distinct from v_action.action_data"
    );
    expect(RETRY_RESET).toContain(
      "v_intent.execution_mode not in ('manual', 'autonomous')"
    );
    expect(RETRY_RESET).toContain(
      "v_intent.execution_mode = 'manual' and ( v_action.reviewed_by is null or v_action.reviewed_at is null or v_intent.actor_user_id is distinct from v_action.reviewed_by )"
    );
    expect(RETRY_RESET).toContain(
      "v_intent.execution_mode = 'autonomous' and ( v_action.reviewed_by is not null or v_action.reviewed_at is not null or v_action.auto_execute_at is null or v_intent.actor_user_id is distinct from v_action.user_id )"
    );
    expect(RETRY_RESET).toContain("v_intent.provider_message_id is not null");
    expect(RETRY_RESET).toContain(
      "v_intent.accepted_provider_thread_id is not null"
    );
    expect(RETRY_RESET).toContain("v_intent.provider_accepted_at is not null");
    expect(RETRY_RESET).not.toContain("status = 'sending'");
    expect(RETRY_RESET).not.toContain("status = 'provider_accepted'");
    expect(RETRY_RESET).not.toContain("status = 'delivery_unknown'");
    expect(RETRY_RESET).toContain(
      "(v_action.reviewed_by is null) <> (v_action.reviewed_at is null)"
    );
    const intentLock = RETRY_RESET.indexOf(
      "from public.approved_action_email_intents intent"
    );
    const safeState = RETRY_RESET.indexOf(
      "v_intent.status not in ('awaiting_signature', 'prepared')"
    );
    const deleteIntent = RETRY_RESET.indexOf(
      "delete from public.approved_action_email_intents"
    );
    const resetAction = RETRY_RESET.indexOf(
      "update public.agent_actions action"
    );
    expect(intentLock).toBeGreaterThan(0);
    expect(safeState).toBeGreaterThan(intentLock);
    expect(deleteIntent).toBeGreaterThan(safeState);
    expect(resetAction).toBeGreaterThan(deleteIntent);
    expect(RETRY_RESET).toContain(
      "set status = 'pending', reviewed_by = null, reviewed_at = null, auto_execute_at = case when v_action.reviewed_by is not null then null else v_action.auto_execute_at end"
    );
    expect(RETRY_RESET).toContain(
      "when v_action.reviewed_by is not null then null"
    );
    expect(RETRY_RESET).toContain("else v_action.auto_execute_at");
    expect(RETRY_RESET).toContain("'previous_intent_status', v_intent_status");
    expect(RETRY_RESET).toContain("'reset', false");
    expect(RETRY_RESET).toContain("'reset', true");
    expect(COMPACT_MIGRATION).toContain(
      "revoke all on function public.reset_purpose_schedule_email_action_for_retry_as_system( uuid, text ) from public, anon, authenticated, service_role"
    );
    expect(COMPACT_MIGRATION).toContain(
      "grant execute on function public.reset_purpose_schedule_email_action_for_retry_as_system( uuid, text ) to service_role"
    );
  });

  it("recovers only bounded stale purpose actions that never crossed the provider boundary", () => {
    expect(RETRY_SELECTOR).toContain("returns table(action_id uuid)");
    expect(RETRY_SELECTOR).toContain(
      "auth.role() is distinct from 'service_role'"
    );
    expect(RETRY_SELECTOR).toContain("action.status = 'approved'");
    expect(RETRY_SELECTOR).toContain(
      "greatest( action.updated_at, coalesce(intent.updated_at, action.updated_at) ) <= statement_timestamp() - interval '15 minutes'"
    );
    expect(RETRY_SELECTOR).toContain(
      "action.reviewed_by is null and action.reviewed_at is null and action.auto_execute_at is not null and action.auto_execute_at <= statement_timestamp()"
    );
    expect(RETRY_SELECTOR).toContain(
      "intent.execution_mode = 'autonomous' and intent.actor_user_id = action.user_id"
    );
    expect(RETRY_SELECTOR).toContain(
      "action.reviewed_by is not null and action.reviewed_at is not null and ( intent.id is null or intent.execution_mode = 'manual'"
    );
    expect(RETRY_SELECTOR).toContain(
      "intent.execution_mode = 'manual' and intent.actor_user_id = action.reviewed_by"
    );
    expect(RETRY_SELECTOR).toContain(
      "private.purpose_schedule_email_action_identity_is_exact( action.action_type, action.context_source, action.source_id, action.action_data )"
    );
    expect(RETRY_SELECTOR).toContain(
      "left join public.approved_action_email_intents intent on intent.action_id = action.id"
    );
    expect(RETRY_SELECTOR).toContain(
      "intent.status in ('awaiting_signature', 'prepared')"
    );
    expect(RETRY_SELECTOR).toContain(
      "intent.action_data_snapshot = action.action_data"
    );
    expect(RETRY_SELECTOR).toContain("intent.provider_message_id is null");
    expect(RETRY_SELECTOR).toContain(
      "intent.accepted_provider_thread_id is null"
    );
    expect(RETRY_SELECTOR).toContain("intent.provider_accepted_at is null");
    expect(RETRY_SELECTOR).not.toContain("'sending'");
    expect(RETRY_SELECTOR).not.toContain("'provider_accepted'");
    expect(RETRY_SELECTOR).not.toContain("'delivery_unknown'");
    expect(RETRY_SELECTOR).toContain(
      "order by case when action.reviewed_by is null then action.auto_execute_at else action.updated_at end, action.created_at, action.id limit 10"
    );
    const manualBranch = RETRY_SELECTOR.slice(
      RETRY_SELECTOR.indexOf("or action.reviewed_by is not null")
    );
    expect(manualBranch).not.toContain("action.auto_execute_at is null");
  });

  it("rechecks purpose-bound schedule-change proof and current sources before delivery", () => {
    for (const field of [
      "source_task_id",
      "source_task_schedule_version",
      "source_task_automation_event_id",
      "task_automation_guard",
      "previous_schedule_confirmed_at",
      "schedule_unconfirmation_origin",
    ]) {
      expect(UNCONFIRMATION_GUARD).toContain(`'${field}'`);
    }
    expect(UNCONFIRMATION_GUARD).toContain(
      "v_data -> 'task_automation_guard' is distinct from jsonb_build_object( 'event_id', v_event_id, 'task_id', v_task_id, 'schedule_version', v_schedule_version )"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "'task-automation:' || v_event_id::text || ':schedule-unconfirmation'"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "event.kind = 'schedule_unconfirmation_dispatch'"
    );
    expect(UNCONFIRMATION_GUARD).toContain("event.status <> 'failed'");
    expect(UNCONFIRMATION_GUARD).toContain(
      "task.schedule_confirmed_at is null"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "task.schedule_confirmed_by is null"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "task.confirmed_schedule_version is null"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "private.task_schedule_automation_snapshot_matches( v_task, v_event.after_snapshot, v_schedule_version )"
    );
    expect(UNCONFIRMATION_GUARD).toContain("feature.feature_key = 'phase_c'");
    expect(UNCONFIRMATION_GUARD).toContain(
      "private.user_is_company_admin( v_action.user_id, v_intent.company_id )"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "coalesce(connection.sync_enabled, false)"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "coalesce(connection.agent_can_send_from, false)"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "lower(btrim(v_intent.to_emails[1])) = lower(btrim(client.email))"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "v_data ->> 'new_date' = to_char( task.start_date at time zone 'utc', 'yyyy-mm-dd' )"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "private.schedule_dispatch_crew_names_are_current( v_intent.company_id, task.team_member_ids, v_data -> 'crew_names' )"
    );
    const rawBound = UNCONFIRMATION_GUARD.indexOf(
      "coalesce(v_task.team_member_ids, array[]::text[]) ) > 100"
    );
    const snapshotMatcher = UNCONFIRMATION_GUARD.indexOf(
      "private.task_schedule_automation_snapshot_matches("
    );
    expect(rawBound).toBeGreaterThan(0);
    expect(snapshotMatcher).toBeGreaterThan(rawBound);
    expect(UNCONFIRMATION_GUARD).toContain(
      "v_unconfirmation_origin = 'explicit_admin' and event.before_snapshot ->> 'schedule_version' = v_schedule_version::text"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "v_schedule_version = 0 and event.before_snapshot ? 'confirmed_schedule_version' and jsonb_typeof( event.before_snapshot -> 'confirmed_schedule_version' ) = 'null'"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "v_unconfirmation_origin = 'schedule_edit' and v_schedule_version > 0 and event.before_snapshot ->> 'schedule_version' = (v_schedule_version - 1)::text and event.before_snapshot ->> 'confirmed_schedule_version' = (v_schedule_version - 1)::text"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "v_data ->> 'change_kind' = 'rescheduled' and task.start_date is not null"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "v_unconfirmation_origin = 'schedule_edit' and v_data ->> 'change_kind' = 'unscheduled' and task.start_date is null"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "jsonb_typeof(v_data -> 'new_date') = 'null'"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "jsonb_typeof(v_data -> 'new_time') = 'null'"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "jsonb_typeof(v_data -> 'new_end_time') = 'null'"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "else 'draft' end in ('draft', 'auto_send')"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "v_data ->> 'schedule_unconfirmation_origin' not in ( 'explicit_admin', 'schedule_edit' )"
    );
    expect(UNCONFIRMATION_GUARD).toContain(
      "event.after_snapshot ->> 'schedule_unconfirmation_origin' = v_unconfirmation_origin"
    );
    const explicitAdminPolicy = UNCONFIRMATION_GUARD.slice(
      UNCONFIRMATION_GUARD.indexOf(
        "v_unconfirmation_origin = 'explicit_admin'"
      ),
      UNCONFIRMATION_GUARD.indexOf(
        "or v_unconfirmation_origin = 'schedule_edit'"
      )
    );
    expect(explicitAdminPolicy).toContain(
      "private.user_is_company_admin( v_action.user_id, v_intent.company_id )"
    );
    expect(explicitAdminPolicy).toContain(
      "private.user_is_company_admin( v_intent.actor_user_id, v_intent.company_id )"
    );
    const scheduleEditPolicy = UNCONFIRMATION_GUARD.slice(
      UNCONFIRMATION_GUARD.indexOf(
        "or v_unconfirmation_origin = 'schedule_edit'"
      )
    );
    expect(scheduleEditPolicy).toContain(
      "private.user_can_edit_task( v_action.user_id, v_task_id )"
    );
    expect(scheduleEditPolicy).toContain(
      "private.user_can_edit_task( v_intent.actor_user_id, v_task_id )"
    );
  });

  it("rechecks after preparation and rolls back an unauthorized intent", () => {
    expect(COMPACT_MIGRATION).toContain(
      "alter function public.prepare_approved_action_email_intent( uuid, text, uuid, text, text, text, text ) rename to prepare_approved_action_email_intent_pre_schedule_guard"
    );
    const legacyCall = PREPARE.indexOf(
      "public.prepare_approved_action_email_intent_pre_schedule_guard("
    );
    const finalAuthorization = PREPARE.lastIndexOf(
      "private.approved_action_email_intent_is_authorized("
    );
    expect(legacyCall).toBeGreaterThan(0);
    expect(finalAuthorization).toBeGreaterThan(legacyCall);
    expect(PREPARE.slice(finalAuthorization)).toContain(
      "raise exception 'approved_action_email_authorization_revoked'"
    );
    expect(PREPARE).toContain(
      "v_intent.status in ('awaiting_signature', 'prepared')"
    );
    expect(
      PREPARE.indexOf("v_intent.status in ('awaiting_signature', 'prepared')")
    ).toBeLessThan(finalAuthorization);
    for (const postProviderStatus of [
      "sending",
      "provider_accepted",
      "reconciliation_failed",
      "reconciled",
    ]) {
      expect(PREPARE).not.toContain(
        `v_intent.status = '${postProviderStatus}'`
      );
    }
  });

  it("rechecks after every legacy claim guard at the last database boundary before provider I/O", () => {
    expect(COMPACT_MIGRATION).toContain(
      "alter function public.claim_approved_action_email_delivery(uuid) rename to claim_approved_action_email_delivery_pre_schedule_guard"
    );
    const legacyCall = CLAIM.indexOf(
      "public.claim_approved_action_email_delivery_pre_schedule_guard("
    );
    const finalAuthorization = CLAIM.lastIndexOf(
      "private.approved_action_email_intent_is_authorized("
    );
    expect(legacyCall).toBeGreaterThan(0);
    expect(finalAuthorization).toBeGreaterThan(legacyCall);
    expect(CLAIM.slice(finalAuthorization)).toContain(
      "raise exception 'approved_action_email_authorization_revoked'"
    );
    expect(CLAIM.slice(finalAuthorization)).toContain("return v_intent");
  });
});

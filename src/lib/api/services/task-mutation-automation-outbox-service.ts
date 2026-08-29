import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sendOneSignalPush } from "@/lib/integrations/onesignal";
import { filterPushRecipientsByQuietHours } from "@/lib/notifications/server-notification-service";
import { runWithSupabase } from "@/lib/supabase/helpers";
import {
  ClientSchedulingCommsService,
  taskMatchesScheduleChange,
  type ConfirmedScheduleChange,
  type TaskScheduleState,
} from "./client-scheduling-comms-service";
import {
  CronDatabaseOperationError,
  isDatabasePressureError,
} from "./cron-workload-control-service";
import { ScheduleOptimizationService } from "./schedule-optimization-service";
import { mintScheduleUnconfirmationPersistenceGuard } from "./schedule-unconfirmation-persistence-guard";

type TaskAutomationKind =
  | "full_auto_confirmation"
  | "schedule_cascade"
  | "confirmed_reschedule"
  | "task_assigned"
  | "task_completed"
  | "schedule_change"
  | "schedule_confirmation_dispatch"
  | "schedule_unconfirmation_dispatch";

type TaskNotificationKind = Extract<
  TaskAutomationKind,
  "task_assigned" | "task_completed" | "schedule_change"
>;

interface TaskAutomationClaim {
  event_id: string;
  lease_token: string;
  kind: TaskAutomationKind;
  company_id: string;
  task_id: string;
  actor_user_id: string | null;
  before_snapshot: Record<string, unknown>;
  after_snapshot: Record<string, unknown>;
  task_schedule_version: number;
  task_updated_at: string | null;
  attempt: number;
}

export interface TaskAutomationBatchResult {
  claimed: number;
  completed: number;
  superseded: number;
  skipped: number;
  requeued: number;
  failed: number;
  terminalFailed: number;
  errors: Array<{ eventId: string; message: string }>;
}

const TASK_FIELDS =
  "id, company_id, project_id, status, start_date, end_date, start_time, end_time, all_day, duration, team_member_ids, schedule_version, updated_at, schedule_confirmed_at, schedule_confirmed_by, confirmed_schedule_version";

function assertClaim(value: unknown): asserts value is TaskAutomationClaim {
  if (!value || typeof value !== "object") {
    throw new Error("Task automation claim was not an object");
  }
  const row = value as Record<string, unknown>;
  for (const key of [
    "event_id",
    "lease_token",
    "kind",
    "company_id",
    "task_id",
  ]) {
    if (typeof row[key] !== "string" || row[key] === "") {
      throw new Error(`Task automation claim is missing ${key}`);
    }
  }
  if (
    typeof row.task_schedule_version !== "number" ||
    !Number.isSafeInteger(row.task_schedule_version) ||
    row.task_schedule_version < 0
  ) {
    throw new Error("Task automation claim has an invalid schedule version");
  }
  if (
    ![
      "full_auto_confirmation",
      "schedule_cascade",
      "confirmed_reschedule",
      "task_assigned",
      "task_completed",
      "schedule_change",
      "schedule_confirmation_dispatch",
      "schedule_unconfirmation_dispatch",
    ].includes(row.kind as string)
  ) {
    throw new Error("Task automation claim has an invalid kind");
  }
  if (
    !row.before_snapshot ||
    typeof row.before_snapshot !== "object" ||
    !row.after_snapshot ||
    typeof row.after_snapshot !== "object"
  ) {
    throw new Error("Task automation claim is missing its schedule snapshot");
  }
  if (
    !isTaskNotificationKind(row.kind as TaskAutomationKind) &&
    ![
      "schedule_confirmation_dispatch",
      "schedule_unconfirmation_dispatch",
    ].includes(row.kind as string) &&
    row.task_schedule_version < 1
  ) {
    throw new Error("Task automation claim has an invalid schedule version");
  }
}

function isTaskNotificationKind(
  kind: TaskAutomationKind
): kind is TaskNotificationKind {
  return ["task_assigned", "task_completed", "schedule_change"].includes(kind);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function taskAutomationDatabaseOperation<T>(
  operation: string,
  pending: PromiseLike<{ data: T; error: { message?: string } | null }>
): Promise<T> {
  let result: { data: T; error: { message?: string } | null };
  try {
    result = await pending;
  } catch (cause) {
    throw new CronDatabaseOperationError(
      `Task automation ${operation} was unreachable`,
      { cause }
    );
  }
  if (result.error) {
    throw new CronDatabaseOperationError(
      `Task automation ${operation} failed: ${
        result.error.message ?? "unknown error"
      }`,
      { cause: result.error }
    );
  }
  return result.data;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function canonicalTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return null;
  }
  return new Date(value).toISOString();
}

type ConfirmationOrigin = "manual" | "automatic_grace" | "full_auto";
type ScheduleUnconfirmationOrigin = "explicit_admin" | "schedule_edit";

function confirmationOrigin(
  snapshot: Record<string, unknown>
): ConfirmationOrigin | null {
  const value = snapshot.confirmation_origin;
  return value === "manual" ||
    value === "automatic_grace" ||
    value === "full_auto"
    ? value
    : null;
}

function scheduleUnconfirmationOrigin(
  snapshot: Record<string, unknown>
): ScheduleUnconfirmationOrigin | null {
  const value = snapshot.schedule_unconfirmation_origin;
  return value === "explicit_admin" || value === "schedule_edit" ? value : null;
}

function purposeDispatchProofIsCurrent(
  task: Record<string, unknown>,
  claim: TaskAutomationClaim,
  change: ConfirmedScheduleChange
): boolean {
  if (!taskMatchesScheduleChange(task, change)) return false;
  if (claim.kind === "schedule_confirmation_dispatch") {
    const expectedAt = canonicalTimestamp(
      claim.after_snapshot.schedule_confirmed_at
    );
    const currentAt = canonicalTimestamp(task.schedule_confirmed_at);
    return (
      expectedAt !== null &&
      currentAt === expectedAt &&
      task.schedule_confirmed_by ===
        (stringOrNull(claim.after_snapshot.schedule_confirmed_by) ?? null) &&
      task.confirmed_schedule_version === claim.task_schedule_version &&
      confirmationOrigin(claim.after_snapshot) !== null
    );
  }
  if (claim.kind === "schedule_unconfirmation_dispatch") {
    return (
      task.schedule_confirmed_at === null &&
      task.schedule_confirmed_by === null &&
      task.confirmed_schedule_version === null &&
      canonicalTimestamp(claim.before_snapshot.schedule_confirmed_at) !==
        null &&
      scheduleUnconfirmationOrigin(claim.after_snapshot) !== null &&
      scheduleUnconfirmationOrigin(claim.before_snapshot) ===
        scheduleUnconfirmationOrigin(claim.after_snapshot)
    );
  }
  return true;
}

function scheduleState(snapshot: Record<string, unknown>): TaskScheduleState {
  return {
    startDate: stringOrNull(snapshot.start_date),
    endDate: stringOrNull(snapshot.end_date),
    startTime: stringOrNull(snapshot.start_time),
    endTime: stringOrNull(snapshot.end_time),
    allDay: snapshot.all_day !== false,
    duration:
      typeof snapshot.duration === "number" &&
      Number.isFinite(snapshot.duration)
        ? snapshot.duration
        : 1,
    teamMemberIds: Array.isArray(snapshot.team_member_ids)
      ? snapshot.team_member_ids.filter(
          (value): value is string => typeof value === "string"
        )
      : [],
  };
}

function scheduleChange(claim: TaskAutomationClaim): ConfirmedScheduleChange {
  return {
    before: scheduleState(claim.before_snapshot),
    after: scheduleState(claim.after_snapshot),
    scheduleVersion: claim.task_schedule_version,
  };
}

function sameScheduleState(
  left: TaskScheduleState,
  right: TaskScheduleState
): boolean {
  const canonical = (state: TaskScheduleState) => ({
    ...state,
    teamMemberIds: [...new Set(state.teamMemberIds)].sort(),
  });
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

interface TaskNotificationPersistenceResult {
  disposition: "processed" | "no_action" | "superseded";
  type?: TaskNotificationKind;
  title?: string;
  body?: string;
  pushTitle?: string;
  pushBody?: string;
  projectId?: string;
  actionUrl?: string;
  actionLabel?: string;
  pushRecipientIds: string[];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((item): item is string => typeof item === "string")
        ),
      ]
    : [];
}

function taskNotificationPersistenceResult(
  value: unknown
): TaskNotificationPersistenceResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Task notification persistence returned an invalid result");
  }
  const row = value as Record<string, unknown>;
  if (
    row.disposition !== "processed" &&
    row.disposition !== "no_action" &&
    row.disposition !== "superseded"
  ) {
    throw new Error(
      "Task notification persistence returned an invalid disposition"
    );
  }
  const result: TaskNotificationPersistenceResult = {
    disposition: row.disposition,
    pushRecipientIds: stringArray(row.push_recipient_ids),
  };
  if (row.disposition === "superseded") return result;
  if (
    (row.type !== "task_assigned" &&
      row.type !== "task_completed" &&
      row.type !== "schedule_change") ||
    typeof row.title !== "string" ||
    row.title === "" ||
    typeof row.body !== "string" ||
    row.body === "" ||
    typeof row.push_title !== "string" ||
    row.push_title === "" ||
    typeof row.push_body !== "string" ||
    row.push_body === "" ||
    typeof row.project_id !== "string" ||
    row.project_id === "" ||
    typeof row.action_url !== "string" ||
    row.action_url === "" ||
    typeof row.action_label !== "string" ||
    row.action_label === ""
  ) {
    throw new Error("Task notification persistence returned invalid proof");
  }
  return {
    ...result,
    type: row.type,
    title: row.title,
    body: row.body,
    pushTitle: row.push_title,
    pushBody: row.push_body,
    projectId: row.project_id,
    actionUrl: row.action_url,
    actionLabel: row.action_label,
  };
}

async function complete(
  db: SupabaseClient,
  claim: TaskAutomationClaim,
  disposition: string,
  result: Record<string, unknown> = {}
): Promise<void> {
  const data = await taskAutomationDatabaseOperation(
    "completion",
    db.rpc("complete_task_schedule_automation_event", {
      p_event_id: claim.event_id,
      p_lease_token: claim.lease_token,
      p_disposition: disposition,
      p_result: result,
    })
  );
  if (data !== true) {
    throw new Error("Task automation lease was lost");
  }
}

async function processTaskNotificationClaim(
  db: SupabaseClient,
  claim: TaskAutomationClaim,
  result: TaskAutomationBatchResult
): Promise<void> {
  const data = await taskAutomationDatabaseOperation(
    "notification persistence",
    db.rpc("persist_task_mutation_notification_as_system", {
      p_event_id: claim.event_id,
      p_lease_token: claim.lease_token,
    })
  );
  const persisted = taskNotificationPersistenceResult(data);

  if (persisted.disposition === "superseded") {
    await complete(db, claim, "superseded");
    result.superseded += 1;
    return;
  }
  if (persisted.disposition === "no_action") {
    await complete(db, claim, "no_action");
    result.skipped += 1;
    return;
  }
  if (persisted.type !== claim.kind) {
    throw new Error("Task notification kind did not match immutable proof");
  }

  // Quiet hours: the RPC computes wants_push + push_enabled only, so a crew
  // member's window was ignored on every task assignment, completion and
  // reschedule — the core leak in bug 42aa787c. The rail rows the RPC already
  // wrote stay put; only the push is dropped.
  const pushTargets = await filterPushRecipientsByQuietHours({
    companyId: claim.company_id,
    recipientUserIds: persisted.pushRecipientIds,
    db,
  });

  if (pushTargets.length > 0) {
    const pushType =
      persisted.type === "task_assigned"
        ? "taskAssignment"
        : persisted.type === "task_completed"
          ? "taskCompletion"
          : "scheduleChange";
    const screen =
      persisted.type === "task_completed" ? "projectDetails" : "taskDetails";
    const pushData =
      persisted.type === "schedule_change"
        ? { type: pushType, screen: "schedule" }
        : {
            type: pushType,
            taskId: claim.task_id,
            projectId: persisted.projectId!,
            screen,
          };
    const push = await sendOneSignalPush({
      recipientUserIds: pushTargets,
      title: persisted.pushTitle!,
      body: persisted.pushBody!,
      data: pushData,
      idempotencyKey: claim.event_id,
    });
    if (!push.ok) throw new Error("Task notification push failed");
  }

  await complete(db, claim, "processed", {
    notificationType: persisted.type,
    pushRecipients: pushTargets.length,
  });
  result.completed += 1;
}

async function actorCanEditTask(
  db: SupabaseClient,
  claim: TaskAutomationClaim,
  _task: Record<string, unknown>
): Promise<boolean> {
  if (!claim.actor_user_id) return false;
  const data = await taskAutomationDatabaseOperation(
    "authorization",
    db.rpc("authorize_task_action_as_system", {
      p_actor_user_id: claim.actor_user_id,
      p_task_id: claim.task_id,
      p_action: "edit",
    })
  );
  return data === true;
}

async function loadTask(
  db: SupabaseClient,
  claim: TaskAutomationClaim
): Promise<Record<string, unknown> | null> {
  const data = await taskAutomationDatabaseOperation(
    "task read",
    db
      .from("project_tasks")
      .select(TASK_FIELDS)
      .eq("id", claim.task_id)
      .eq("company_id", claim.company_id)
      .is("deleted_at", null)
      .maybeSingle()
  );
  return (data as Record<string, unknown> | null) ?? null;
}

async function runEffect(
  db: SupabaseClient,
  claim: TaskAutomationClaim,
  change: ConfirmedScheduleChange
): Promise<Record<string, unknown>> {
  const sourceId = `task-automation:${claim.event_id}`;
  const taskAutomationGuard = {
    eventId: claim.event_id,
    leaseToken: claim.lease_token,
    taskId: claim.task_id,
    scheduleVersion: claim.task_schedule_version,
  } as const;
  let guardDisposition: "superseded" | "access_lost" | null = null;
  const prePersistGuard = async (): Promise<boolean> => {
    const current = await loadTask(db, claim);
    if (
      !current ||
      current.status !== "active" ||
      !taskMatchesScheduleChange(current, change)
    ) {
      guardDisposition = "superseded";
      return false;
    }
    if (!(await actorCanEditTask(db, claim, current))) {
      guardDisposition = "access_lost";
      return false;
    }
    return true;
  };
  switch (claim.kind) {
    case "schedule_confirmation_dispatch": {
      const confirmedAt = stringOrNull(
        claim.after_snapshot.schedule_confirmed_at
      );
      const confirmedBy = stringOrNull(
        claim.after_snapshot.schedule_confirmed_by
      );
      if (!confirmedAt) {
        throw new Error("Confirmation dispatch proof is missing its timestamp");
      }
      const origin = confirmationOrigin(claim.after_snapshot);
      if (!origin) {
        throw new Error("Confirmation dispatch proof is missing its origin");
      }
      const confirmation =
        await ClientSchedulingCommsService.dispatchConfirmedScheduleProof(
          claim.company_id,
          claim.actor_user_id!,
          claim.task_id,
          {
            scheduleVersion: claim.task_schedule_version,
            confirmedAt: new Date(confirmedAt).toISOString(),
            confirmedBy,
            confirmationOrigin: origin,
          },
          scheduleState(claim.after_snapshot),
          origin,
          taskAutomationGuard
        );
      const disposition = confirmation.actionId
        ? "processed"
        : confirmation.actionTaken === "phase_c_disabled"
          ? "phase_disabled"
          : confirmation.actionTaken === "off" ||
              confirmation.actionTaken === "manual"
            ? "no_action"
            : null;
      if (!disposition) {
        throw new Error(
          `Schedule confirmation dispatch incomplete: ${confirmation.actionTaken}`
        );
      }
      return {
        sourceId: `schedule-confirmation:${claim.task_id}:v${claim.task_schedule_version}:${new Date(confirmedAt).toISOString()}`,
        confirmation,
        disposition,
      };
    }
    case "schedule_unconfirmation_dispatch": {
      const previousConfirmedAt = stringOrNull(
        claim.before_snapshot.schedule_confirmed_at
      );
      const unconfirmationOrigin = scheduleUnconfirmationOrigin(
        claim.after_snapshot
      );
      if (!previousConfirmedAt) {
        throw new Error(
          "Unconfirmation dispatch proof is missing its prior timestamp"
        );
      }
      if (!unconfirmationOrigin) {
        throw new Error("Unconfirmation dispatch proof is missing its origin");
      }
      const unconfirmationGuard = mintScheduleUnconfirmationPersistenceGuard({
        eventId: claim.event_id,
        leaseToken: claim.lease_token,
        taskId: claim.task_id,
        scheduleVersion: claim.task_schedule_version,
        companyId: claim.company_id,
        actorUserId: claim.actor_user_id!,
        previousConfirmedAt: new Date(previousConfirmedAt).toISOString(),
        unconfirmationOrigin,
      });
      const unconfirmation =
        await ClientSchedulingCommsService.dispatchUnconfirmedScheduleProof(
          claim.company_id,
          claim.actor_user_id!,
          claim.task_id,
          claim.task_schedule_version,
          new Date(previousConfirmedAt).toISOString(),
          unconfirmationGuard
        );
      return {
        sourceId: `schedule-unconfirmation:${claim.task_id}:v${claim.task_schedule_version}:${new Date(previousConfirmedAt).toISOString()}`,
        unconfirmation,
        disposition:
          unconfirmation.actionTaken === "stale_or_unconfirmed"
            ? "superseded"
            : unconfirmation.actionTaken === "phase_c_disabled"
              ? "phase_disabled"
              : unconfirmation.actionTaken === "do_nothing"
                ? "no_action"
                : unconfirmation.actionTaken === "notify" ||
                    ((unconfirmation.actionTaken === "draft" ||
                      unconfirmation.actionTaken === "auto_send") &&
                      unconfirmation.actionId)
                  ? "processed"
                  : (() => {
                      throw new Error(
                        `Schedule unconfirmation dispatch incomplete: ${unconfirmation.actionTaken}`
                      );
                    })(),
      };
    }
    case "full_auto_confirmation": {
      const fullAuto =
        await ClientSchedulingCommsService.confirmFullAutoScheduleFromLease(
          claim.event_id,
          claim.lease_token,
          claim.task_id,
          claim.task_schedule_version
        );
      return {
        sourceId: `${sourceId}:full-auto`,
        fullAuto,
        disposition: fullAuto.disposition,
      };
    }
    case "schedule_cascade": {
      const cascade = await ScheduleOptimizationService.handleRescheduleCascade(
        claim.company_id,
        claim.actor_user_id!,
        claim.task_id,
        "manual_update",
        {
          throwOnError: true,
          sourceIdPrefix: `${sourceId}:cascade`,
          prePersistGuard,
          taskAutomationGuard,
        }
      );
      return { sourceId: `${sourceId}:cascade`, cascade };
    }
    case "confirmed_reschedule": {
      const reschedule =
        await ClientSchedulingCommsService.onConfirmedTaskRescheduled(
          claim.company_id,
          claim.actor_user_id!,
          claim.task_id,
          change,
          {
            sourceId: `${sourceId}:confirmed-reschedule`,
            prePersistGuard,
            throwOnError: true,
            taskAutomationGuard,
          }
        );
      if (
        (reschedule.actionTaken === "draft" ||
          reschedule.actionTaken === "auto_send") &&
        !reschedule.actionId
      ) {
        if (guardDisposition) {
          return {
            sourceId: `${sourceId}:confirmed-reschedule`,
            reschedule,
            disposition: guardDisposition,
          };
        }
        throw new Error(
          "Configured schedule communication produced no durable action"
        );
      }
      return {
        sourceId: `${sourceId}:confirmed-reschedule`,
        reschedule,
        disposition:
          reschedule.actionTaken === "stale_or_unconfirmed"
            ? "superseded"
            : reschedule.actionTaken === "phase_c_disabled"
              ? "phase_disabled"
              : reschedule.actionTaken === "do_nothing"
                ? "no_action"
                : "processed",
      };
    }
    default:
      throw new Error("Task notification claim reached an automation effect");
  }
}

async function processClaim(
  db: SupabaseClient,
  rawClaim: unknown,
  result: TaskAutomationBatchResult
): Promise<void> {
  let claim: TaskAutomationClaim;
  try {
    assertClaim(rawClaim);
    claim = rawClaim;
  } catch (error) {
    const row =
      rawClaim && typeof rawClaim === "object" && !Array.isArray(rawClaim)
        ? (rawClaim as Record<string, unknown>)
        : null;
    const eventId = row && stringOrNull(row.event_id);
    const leaseToken = row && stringOrNull(row.lease_token);
    if (!eventId || !leaseToken) throw error;
    const failure = message(error);
    const { error: persistError } = await db.rpc(
      "fail_task_schedule_automation_event",
      {
        p_event_id: eventId,
        p_lease_token: leaseToken,
        p_error: failure,
        p_retryable: false,
      }
    );
    if (persistError) {
      throw new CronDatabaseOperationError(
        `Malformed task automation claim could not be terminalized: ${persistError.message}`,
        { cause: persistError }
      );
    }
    result.failed += 1;
    result.errors.push({ eventId, message: failure });
    return;
  }
  try {
    if (isTaskNotificationKind(claim.kind)) {
      await processTaskNotificationClaim(db, claim, result);
      return;
    }
    if (!claim.actor_user_id) {
      await complete(db, claim, "actor_missing");
      result.skipped += 1;
      return;
    }

    const task = await loadTask(db, claim);
    if (!task) {
      await complete(db, claim, "task_deleted");
      result.skipped += 1;
      return;
    }
    const change = scheduleChange(claim);
    const proofDispatch =
      claim.kind === "schedule_confirmation_dispatch" ||
      claim.kind === "schedule_unconfirmation_dispatch";
    if (
      task.status !== "active" ||
      (!proofDispatch && !taskMatchesScheduleChange(task, change))
    ) {
      await complete(db, claim, "superseded");
      result.superseded += 1;
      return;
    }
    if (proofDispatch && !purposeDispatchProofIsCurrent(task, claim, change)) {
      await complete(db, claim, "superseded");
      result.superseded += 1;
      return;
    }
    if (
      ![
        "full_auto_confirmation",
        "schedule_confirmation_dispatch",
        "schedule_unconfirmation_dispatch",
      ].includes(claim.kind) &&
      sameScheduleState(change.before, change.after)
    ) {
      await complete(db, claim, "no_action", {
        reason: "coalesced_schedule_no_op",
        scheduleVersion: claim.task_schedule_version,
      });
      result.skipped += 1;
      return;
    }
    if (!proofDispatch && !(await actorCanEditTask(db, claim, task))) {
      await complete(db, claim, "access_lost");
      result.skipped += 1;
      return;
    }

    const effectResult = await runWithSupabase(db, () =>
      runEffect(db, claim, change)
    );

    if (effectResult.disposition === "superseded") {
      await complete(db, claim, "superseded", effectResult);
      result.superseded += 1;
      return;
    }
    if (effectResult.disposition === "access_lost") {
      await complete(db, claim, "access_lost", effectResult);
      result.skipped += 1;
      return;
    }
    if (
      effectResult.disposition === "phase_disabled" ||
      effectResult.disposition === "no_action"
    ) {
      await complete(db, claim, effectResult.disposition, effectResult);
      result.skipped += 1;
      return;
    }

    // Re-read after model work. Action/notification persistence also performs
    // this exact version/access/lease proof atomically in SQL.
    const current = await loadTask(db, claim);
    if (
      !current ||
      current.status !== "active" ||
      (!proofDispatch && !taskMatchesScheduleChange(current, change)) ||
      (proofDispatch && !purposeDispatchProofIsCurrent(current, claim, change))
    ) {
      await complete(db, claim, "superseded", effectResult);
      result.superseded += 1;
      return;
    }
    if (!proofDispatch && !(await actorCanEditTask(db, claim, current))) {
      await complete(db, claim, "access_lost", effectResult);
      result.skipped += 1;
      return;
    }

    await complete(db, claim, "processed", effectResult);
    result.completed += 1;
  } catch (error) {
    if (isDatabasePressureError(error)) {
      throw error;
    }
    const failure = message(error);
    const { data: disposition, error: persistError } = await db.rpc(
      "fail_task_schedule_automation_event",
      {
        p_event_id: claim.event_id,
        p_lease_token: claim.lease_token,
        p_error: failure,
        p_retryable: true,
      }
    );
    if (persistError) {
      const persistenceDatabaseError = new CronDatabaseOperationError(
        `Task automation failure persistence failed: ${persistError.message}`,
        { cause: persistError }
      );
      if (isDatabasePressureError(persistenceDatabaseError)) {
        throw persistenceDatabaseError;
      }
      result.failed += 1;
      result.errors.push({
        eventId: claim.event_id,
        message: `${failure}; failure persistence: ${persistError.message}`,
      });
    } else if (disposition === "pending") {
      result.requeued += 1;
      result.errors.push({ eventId: claim.event_id, message: failure });
    } else {
      result.failed += 1;
      result.errors.push({ eventId: claim.event_id, message: failure });
    }
  }
}

export const TaskMutationAutomationOutboxService = {
  async processBatch(
    db: SupabaseClient,
    options: { limit?: number; leaseSeconds?: number; workerId?: string } = {}
  ): Promise<TaskAutomationBatchResult> {
    const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 25), 100));
    const leaseSeconds = Math.max(
      30,
      Math.min(Math.floor(options.leaseSeconds ?? 180), 900)
    );
    const workerId = options.workerId ?? randomUUID();
    const terminalized = await taskAutomationDatabaseOperation(
      "exhausted-event finalization",
      db.rpc("finalize_exhausted_task_schedule_automation_events")
    );
    if (
      typeof terminalized !== "number" ||
      !Number.isSafeInteger(terminalized) ||
      terminalized < 0
    ) {
      throw new Error("Task automation finalizer returned an invalid count");
    }

    const result: TaskAutomationBatchResult = {
      claimed: 0,
      completed: 0,
      superseded: 0,
      skipped: 0,
      requeued: 0,
      failed: 0,
      terminalFailed: terminalized,
      errors: [],
    };

    // A lease starts only when its event is about to be processed. Claiming a
    // whole batch up front lets slow model work consume tail-row leases and
    // attempts without ever touching those rows.
    for (let processed = 0; processed < limit; processed += 1) {
      const data = await taskAutomationDatabaseOperation(
        "claim",
        db.rpc("claim_task_schedule_automation_events", {
          p_worker_id: workerId,
          p_limit: 1,
          p_lease_seconds: leaseSeconds,
        })
      );
      const claims = (data ?? []) as unknown[];
      if (claims.length === 0) break;
      if (claims.length !== 1) {
        throw new Error("Task automation single claim returned multiple rows");
      }
      result.claimed += 1;
      await processClaim(db, claims[0], result);
    }

    return result;
  },
};

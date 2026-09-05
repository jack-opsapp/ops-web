import { z } from "zod-v4";

import {
  CursorRequestSchema,
  IanaTimeZoneSchema,
  LocalDateTimeSchema,
  OpaqueIdSchema,
  Rfc3339UtcTimestampSchema,
} from "./common";

const DAY_MILLISECONDS = 86_400_000;
export const MAX_SCHEDULE_WINDOW_DAYS = 90;
export const MAX_SCHEDULE_ASSIGNMENTS = 50;

export const TASK_LIFECYCLE_STATUSES = [
  "active",
  "completed",
  "cancelled",
] as const;
export const TaskLifecycleStatusSchema = z.enum(TASK_LIFECYCLE_STATUSES);

export const SCHEDULE_CONFIRMATION_STATES = [
  "confirmed",
  "unconfirmed",
] as const;
export const ScheduleConfirmationStateSchema = z.enum(
  SCHEDULE_CONFIRMATION_STATES
);

export const SCHEDULE_TIMING_STATES = [
  "upcoming",
  "in_progress",
  "past_due",
  "past",
] as const;
export const ScheduleTimingStateSchema = z.enum(SCHEDULE_TIMING_STATES);

export const PROJECT_LIFECYCLE_STATUSES = [
  "rfq",
  "estimated",
  "accepted",
  "in_progress",
  "completed",
  "closed",
  "archived",
] as const;
export const ProjectLifecycleStatusSchema = z.enum(PROJECT_LIFECYCLE_STATUSES);

export const READINESS_RULE_CODES = [
  "SITE_PHOTOS_MISSING",
  "CUSTOMER_RECORD_UNRESOLVED",
  "SCHEDULE_UNCONFIRMED",
  "CREW_UNASSIGNED",
  "ADDRESS_INCOMPLETE",
] as const;
export const ReadinessRuleCodeSchema = z.enum(READINESS_RULE_CODES);

function valuesAreUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function validScheduleWindow(from: string, to: string): boolean {
  const start = Date.parse(from);
  const end = Date.parse(to);
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end > start &&
    end - start <= MAX_SCHEDULE_WINDOW_DAYS * DAY_MILLISECONDS
  );
}

const UniqueTaskStatusesSchema = z
  .array(TaskLifecycleStatusSchema)
  .min(1)
  .max(TASK_LIFECYCLE_STATUSES.length)
  .refine(valuesAreUnique, "Task lifecycle statuses must be unique");

const UniqueConfirmationStatesSchema = z
  .array(ScheduleConfirmationStateSchema)
  .min(1)
  .max(SCHEDULE_CONFIRMATION_STATES.length)
  .refine(valuesAreUnique, "Schedule confirmation states must be unique");

const UniqueReadinessRuleCodesSchema = z
  .array(ReadinessRuleCodeSchema)
  .min(1)
  .max(READINESS_RULE_CODES.length)
  .refine(valuesAreUnique, "Readiness rule codes must be unique");

function withValidWindow<TSchema extends z.ZodType>(schema: TSchema) {
  return schema.superRefine((input, context) => {
    const candidate = input as { from?: unknown; to?: unknown };
    if (
      typeof candidate.from !== "string" ||
      typeof candidate.to !== "string" ||
      !validScheduleWindow(candidate.from, candidate.to)
    ) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "Schedule window must be positive and no longer than 90 days",
      });
    }
  });
}

export const ScheduledJobsInputSchema = withValidWindow(
  CursorRequestSchema.extend({
    from: Rfc3339UtcTimestampSchema.describe(
      "Inclusive UTC start ending in Z, for example 2026-09-07T07:00:00Z."
    ),
    to: Rfc3339UtcTimestampSchema.describe(
      "Exclusive UTC end ending in Z. Window must be positive and at most 90 days."
    ),
    task_statuses: UniqueTaskStatusesSchema.default(["active"]),
    confirmation_states: UniqueConfirmationStatesSchema.optional(),
    display_timezone: IanaTimeZoneSchema.optional(),
  }).strict()
);

export const JobReadinessIssuesInputSchema = withValidWindow(
  CursorRequestSchema.extend({
    from: Rfc3339UtcTimestampSchema.describe(
      "Inclusive UTC start ending in Z, for example 2026-09-07T07:00:00Z."
    ),
    to: Rfc3339UtcTimestampSchema.describe(
      "Exclusive UTC end ending in Z. Window must be positive and at most 90 days."
    ),
    rule_codes: UniqueReadinessRuleCodesSchema.default([
      ...READINESS_RULE_CODES,
    ]),
    include_clear: z.boolean().default(false),
  }).strict()
);

const ProjectJobRefSchema = z
  .object({
    kind: z.literal("project"),
    id: OpaqueIdSchema,
  })
  .strict();

const ProjectTaskOccurrenceRefSchema = z
  .object({
    kind: z.literal("project_task"),
    id: OpaqueIdSchema,
  })
  .strict();

const CustomerShareableAssignmentSchema = z
  .object({
    user_id: OpaqueIdSchema,
    display_name: z.string().trim().min(1).max(256),
  })
  .strict();

const UtcOffsetMinutesSchema = z.number().int().safe().min(-840).max(840);

const DisplayOccurrenceTimingSchema = z
  .object({
    timezone: IanaTimeZoneSchema,
    local_start: LocalDateTimeSchema,
    local_end_exclusive: LocalDateTimeSchema,
    start_utc_offset_minutes: UtcOffsetMinutesSchema,
    end_utc_offset_minutes: UtcOffsetMinutesSchema,
  })
  .strict();

export const ScheduledOccurrenceTimingSchema = z
  .object({
    all_day: z.boolean(),
    company_timezone: IanaTimeZoneSchema,
    local_start: LocalDateTimeSchema,
    local_end_inclusive: LocalDateTimeSchema,
    start_utc: Rfc3339UtcTimestampSchema,
    start_utc_offset_minutes: UtcOffsetMinutesSchema,
    start_pre_boundary_utc_offset_minutes: UtcOffsetMinutesSchema.nullable(),
    end_utc_exclusive: Rfc3339UtcTimestampSchema,
    end_utc_offset_minutes: UtcOffsetMinutesSchema,
    end_pre_boundary_utc_offset_minutes: UtcOffsetMinutesSchema.nullable(),
    display: DisplayOccurrenceTimingSchema,
  })
  .strict()
  .superRefine((schedule, context) => {
    if (
      Date.parse(schedule.end_utc_exclusive) <= Date.parse(schedule.start_utc)
    ) {
      context.addIssue({
        code: "custom",
        path: ["end_utc_exclusive"],
        message: "Occurrence end must be after its start",
      });
    }
    if (schedule.local_end_inclusive < schedule.local_start) {
      context.addIssue({
        code: "custom",
        path: ["local_end_inclusive"],
        message: "Local occurrence end cannot precede its start",
      });
    }
    const predecessorOffsetsArePresent =
      schedule.start_pre_boundary_utc_offset_minutes !== null &&
      schedule.end_pre_boundary_utc_offset_minutes !== null;
    if (schedule.all_day !== predecessorOffsetsArePresent) {
      context.addIssue({
        code: "custom",
        path: ["start_pre_boundary_utc_offset_minutes"],
        message:
          "All-day boundaries require predecessor offsets and timed occurrences forbid them",
      });
    }
  });

export const ScheduledJobOccurrenceSchema = z
  .object({
    job_ref: ProjectJobRefSchema,
    occurrence_ref: ProjectTaskOccurrenceRefSchema,
    title: z.string().trim().min(1).max(1_000),
    address: z.string().trim().min(1).max(2_000).nullable(),
    task_status: TaskLifecycleStatusSchema,
    timing_state: ScheduleTimingStateSchema,
    confirmation_state: ScheduleConfirmationStateSchema,
    schedule_confirmed_at: Rfc3339UtcTimestampSchema.nullable(),
    confirmed_schedule_version: z
      .number()
      .int()
      .safe()
      .nonnegative()
      .nullable(),
    schedule_locked: z.boolean(),
    schedule_version: z.number().int().safe().nonnegative(),
    task_updated_at: Rfc3339UtcTimestampSchema,
    project_status: ProjectLifecycleStatusSchema,
    project_status_version: z.number().int().safe().nonnegative(),
    project_updated_at: Rfc3339UtcTimestampSchema,
    schedule: ScheduledOccurrenceTimingSchema,
    assignments: z
      .array(CustomerShareableAssignmentSchema)
      .max(MAX_SCHEDULE_ASSIGNMENTS),
    assignment_total: z.number().int().safe().nonnegative(),
    assignments_omitted_count: z.number().int().safe().nonnegative(),
  })
  .strict()
  .superRefine((occurrence, context) => {
    const assignmentIds = occurrence.assignments.map(
      (assignment) => assignment.user_id
    );
    if (!valuesAreUnique(assignmentIds)) {
      context.addIssue({
        code: "custom",
        path: ["assignments"],
        message: "Assignment IDs must be unique",
      });
    }

    if (
      occurrence.assignment_total !==
      occurrence.assignments.length + occurrence.assignments_omitted_count
    ) {
      context.addIssue({
        code: "custom",
        path: ["assignment_total"],
        message:
          "Assignment total must equal retained plus omitted assignments",
      });
    }

    if (occurrence.confirmation_state === "confirmed") {
      if (occurrence.schedule_confirmed_at === null) {
        context.addIssue({
          code: "custom",
          path: ["schedule_confirmed_at"],
          message: "A confirmed schedule requires its confirmation timestamp",
        });
      }
      if (
        occurrence.confirmed_schedule_version === null ||
        occurrence.confirmed_schedule_version !== occurrence.schedule_version
      ) {
        context.addIssue({
          code: "custom",
          path: ["confirmed_schedule_version"],
          message: "Confirmation must bind the current schedule version",
        });
      }
    } else {
      if (occurrence.schedule_confirmed_at !== null) {
        context.addIssue({
          code: "custom",
          path: ["schedule_confirmed_at"],
          message:
            "An unconfirmed schedule cannot have a confirmation timestamp",
        });
      }
      if (occurrence.confirmed_schedule_version !== null) {
        context.addIssue({
          code: "custom",
          path: ["confirmed_schedule_version"],
          message: "An unconfirmed schedule cannot bind a schedule version",
        });
      }
    }

    if (
      occurrence.task_status === "active" &&
      occurrence.timing_state === "past"
    ) {
      context.addIssue({
        code: "custom",
        path: ["timing_state"],
        message: "An active task cannot use terminal past timing",
      });
    }
    if (
      occurrence.task_status !== "active" &&
      occurrence.timing_state !== "past"
    ) {
      context.addIssue({
        code: "custom",
        path: ["timing_state"],
        message: "A terminal task must use past timing",
      });
    }
  });

export type TaskLifecycleStatus = z.infer<typeof TaskLifecycleStatusSchema>;
export type ScheduleConfirmationState = z.infer<
  typeof ScheduleConfirmationStateSchema
>;
export type ScheduleTimingState = z.infer<typeof ScheduleTimingStateSchema>;
export type ProjectLifecycleStatus = z.infer<
  typeof ProjectLifecycleStatusSchema
>;
export type ReadinessRuleCode = z.infer<typeof ReadinessRuleCodeSchema>;
export type ScheduledJobsInput = z.input<typeof ScheduledJobsInputSchema>;
export type ParsedScheduledJobsInput = z.output<
  typeof ScheduledJobsInputSchema
>;
export type JobReadinessIssuesInput = z.input<
  typeof JobReadinessIssuesInputSchema
>;
export type ParsedJobReadinessIssuesInput = z.output<
  typeof JobReadinessIssuesInputSchema
>;
export type ScheduledOccurrenceTiming = z.infer<
  typeof ScheduledOccurrenceTimingSchema
>;
export type ScheduledJobOccurrence = z.infer<
  typeof ScheduledJobOccurrenceSchema
>;

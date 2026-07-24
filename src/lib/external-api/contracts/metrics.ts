import { z } from "zod";

import {
  dateOnlySchema,
  opaqueCampaignHandleSchema,
  opaqueFormIdSchema,
  opaqueSourceIdSchema,
  safeLabelSchema,
  timestampSchema,
} from "./common";

export const metricIdSchema = z.enum([
  "leads_received",
  "cohort_active_lead_count",
  "cohort_discarded_lead_count",
  "cohort_discard_rate",
  "cohort_current_stage_distribution",
  "cohort_outcome_distribution",
  "cohort_disqualified_count",
  "cohort_disqualified_rate",
  "project_converted_count",
  "project_converted_rate",
  "stage_reached_funnel_count",
  "stage_reached_funnel_rate",
  "cohort_decided_lead_count",
  "cohort_won_count",
  "cohort_lost_count",
  "cohort_decided_win_rate",
  "first_response_coverage",
  "median_first_response_minutes",
  "median_time_to_decision",
  "median_time_to_win",
  "median_time_to_project_conversion",
  "intake_submissions_accepted",
  "intake_submissions_rejected",
  "intake_submissions_replayed",
  "external_intake_customers_created",
  "external_intake_customers_matched",
  "source_attribution_completeness",
  "lifecycle_evidence_completeness",
  "cohort_open_estimated_value",
  "cohort_won_value",
  "cohort_average_won_value",
  "invoiced_event_total",
  "paid_event_total",
]);

export const metricGroupingSchema = z.enum([
  "day",
  "week",
  "month",
  "source",
  "campaign",
  "form",
]);

export const metricPresetSchema = z.enum([
  "7d",
  "30d",
  "90d",
  "lifetime",
  "custom",
]);

export const metricQuerySchema = z
  .object({
    preset: metricPresetSchema.default("30d"),
    from: z.union([timestampSchema, dateOnlySchema]).optional(),
    to: z.union([timestampSchema, dateOnlySchema]).optional(),
    metricIds: z.array(metricIdSchema).min(1).max(33),
    definitionVersion: z
      .string()
      .regex(/^[1-9]\d*$/)
      .default("1"),
    groupBy: z.array(metricGroupingSchema).max(2).default([]),
    sourceId: opaqueSourceIdSchema.optional(),
    campaignHandle: opaqueCampaignHandleSchema.optional(),
    formId: opaqueFormIdSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.metricIds).size !== value.metricIds.length ||
      new Set(value.groupBy).size !== value.groupBy.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Metric IDs and groupings must be unique",
      });
    }
    if (
      value.preset === "custom" &&
      (value.from === undefined || value.to === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["from"],
        message: "Custom ranges require both from and to",
      });
    }
    if (
      value.preset !== "custom" &&
      (value.from !== undefined || value.to !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["from"],
        message: "Preset ranges cannot include custom boundaries",
      });
    }
    if (
      value.preset === "custom" &&
      value.from !== undefined &&
      value.to !== undefined
    ) {
      const from = new Date(
        value.from.length === 10 ? `${value.from}T00:00:00.000Z` : value.from
      );
      const to = new Date(
        value.to.length === 10 ? `${value.to}T00:00:00.000Z` : value.to
      );
      const rangeMilliseconds = to.getTime() - from.getTime();
      if (rangeMilliseconds <= 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["to"],
          message: "The end of a custom range must follow its start",
        });
      }
      if (rangeMilliseconds > 366 * 24 * 60 * 60 * 1000) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["to"],
          message: "A detailed custom range cannot exceed 366 days",
        });
      }
    }
    if (
      value.preset === "lifetime" &&
      value.groupBy.some((group) => group !== "source")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["groupBy"],
        message: "Lifetime supports only ungrouped and source summaries",
      });
    }
    const timeGroups = value.groupBy.filter((group) =>
      ["day", "week", "month"].includes(group)
    );
    const dimensionGroups = value.groupBy.filter((group) =>
      ["source", "campaign", "form"].includes(group)
    );
    if (timeGroups.length > 1 || dimensionGroups.length > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["groupBy"],
        message: "Use at most one time bucket and one source dimension",
      });
    }
  });

export const metricBasisSchema = z.enum([
  "received_cohort",
  "current_snapshot",
  "event_dated",
]);

export const metricUnitSchema = z.enum([
  "count",
  "percent",
  "minutes",
  "currency",
]);

export const metricGroupingValueSchema = z
  .object({
    timeBucket: timestampSchema.nullable().optional(),
    sourceId: opaqueSourceIdSchema.nullable().optional(),
    campaignHandle: opaqueCampaignHandleSchema.nullable().optional(),
    formId: opaqueFormIdSchema.nullable().optional(),
    label: safeLabelSchema.nullable(),
  })
  .strict();

export const metricResultCellSchema = z
  .object({
    metricId: metricIdSchema,
    definitionVersion: z.string().regex(/^[1-9]\d*$/),
    basis: metricBasisSchema,
    population: z.string().min(1).max(500),
    value: z.number().finite().nullable(),
    unit: metricUnitSchema,
    numerator: z.number().finite().nullable(),
    denominator: z.number().finite().nonnegative().nullable(),
    includedCount: z.number().int().nonnegative(),
    missingEvidenceCount: z.number().int().nonnegative(),
    grouping: metricGroupingValueSchema.nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    suppressed: z.boolean(),
    cohortCount: z.number().int().nonnegative(),
    evidenceCoveragePercent: z.number().min(0).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.suppressed && value.value !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Suppressed metric cells cannot expose a value",
      });
    }
    if (value.unit === "currency" && value.currency === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currency"],
        message: "Currency metrics require an ISO currency code",
      });
    }
  });

export const metricsResultSchema = z
  .object({
    from: timestampSchema,
    to: timestampSchema,
    timezone: z.string().min(1).max(100),
    generatedAt: timestampSchema,
    dataThrough: timestampSchema,
    metricDefinitionVersion: z.string().regex(/^[1-9]\d*$/),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    includedMetricIds: z.array(metricIdSchema).min(1).max(33),
    results: z.array(metricResultCellSchema),
  })
  .strict();

export type MetricId = z.infer<typeof metricIdSchema>;
export type MetricQuery = z.infer<typeof metricQuerySchema>;
export type MetricsResult = z.infer<typeof metricsResultSchema>;

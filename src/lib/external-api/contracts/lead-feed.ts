import { z } from "zod";

import {
  DEFAULT_LEAD_FEED_PAGE_SIZE,
  MAX_LEAD_FEED_PAGE_SIZE,
  hostnameSchema,
  minuteTimestampSchema,
  opaqueAttributionHandleSchema,
  opaqueCampaignHandleSchema,
  opaqueCursorSchema,
  opaqueFormIdSchema,
  opaqueLeadIdSchema,
  opaquePathHandleSchema,
  opaqueSourceIdSchema,
  opaqueSyncCheckpointSchema,
  safeLabelSchema,
  timestampSchema,
} from "./common";

export const leadStageSchema = z.enum([
  "new_lead",
  "qualifying",
  "quoting",
  "quoted",
  "follow_up",
  "negotiation",
  "won",
  "lost",
  "discarded",
]);

export const lifecycleDispositionSchema = z.enum([
  "won",
  "lost",
  "disqualified",
  "discarded",
  "converted_to_project",
]);

export const leadRecordStateSchema = z.enum(["active", "archived", "merged"]);

const attributionDimensionSchema = z
  .object({
    present: z.boolean(),
    handle: opaqueAttributionHandleSchema.nullable(),
    label: safeLabelSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.present && value.handle === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["handle"],
        message: "Observed attribution requires a stable opaque handle",
      });
    }
    if (!value.present && (value.handle !== null || value.label !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Absent attribution cannot expose a handle or label",
      });
    }
  });

const campaignDimensionSchema = z
  .object({
    present: z.boolean(),
    handle: opaqueCampaignHandleSchema.nullable(),
    label: safeLabelSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.present && value.handle === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["handle"],
        message: "Observed campaign requires a stable opaque handle",
      });
    }
    if (!value.present && (value.handle !== null || value.label !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Absent campaign cannot expose a handle or label",
      });
    }
  });

const pageCharacteristicSchema = z
  .object({
    host: hostnameSchema,
    pathHandle: opaquePathHandleSchema,
    routeLabel: safeLabelSchema.nullable(),
  })
  .strict();

export const sourceAttributionSchema = z
  .object({
    sourceChannel: z.enum([
      "website",
      "email",
      "referral",
      "phone",
      "social",
      "walk_in",
      "repeat_business",
      "manual",
      "other",
    ]),
    sourceIntegrationType: z.enum([
      "external_intake",
      "email_import",
      "manual",
      "referral",
      "phone",
      "social",
      "walk_in",
      "repeat_business",
      "other",
    ]),
    sourceId: opaqueSourceIdSchema.nullable(),
    sourceLabel: safeLabelSchema.nullable(),
    siteHost: hostnameSchema.nullable(),
    siteLabel: safeLabelSchema.nullable(),
    formId: opaqueFormIdSchema.nullable(),
    formLabel: safeLabelSchema.nullable(),
    campaign: campaignDimensionSchema,
    utm: z
      .object({
        source: attributionDimensionSchema,
        medium: attributionDimensionSchema,
        campaign: attributionDimensionSchema,
        term: attributionDimensionSchema,
        content: attributionDimensionSchema,
      })
      .strict(),
    click: z
      .object({
        providerCode: z
          .enum(["google_ads", "microsoft_ads", "meta_ads", "other"])
          .nullable(),
        captured: z.boolean(),
      })
      .strict(),
    landingPage: pageCharacteristicSchema.nullable(),
    referrer: pageCharacteristicSchema.nullable(),
    inquiryReceivedAt: minuteTimestampSchema,
    leadCreatedAt: minuteTimestampSchema,
    attributionCapturedAt: minuteTimestampSchema,
    timingSource: z.enum([
      "authenticated_request",
      "provider_message",
      "manual",
      "creation_fallback",
    ]),
    timingQuality: z.enum(["exact", "provider_derived", "manual", "fallback"]),
    completeness: z
      .object({
        channelKnown: z.boolean(),
        authenticatedSite: z.boolean(),
        configuredForm: z.boolean(),
        campaignObserved: z.boolean(),
        utmSetObserved: z.boolean(),
        landingPageObserved: z.boolean(),
        referrerObserved: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const lifecycleReachedSchema = z
  .object({
    qualifying: z.boolean(),
    quoting: z.boolean(),
    quoted: z.boolean(),
    followUp: z.boolean(),
    negotiation: z.boolean(),
    won: z.boolean(),
    lost: z.boolean(),
    projectConverted: z.boolean(),
  })
  .strict();

export const leadFinancialSchema = z
  .object({
    estimatedLeadValue: z.number().finite().nonnegative().nullable(),
    wonValue: z.number().finite().nonnegative().nullable(),
    invoicedTotal: z.number().finite().nonnegative(),
    paidTotal: z.number().finite().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();

const upsertLeadProjectionSchema = z
  .object({
    operation: z.enum(["upsert", "merge"]),
    publicLeadId: opaqueLeadIdSchema,
    inquiryReceivedAt: minuteTimestampSchema,
    createdAt: minuteTimestampSchema,
    updatedAt: minuteTimestampSchema,
    currentStageEnteredAt: minuteTimestampSchema,
    terminalAt: minuteTimestampSchema.nullable(),
    currentStage: leadStageSchema,
    disposition: lifecycleDispositionSchema.nullable(),
    recordState: leadRecordStateSchema,
    mergeTargetPublicLeadId: opaqueLeadIdSchema.nullable(),
    source: sourceAttributionSchema,
    firstResponseAt: minuteTimestampSchema.nullable(),
    firstResponseMinutes: z.number().int().nonnegative().nullable(),
    wonAt: minuteTimestampSchema.nullable(),
    lostAt: minuteTimestampSchema.nullable(),
    disqualifiedAt: minuteTimestampSchema.nullable(),
    discardedAt: minuteTimestampSchema.nullable(),
    projectConvertedAt: minuteTimestampSchema.nullable(),
    minutesToDecision: z.number().int().nonnegative().nullable(),
    minutesToWin: z.number().int().nonnegative().nullable(),
    minutesToProjectConversion: z.number().int().nonnegative().nullable(),
    reached: lifecycleReachedSchema,
    financial: leadFinancialSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.recordState === "merged" &&
      value.mergeTargetPublicLeadId === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mergeTargetPublicLeadId"],
        message: "Merged leads require a public merge target",
      });
    }
    if (
      value.recordState !== "merged" &&
      value.mergeTargetPublicLeadId !== null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mergeTargetPublicLeadId"],
        message: "Only merged leads expose a merge target",
      });
    }
  });

export const deletionTombstoneSchema = z
  .object({
    operation: z.literal("delete"),
    publicLeadId: opaqueLeadIdSchema,
    deletedAt: minuteTimestampSchema,
  })
  .strict();

export const leadProjectionSchema = z.union([
  upsertLeadProjectionSchema,
  deletionTombstoneSchema,
]);

export function serializeLeadProjection(
  input: unknown
): z.infer<typeof leadProjectionSchema> {
  return leadProjectionSchema.parse(input);
}

export const leadFeedFiltersSchema = z
  .object({
    inquiryReceivedFrom: timestampSchema.optional(),
    inquiryReceivedTo: timestampSchema.optional(),
    updatedFrom: timestampSchema.optional(),
    updatedTo: timestampSchema.optional(),
    sourceId: opaqueSourceIdSchema.optional(),
    campaignHandle: opaqueCampaignHandleSchema.optional(),
    formId: opaqueFormIdSchema.optional(),
    stage: z.array(leadStageSchema).min(1).max(9).optional(),
    disposition: z.array(lifecycleDispositionSchema).min(1).max(5).optional(),
    recordState: z.array(leadRecordStateSchema).min(1).max(3).optional(),
  })
  .strict();

export const leadFeedQuerySchema = z
  .object({
    mode: z.enum(["full", "incremental"]).default("full"),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(MAX_LEAD_FEED_PAGE_SIZE)
      .default(DEFAULT_LEAD_FEED_PAGE_SIZE),
    cursor: opaqueCursorSchema.optional(),
    syncCheckpoint: opaqueSyncCheckpointSchema.optional(),
    filters: leadFeedFiltersSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === "incremental" && value.syncCheckpoint === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["syncCheckpoint"],
        message: "Incremental sync requires a committed checkpoint",
      });
    }
    if (value.mode === "incremental" && value.filters !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filters"],
        message: "Incremental sync cannot use business-field filters",
      });
    }
    if (value.mode === "full" && value.syncCheckpoint !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["syncCheckpoint"],
        message: "Full sync cannot accept an incremental checkpoint",
      });
    }
  });

export const leadFeedResultSchema = z
  .object({
    mode: z.enum(["full", "incremental"]),
    dataThrough: timestampSchema,
    items: z.array(leadProjectionSchema).max(MAX_LEAD_FEED_PAGE_SIZE),
    nextCursor: opaqueCursorSchema.nullable(),
    nextSyncCheckpoint: opaqueSyncCheckpointSchema.nullable(),
  })
  .strict();

export type SourceAttribution = z.infer<typeof sourceAttributionSchema>;
export type LeadProjection = z.infer<typeof leadProjectionSchema>;
export type LeadFeedQuery = z.infer<typeof leadFeedQuerySchema>;
export type LeadFeedResult = z.infer<typeof leadFeedResultSchema>;

import { z } from "zod";

import {
  EXTERNAL_API_VERSION,
  MAX_ANSWER_COUNT,
  MAX_FILE_BYTES,
  MAX_FILES_PER_BATCH,
  MAX_JSON_BODY_BYTES,
  MAX_UPLOAD_BATCH_BYTES,
  dateOnlySchema,
  hostnameSchema,
  httpUrlSchema,
  httpsUrlSchema,
  isoCountryCodeSchema,
  opaqueEmailCorrelationMarkerSchema,
  opaqueFormIdSchema,
  opaqueLeadIdSchema,
  opaqueSourceIdSchema,
  opaqueSubmissionIdSchema,
  opaqueUploadIdSchema,
  safeKeySchema,
  safeLabelSchema,
  timestampSchema,
} from "./common";

export const acceptedUploadContentTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/vnd.dwg",
  "image/vnd.dxf",
  "application/acad",
  "application/dxf",
]);

export const intakeFormSchema = z
  .object({
    formId: opaqueFormIdSchema,
    label: safeLabelSchema,
    isDefault: z.boolean(),
  })
  .strict();

export const intakeSourceConfigSchema = z
  .object({
    sourceId: opaqueSourceIdSchema,
    label: safeLabelSchema,
    canonicalSiteHost: hostnameSchema,
    defaultPhoneRegion: isoCountryCodeSchema,
    defaultOwnerConfigured: z.boolean(),
    forms: z.array(intakeFormSchema).min(1).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.forms.filter((form) => form.isDefault).length !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["forms"],
        message: "Exactly one default form is required",
      });
    }
  });

export const acceptedFilePolicySchema = z
  .object({
    contentTypes: z.array(acceptedUploadContentTypeSchema).min(1),
    maxFiles: z.literal(MAX_FILES_PER_BATCH),
    maxFileBytes: z.literal(MAX_FILE_BYTES),
    maxBatchBytes: z.literal(MAX_UPLOAD_BATCH_BYTES),
  })
  .strict();

export const intakeConfigResultSchema = z
  .object({
    contractVersion: z.literal(EXTERNAL_API_VERSION),
    sources: z.array(intakeSourceConfigSchema).max(100),
    acceptedFilePolicy: acceptedFilePolicySchema,
    requestLimits: z
      .object({
        maxJsonBodyBytes: z.literal(MAX_JSON_BODY_BYTES),
        maxAnswers: z.literal(MAX_ANSWER_COUNT),
      })
      .strict(),
  })
  .strict();

const safeFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !/[\u0000-\u001f\u007f/\\]/.test(value) &&
      value !== "." &&
      value !== "..",
    "Filename must not contain control characters or path separators"
  );

export const uploadFileMetadataSchema = z
  .object({
    callerFileId: safeKeySchema,
    filename: safeFilenameSchema,
    sizeBytes: z.number().int().positive().max(MAX_FILE_BYTES),
    contentType: acceptedUploadContentTypeSchema,
    sha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional(),
  })
  .strict();

export const uploadBatchRequestSchema = z
  .object({
    sourceId: opaqueSourceIdSchema,
    formId: opaqueFormIdSchema,
    files: z.array(uploadFileMetadataSchema).min(1).max(MAX_FILES_PER_BATCH),
  })
  .strict()
  .superRefine((value, context) => {
    const callerIds = value.files.map((file) => file.callerFileId);
    if (new Set(callerIds).size !== callerIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: "Caller file IDs must be unique within a batch",
      });
    }
    const totalBytes = value.files.reduce(
      (sum, file) => sum + file.sizeBytes,
      0
    );
    if (totalBytes > MAX_UPLOAD_BATCH_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: "Upload batch exceeds the total byte limit",
      });
    }
  });

export const uploadCapabilitySchema = z
  .object({
    method: z.literal("PUT"),
    url: httpsUrlSchema,
    expiresAt: timestampSchema,
    requiredHeaders: z
      .object({
        contentType: acceptedUploadContentTypeSchema,
        contentLength: z.number().int().positive().max(MAX_FILE_BYTES),
        ifNoneMatch: z.literal("*"),
      })
      .strict(),
  })
  .strict();

const issuedUploadSchema = z
  .object({
    callerFileId: safeKeySchema,
    uploadId: opaqueUploadIdSchema,
    state: z.literal("issued"),
    capability: uploadCapabilitySchema,
  })
  .strict();

const uploadedUploadSchema = z
  .object({
    callerFileId: safeKeySchema,
    uploadId: opaqueUploadIdSchema,
    state: z.literal("uploaded"),
    capability: z.null(),
  })
  .strict();

const unavailableUploadSchema = z
  .object({
    callerFileId: safeKeySchema,
    uploadId: opaqueUploadIdSchema.nullable(),
    state: z.enum(["rejected", "expired"]),
    capability: z.null().optional(),
    safeCode: safeKeySchema,
  })
  .strict();

export const uploadIntentResultSchema = z.union([
  issuedUploadSchema,
  uploadedUploadSchema,
  unavailableUploadSchema,
]);

export const uploadBatchResultSchema = z
  .object({
    replayed: z.boolean(),
    uploads: z.array(uploadIntentResultSchema).min(1).max(MAX_FILES_PER_BATCH),
  })
  .strict();

const answerBase = {
  fieldKey: safeKeySchema,
  label: safeLabelSchema,
};

const stringAnswerSchema = z
  .object({
    ...answerBase,
    type: z.literal("string"),
    value: z.string().max(10_000),
  })
  .strict();
const numberAnswerSchema = z
  .object({
    ...answerBase,
    type: z.literal("number"),
    value: z.number().finite(),
  })
  .strict();
const booleanAnswerSchema = z
  .object({
    ...answerBase,
    type: z.literal("boolean"),
    value: z.boolean(),
  })
  .strict();
const dateAnswerSchema = z
  .object({
    ...answerBase,
    type: z.literal("date"),
    value: dateOnlySchema,
  })
  .strict();
const choiceAnswerSchema = z
  .object({
    ...answerBase,
    type: z.literal("single_choice"),
    value: z.string().max(500),
  })
  .strict();
const stringListAnswerSchema = z
  .object({
    ...answerBase,
    type: z.literal("string_list"),
    value: z.array(z.string().max(500)).max(50),
  })
  .strict();

export const intakeAnswerSchema = z.discriminatedUnion("type", [
  stringAnswerSchema,
  numberAnswerSchema,
  booleanAnswerSchema,
  dateAnswerSchema,
  choiceAnswerSchema,
  stringListAnswerSchema,
]);

export const intakeAttributionInputSchema = z
  .object({
    utmSource: z.string().max(512).optional(),
    utmMedium: z.string().max(512).optional(),
    utmCampaign: z.string().max(512).optional(),
    utmTerm: z.string().max(512).optional(),
    utmContent: z.string().max(512).optional(),
    externalCampaignId: z.string().max(512).optional(),
    clickProviderCode: z
      .enum(["google_ads", "microsoft_ads", "meta_ads", "other"])
      .optional(),
    clickId: z.string().max(1024).optional(),
    landingPageUrl: httpUrlSchema.optional(),
    referrerUrl: httpUrlSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.clickId !== undefined && value.clickProviderCode === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clickProviderCode"],
        message: "A click provider is required when a click ID is supplied",
      });
    }
  });

export const contactInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.string().email().max(320).optional(),
    phone: z.string().trim().min(3).max(40).optional(),
    organizationName: z.string().trim().min(1).max(200).optional(),
    phoneRegion: isoCountryCodeSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.email === undefined && value.phone === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "At least one reply method is required",
      });
    }
  });

export const serviceAddressInputSchema = z
  .object({
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(120),
    region: z.string().trim().min(1).max(120),
    postalCode: z.string().trim().min(1).max(32),
    countryCode: isoCountryCodeSchema,
  })
  .strict();

export const submissionRequestSchema = z
  .object({
    sourceId: opaqueSourceIdSchema,
    formId: opaqueFormIdSchema,
    contact: contactInputSchema,
    serviceAddress: serviceAddressInputSchema.optional(),
    workSummary: z.string().trim().max(20_000).optional(),
    preferredTiming: z.string().trim().max(1_000).optional(),
    answers: z.array(intakeAnswerSchema).max(MAX_ANSWER_COUNT).default([]),
    attribution: intakeAttributionInputSchema.optional(),
    uploadIds: z
      .array(opaqueUploadIdSchema)
      .max(MAX_FILES_PER_BATCH)
      .default([]),
    externalSubmissionId: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[^\u0000-\u001f\u007f]+$/)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const answerKeys = value.answers.map((answer) => answer.fieldKey);
    if (new Set(answerKeys).size !== answerKeys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["answers"],
        message: "Answer field keys must be unique",
      });
    }
    if (new Set(value.uploadIds).size !== value.uploadIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["uploadIds"],
        message: "Upload IDs must be unique",
      });
    }
  });

export const attachmentStateSchema = z.enum([
  "accepted",
  "pending_inspection",
  "rejected",
  "missing",
  "expired",
]);

export const attachmentResultSchema = z
  .object({
    uploadId: opaqueUploadIdSchema,
    callerFileId: safeKeySchema,
    state: attachmentStateSchema,
    safeCode: safeKeySchema.nullable(),
  })
  .strict();

export const customerOutcomeSchema = z.enum([
  "created",
  "matched",
  "created_possible_duplicate",
]);

export const initialLeadStageSchema = z.literal("new_lead");

export const submissionResultSchema = z
  .object({
    publicSubmissionId: opaqueSubmissionIdSchema,
    publicLeadId: opaqueLeadIdSchema,
    customerOutcome: customerOutcomeSchema,
    leadCreatedAt: timestampSchema,
    initialLeadStage: initialLeadStageSchema,
    attachments: z.array(attachmentResultSchema).max(MAX_FILES_PER_BATCH),
    emailCorrelationMarker: opaqueEmailCorrelationMarkerSchema.optional(),
    replayed: z.boolean(),
  })
  .strict();

export const submissionStatusResultSchema = z
  .object({
    publicSubmissionId: opaqueSubmissionIdSchema,
    publicLeadId: opaqueLeadIdSchema,
    createdAt: timestampSchema,
    customerOutcome: customerOutcomeSchema,
    attachments: z.array(attachmentResultSchema).max(MAX_FILES_PER_BATCH),
    attachmentProcessingTerminal: z.boolean(),
    pollAfterSeconds: z.number().int().min(5).max(300).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.attachmentProcessingTerminal && value.pollAfterSeconds !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pollAfterSeconds"],
        message: "Terminal submissions do not require polling",
      });
    }
    if (
      !value.attachmentProcessingTerminal &&
      value.pollAfterSeconds === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pollAfterSeconds"],
        message: "Pending submissions require bounded polling guidance",
      });
    }
  });

export type IntakeConfigResult = z.infer<typeof intakeConfigResultSchema>;
export type UploadBatchRequest = z.infer<typeof uploadBatchRequestSchema>;
export type UploadBatchResult = z.infer<typeof uploadBatchResultSchema>;
export type SubmissionRequest = z.infer<typeof submissionRequestSchema>;
export type SubmissionResult = z.infer<typeof submissionResultSchema>;
export type SubmissionStatusResult = z.infer<
  typeof submissionStatusResultSchema
>;

import { z } from "zod";

import {
  EXTERNAL_API_VERSION,
  opaqueUploadIdSchema,
  safeKeySchema,
  timestampSchema,
} from "../contracts/common";
import {
  type ExternalApiErrorCode,
  externalApiErrorCodeSchema,
  externalApiErrorDefinitions,
} from "../contracts/errors";
import {
  intakeConfigResultSchema,
  submissionResultSchema,
  submissionStatusResultSchema,
  uploadBatchResultSchema,
} from "../contracts/intake";
import { leadFeedResultSchema } from "../contracts/lead-feed";
import { metricQuerySchema, metricsResultSchema } from "../contracts/metrics";
import { externalRequestIdSchema } from "./request-id";

export const INTAKE_CACHE_CONTROL = "no-store" as const;
export const ANALYTICS_SHORT_CACHE_CONTROL =
  "private, max-age=60, must-revalidate" as const;
export const ANALYTICS_LONG_CACHE_CONTROL =
  "private, max-age=300, must-revalidate" as const;
export const externalApiCacheControlSchema = z.enum([
  INTAKE_CACHE_CONTROL,
  ANALYTICS_SHORT_CACHE_CONTROL,
  ANALYTICS_LONG_CACHE_CONTROL,
]);

const responseMetadataShape = {
  requestId: externalRequestIdSchema,
  apiVersion: z.literal(EXTERNAL_API_VERSION),
  serverTimestamp: timestampSchema,
};

const unsafeDetailFieldPattern =
  /(?:authorization|credential|secret|token|body|signed.?url|storage)/i;

export const errorDetailReasonSchema = z.enum([
  "invalid",
  "required",
  "unknown_field",
  "out_of_range",
  "too_many_items",
  "unsupported_content_type",
  "body_missing",
  "body_too_large",
  "invalid_utf8",
  "malformed_json",
  "validation_failed",
  "duplicate",
  "not_allowed",
  "not_found",
  "expired",
  "batch_expired",
  "conflict",
  "rejected",
  "inspection_unavailable",
  "size_mismatch",
  "checksum_mismatch",
  "content_type_mismatch",
  "unsafe_content",
  "rate_limited",
  "temporarily_unavailable",
]);

export const errorDetailSchema = z
  .object({
    field: safeKeySchema.optional(),
    fileId: safeKeySchema.or(opaqueUploadIdSchema).optional(),
    reason: errorDetailReasonSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.field && unsafeDetailFieldPattern.test(value.field)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["field"],
        message: "Sensitive fields cannot appear in external error details",
      });
    }
  });

export const errorEnvelopeSchema = z
  .object({
    ...responseMetadataShape,
    error: z
      .object({
        status: z.number().int().min(400).max(599),
        code: externalApiErrorCodeSchema,
        message: z.string().min(1).max(240),
        details: z.array(errorDetailSchema).max(100),
      })
      .strict(),
  })
  .strict();

export function successEnvelopeSchema<T extends z.ZodTypeAny>(resultSchema: T) {
  return z
    .object({
      ...responseMetadataShape,
      result: resultSchema,
    })
    .strict();
}

const responseOptionsSchema = z
  .object({
    requestId: externalRequestIdSchema,
    serverTimestamp: timestampSchema.optional(),
  })
  .strict();

export type ExternalResponseOptions = z.input<typeof responseOptionsSchema>;

function responseHeaders(
  requestId: string,
  cacheControl: z.infer<typeof externalApiCacheControlSchema>
): Headers {
  return new Headers({
    "cache-control": cacheControl,
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-request-id": requestId,
  });
}

function createSuccessResponse<T extends z.ZodTypeAny>(
  input: unknown,
  resultSchema: T,
  optionsInput: ExternalResponseOptions,
  status: number,
  cacheControl: z.infer<typeof externalApiCacheControlSchema>
): Response {
  const options = responseOptionsSchema.parse(optionsInput);
  const envelope = successEnvelopeSchema(resultSchema).parse({
    requestId: options.requestId,
    apiVersion: EXTERNAL_API_VERSION,
    serverTimestamp: options.serverTimestamp ?? new Date().toISOString(),
    result: input,
  });
  return new Response(JSON.stringify(envelope), {
    status,
    headers: responseHeaders(envelope.requestId, cacheControl),
  });
}

export function createIntakeConfigResponse(
  input: unknown,
  options: ExternalResponseOptions
): Response {
  return createSuccessResponse(
    input,
    intakeConfigResultSchema,
    options,
    200,
    INTAKE_CACHE_CONTROL
  );
}

export function createUploadBatchResponse(
  input: unknown,
  options: ExternalResponseOptions
): Response {
  const result = uploadBatchResultSchema.parse(input);
  return createSuccessResponse(
    result,
    uploadBatchResultSchema,
    options,
    result.replayed ? 200 : 201,
    INTAKE_CACHE_CONTROL
  );
}

export function createSubmissionResponse(
  input: unknown,
  options: ExternalResponseOptions
): Response {
  const result = submissionResultSchema.parse(input);
  return createSuccessResponse(
    result,
    submissionResultSchema,
    options,
    result.replayed ? 200 : 201,
    INTAKE_CACHE_CONTROL
  );
}

export function createSubmissionStatusResponse(
  input: unknown,
  options: ExternalResponseOptions
): Response {
  return createSuccessResponse(
    input,
    submissionStatusResultSchema,
    options,
    200,
    INTAKE_CACHE_CONTROL
  );
}

export function createLeadFeedResponse(
  input: unknown,
  options: ExternalResponseOptions
): Response {
  return createSuccessResponse(
    input,
    leadFeedResultSchema,
    options,
    200,
    ANALYTICS_SHORT_CACHE_CONTROL
  );
}

function timestampMilliseconds(value: string): number {
  return new Date(
    value.length === 10 ? `${value}T00:00:00.000Z` : value
  ).getTime();
}

export function metricsCacheControlForQuery(
  input: unknown
): z.infer<typeof externalApiCacheControlSchema> {
  const query = metricQuerySchema.parse(input);
  if (query.preset === "90d" || query.preset === "lifetime") {
    return ANALYTICS_LONG_CACHE_CONTROL;
  }
  if (
    query.preset === "custom" &&
    query.from !== undefined &&
    query.to !== undefined &&
    timestampMilliseconds(query.to) - timestampMilliseconds(query.from) >=
      90 * 24 * 60 * 60 * 1000
  ) {
    return ANALYTICS_LONG_CACHE_CONTROL;
  }
  return ANALYTICS_SHORT_CACHE_CONTROL;
}

export function createMetricsResponse(
  input: unknown,
  queryInput: unknown,
  options: ExternalResponseOptions
): Response {
  return createSuccessResponse(
    input,
    metricsResultSchema,
    options,
    200,
    metricsCacheControlForQuery(queryInput)
  );
}

const errorResponseOptionsSchema = responseOptionsSchema.extend({
  details: z.array(errorDetailSchema).max(100).optional(),
});

export type ErrorResponseOptions = z.input<typeof errorResponseOptionsSchema>;

export function createErrorResponse(
  code: ExternalApiErrorCode,
  optionsInput: ErrorResponseOptions
): Response {
  const options = errorResponseOptionsSchema.parse(optionsInput);
  const definition = externalApiErrorDefinitions[code];
  const envelope = errorEnvelopeSchema.parse({
    requestId: options.requestId,
    apiVersion: EXTERNAL_API_VERSION,
    serverTimestamp: options.serverTimestamp ?? new Date().toISOString(),
    error: {
      status: definition.status,
      code,
      message: definition.message,
      details: options.details ?? [],
    },
  });
  return new Response(JSON.stringify(envelope), {
    status: definition.status,
    headers: responseHeaders(envelope.requestId, INTAKE_CACHE_CONTROL),
  });
}

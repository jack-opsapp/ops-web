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

export const errorDetailSchema = z
  .object({
    field: safeKeySchema.optional(),
    fileId: safeKeySchema.or(opaqueUploadIdSchema).optional(),
    reason: safeKeySchema,
    message: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value))
      .optional(),
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

type ResponseOptions = Readonly<{
  requestId: string;
  serverTimestamp?: string;
  cacheControl?: z.infer<typeof externalApiCacheControlSchema>;
  status?: number;
}>;

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

export function createSuccessResponse<T extends z.ZodTypeAny>(
  input: unknown,
  resultSchema: T,
  options: ResponseOptions
): Response {
  const cacheControl = externalApiCacheControlSchema.parse(
    options.cacheControl ?? INTAKE_CACHE_CONTROL
  );
  const status = z
    .number()
    .int()
    .min(200)
    .max(299)
    .parse(options.status ?? 200);
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

type ErrorResponseOptions = Readonly<{
  requestId: string;
  serverTimestamp?: string;
  details?: readonly unknown[];
}>;

export function createErrorResponse(
  code: ExternalApiErrorCode,
  options: ErrorResponseOptions
): Response {
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

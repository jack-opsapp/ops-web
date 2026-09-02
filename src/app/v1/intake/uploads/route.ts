import { z } from "zod";

import {
  idempotencyKeySchema,
  MAX_JSON_BODY_BYTES,
} from "@/lib/external-api/contracts/common";
import { uploadBatchRequestSchema } from "@/lib/external-api/contracts/intake";
import { decodeOpaqueUuid } from "@/lib/external-api/contracts/opaque-id";
import { createExternalApiRequestBoundary } from "@/lib/external-api/http/boundary";
import { readBoundedJson } from "@/lib/external-api/http/request-body";
import { createUploadBatchResponse } from "@/lib/external-api/http/responses";
import { createExternalUploadBatch } from "@/lib/external-api/uploads/upload-service";

const originHeaderSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        url.origin === value
      );
    } catch {
      return false;
    }
  });

const routeUploadBatchRequestSchema = uploadBatchRequestSchema.superRefine(
  (value, context) => {
    try {
      decodeOpaqueUuid(value.sourceId, "src");
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceId"],
        message: "Source identifier is invalid",
      });
    }
    try {
      decodeOpaqueUuid(value.formId, "frm");
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formId"],
        message: "Form identifier is invalid",
      });
    }
  }
);

const parseRequest = async (request: Request) => {
  const batch = await readBoundedJson(
    request,
    routeUploadBatchRequestSchema,
    MAX_JSON_BODY_BYTES
  );
  const idempotencyKey = idempotencyKeySchema.parse(
    request.headers.get("idempotency-key")
  );
  const origin = request.headers.get("origin");
  return {
    batch,
    idempotencyKey,
    requestedOrigin: origin === null ? null : originHeaderSchema.parse(origin),
  };
};

export const POST = createExternalApiRequestBoundary({
  route: "/v1/intake/uploads",
  method: "POST",
  requiredCredentialClass: "intake",
  requiredScopes: ["intake.write"],
  parseRequest,
  async handler(context) {
    const result = await createExternalUploadBatch({
      actor: context.actor,
      auditRequestId: context.auditRequestId,
      requestReceivedAt: context.requestReceivedAt,
      idempotencyKey: context.input.idempotencyKey,
      requestedOrigin: context.input.requestedOrigin,
      batch: context.input.batch,
    });
    return {
      result: result.result,
      auditBase: result.auditBase,
      audit: {
        outcome: "accepted",
        idempotencyResult: result.idempotencyResult,
        cacheResult: "not_applicable",
        metricSet: [],
        grouping: [],
        resultSize: result.result.uploads.length,
      },
    };
  },
  createResponse: createUploadBatchResponse,
});

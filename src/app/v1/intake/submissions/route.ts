import { after } from "next/server";
import { z } from "zod";

import {
  idempotencyKeySchema,
  MAX_JSON_BODY_BYTES,
} from "@/lib/external-api/contracts/common";
import { submissionRequestSchema } from "@/lib/external-api/contracts/intake";
import { createExternalApiRequestBoundary } from "@/lib/external-api/http/boundary";
import { readBoundedJson } from "@/lib/external-api/http/request-body";
import { createSubmissionResponse } from "@/lib/external-api/http/responses";
import { processExternalIntakeOutboxBatch } from "@/lib/external-api/intake/outbox-worker";
import { createExternalIntakeSubmission } from "@/lib/external-api/intake/submission-service";

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

const parseRequest = async (request: Request) => {
  const submission = await readBoundedJson(
    request,
    submissionRequestSchema,
    MAX_JSON_BODY_BYTES
  );
  const idempotencyKey = idempotencyKeySchema.parse(
    request.headers.get("idempotency-key")
  );
  const origin = request.headers.get("origin");
  return {
    submission,
    idempotencyKey,
    requestedOrigin: origin === null ? null : originHeaderSchema.parse(origin),
  };
};

export const POST = createExternalApiRequestBoundary({
  route: "/v1/intake/submissions",
  method: "POST",
  requiredCredentialClass: "intake",
  requiredScopes: ["intake.write"],
  parseRequest,
  async handler(context) {
    const submitted = await createExternalIntakeSubmission({
      actor: context.actor,
      auditRequestId: context.auditRequestId,
      requestReceivedAt: context.requestReceivedAt,
      idempotencyKey: context.input.idempotencyKey,
      requestedOrigin: context.input.requestedOrigin,
      submission: context.input.submission,
    });
    after(async () => {
      try {
        await processExternalIntakeOutboxBatch({
          limit: 5,
          workerId: `submission:${context.auditRequestId}`,
        });
      } catch {
        console.error("External intake outbox dispatch failed");
      }
    });
    return {
      result: submitted.result,
      auditBase: submitted.auditBase,
      audit: {
        outcome: "accepted",
        idempotencyResult: submitted.idempotencyResult,
        cacheResult: "not_applicable",
        metricSet: [],
        grouping: [],
        resultSize: 1,
      },
    };
  },
  createResponse: createSubmissionResponse,
});

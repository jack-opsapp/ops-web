import { opaqueSubmissionIdSchema } from "@/lib/external-api/contracts/common";
import { createExternalApiRequestBoundary } from "@/lib/external-api/http/boundary";
import { createSubmissionStatusResponse } from "@/lib/external-api/http/responses";
import { getExternalIntakeSubmissionStatus } from "@/lib/external-api/intake/status-service";

const parseRequest = async (request: Request) => {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  return {
    publicSubmissionId: opaqueSubmissionIdSchema.parse(segments.at(-1)),
  };
};

export const GET = createExternalApiRequestBoundary({
  route: "/v1/intake/submissions/{publicSubmissionId}",
  method: "GET",
  requiredCredentialClass: "intake",
  requiredScopes: ["intake.write"],
  parseRequest,
  async handler(context) {
    const status = await getExternalIntakeSubmissionStatus({
      actor: context.actor,
      auditRequestId: context.auditRequestId,
      requestReceivedAt: context.requestReceivedAt,
      publicSubmissionId: context.input.publicSubmissionId,
    });
    return {
      result: status.result,
      auditBase: status.auditBase,
      audit: {
        outcome: "accepted",
        idempotencyResult: "not_applicable",
        cacheResult: "not_applicable",
        metricSet: [],
        grouping: [],
        resultSize: 1,
      },
    };
  },
  createResponse: createSubmissionStatusResponse,
});

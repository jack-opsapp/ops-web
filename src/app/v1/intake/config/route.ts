import { getExternalIntakeConfig } from "@/lib/external-api/intake/config-service";
import { createExternalApiRequestBoundary } from "@/lib/external-api/http/boundary";
import { createIntakeConfigResponse } from "@/lib/external-api/http/responses";

export const GET = createExternalApiRequestBoundary({
  route: "/v1/intake/config",
  method: "GET",
  requiredCredentialClass: "intake",
  requiredScopes: ["intake.write"],
  parseRequest: async () => undefined,
  async handler(context) {
    const configured = await getExternalIntakeConfig({
      actor: context.actor,
      auditRequestId: context.auditRequestId,
      requestReceivedAt: context.requestReceivedAt,
    });
    return {
      result: configured.result,
      auditBase: configured.auditBase,
      audit: {
        outcome: "accepted",
        idempotencyResult: "not_applicable",
        cacheResult: "not_applicable",
        metricSet: [],
        grouping: [],
        resultSize: configured.result.sources.length,
      },
    };
  },
  createResponse: createIntakeConfigResponse,
});

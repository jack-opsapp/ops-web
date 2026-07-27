import { z } from "zod";

import { getExternalLeadMetrics } from "@/lib/external-api/analytics/metrics-service";
import { metricQuerySchema } from "@/lib/external-api/contracts/metrics";
import { createExternalApiRequestBoundary } from "@/lib/external-api/http/boundary";
import { createMetricsResponse } from "@/lib/external-api/http/responses";

const scalarParameters = new Set([
  "preset",
  "from",
  "to",
  "definition_version",
  "source_id",
  "campaign_handle",
  "form_id",
]);
const arrayParameters = new Set(["metric", "group_by"]);
const allowedParameters = new Set([...scalarParameters, ...arrayParameters]);

function optionalScalar(parameters: URLSearchParams, key: string) {
  const values = parameters.getAll(key);
  z.array(z.string()).max(1).parse(values);
  return values[0];
}

const parseRequest = async (request: Request) => {
  const parameters = new URL(request.url).searchParams;
  const unknown = [...new Set(parameters.keys())].filter(
    (key) => !allowedParameters.has(key)
  );
  z.array(z.never()).parse(unknown);
  for (const key of scalarParameters) optionalScalar(parameters, key);

  return metricQuerySchema.parse({
    preset: optionalScalar(parameters, "preset"),
    from: optionalScalar(parameters, "from"),
    to: optionalScalar(parameters, "to"),
    definitionVersion: optionalScalar(parameters, "definition_version"),
    metricIds: parameters.getAll("metric"),
    groupBy: parameters.getAll("group_by"),
    sourceId: optionalScalar(parameters, "source_id"),
    campaignHandle: optionalScalar(parameters, "campaign_handle"),
    formId: optionalScalar(parameters, "form_id"),
  });
};

export const GET = createExternalApiRequestBoundary({
  route: "/v1/analytics/metrics",
  method: "GET",
  requiredCredentialClass: "analytics",
  requiredScopes: ["analytics.leads.read"],
  parseRequest,
  async handler(context) {
    const metrics = await getExternalLeadMetrics({
      actor: context.actor,
      auditRequestId: context.auditRequestId,
      requestReceivedAt: context.requestReceivedAt,
      query: context.input,
    });
    return {
      result: { body: metrics.result, query: context.input },
      auditBase: metrics.auditBase,
      audit: {
        outcome: "accepted",
        idempotencyResult: "not_applicable",
        cacheResult: metrics.cacheResult,
        metricSet: context.input.metricIds,
        grouping: context.input.groupBy,
        resultSize: metrics.result.results.length,
      },
    };
  },
  createResponse(value, options) {
    return createMetricsResponse(value.body, value.query, options);
  },
});

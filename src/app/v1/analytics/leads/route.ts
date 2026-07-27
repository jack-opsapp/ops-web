import { z } from "zod";

import { getExternalLeadFeed } from "@/lib/external-api/analytics/lead-feed-service";
import { leadFeedQuerySchema } from "@/lib/external-api/contracts/lead-feed";
import { createExternalApiRequestBoundary } from "@/lib/external-api/http/boundary";
import { createLeadFeedResponse } from "@/lib/external-api/http/responses";

const scalarParameters = new Set([
  "mode",
  "page_size",
  "cursor",
  "sync_checkpoint",
  "inquiry_received_from",
  "inquiry_received_to",
  "updated_from",
  "updated_to",
  "source_id",
  "campaign_handle",
  "form_id",
]);
const arrayParameters = new Set(["stage", "disposition", "record_state"]);
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

  const filters = {
    inquiryReceivedFrom: optionalScalar(parameters, "inquiry_received_from"),
    inquiryReceivedTo: optionalScalar(parameters, "inquiry_received_to"),
    updatedFrom: optionalScalar(parameters, "updated_from"),
    updatedTo: optionalScalar(parameters, "updated_to"),
    sourceId: optionalScalar(parameters, "source_id"),
    campaignHandle: optionalScalar(parameters, "campaign_handle"),
    formId: optionalScalar(parameters, "form_id"),
    stage: parameters.getAll("stage"),
    disposition: parameters.getAll("disposition"),
    recordState: parameters.getAll("record_state"),
  };
  const compactFilters = Object.fromEntries(
    Object.entries(filters).filter(
      ([, value]) =>
        value !== undefined && (!Array.isArray(value) || value.length > 0)
    )
  );

  return leadFeedQuerySchema.parse({
    mode: optionalScalar(parameters, "mode"),
    pageSize:
      optionalScalar(parameters, "page_size") === undefined
        ? undefined
        : Number(optionalScalar(parameters, "page_size")),
    cursor: optionalScalar(parameters, "cursor"),
    syncCheckpoint: optionalScalar(parameters, "sync_checkpoint"),
    filters:
      Object.keys(compactFilters).length === 0 ? undefined : compactFilters,
  });
};

export const GET = createExternalApiRequestBoundary({
  route: "/v1/analytics/leads",
  method: "GET",
  requiredCredentialClass: "analytics",
  requiredScopes: ["analytics.leads.read"],
  parseRequest,
  async handler(context) {
    const feed = await getExternalLeadFeed({
      actor: context.actor,
      auditRequestId: context.auditRequestId,
      requestReceivedAt: context.requestReceivedAt,
      query: context.input,
    });
    return {
      result: feed.result,
      auditBase: feed.auditBase,
      audit: {
        outcome: "accepted",
        idempotencyResult: "not_applicable",
        cacheResult: feed.cacheResult,
        metricSet: [],
        grouping: [],
        resultSize: feed.result.items.length,
      },
    };
  },
  createResponse: createLeadFeedResponse,
});

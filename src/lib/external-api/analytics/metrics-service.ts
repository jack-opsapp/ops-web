import "server-only";

import { z } from "zod";

import { getServiceRoleClient } from "@/lib/supabase/server-client";

import type { ExternalApiRequestActor } from "../auth/credential-auth";
import { EXTERNAL_API_VERSION } from "../contracts/common";
import { ExternalApiSafeError } from "../contracts/errors";
import { type MetricQuery, metricsResultSchema } from "../contracts/metrics";
import { commitExternalApiAuditBase } from "../security/audit";
import {
  financialMetricIdsV1,
  getMetricDefinitions,
} from "./metric-definitions";
import {
  type ExternalApiPrivateCache,
  createConfiguredExternalApiPrivateCache,
  createExternalApiPrivateCacheKey,
} from "./private-cache";

interface MetricsRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

interface MetricsDependencies {
  client?: MetricsRpcClient;
  cache?: ExternalApiPrivateCache;
  now?: () => Date;
}

type CacheAuditResult = "hit" | "miss" | "bypass";

const decimalSequenceSchema = z
  .union([z.string(), z.number().int().nonnegative()])
  .transform(String)
  .pipe(z.string().regex(/^(?:0|[1-9][0-9]{0,18})$/));

const metricsContextSchema = z
  .object({
    high_water_sequence: decimalSequenceSchema,
    data_through: z.string().datetime({ offset: true }),
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    from_local_date: z.string().date(),
    to_local_date: z.string().date(),
    timezone: z.string().min(1).max(100),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();

const dateBasedFinancialMetricIds = new Set([
  "invoiced_event_total",
  "paid_event_total",
]);

function actorArguments(actor: ExternalApiRequestActor) {
  return {
    p_principal_id: actor.principalId,
    p_credential_id: actor.credentialId,
    p_company_id: actor.companyId,
    p_digest_version: actor.digestVersion,
    p_credential_digest: actor.credentialDigest,
    p_visible_prefix: actor.visiblePrefix,
    p_authorization_epoch: actor.authorizationEpoch,
  };
}

function normalizedScopes(actor: ExternalApiRequestActor) {
  return [...actor.scopes].sort();
}

function databaseErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const message = Reflect.get(error, "message");
  return typeof message === "string" ? message : "";
}

function safeDatabaseError(error: unknown): ExternalApiSafeError {
  const message = databaseErrorMessage(error);
  if (message.includes("external_metric_date_alignment_required")) {
    return new ExternalApiSafeError("date_alignment_required");
  }
  if (message.includes("external_metric_range_too_large")) {
    return new ExternalApiSafeError("range_too_large");
  }
  if (message.includes("external_metric_definition_version_unsupported")) {
    return new ExternalApiSafeError("definition_version_unsupported");
  }
  if (message.includes("external_analytics_credential_invalid")) {
    return new ExternalApiSafeError("invalid_credentials");
  }
  return new ExternalApiSafeError("temporarily_unavailable");
}

async function callRpc(
  client: MetricsRpcClient,
  name: string,
  args: Record<string, unknown>
) {
  try {
    const response = await client.rpc(name, args);
    if (response.error) throw safeDatabaseError(response.error);
    return response.data;
  } catch (error) {
    if (error instanceof ExternalApiSafeError) throw error;
    throw new ExternalApiSafeError("temporarily_unavailable");
  }
}

function requestsFinancialMetrics(query: MetricQuery): boolean {
  return query.metricIds.some((metricId) => financialMetricIdsV1.has(metricId));
}

function requiresDateAlignment(query: MetricQuery): boolean {
  return query.metricIds.some((metricId) =>
    dateBasedFinancialMetricIds.has(metricId)
  );
}

function cacheTtlSeconds(query: MetricQuery): 60 | 300 {
  if (query.preset === "90d" || query.preset === "lifetime") return 300;
  if (
    query.preset === "custom" &&
    query.from !== undefined &&
    query.to !== undefined
  ) {
    const from = new Date(
      query.from.length === 10 ? `${query.from}T00:00:00.000Z` : query.from
    );
    const to = new Date(
      query.to.length === 10 ? `${query.to}T00:00:00.000Z` : query.to
    );
    if (to.getTime() - from.getTime() >= 90 * 24 * 60 * 60 * 1000) {
      return 300;
    }
  }
  return 60;
}

export async function getExternalLeadMetrics(
  input: Readonly<{
    actor: ExternalApiRequestActor;
    auditRequestId: string;
    requestReceivedAt: string;
    query: MetricQuery;
  }>,
  dependencies: MetricsDependencies = {}
) {
  const definitions = getMetricDefinitions(
    input.query.definitionVersion,
    input.query.metricIds
  );
  if (!definitions) {
    throw new ExternalApiSafeError("definition_version_unsupported");
  }

  const includeFinancial = requestsFinancialMetrics(input.query);
  if (
    includeFinancial &&
    !input.actor.scopes.includes("analytics.financial.read")
  ) {
    throw new ExternalApiSafeError("insufficient_scope");
  }
  if (
    input.query.preset === "custom" &&
    requiresDateAlignment(input.query) &&
    (input.query.from?.length !== 10 || input.query.to?.length !== 10)
  ) {
    throw new ExternalApiSafeError("date_alignment_required");
  }

  const client =
    dependencies.client ??
    (getServiceRoleClient() as unknown as MetricsRpcClient);
  const cache = dependencies.cache ?? createConfiguredExternalApiPrivateCache();
  const now = dependencies.now?.() ?? new Date();
  const context = metricsContextSchema.safeParse(
    await callRpc(client, "authorize_external_lead_metrics_as_system", {
      p_request_id: input.auditRequestId,
      ...actorArguments(input.actor),
      p_require_financial: includeFinancial,
      p_require_date_alignment: requiresDateAlignment(input.query),
      p_definition_version: input.query.definitionVersion,
      p_preset: input.query.preset,
      p_from: input.query.from ?? null,
      p_to: input.query.to ?? null,
      p_source_id: input.query.sourceId ?? null,
      p_campaign_handle: input.query.campaignHandle ?? null,
      p_form_id: input.query.formId ?? null,
      p_request_received_at: input.requestReceivedAt,
    })
  );
  if (!context.success) {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }

  const cacheKey = createExternalApiPrivateCacheKey({
    kind: "lead-metrics",
    apiVersion: EXTERNAL_API_VERSION,
    metricDefinitionVersion: input.query.definitionVersion,
    principalId: input.actor.principalId,
    companyId: input.actor.companyId,
    authorizationEpoch: input.actor.authorizationEpoch,
    scopes: normalizedScopes(input.actor),
    highWater: context.data.high_water_sequence,
    dataThrough: context.data.data_through,
    from: context.data.from,
    to: context.data.to,
    metricIds: input.query.metricIds,
    groupBy: input.query.groupBy,
    sourceId: input.query.sourceId ?? null,
    campaignHandle: input.query.campaignHandle ?? null,
    formId: input.query.formId ?? null,
    includeFinancial,
  });
  const cached = await cache.get(cacheKey);
  if (cached.outcome === "hit") {
    const parsed = metricsResultSchema.safeParse(cached.value);
    if (parsed.success) {
      return {
        result: parsed.data,
        auditBase: commitExternalApiAuditBase(input.auditRequestId),
        cacheResult: "hit" as const satisfies CacheAuditResult,
      };
    }
  }
  const cacheResult: CacheAuditResult =
    cached.outcome === "unavailable" ? "bypass" : "miss";

  const parsed = metricsResultSchema.safeParse(
    await callRpc(client, "read_external_lead_metrics_v1_as_system", {
      ...actorArguments(input.actor),
      p_include_financial: includeFinancial,
      p_high_water_sequence: context.data.high_water_sequence,
      p_from: context.data.from,
      p_to: context.data.to,
      p_from_local_date: context.data.from_local_date,
      p_to_local_date: context.data.to_local_date,
      p_timezone: context.data.timezone,
      p_currency: context.data.currency,
      p_metric_ids: input.query.metricIds,
      p_groupings: input.query.groupBy,
      p_source_id: input.query.sourceId ?? null,
      p_campaign_handle: input.query.campaignHandle ?? null,
      p_form_id: input.query.formId ?? null,
      p_data_through: context.data.data_through,
      p_generated_at: now.toISOString(),
    })
  );
  if (!parsed.success) {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }

  await cache.set(cacheKey, parsed.data, cacheTtlSeconds(input.query));
  return {
    result: parsed.data,
    auditBase: commitExternalApiAuditBase(input.auditRequestId),
    cacheResult,
  };
}

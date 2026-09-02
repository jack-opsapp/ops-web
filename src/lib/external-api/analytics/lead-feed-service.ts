import "server-only";

import { z } from "zod";

import { getServiceRoleClient } from "@/lib/supabase/server-client";

import type { ExternalApiRequestActor } from "../auth/credential-auth";
import { EXTERNAL_API_VERSION } from "../contracts/common";
import { ExternalApiSafeError } from "../contracts/errors";
import {
  type LeadFeedFilters,
  type LeadFeedQuery,
  leadFeedResultSchema,
  serializeLeadProjection,
} from "../contracts/lead-feed";
import { commitExternalApiAuditBase } from "../security/audit";
import {
  type ExternalApiCursorKeyRing,
  LEAD_FEED_CURSOR_TTL_MS,
  LEAD_PROJECTION_SCHEMA_VERSION,
  openLeadFeedCursor,
  openLeadSyncCheckpoint,
  readExternalApiCursorKeyRing,
  sealLeadFeedCursor,
  sealLeadSyncCheckpoint,
} from "./cursor";
import {
  type ExternalApiPrivateCache,
  createConfiguredExternalApiPrivateCache,
  createExternalApiPrivateCacheKey,
} from "./private-cache";

interface LeadFeedRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

type CacheAuditResult = "hit" | "miss" | "bypass";

interface LeadFeedDependencies {
  client?: LeadFeedRpcClient;
  cache?: ExternalApiPrivateCache;
  cursorKeyRing?: ExternalApiCursorKeyRing;
  now?: () => Date;
}

const decimalSequenceSchema = z
  .union([z.string(), z.number().int().nonnegative()])
  .transform(String)
  .pipe(z.string().regex(/^(?:0|[1-9][0-9]{0,18})$/));

const authorizationSchema = z
  .object({
    high_water_sequence: decimalSequenceSchema,
    retained_from_sequence: decimalSequenceSchema,
    data_through: z.string().datetime({ offset: true }),
  })
  .strict();

const pageSchema = z
  .object({
    items: z.array(z.unknown()).max(251),
    has_more: z.boolean(),
    last_public_lead_id: z.string().uuid().nullable().optional(),
    last_sequence: decimalSequenceSchema.nullable().optional(),
  })
  .strict();

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

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertBinding(
  claims: {
    apiVersion: string;
    projectionVersion: number;
    principalId: string;
    companyId: string;
    authorizationEpoch: number;
    scopes: readonly string[];
  },
  actor: ExternalApiRequestActor
) {
  if (
    claims.apiVersion !== EXTERNAL_API_VERSION ||
    claims.projectionVersion !== LEAD_PROJECTION_SCHEMA_VERSION ||
    claims.principalId !== actor.principalId ||
    claims.companyId !== actor.companyId ||
    claims.authorizationEpoch !== actor.authorizationEpoch ||
    !sameJson([...claims.scopes].sort(), normalizedScopes(actor))
  ) {
    throw new ExternalApiSafeError("cursor_invalid");
  }
}

async function callRpc(
  client: LeadFeedRpcClient,
  name: string,
  args: Record<string, unknown>
) {
  try {
    const response = await client.rpc(name, args);
    if (response.error) throw new Error("database command failed");
    return response.data;
  } catch {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }
}

function lessThan(left: string, right: string): boolean {
  return BigInt(left) < BigInt(right);
}

export async function getExternalLeadFeed(
  input: Readonly<{
    actor: ExternalApiRequestActor;
    auditRequestId: string;
    requestReceivedAt: string;
    query: LeadFeedQuery;
  }>,
  dependencies: LeadFeedDependencies = {}
) {
  const client =
    dependencies.client ??
    (getServiceRoleClient() as unknown as LeadFeedRpcClient);
  const cache = dependencies.cache ?? createConfiguredExternalApiPrivateCache();
  let keyRing: ExternalApiCursorKeyRing;
  try {
    keyRing = dependencies.cursorKeyRing ?? readExternalApiCursorKeyRing();
  } catch {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }
  const now = dependencies.now?.() ?? new Date();
  const includeFinancial = input.actor.scopes.includes(
    "analytics.financial.read"
  );

  const authorized = authorizationSchema.safeParse(
    await callRpc(client, "authorize_external_lead_feed_as_system", {
      p_request_id: input.auditRequestId,
      ...actorArguments(input.actor),
      p_require_financial: includeFinancial,
      p_route: "/v1/analytics/leads",
      p_method: "GET",
      p_request_received_at: input.requestReceivedAt,
    })
  );
  if (!authorized.success) {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }

  let mode = input.query.mode;
  let highWater = authorized.data.high_water_sequence;
  let dataThrough = authorized.data.data_through;
  let filters: LeadFeedFilters | null = input.query.filters ?? null;
  let checkpointSequence: string | null = null;
  let afterPublicLeadId: string | null = null;
  let afterSequence: string | null = null;
  let filtered = filters !== null;

  if (input.query.cursor) {
    let cursor;
    try {
      cursor = openLeadFeedCursor(input.query.cursor, keyRing, now);
    } catch {
      throw new ExternalApiSafeError("cursor_invalid");
    }
    assertBinding(cursor, input.actor);
    if (
      cursor.mode !== mode ||
      (input.query.filters !== undefined &&
        !sameJson(input.query.filters, cursor.filters))
    ) {
      throw new ExternalApiSafeError("cursor_invalid");
    }
    mode = cursor.mode;
    highWater = cursor.highWater;
    dataThrough = cursor.dataThrough;
    filters = cursor.filters;
    filtered = cursor.filtered;
    checkpointSequence = cursor.checkpointSequence;
    afterPublicLeadId = cursor.afterPublicLeadId;
    afterSequence = cursor.afterSequence;
  }

  if (mode === "incremental") {
    if (!input.query.syncCheckpoint) {
      throw new ExternalApiSafeError("cursor_invalid");
    }
    let checkpoint;
    try {
      checkpoint = openLeadSyncCheckpoint(input.query.syncCheckpoint, keyRing);
    } catch {
      throw new ExternalApiSafeError("cursor_invalid");
    }
    assertBinding(checkpoint, input.actor);
    if (
      checkpointSequence !== null &&
      checkpointSequence !== checkpoint.sequence
    ) {
      throw new ExternalApiSafeError("cursor_invalid");
    }
    checkpointSequence = checkpoint.sequence;
    afterSequence ??= checkpoint.sequence;
    filters = null;
    filtered = false;

    const minimumCheckpoint = (
      BigInt(authorized.data.retained_from_sequence) - BigInt(1)
    ).toString();
    if (lessThan(checkpoint.sequence, minimumCheckpoint)) {
      throw new ExternalApiSafeError("sync_checkpoint_expired");
    }
  } else if (input.query.syncCheckpoint) {
    throw new ExternalApiSafeError("cursor_invalid");
  }

  const cacheKey = createExternalApiPrivateCacheKey({
    kind: "lead-feed",
    apiVersion: EXTERNAL_API_VERSION,
    projectionVersion: LEAD_PROJECTION_SCHEMA_VERSION,
    principalId: input.actor.principalId,
    companyId: input.actor.companyId,
    authorizationEpoch: input.actor.authorizationEpoch,
    scopes: normalizedScopes(input.actor),
    mode,
    highWater,
    checkpointSequence,
    afterPublicLeadId,
    afterSequence,
    filters,
    pageSize: input.query.pageSize,
    includeFinancial,
  });
  const cached = await cache.get(cacheKey);
  if (cached.outcome === "hit") {
    const parsed = leadFeedResultSchema.safeParse(cached.value);
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

  const page = pageSchema.safeParse(
    await callRpc(client, "read_external_lead_feed_page_as_system", {
      ...actorArguments(input.actor),
      p_include_financial: includeFinancial,
      p_mode: mode,
      p_high_water_sequence: highWater,
      p_after_public_lead_id: afterPublicLeadId,
      p_after_sequence: afterSequence,
      p_page_size: input.query.pageSize,
      p_filters: filters,
    })
  );
  if (!page.success) {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }

  const items = page.data.items.map(serializeLeadProjection);
  const nextCursor = page.data.has_more
    ? sealLeadFeedCursor(
        {
          purpose: "lead_page",
          apiVersion: EXTERNAL_API_VERSION,
          projectionVersion: LEAD_PROJECTION_SCHEMA_VERSION,
          principalId: input.actor.principalId,
          companyId: input.actor.companyId,
          authorizationEpoch: input.actor.authorizationEpoch,
          scopes: normalizedScopes(input.actor),
          mode,
          highWater,
          checkpointSequence,
          afterPublicLeadId:
            mode === "full" ? (page.data.last_public_lead_id ?? null) : null,
          afterSequence:
            mode === "incremental"
              ? (page.data.last_sequence ?? afterSequence)
              : null,
          filters,
          filtered,
          sort: mode === "full" ? "public_lead_id" : "change_sequence",
          dataThrough,
          expiresAt: now.getTime() + LEAD_FEED_CURSOR_TTL_MS,
        },
        keyRing
      )
    : null;
  const nextSyncCheckpoint =
    !page.data.has_more && !filtered
      ? sealLeadSyncCheckpoint(
          {
            purpose: "lead_checkpoint",
            apiVersion: EXTERNAL_API_VERSION,
            projectionVersion: LEAD_PROJECTION_SCHEMA_VERSION,
            principalId: input.actor.principalId,
            companyId: input.actor.companyId,
            authorizationEpoch: input.actor.authorizationEpoch,
            scopes: normalizedScopes(input.actor),
            sequence: highWater,
            dataThrough,
            issuedAt: now.getTime(),
          },
          keyRing
        )
      : null;

  const result = leadFeedResultSchema.parse({
    mode,
    dataThrough,
    items,
    nextCursor,
    nextSyncCheckpoint,
  });
  await cache.set(cacheKey, result, 60);
  return {
    result,
    auditBase: commitExternalApiAuditBase(input.auditRequestId),
    cacheResult,
  };
}

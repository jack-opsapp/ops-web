import "server-only";

import type { CapabilityRateLimitBucket } from "@/lib/agent-control-plane/registry/capability-types";
import { rateLimit } from "@/lib/utils/ratelimit";

import type { DurableMcpRateLimiter } from "./durable-rate-limit";

/**
 * Foundation-spec 13.3 ceilings for the P1 read surface. Sliding windows via
 * the shared limiter (Vercel KV when provisioned; per-instance in-memory
 * fallback otherwise — the documented degradation at current scale).
 * Actor and grant keys independently contain one human and one connection;
 * the company key holds the tenant ceiling across every actor and connection.
 */
const BUCKET_LIMITS: Readonly<
  Record<
    "lightweight_read" | "evidence_search" | "prepare",
    {
      readonly actorPerMinute: number;
      readonly grantPerMinute: number;
      readonly companyPerMinute: number;
    }
  >
> = Object.freeze({
  lightweight_read: Object.freeze({
    actorPerMinute: 120,
    grantPerMinute: 120,
    companyPerMinute: 600,
  }),
  evidence_search: Object.freeze({
    actorPerMinute: 30,
    grantPerMinute: 30,
    companyPerMinute: 120,
  }),
  prepare: Object.freeze({
    actorPerMinute: 6,
    grantPerMinute: 6,
    companyPerMinute: 30,
  }),
});

/** Coarse per-grant transport ceiling applied before JSON-RPC parsing. */
export const TRANSPORT_REQUESTS_PER_MINUTE = 300 as const;

export interface McpRateDecision {
  readonly exceeded: boolean;
  readonly retryAfterSec: number;
  /** The durable SQL transaction already appended the denial audit. */
  readonly durableAuditRecorded?: true;
}

export async function checkTransportRate(
  grantId: string
): Promise<McpRateDecision> {
  const result = await rateLimit({
    key: `mcp:transport:${grantId}`,
    limit: TRANSPORT_REQUESTS_PER_MINUTE,
    windowSec: 60,
  });
  return { exceeded: result.exceeded, retryAfterSec: result.retryAfterSec };
}

export async function checkCapabilityRate(input: {
  readonly durableLimiter: DurableMcpRateLimiter;
  readonly bucket: CapabilityRateLimitBucket;
  readonly requestId: string;
  readonly actorUserId: string;
  readonly grantId: string;
  readonly companyId: string;
  readonly capabilityId: string;
  readonly protocolEra: "legacy" | "modern";
}): Promise<McpRateDecision> {
  if (
    input.bucket !== "lightweight_read" &&
    input.bucket !== "evidence_search" &&
    input.bucket !== "prepare"
  ) {
    throw new TypeError("MCP read capability has an invalid rate policy");
  }
  const durable = await input.durableLimiter.consume({
    requestId: input.requestId,
    grantId: input.grantId,
    actorUserId: input.actorUserId,
    companyId: input.companyId,
    capabilityId: input.capabilityId,
    protocolEra: input.protocolEra,
    bucket: input.bucket,
  });
  if (!durable.allowed) {
    const resetAtMs = Date.parse(durable.resetAt);
    const retryAfterSec = Number.isFinite(resetAtMs)
      ? Math.max(1, Math.min(60, Math.ceil((resetAtMs - Date.now()) / 1_000)))
      : 1;
    return {
      exceeded: true,
      retryAfterSec,
      durableAuditRecorded: true,
    };
  }

  const limits = BUCKET_LIMITS[input.bucket];

  const actorResult = await rateLimit({
    key: `mcp:${input.bucket}:actor:${input.actorUserId}`,
    limit: limits.actorPerMinute,
    windowSec: 60,
  });
  if (actorResult.exceeded) {
    return { exceeded: true, retryAfterSec: actorResult.retryAfterSec };
  }
  const grantResult = await rateLimit({
    key: `mcp:${input.bucket}:grant:${input.grantId}`,
    limit: limits.grantPerMinute,
    windowSec: 60,
  });
  if (grantResult.exceeded) {
    return { exceeded: true, retryAfterSec: grantResult.retryAfterSec };
  }
  const companyResult = await rateLimit({
    key: `mcp:${input.bucket}:company:${input.companyId}`,
    limit: limits.companyPerMinute,
    windowSec: 60,
  });
  return {
    exceeded: companyResult.exceeded,
    retryAfterSec: companyResult.retryAfterSec,
  };
}

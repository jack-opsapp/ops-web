import "server-only";

import type { CapabilityRateLimitBucket } from "@/lib/agent-control-plane/registry/capability-types";
import { rateLimit } from "@/lib/utils/ratelimit";

/**
 * Foundation-spec 13.3 ceilings for the P1 read surface. Sliding windows via
 * the shared limiter (Vercel KV when provisioned; per-instance in-memory
 * fallback otherwise — the documented degradation at current scale).
 * Actor and grant keys independently contain one human and one connection;
 * the company key holds the tenant ceiling across every actor and connection.
 */
const BUCKET_LIMITS: Readonly<
  Record<
    "lightweight_read" | "evidence_search",
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
});

/** Coarse per-grant transport ceiling applied before JSON-RPC parsing. */
export const TRANSPORT_REQUESTS_PER_MINUTE = 300 as const;

export interface McpRateDecision {
  readonly exceeded: boolean;
  readonly retryAfterSec: number;
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
  readonly bucket: CapabilityRateLimitBucket;
  readonly actorUserId: string;
  readonly grantId: string;
  readonly companyId: string;
}): Promise<McpRateDecision> {
  const limits =
    input.bucket === "evidence_search"
      ? BUCKET_LIMITS.evidence_search
      : BUCKET_LIMITS.lightweight_read;

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

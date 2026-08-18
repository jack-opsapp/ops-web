import "server-only";

import type { CapabilityRateLimitBucket } from "@/lib/agent-control-plane/registry/capability-types";
import { rateLimit } from "@/lib/utils/ratelimit";

/**
 * Foundation-spec 13.3 ceilings for the P1 read surface. Sliding windows via
 * the shared limiter (Vercel KV when provisioned; per-instance in-memory
 * fallback otherwise — the documented degradation at current scale).
 * Per-connection = per grant; the company key holds the tenant ceiling
 * across every connection of that company.
 */
const BUCKET_LIMITS: Readonly<
  Record<
    "lightweight_read" | "evidence_search",
    { readonly grantPerMinute: number; readonly companyPerMinute: number }
  >
> = Object.freeze({
  lightweight_read: Object.freeze({
    grantPerMinute: 120,
    companyPerMinute: 600,
  }),
  evidence_search: Object.freeze({ grantPerMinute: 30, companyPerMinute: 120 }),
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
  readonly grantId: string;
  readonly companyId: string;
}): Promise<McpRateDecision> {
  const limits =
    input.bucket === "evidence_search"
      ? BUCKET_LIMITS.evidence_search
      : BUCKET_LIMITS.lightweight_read;

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

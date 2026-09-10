import "server-only";
import * as adsClient from "@/lib/analytics/google-ads-client";
import type { AdsGateway, MutateOperation, MutateResult } from "./apply";

/**
 * The only door from the engine to Google. It adapts phase 1's
 * `mutateGoogleAds` and `getServingCustomerIds` (feat/ads-engine-p1). Until
 * that branch is merged the client module has neither export, so the gateway
 * is resolved at call time and refuses loudly instead of failing at import —
 * the engine's validators, handoff, worker and console all build and test
 * without it, and every apply attempt records ADS_CLIENT_MUTATE_UNAVAILABLE.
 */
type MutateFn = (
  operations: MutateOperation[],
  options: { validateOnly?: boolean; partialFailure?: boolean }
) => Promise<MutateResult>;
type ServingFn = () => Promise<{ servingId: string; loginId?: string }>;

function resolve(): { mutate: MutateFn; serving: ServingFn } | null {
  const candidate = adsClient as unknown as { mutateGoogleAds?: MutateFn; getServingCustomerIds?: ServingFn };
  if (typeof candidate.mutateGoogleAds !== "function" || typeof candidate.getServingCustomerIds !== "function") return null;
  return { mutate: candidate.mutateGoogleAds, serving: candidate.getServingCustomerIds };
}

export function googleGatewayAvailable(): boolean {
  return resolve() !== null;
}

export function createGoogleGateway(): AdsGateway {
  return {
    async customerId() {
      const client = resolve();
      if (!client) throw new Error("ADS_CLIENT_MUTATE_UNAVAILABLE");
      return (await client.serving()).servingId;
    },
    async mutate(operations, options) {
      const client = resolve();
      if (!client) throw new Error("ADS_CLIENT_MUTATE_UNAVAILABLE");
      const result = await client.mutate(operations, {
        validateOnly: options.validateOnly,
        partialFailure: options.partialFailure ?? false,
      });
      return {
        results: result.results ?? [],
        failures: (result.failures ?? []).map((failure) => ({
          index: failure.index ?? null,
          code: failure.code,
          message: failure.message,
          ...(failure.topics ? { topics: failure.topics } : {}),
        })),
        requestId: result.requestId,
      };
    },
  };
}

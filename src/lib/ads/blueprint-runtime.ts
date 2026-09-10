import "server-only";
import { mutateGoogleAds } from "@/lib/analytics/google-ads-client";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { createEngineRepository } from "@/lib/ads/engine/repository";
import { refreshEntitySnapshot } from "@/lib/ads/engine/snapshot-refresh";
import type {
  BlueprintGateway,
  BlueprintRepository,
} from "@/lib/ads/blueprint-apply";
import type { EntitySnapshot } from "@/lib/ads/engine/types";

/**
 * The real gateway and repository behind the blueprint routes. Kept apart from
 * `blueprint-apply.ts` so that module stays pure and its tests inject their own.
 * The entity snapshot is read through the engine's repository — one reader for
 * the whole account, so phase 2 and phase 3 can never disagree about what the
 * account contains.
 */
export function googleGateway(): BlueprintGateway {
  return {
    async mutate(operations, options) {
      const result = await mutateGoogleAds(operations, {
        validateOnly: options.validateOnly,
        partialFailure: options.partialFailure,
      });
      return {
        results: result.results ?? [],
        failures: (result.failures ?? []).map((failure) => ({
          index: failure.index ?? null,
          code: failure.code,
          message: failure.message,
        })),
        ...(result.requestId ? { requestId: result.requestId } : {}),
      };
    },
  };
}

export function warehouseRepository(): BlueprintRepository {
  const engine = createEngineRepository();
  return {
    readSnapshot: (): Promise<EntitySnapshot> => engine.readSnapshot(),
    async refreshSnapshot(): Promise<void> {
      await refreshEntitySnapshot();
    },
    async record(id, payload): Promise<void> {
      const db = getAdminSupabase();
      const { error } = await db.from("ads_sync_status").upsert(
        {
          id,
          status: "complete",
          error: null,
          backfill_progress: payload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
      if (error) throw new Error(`${id} record failed: ${error.message}`);
    },
  };
}

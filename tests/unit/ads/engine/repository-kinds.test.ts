import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBlueprint } from "@/lib/ads/blueprint";
import type { EntityRow } from "@/lib/ads/engine/snapshot";
import { createEngineRepository } from "@/lib/ads/engine/repository";

/**
 * The repository is the one place the engine's snapshot is built — for the
 * brief, the handoff's validator, the worker tick, apply and the console — so
 * it is where the blueprint must reach the mapper.
 */
const C = "customers/4454506598";
const at = "2026-09-14T08:04:44.000Z";

const ENTITIES: EntityRow[] = [
  { resource_name: `${C}/campaigns/1`, entity_type: "campaign", parent_resource_name: null, name: "PRICING · US", status: "PAUSED", payload: { id: "1", name: "PRICING · US", status: "PAUSED" }, labels: ["engine"], snapshot_at: at },
  { resource_name: `${C}/adGroups/2`, entity_type: "ad_group", parent_resource_name: `${C}/campaigns/1`, name: "Jobber pricing", status: "ENABLED", payload: { id: "2", name: "Jobber pricing", status: "ENABLED", campaign: `${C}/campaigns/1` }, labels: [], snapshot_at: at },
  { resource_name: `${C}/adGroupAds/2~3`, entity_type: "ad_group_ad", parent_resource_name: `${C}/adGroups/2`, name: null, status: "ENABLED", payload: { adGroup: `${C}/adGroups/2`, status: "ENABLED", ad: { id: "3", finalUrls: ["https://try.opsapp.co/compare/jobber"] } }, labels: ["engine", "role-control"], snapshot_at: at },
];

/**
 * A PostgREST stand-in: every query builder method chains, and awaiting any
 * query answers the entity rows for `ads_entities` and nothing for the rest.
 */
function fakeClient(): SupabaseClient {
  const query = (table: string): unknown => {
    const result = { data: table === "ads_entities" ? ENTITIES : [], error: null, count: 0 };
    const terminal: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
      single: () => Promise.resolve({ data: {}, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    };
    const builder: unknown = new Proxy(terminal, {
      get: (target, key: string) => (key in target ? target[key] : () => builder),
    });
    return builder;
  };
  return {
    from: (table: string) => query(table),
    rpc: () => Promise.resolve({ data: [], error: null }),
  } as unknown as SupabaseClient;
}

afterEach(() => vi.restoreAllMocks());

describe("createEngineRepository — kinds come from the blueprint", () => {
  it("reads the committed blueprint by default: a competitor-intent campaign and its group answer to competitor rules", async () => {
    const snapshot = await createEngineRepository(fakeClient()).readSnapshot();
    expect(snapshot.campaigns[0]).toMatchObject({ name: "PRICING · US", kind: "competitor" });
    expect(snapshot.adGroups[0]).toMatchObject({ name: "Jobber pricing", copyKind: "competitor" });
  });

  it("grants nothing when the blueprint cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repository = createEngineRepository(fakeClient(), {
      loadBlueprint: () => {
        throw new Error("BLUEPRINT_INVALID");
      },
    });
    const snapshot = await repository.readSnapshot();
    expect(snapshot.campaigns[0]).toMatchObject({ kind: "other" });
    expect(snapshot.adGroups[0]).toMatchObject({ copyKind: "core" });
    expect(logged).toHaveBeenCalled();
  });

  it("hands the validator the same blueprint its snapshot was built with", async () => {
    const inputs = await createEngineRepository(fakeClient()).validationContext();
    expect(inputs.blueprint).toBe(loadBlueprint());
    expect(inputs.snapshot.adGroups[0]).toMatchObject({ copyKind: "competitor" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unreadable = await createEngineRepository(fakeClient(), {
      loadBlueprint: () => {
        throw new Error("BLUEPRINT_INVALID");
      },
    }).validationContext();
    expect(unreadable.blueprint).toBeNull();
    expect(unreadable.snapshot.adGroups[0]).toMatchObject({ copyKind: "core" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFeatureFlagsStore } from "@/lib/store/feature-flags-store";

function responseFor(slug: string, enabled: boolean) {
  return {
    ok: true,
    json: async () => [
      {
        slug,
        enabled,
        hasOverride: false,
        routes: [`/${slug}`],
        permissions: [],
      },
    ],
  } as Response;
}

describe("feature flag actor binding", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useFeatureFlagsStore.getState().clear();
  });

  it("cannot let a stale actor overwrite the newer actor after an account switch", async () => {
    let resolveActorA!: (response: Response) => void;
    const actorAResponse = new Promise<Response>((resolve) => {
      resolveActorA = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockReturnValueOnce(actorAResponse)
        .mockResolvedValueOnce(responseFor("actor-b", false))
    );

    const actorA = useFeatureFlagsStore.getState().fetchFlags("actor-a");
    const actorB = useFeatureFlagsStore.getState().fetchFlags("actor-b");
    await actorB;
    expect(useFeatureFlagsStore.getState().flags.has("actor-b")).toBe(true);

    resolveActorA(responseFor("actor-a", true));
    await actorA;

    expect(useFeatureFlagsStore.getState().flags.has("actor-b")).toBe(true);
    expect(useFeatureFlagsStore.getState().flags.has("actor-a")).toBe(false);
  });

  it("clear invalidates an in-flight response before it can repopulate state", async () => {
    let resolveActor!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise<Response>((resolve) => {
          resolveActor = resolve;
        })
      )
    );

    const request = useFeatureFlagsStore.getState().fetchFlags("actor-a");
    useFeatureFlagsStore.getState().clear();
    resolveActor(responseFor("actor-a", true));
    await request;

    expect(useFeatureFlagsStore.getState().flags.size).toBe(0);
    expect(useFeatureFlagsStore.getState().initialized).toBe(false);
  });
});

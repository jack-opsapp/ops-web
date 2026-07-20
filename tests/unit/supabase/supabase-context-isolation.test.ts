// @vitest-environment node

import { describe, expect, it } from "vitest";

import { requireSupabase, runWithSupabase } from "@/lib/supabase/helpers";

describe("server Supabase async context", () => {
  it("preserves the first request client while a second request completes", async () => {
    const firstClient = { id: "first-service-client" } as never;
    const secondClient = { id: "second-service-client" } as never;

    let resumeFirst: (() => void) | undefined;
    let firstIsPaused: (() => void) | undefined;
    const firstPaused = new Promise<void>((resolve) => {
      firstIsPaused = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      resumeFirst = resolve;
    });

    const firstRequest = runWithSupabase(firstClient, async () => {
      expect(requireSupabase()).toBe(firstClient);
      firstIsPaused?.();
      await resume;
      return requireSupabase();
    });

    await firstPaused;

    const secondResult = await runWithSupabase(secondClient, async () => {
      await Promise.resolve();
      return requireSupabase();
    });

    expect(secondResult).toBe(secondClient);
    resumeFirst?.();
    await expect(firstRequest).resolves.toBe(firstClient);
  });
});

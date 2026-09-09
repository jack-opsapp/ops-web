import { afterEach, describe, expect, it, vi } from "vitest";
import { useFeatureFlagsStore } from "@/lib/store/feature-flags-store";

afterEach(() => { vi.unstubAllGlobals(); useFeatureFlagsStore.getState().clear(); });
async function load(enabled: boolean) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [
    { slug: "phase_c", enabled: false, hasOverride: false, routes: ["/agent", "/calibration"], permissions: ["email.configure_ai"] },
    { slug: "mcp_catalog_review", enabled, hasOverride: false, routes: [], permissions: [] },
  ] }));
  await useFeatureFlagsStore.getState().fetchFlags("exact-actor");
}
describe("catalog trial review route", () => {
  it("allows only the exact approval desk, not automation or adjacent paths", async () => {
    await load(true);
    const state = useFeatureFlagsStore.getState();
    expect(state.isRouteUnlocked("/agent/queue")).toBe(true);
    for (const path of ["/agent", "/agent/queue/other", "/agent/queue-extra", "/agent/config", "/calibration"]) {
      expect(state.isRouteUnlocked(path)).toBe(false);
    }
    expect(state.canAccessFeature("phase_c")).toBe(false);
    expect(state.isPermissionUnlocked("email.configure_ai")).toBe(false);
  });
  it("does not keep the route unlocked after a disabled refresh", async () => {
    await load(true); await load(false);
    expect(useFeatureFlagsStore.getState().isRouteUnlocked("/agent/queue")).toBe(false);
  });
  it("does not treat an absent trial flag as authority", async () => {
    await load(false);
    useFeatureFlagsStore.getState().flags.delete("mcp_catalog_review");
    expect(useFeatureFlagsStore.getState().isRouteUnlocked("/agent/queue")).toBe(false);
  });
});

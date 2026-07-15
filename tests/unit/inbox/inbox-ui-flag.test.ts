import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock: getServiceRoleClient ───────────────────────────────────────────────
// Uses vi.hoisted so the mock factory runs before any module imports, then
// vi.mock binds the factory. Pattern follows campaign-query-mappers.test.ts
// (simple chainable mock) extended to cover the .select().eq().eq().maybeSingle()
// chain used by isFeatureEnabled, and .upsert() used by setFeatureOverride.

const maybeSingleMock = vi.fn();
const upsertMock = vi.fn();

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: maybeSingleMock,
          }),
        }),
      }),
      upsert: upsertMock,
    }),
  }),
}));

import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AdminFeatureOverrideService.isFeatureEnabled", () => {
  it("returns false when no override row exists (data: null)", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null });
    const result = await AdminFeatureOverrideService.isFeatureEnabled(
      "company-abc",
      "inbox_ui"
    );
    expect(result).toBe(false);
  });

  it("throws when the feature-gate read fails instead of treating it as disabled", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "override read unavailable" },
    });

    await expect(
      AdminFeatureOverrideService.isAIFeatureEnabled("company-abc", "phase_c")
    ).rejects.toThrow(
      "Failed to read AI feature override: override read unavailable"
    );
  });

  it("returns true when a row with enabled: true exists", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { enabled: true } });
    const result = await AdminFeatureOverrideService.isFeatureEnabled(
      "company-abc",
      "inbox_ui"
    );
    expect(result).toBe(true);
  });

  it("returns false when a row with enabled: false exists", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { enabled: false } });
    const result = await AdminFeatureOverrideService.isFeatureEnabled(
      "company-abc",
      "inbox_ui"
    );
    expect(result).toBe(false);
  });
});

describe("AdminFeatureOverrideService.setFeatureOverride", () => {
  beforeEach(() => {
    upsertMock.mockReset();
  });

  it("resolves undefined on success and calls upsert with correct payload", async () => {
    upsertMock.mockResolvedValueOnce({ error: null });

    await expect(
      AdminFeatureOverrideService.setFeatureOverride(
        "co1",
        "inbox_ui",
        true,
        "admin1"
      )
    ).resolves.toBeUndefined();

    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        company_id: "co1",
        feature_key: "inbox_ui",
        enabled: true,
        enabled_by: "admin1",
        enabled_at: expect.any(String),
      }),
      { onConflict: "company_id,feature_key" }
    );
  });

  it("sets enabled_at to null when disabling", async () => {
    upsertMock.mockResolvedValueOnce({ error: null });

    await AdminFeatureOverrideService.setFeatureOverride(
      "co1",
      "inbox_ui",
      false,
      "admin1"
    );

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        enabled_at: null,
      }),
      { onConflict: "company_id,feature_key" }
    );
  });

  it("throws 'Failed to set feature override: <message>' when upsert returns an error", async () => {
    upsertMock.mockResolvedValueOnce({ error: { message: "boom" } });

    await expect(
      AdminFeatureOverrideService.setFeatureOverride(
        "co1",
        "inbox_ui",
        true,
        "admin1"
      )
    ).rejects.toThrow("Failed to set feature override: boom");
  });
});

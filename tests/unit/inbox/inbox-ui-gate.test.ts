/**
 * Unit tests: isInboxUiEnabled server-side gate helper
 *
 * Mocks next/headers, firebase token verification, findUserByAuth, and
 * AdminFeatureOverrideService so the pure gate logic can be exercised
 * without a live server or DB.
 *
 * Uses vi.hoisted so mock factories are available before module imports —
 * required because vi.mock() is hoisted to the top of the file by Vitest.
 * Pattern follows tests/unit/inbox/inbox-ui-flag.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock factories ───────────────────────────────────────────────────

const {
  cookiesMock,
  verifyFirebaseTokenMock,
  findUserByAuthMock,
  isFeatureEnabledMock,
} = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  verifyFirebaseTokenMock: vi.fn(),
  findUserByAuthMock: vi.fn(),
  isFeatureEnabledMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyFirebaseToken: verifyFirebaseTokenMock,
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: findUserByAuthMock,
}));

vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: {
    isFeatureEnabled: isFeatureEnabledMock,
  },
}));

import { isInboxUiEnabled } from "@/lib/feature-flags/inbox-ui-gate";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCookieStore(token: string | undefined) {
  return {
    get: (name: string) => {
      if ((name === "ops-auth-token" || name === "__session") && token) {
        return { value: token };
      }
      return undefined;
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("isInboxUiEnabled", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns false when no auth cookie is present", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore(undefined));
    const result = await isInboxUiEnabled();
    expect(result).toBe(false);
    expect(verifyFirebaseTokenMock).not.toHaveBeenCalled();
  });

  it("returns false when token verification throws", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore("bad-token"));
    verifyFirebaseTokenMock.mockRejectedValue(new Error("invalid token"));
    const result = await isInboxUiEnabled();
    expect(result).toBe(false);
  });

  it("returns false when user is not found in DB", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore("valid-token"));
    verifyFirebaseTokenMock.mockResolvedValue({ uid: "uid1", email: "a@b.com" });
    findUserByAuthMock.mockResolvedValue(null);
    const result = await isInboxUiEnabled();
    expect(result).toBe(false);
    expect(isFeatureEnabledMock).not.toHaveBeenCalled();
  });

  it("returns false when user has no company_id", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore("valid-token"));
    verifyFirebaseTokenMock.mockResolvedValue({ uid: "uid1", email: "a@b.com" });
    findUserByAuthMock.mockResolvedValue({ company_id: null });
    const result = await isInboxUiEnabled();
    expect(result).toBe(false);
    expect(isFeatureEnabledMock).not.toHaveBeenCalled();
  });

  it("returns false when isFeatureEnabled returns false", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore("valid-token"));
    verifyFirebaseTokenMock.mockResolvedValue({ uid: "uid1", email: "a@b.com" });
    findUserByAuthMock.mockResolvedValue({ company_id: "company-abc" });
    isFeatureEnabledMock.mockResolvedValue(false);

    const result = await isInboxUiEnabled();
    expect(result).toBe(false);
    expect(isFeatureEnabledMock).toHaveBeenCalledWith("company-abc", "inbox_ui");
  });

  it("returns true when company has inbox_ui enabled", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore("valid-token"));
    verifyFirebaseTokenMock.mockResolvedValue({ uid: "uid1", email: "a@b.com" });
    findUserByAuthMock.mockResolvedValue({ company_id: "company-abc" });
    isFeatureEnabledMock.mockResolvedValue(true);

    const result = await isInboxUiEnabled();
    expect(result).toBe(true);
    expect(isFeatureEnabledMock).toHaveBeenCalledWith("company-abc", "inbox_ui");
  });

  it("returns false when isFeatureEnabled throws (fail-closed)", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore("valid-token"));
    verifyFirebaseTokenMock.mockResolvedValue({ uid: "uid1", email: "a@b.com" });
    findUserByAuthMock.mockResolvedValue({ company_id: "company-abc" });
    isFeatureEnabledMock.mockRejectedValue(new Error("DB down"));

    const result = await isInboxUiEnabled();
    expect(result).toBe(false);
  });
});

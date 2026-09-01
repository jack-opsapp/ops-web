import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockLogEvent, mockTrack } = vi.hoisted(() => ({
  mockLogEvent: vi.fn(),
  mockTrack: vi.fn(),
}));

vi.mock("firebase/analytics", () => ({
  getAnalytics: vi.fn(() => ({ name: "analytics" })),
  logEvent: mockLogEvent,
}));
vi.mock("@/lib/firebase/config", () => ({
  getFirebaseApp: vi.fn(() => ({ name: "app" })),
}));
vi.mock("@/lib/analytics/analytics-service", () => ({
  analyticsService: { track: mockTrack },
}));

let conversions: typeof import("../analytics");

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_ANALYTICS_ENABLED", "true");
  conversions = await import("../analytics");
});

beforeEach(() => {
  mockLogEvent.mockClear();
  mockTrack.mockClear();
});

describe("Firebase conversion contract", () => {
  it("exposes only the five deliberate conversion helpers", () => {
    expect(Object.keys(conversions).sort()).toEqual([
      "trackBeginTrial",
      "trackCompleteOnboarding",
      "trackCreateFirstProject",
      "trackPurchase",
      "trackSignUp",
    ]);
  });

  it.each([
    ["sign_up", () => conversions.trackSignUp("google")],
    ["begin_trial", () => conversions.trackBeginTrial()],
    ["complete_onboarding", () => conversions.trackCompleteOnboarding()],
    ["create_first_project", () => conversions.trackCreateFirstProject()],
    ["purchase", () => conversions.trackPurchase("business", 99, "CAD")],
  ])("dual-writes %s to Firebase and Supabase", (eventName, invoke) => {
    invoke();
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.anything(),
      eventName,
      expect.any(Object)
    );
    expect(mockTrack).toHaveBeenCalledWith(
      "lifecycle",
      eventName,
      expect.any(Object)
    );
  });
});

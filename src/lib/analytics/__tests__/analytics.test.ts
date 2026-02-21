import { describe, it, expect, vi } from "vitest";

const mockLogEvent = vi.fn();
const mockGetAnalytics = vi.fn(() => ({ name: "analytics" }));

vi.mock("firebase/analytics", () => ({
  getAnalytics: mockGetAnalytics,
  logEvent: mockLogEvent,
  isSupported: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@/lib/firebase/config", () => ({
  getFirebaseApp: vi.fn(() => ({ name: "app" })),
}));

describe("analytics", () => {
  it("trackSignUp logs sign_up event with method", async () => {
    const { trackSignUp } = await import("../analytics");
    trackSignUp("google");
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.anything(),
      "sign_up",
      expect.objectContaining({ method: "google" })
    );
  });

  it("trackBeginTrial logs begin_trial event", async () => {
    const { trackBeginTrial } = await import("../analytics");
    trackBeginTrial();
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.anything(),
      "begin_trial",
      expect.any(Object)
    );
  });

  it("trackCreateProject logs create_project and create_first_project when count=1", async () => {
    const { trackCreateProject } = await import("../analytics");
    trackCreateProject(1);
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.anything(),
      "create_project",
      expect.objectContaining({ project_count: 1 })
    );
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.anything(),
      "create_first_project",
      expect.any(Object)
    );
  });

  it("trackFormAbandoned logs form_abandoned with formType and fieldsFilled", async () => {
    const { trackFormAbandoned } = await import("../analytics");
    trackFormAbandoned("project", 3);
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.anything(),
      "form_abandoned",
      expect.objectContaining({ form_type: "project", fields_filled: 3 })
    );
  });
});

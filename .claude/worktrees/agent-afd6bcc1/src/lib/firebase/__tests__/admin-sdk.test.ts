import { describe, it, expect, vi, beforeEach } from "vitest";

const mockApp = { name: "test-app" };
const mockAuth = { listUsers: vi.fn() };

vi.mock("firebase-admin/app", () => ({
  initializeApp: vi.fn(() => mockApp),
  getApps: vi.fn(() => []),
  cert: vi.fn((creds) => creds),
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: vi.fn(() => mockAuth),
}));

vi.stubEnv(
  "FIREBASE_ADMIN_SERVICE_ACCOUNT",
  JSON.stringify({
    type: "service_account",
    project_id: "test-project",
    private_key: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n",
    client_email: "test@test-project.iam.gserviceaccount.com",
  })
);

describe("getAdminAuth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns a Firebase Auth instance", async () => {
    const { getAdminAuth } = await import("../admin-sdk");
    const auth = getAdminAuth();
    expect(auth).toBe(mockAuth);
  });

  it("does not re-initialize if app already exists", async () => {
    const { initializeApp, getApps } = await import("firebase-admin/app");
    vi.mocked(getApps).mockReturnValue([mockApp as never]);

    const { getAdminAuth } = await import("../admin-sdk");
    getAdminAuth();

    expect(initializeApp).not.toHaveBeenCalled();
  });
});

import { calcActiveUsers } from "../admin-sdk";

describe("calcActiveUsers", () => {
  it("counts users active within day/week/month windows", () => {
    const now = Date.now();
    const users = [
      { metadata: { lastSignInTime: new Date(now - 1 * 3_600_000).toISOString() } },
      { metadata: { lastSignInTime: new Date(now - 3 * 86_400_000).toISOString() } },
      { metadata: { lastSignInTime: new Date(now - 20 * 86_400_000).toISOString() } },
      { metadata: { lastSignInTime: new Date(now - 45 * 86_400_000).toISOString() } },
      { metadata: {} },
    ] as never;

    const result = calcActiveUsers(users);
    expect(result.dau).toBe(1);
    expect(result.wau).toBe(2);
    expect(result.mau).toBe(3);
  });
});

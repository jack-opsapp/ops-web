import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  headers: new Map<string, string>(),
  isAdminEmail: vi.fn(),
  verifyFirebaseToken: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.cookies.get(name);
      return value === undefined ? undefined : { value };
    },
  }),
  headers: async () => ({
    get: (name: string) => mocks.headers.get(name.toLowerCase()) ?? null,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyFirebaseToken: mocks.verifyFirebaseToken,
}));

vi.mock("@/lib/admin/admin-queries", () => ({
  isAdminEmail: mocks.isAdminEmail,
}));

vi.mock("@/app/admin/_components/sidebar", () => ({
  AdminSidebar: () => null,
}));
vi.mock("@/app/admin/_components/company-sheet-provider", () => ({
  CompanySheetProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock("@/app/admin/_components/query-provider", () => ({
  AdminQueryProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import AdminLayout from "@/app/admin/layout";

describe("admin layout authorization outcomes", () => {
  beforeEach(() => {
    mocks.cookies.clear();
    mocks.headers.clear();
    mocks.cookies.set("ops-auth-token", "canonical-token");
    mocks.headers.set("x-ops-admin-return-to", "/admin/acquisition?range=30d");
    mocks.verifyFirebaseToken.mockReset();
    mocks.isAdminEmail.mockReset();
  });

  it("recovers invalid auth through login with the trusted exact destination", async () => {
    mocks.verifyFirebaseToken.mockRejectedValue(new Error("expired token"));

    await expect(AdminLayout({ children: <div>admin</div> })).rejects.toThrow(
      "NEXT_REDIRECT:/login?redirect=%2Fadmin%2Facquisition%3Frange%3D30d"
    );
  });

  it("sends a verified non-admin to dashboard without an admin return loop", async () => {
    mocks.verifyFirebaseToken.mockResolvedValue({
      uid: "firebase-user",
      email: "member@opsapp.co",
      claims: {},
    });
    mocks.isAdminEmail.mockResolvedValue(false);

    await expect(AdminLayout({ children: <div>admin</div> })).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard"
    );
  });

  it("does not disguise an admin allowlist outage as a login failure", async () => {
    mocks.verifyFirebaseToken.mockResolvedValue({
      uid: "firebase-admin",
      email: "admin@opsapp.co",
      claims: {},
    });
    mocks.isAdminEmail.mockRejectedValue(new Error("admin table unavailable"));

    await expect(AdminLayout({ children: <div>admin</div> })).rejects.toThrow(
      "admin table unavailable"
    );
  });

  it("prefers the canonical cookie over a stale legacy session", async () => {
    mocks.cookies.set("__session", "stale-legacy-token");
    mocks.verifyFirebaseToken.mockImplementation(async (token: string) => {
      if (token !== "canonical-token") throw new Error("stale token");
      return {
        uid: "firebase-admin",
        email: "admin@opsapp.co",
        claims: {},
      };
    });
    mocks.isAdminEmail.mockResolvedValue(true);

    await expect(
      AdminLayout({ children: <div>admin</div> })
    ).resolves.toBeTruthy();
  });
});

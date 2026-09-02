/** @vitest-environment node */

import { NextRequest, NextResponse } from "next/server";
import {
  createAdminSocialInstagramHandlers,
  type AdminSocialInstagramRouteDependencies,
} from "@/lib/social/admin-instagram-route";

const USER = { uid: "firebase-admin", email: "jackson@opsapp.co", claims: {} };

function dependencies(): AdminSocialInstagramRouteDependencies {
  return {
    authenticate: vi.fn(async () => USER),
    service: {
      getPublicStatus: vi.fn(async () => ({
        connected: false as const,
        reason: "not_connected" as const,
        needsReconnect: false,
      })),
      createAuthorizationUrl: vi.fn(
        async () =>
          new URL("https://www.instagram.com/oauth/authorize?state=opaque")
      ),
      disconnect: vi.fn(async () => undefined),
    },
  };
}

function request(method: string): NextRequest {
  return new NextRequest("https://app.opsapp.co/api/admin/social/instagram", {
    method,
  });
}

describe("admin Instagram connection route", () => {
  it.each(["GET", "POST", "DELETE"] as const)(
    "runs the admin gate before %s",
    async (method) => {
      const deps = dependencies();
      vi.mocked(deps.authenticate).mockRejectedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      );
      const handlers = createAdminSocialInstagramHandlers(deps);
      const response = await handlers[method](request(method));

      expect(response.status).toBe(401);
      expect(deps.service.getPublicStatus).not.toHaveBeenCalled();
      expect(deps.service.createAuthorizationUrl).not.toHaveBeenCalled();
      expect(deps.service.disconnect).not.toHaveBeenCalled();
    }
  );

  it("returns only safe connection status with no-store caching", async () => {
    const deps = dependencies();
    const handlers = createAdminSocialInstagramHandlers(deps);
    const response = await handlers.GET(request("GET"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      connection: {
        connected: false,
        reason: "not_connected",
        needsReconnect: false,
      },
    });
  });

  it("mints the login handoff for the verified admin", async () => {
    const deps = dependencies();
    const handlers = createAdminSocialInstagramHandlers(deps);
    const response = await handlers.POST(request("POST"));

    expect(deps.service.createAuthorizationUrl).toHaveBeenCalledWith(
      "jackson@opsapp.co"
    );
    await expect(response.json()).resolves.toEqual({
      authorizationUrl:
        "https://www.instagram.com/oauth/authorize?state=opaque",
    });
  });

  it("disconnects without returning any stored metadata", async () => {
    const deps = dependencies();
    const handlers = createAdminSocialInstagramHandlers(deps);
    const response = await handlers.DELETE(request("DELETE"));

    expect(deps.service.disconnect).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("returns a generic failure without leaking service errors", async () => {
    const deps = dependencies();
    vi.mocked(deps.service.createAuthorizationUrl).mockRejectedValue(
      new Error("secret meta-app-secret")
    );
    const response = await createAdminSocialInstagramHandlers(deps).POST(
      request("POST")
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain("meta-app-secret");
    expect(body).toContain("Instagram connection could not be started");
  });
});

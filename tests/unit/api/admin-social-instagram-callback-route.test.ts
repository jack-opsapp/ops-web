/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  createInstagramCallbackHandler,
  type InstagramCallbackDependencies,
} from "@/lib/social/instagram-callback-handler";

function dependencies(): InstagramCallbackDependencies {
  return {
    completeAuthorization: vi.fn(async () => ({
      connected: true as const,
      username: "opsjournal",
      connectedAt: "2026-09-02T20:00:00.000Z",
      tokenExpiresAt: "2026-11-01T20:00:00.000Z",
      lastRefreshedAt: null,
      needsReconnect: false as const,
    })),
    appUrl: "https://app.opsapp.co",
  };
}

function callback(query: string): NextRequest {
  return new NextRequest(
    `https://app.opsapp.co/api/admin/social/instagram/callback?${query}`
  );
}

describe("Instagram OAuth callback", () => {
  it("consumes code and state then returns to Social with a safe success flag", async () => {
    const deps = dependencies();
    const response = await createInstagramCallbackHandler(deps)(
      callback("code=one-time-code&state=opaque-state")
    );

    expect(deps.completeAuthorization).toHaveBeenCalledWith(
      "opaque-state",
      "one-time-code"
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.opsapp.co/admin/social?instagram=connected"
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects missing callback context before any exchange", async () => {
    const deps = dependencies();
    const response = await createInstagramCallbackHandler(deps)(
      callback("state=only")
    );

    expect(deps.completeAuthorization).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://app.opsapp.co/admin/social?instagram=failed&reason=invalid_callback"
    );
  });

  it("maps Meta denial to one non-secret result code", async () => {
    const deps = dependencies();
    const response = await createInstagramCallbackHandler(deps)(
      callback(
        "error=access_denied&error_description=contains-super-secret&state=opaque"
      )
    );

    expect(deps.completeAuthorization).not.toHaveBeenCalled();
    const location = response.headers.get("location")!;
    expect(location).toBe(
      "https://app.opsapp.co/admin/social?instagram=failed&reason=denied"
    );
    expect(location).not.toContain("super-secret");
  });

  it("returns a generic failure when state consumption or exchange fails", async () => {
    const deps = dependencies();
    vi.mocked(deps.completeAuthorization).mockRejectedValue(
      new Error("long-lived-token-never-leak")
    );
    const response = await createInstagramCallbackHandler(deps)(
      callback("code=bad&state=replayed")
    );

    const location = response.headers.get("location")!;
    expect(location).toBe(
      "https://app.opsapp.co/admin/social?instagram=failed&reason=connection"
    );
    expect(location).not.toContain("long-lived-token-never-leak");
  });
});

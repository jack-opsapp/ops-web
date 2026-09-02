/**
 * POST /api/portal/share is frozen (design D7, P1 plan Task 5).
 *
 * The legacy magic-link portal auth is retired, not migrated: the share
 * route answers 410 for every caller, mints nothing, sends nothing, and no
 * UI surface calls it any more. Both halves are asserted here — the HTTP
 * contract and the absence of call sites — because a stray "Share portal"
 * button would silently start minting seven-day multi-use links again.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPortalToken: vi.fn(),
  getBranding: vi.fn(),
  verifyAdminAuth: vi.fn(),
}));

vi.mock("@/lib/api/services/portal-auth-service", () => ({
  PortalAuthService: { createPortalToken: mocks.createPortalToken },
}));
vi.mock("@/lib/api/services/portal-branding-service", () => ({
  PortalBrandingService: { getBranding: mocks.getBranding },
}));
vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: mocks.verifyAdminAuth,
}));

import { POST } from "@/app/api/portal/share/route";

const RETIRED_BODY = { error: "portal_link_sharing_retired" };

function shareRequest(init: { authed: boolean; body?: unknown }): NextRequest {
  return new NextRequest("http://localhost/api/portal/share", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(init.authed ? { authorization: "Bearer firebase-id-token" } : {}),
    },
    body: JSON.stringify(
      init.body ?? {
        companyId: "11111111-1111-4111-8111-111111111111",
        clientId: "22222222-2222-4222-8222-222222222222",
        email: "client@example.com",
        companyName: "Maverick Projects",
      }
    ),
  });
}

const REPO_ROOT = path.resolve(__dirname, "../..");
const SRC_ROOT = path.join(REPO_ROOT, "src");
const SHARE_ROUTE = path.join(SRC_ROOT, "app/api/portal/share/route.ts");

/** Tracked and untracked source files under src/ containing `needle`. */
function sourceFilesContaining(needle: string): string[] {
  let out: string;
  try {
    out = execFileSync(
      "git",
      ["grep", "-l", "--untracked", "--fixed-strings", needle, "--", "src"],
      { cwd: REPO_ROOT, encoding: "utf8" }
    );
  } catch (error) {
    // git grep exits 1 when nothing matches.
    const status = (error as { status?: number }).status;
    if (status === 1) return [];
    throw error;
  }
  return out
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => path.join(REPO_ROOT, line));
}

describe("POST /api/portal/share — frozen", () => {
  it("answers 410 with the retirement body for an admin request", async () => {
    mocks.verifyAdminAuth.mockResolvedValue({
      uid: "firebase-admin",
      email: "boss@ops.co",
      claims: {},
    });
    const res = await POST(shareRequest({ authed: true }));
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual(RETIRED_BODY);
  });

  it("answers the identical 410 for an unauthenticated request (nothing to learn here)", async () => {
    mocks.verifyAdminAuth.mockResolvedValue(null);
    const res = await POST(shareRequest({ authed: false }));
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual(RETIRED_BODY);
  });

  it("answers 410 even for a malformed body — no validation branch survives", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/portal/share", {
        method: "POST",
        body: "not json",
      })
    );
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual(RETIRED_BODY);
  });

  it("never mints a portal token, reads branding, or verifies a token", async () => {
    mocks.createPortalToken.mockReset();
    mocks.getBranding.mockReset();
    mocks.verifyAdminAuth.mockReset();
    await POST(shareRequest({ authed: true }));
    expect(mocks.createPortalToken).not.toHaveBeenCalled();
    expect(mocks.getBranding).not.toHaveBeenCalled();
    expect(mocks.verifyAdminAuth).not.toHaveBeenCalled();
  });

  it("sets no cookie and is not cacheable", async () => {
    const res = await POST(shareRequest({ authed: true }));
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("legacy magic-link surfaces are gone", () => {
  it("no source file outside the frozen route references /api/portal/share", () => {
    const offenders = sourceFilesContaining("api/portal/share").filter(
      (file) => file !== SHARE_ROUTE
    );
    expect(offenders).toEqual([]);
  });

  it("the share-portal button component no longer exists", () => {
    expect(
      existsSync(path.join(SRC_ROOT, "components/ops/share-portal-button.tsx"))
    ).toBe(false);
    expect(sourceFilesContaining("SharePortalButton")).toEqual([]);
  });

  it("the SendGrid module no longer exports a magic-link sender", () => {
    const source = readFileSync(
      path.join(SRC_ROOT, "lib/email/sendgrid.tsx"),
      "utf8"
    );
    expect(source).not.toMatch(/sendMagicLink/);
    expect(source).not.toMatch(/\/portal\/\$\{/);
  });

  it("the frozen route imports nothing from the legacy portal auth stack", () => {
    const source = readFileSync(SHARE_ROUTE, "utf8");
    expect(source).not.toMatch(/portal-auth-service/);
    expect(source).not.toMatch(/sendMagicLink/);
    expect(source).not.toMatch(/admin-verify/);
  });
});

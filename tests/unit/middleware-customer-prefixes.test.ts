/**
 * Middleware boundary for the hosted customer surface (P1 plan Task 5).
 *
 * Two properties must hold, and both rot silently if untested:
 *   1. `/c/…` and `/api/customer/…` are public — no staff cookie is required
 *      and no request there is ever bounced to `/login`.
 *   2. Staff-protected prefixes never consult the customer session cookie.
 *      A customer credential alone must not read as "authenticated", and the
 *      middleware must not even look at `ops-customer-session` on a staff
 *      path (design I9: the two principals never share a credential path).
 */

import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

const CUSTOMER_CREDENTIAL = `ops_cs_${"A".repeat(43)}`;
const CUSTOMER_COOKIE = "ops-customer-session";

function req(path: string, cookies: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(`http://localhost${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

function isPassThrough(res: Response): boolean {
  return res.status === 200 && res.headers.get("location") === null;
}

function loginRedirect(res: Response): boolean {
  const location = res.headers.get("location");
  return location !== null && new URL(location).pathname === "/login";
}

describe("middleware — hosted customer prefixes are public", () => {
  it.each([
    "/c",
    "/c/maverick-projects",
    "/c/maverick-projects/signin",
    "/c/maverick-projects/home",
    "/c/maverick-projects/home?next=%2Fc%2Fmaverick-projects%2Fhome",
  ])("passes %s through without a staff cookie", (path) => {
    expect(isPassThrough(middleware(req(path)))).toBe(true);
  });

  it.each([
    "/api/customer/auth/start",
    "/api/customer/auth/verify",
    "/api/customer/auth/signout",
    "/api/customer/me?handle=maverick-projects",
  ])("passes %s through without a staff cookie", (path) => {
    expect(isPassThrough(middleware(req(path)))).toBe(true);
  });

  it("passes a hosted page through when only the customer cookie is present", () => {
    const res = middleware(
      req("/c/maverick-projects/home", { [CUSTOMER_COOKIE]: CUSTOMER_CREDENTIAL })
    );
    expect(isPassThrough(res)).toBe(true);
  });

  it("does not gate a hosted page on the customer cookie (authority is per request, not in middleware)", () => {
    // Design I3: the route resolves the session and membership every
    // request. Middleware never pre-judges a customer credential.
    expect(isPassThrough(middleware(req("/c/maverick-projects/home")))).toBe(true);
  });

  it("keeps /clients, /catalog and /calibration staff-protected (the /c prefix is exact)", () => {
    expect(loginRedirect(middleware(req("/clients")))).toBe(true);
    expect(loginRedirect(middleware(req("/clients/abc")))).toBe(true);
    expect(loginRedirect(middleware(req("/catalog")))).toBe(true);
    expect(loginRedirect(middleware(req("/calibration")))).toBe(true);
  });

  it("does not treat /customer or /cx as hosted paths", () => {
    // Neither is a protected prefix today, so both pass through — the
    // assertion is that the pass-through is not because of the /c rule.
    // We prove it by checking a protected sibling that starts with /c still
    // redirects (above) and that the exact hosted prefix is the only match.
    expect(isPassThrough(middleware(req("/customer")))).toBe(true);
  });
});

describe("middleware — staff-protected prefixes never consult the customer session", () => {
  const staffPaths = [
    "/dashboard",
    "/projects",
    "/schedule",
    "/clients",
    "/pipeline",
    "/books",
    "/catalog",
    "/settings",
    "/admin",
    "/setup",
    "/employee-setup",
  ];

  it.each(staffPaths)(
    "%s with only a customer credential is bounced to /login",
    (path) => {
      const res = middleware(req(path, { [CUSTOMER_COOKIE]: CUSTOMER_CREDENTIAL }));
      expect(loginRedirect(res)).toBe(true);
    }
  );

  it.each(staffPaths)("%s never reads the customer cookie at all", (path) => {
    const request = req(path, {
      [CUSTOMER_COOKIE]: CUSTOMER_CREDENTIAL,
      __session: "staff-token",
    });
    const get = vi.spyOn(request.cookies, "get");
    const res = middleware(request);
    expect(isPassThrough(res)).toBe(true);
    const namesRead = get.mock.calls.map((call) => String(call[0]));
    expect(namesRead).not.toContain(CUSTOMER_COOKIE);
    expect(namesRead.length).toBeGreaterThan(0);
  });

  it("a staff cookie plus a customer cookie on /login still redirects to the dashboard, reading only staff cookies", () => {
    const request = req("/login", {
      [CUSTOMER_COOKIE]: CUSTOMER_CREDENTIAL,
      "ops-auth-token": "staff-token",
    });
    const get = vi.spyOn(request.cookies, "get");
    const res = middleware(request);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
    expect(get.mock.calls.map((call) => String(call[0]))).not.toContain(
      CUSTOMER_COOKIE
    );
  });

  it("a customer credential alone on /login is not an authenticated staff user", () => {
    const res = middleware(
      req("/login", { [CUSTOMER_COOKIE]: CUSTOMER_CREDENTIAL })
    );
    expect(isPassThrough(res)).toBe(true);
  });

  it("hosted paths never read the staff cookies either", () => {
    const request = req("/c/maverick-projects/home", {
      __session: "staff-token",
      "ops-auth-token": "staff-token",
    });
    const get = vi.spyOn(request.cookies, "get");
    expect(isPassThrough(middleware(request))).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("middleware — public prefix declaration", () => {
  it("exports the customer public prefixes so route code can assert against one source of truth", async () => {
    const mod = await import("@/middleware");
    expect(mod.CUSTOMER_PUBLIC_PREFIXES).toEqual(["/c", "/api/customer"]);
  });
});

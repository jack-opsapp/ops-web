/**
 * POST /api/customer/auth/signout — revoke the presented broker session
 * (P1 plan Task 4, design I6: revocable per session, every revoke logged).
 *
 * Idempotent from the visitor's side: a missing, malformed, expired or
 * already-revoked session all end the same way — 204 and a cleared cookie.
 * The one case that must not pretend is a live session the broker cannot
 * reach: the cookie stays so the visitor can retry.
 */

import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerIdentityFake } from "../utils/customer-identity-fake";

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  getDeps: vi.fn(),
}));

let fake: CustomerIdentityFake;

vi.mock("@/lib/utils/ratelimit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => fake.serviceRoleClient(),
}));
vi.mock("@/lib/customer-identity/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/customer-identity/config")>()),
  getCustomerIdentityDeps: () => mocks.getDeps(),
}));

import {
  CustomerIdentityUnavailableError,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_PATH,
  mintSessionCredential,
  sessionDigest,
} from "@/lib/customer-identity";
import { IP_LIMITS } from "@/app/api/customer/_lib/broker-request";
import { POST } from "@/app/api/customer/auth/signout/route";

const IDENTITY_ID = "22222222-2222-4222-8222-222222222222";
const IP = "203.0.113.7";

function signout(init: { cookie?: string; body?: string } = {}): Promise<NextResponse> {
  return POST(
    new NextRequest("http://localhost/api/customer/auth/signout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": IP,
        "user-agent": "Safari/17",
        ...(init.cookie ? { cookie: `${SESSION_COOKIE_NAME}=${init.cookie}` } : {}),
      },
      body: init.body ?? JSON.stringify({ handle: "maverick-projects" }),
    })
  );
}

function liveCredential(): string {
  const credential = mintSessionCredential();
  fake.seedSession(sessionDigest(credential)!, {
    identityId: IDENTITY_ID,
    status: "ok",
    networkFingerprint: "f".repeat(64),
  });
  return credential;
}

function clearedCookie(res: NextResponse) {
  const cookie = res.cookies.get(SESSION_COOKIE_NAME);
  return cookie && cookie.value === "" && cookie.maxAge === 0 && cookie.path === SESSION_COOKIE_PATH;
}

beforeEach(() => {
  fake = new CustomerIdentityFake();
  mocks.rateLimit.mockReset().mockResolvedValue({ exceeded: false, count: 1, retryAfterSec: 0 });
  mocks.getDeps.mockReset().mockImplementation(() => fake.deps());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/customer/auth/signout", () => {
  it("revokes a live session, logs it, clears the cookie and answers 204", async () => {
    const credential = liveCredential();
    const res = await signout({ cookie: credential });
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");
    expect(clearedCookie(res)).toBe(true);
    expect(fake.sessions.get(sessionDigest(credential)!)!.status).toBe("revoked");
    expect(fake.eventTypes()).toEqual(["session_revoked"]);
    const [event] = fake.events;
    expect(event.args.p_identity_id).toBe(IDENTITY_ID);
  });

  it("revokes only the presented session, never the identity's others", async () => {
    const presented = liveCredential();
    const other = liveCredential();
    await signout({ cookie: presented });
    expect(fake.sessions.get(sessionDigest(presented)!)!.status).toBe("revoked");
    expect(fake.sessions.get(sessionDigest(other)!)!.status).toBe("ok");
    expect(fake.callsTo("revoke_all_customer_sessions_as_system")).toEqual([]);
  });

  it("answers 204 and clears the cookie when no session is presented, touching nothing", async () => {
    const res = await signout();
    expect(res.status).toBe(204);
    expect(clearedCookie(res)).toBe(true);
    expect(fake.calls).toEqual([]);
  });

  it("answers 204 and clears the cookie for a malformed credential, touching nothing", async () => {
    for (const cookie of ["garbage", "ops_cs_short", `ops_mcp_${"A".repeat(43)}`]) {
      const res = await signout({ cookie });
      expect(res.status).toBe(204);
      expect(clearedCookie(res)).toBe(true);
    }
    expect(fake.calls).toEqual([]);
  });

  it("answers 204 for an unknown, expired or already-revoked session without logging a revocation", async () => {
    const unknown = mintSessionCredential();
    const expired = mintSessionCredential();
    fake.seedSession(sessionDigest(expired)!, {
      identityId: IDENTITY_ID,
      status: "expired",
      networkFingerprint: "f".repeat(64),
    });
    const revoked = mintSessionCredential();
    fake.seedSession(sessionDigest(revoked)!, {
      identityId: IDENTITY_ID,
      status: "revoked",
      networkFingerprint: "f".repeat(64),
    });
    for (const cookie of [unknown, revoked]) {
      const res = await signout({ cookie });
      expect(res.status).toBe(204);
      expect(clearedCookie(res)).toBe(true);
    }
    expect(fake.eventTypes()).toEqual([]);
    // An expired row is still revoked so it can never be resurrected (I6).
    const res = await signout({ cookie: expired });
    expect(res.status).toBe(204);
    expect(fake.sessions.get(sessionDigest(expired)!)!.status).toBe("revoked");
  });

  it("ignores the body entirely — a bad body cannot keep a session alive", async () => {
    const credential = liveCredential();
    const res = await signout({ cookie: credential, body: "not json" });
    expect(res.status).toBe(204);
    expect(fake.sessions.get(sessionDigest(credential)!)!.status).toBe("revoked");
  });

  it("rate-limits per client address with the signout policy", async () => {
    mocks.rateLimit.mockResolvedValue({ exceeded: true, count: 99, retryAfterSec: 5 });
    const credential = liveCredential();
    const res = await signout({ cookie: credential });
    expect(res.status).toBe(429);
    expect(mocks.rateLimit).toHaveBeenCalledWith({
      key: `customer-api:${IP_LIMITS.authSignout.name}:${IP}`,
      limit: IP_LIMITS.authSignout.limit,
      windowSec: IP_LIMITS.authSignout.windowSec,
    });
    expect(fake.sessions.get(sessionDigest(credential)!)!.status).toBe("ok");
    expect(res.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("fails closed with 503 and keeps the cookie when a session is presented but the broker is unconfigured", async () => {
    mocks.getDeps.mockImplementation(() => {
      throw new CustomerIdentityUnavailableError("blank", "OPS_CUSTOMER_AUTH_URL is blank");
    });
    const res = await signout({ cookie: mintSessionCredential() });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "customer_identity_unavailable" });
    expect(res.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("answers 204 with a cleared cookie when nothing is presented, even unconfigured", async () => {
    mocks.getDeps.mockImplementation(() => {
      throw new CustomerIdentityUnavailableError("blank", "OPS_CUSTOMER_AUTH_URL is blank");
    });
    const res = await signout();
    expect(res.status).toBe(204);
    expect(clearedCookie(res)).toBe(true);
  });

  it("answers the generic failure and keeps the cookie when the revoke cannot be recorded", async () => {
    const credential = liveCredential();
    fake.failOn("revoke_customer_session_as_system", { code: "57P01", message: "terminating" });
    const res = await signout({ cookie: credential });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "customer_identity_failed" });
    expect(res.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
    expect(fake.sessions.get(sessionDigest(credential)!)!.status).toBe("ok");
  });

  it("never echoes the credential or an id", async () => {
    const credential = liveCredential();
    const res = await signout({ cookie: credential });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toContain(credential.slice(-12));
    expect(setCookie).not.toContain(IDENTITY_ID);
  });
});

/**
 * POST /api/customer/auth/verify — six-digit code → broker session
 * (P1 plan Task 4, design §5.1).
 *
 * Runs the real broker library against the in-memory fake. Asserts the
 * HTTP contract, that the only credential that leaves is the broker's own
 * opaque session cookie (I6, I9 — never a Supabase token, never an id), the
 * attempt accounting the broker owns (I8), and that membership for the
 * handle's company is resolved on sign-in (§5.1 step 3).
 */

import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerIdentityFake, FAKE_KEY_RING } from "../utils/customer-identity-fake";

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
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_PATH,
  sessionDigest,
  startOtp,
} from "@/lib/customer-identity";
import { IP_LIMITS, encodeChallengeRef } from "@/app/api/customer/_lib/broker-request";
import { POST } from "@/app/api/customer/auth/verify/route";

const HANDLE = "maverick-projects";
const COMPANY_ID = "ddee107c-33cd-483e-8278-0f8d8a180181";
const EMAIL = "jordan@example.com";
const CODE = "482913";
const IP = "203.0.113.7";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function verify(body: unknown, init: { ip?: string } = {}): Promise<NextResponse> {
  return POST(
    new NextRequest("http://localhost/api/customer/auth/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": init.ip ?? IP,
        "user-agent": "Safari/17",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

/** Begin a challenge through the real library and arm the fake's code. */
async function armedChallenge(email = EMAIL): Promise<string> {
  const { challengeId } = await startOtp(fake.deps(), {
    email,
    networkFingerprint: "f".repeat(64),
  });
  fake.codes.set(email, CODE);
  fake.calls.length = 0;
  fake.events.length = 0;
  return encodeChallengeRef(challengeId, email, FAKE_KEY_RING);
}

function sessionCookie(res: NextResponse) {
  return res.cookies.get(SESSION_COOKIE_NAME);
}

beforeEach(() => {
  fake = new CustomerIdentityFake();
  fake.addCompany(HANDLE, { id: COMPANY_ID, deleted_at: null });
  mocks.rateLimit.mockReset().mockResolvedValue({ exceeded: false, count: 1, retryAfterSec: 0 });
  mocks.getDeps.mockReset().mockImplementation(() => fake.deps());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/customer/auth/verify — success", () => {
  it("answers { ok, next } only and sets the broker session cookie", async () => {
    const challengeId = await armedChallenge();
    const res = await verify({ handle: HANDLE, challengeId, code: CODE, email: EMAIL });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, next: "/c/maverick-projects/home" });

    const cookie = sessionCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie!.value).toMatch(/^ops_cs_[A-Za-z0-9_-]{43}$/);
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.secure).toBe(true);
    expect(cookie!.sameSite).toBe("lax");
    expect(cookie!.path).toBe(SESSION_COOKIE_PATH);
    expect(cookie!.maxAge).toBe(SESSION_ABSOLUTE_TTL_SECONDS);

    // The cookie value is the credential whose digest the store holds.
    const stored = fake.sessions.get(sessionDigest(cookie!.value)!);
    expect(stored).toBeDefined();
    expect(stored!.status).toBe("ok");
    expect(fake.identities.has(stored!.identityId)).toBe(true);
  });

  it("never lets a Supabase token, an id, or the email leave (I4, I9)", async () => {
    const challengeId = await armedChallenge();
    const res = await verify({ handle: HANDLE, challengeId, code: CODE, email: EMAIL });
    const text = await res.text();
    const setCookie = res.headers.get("set-cookie") ?? "";
    for (const surface of [text, setCookie]) {
      expect(surface).not.toMatch(UUID);
      expect(surface).not.toContain("eyJ");
      expect(surface).not.toContain("supabase-refresh");
      expect(surface).not.toContain("jordan");
      expect(surface).not.toContain(CODE);
    }
  });

  it("resolves membership for the handle's company on sign-in (§5.1 step 3)", async () => {
    const challengeId = await armedChallenge();
    const res = await verify({ handle: HANDLE, challengeId, code: CODE, email: EMAIL });
    expect(res.status).toBe(200);
    const [resolve] = fake.callsTo("resolve_customer_membership_as_system");
    expect(resolve).toBeDefined();
    expect(resolve.args.p_company_id).toBe(COMPANY_ID);
    const stored = fake.sessions.get(sessionDigest(sessionCookie(res)!.value)!)!;
    expect(resolve.args.p_identity_id).toBe(stored.identityId);
  });

  it("marks a newly created identity as a customer principal and logs the chain", async () => {
    const challengeId = await armedChallenge();
    await verify({ handle: HANDLE, challengeId, code: CODE, email: EMAIL });
    expect(fake.appMetadataWrites).toHaveLength(1);
    expect(fake.appMetadataWrites[0].attributes).toEqual({
      app_metadata: { principal: "customer" },
    });
    expect(fake.eventTypes()).toEqual([
      "otp_verified",
      "identity_created",
      "session_issued",
    ]);
  });

  it("signs a returning identity in without re-marking it", async () => {
    fake.seedIdentity(
      "22222222-2222-4222-8222-222222222222",
      "88888888-8888-4888-8888-888888888888",
      EMAIL
    );
    const challengeId = await armedChallenge();
    const res = await verify({ handle: HANDLE, challengeId, code: CODE, email: EMAIL });
    expect(res.status).toBe(200);
    expect(fake.appMetadataWrites).toEqual([]);
    expect(fake.eventTypes()).toEqual(["otp_verified", "session_issued"]);
    const stored = fake.sessions.get(sessionDigest(sessionCookie(res)!.value)!)!;
    expect(stored.identityId).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("normalizes the email before verifying", async () => {
    const challengeId = await armedChallenge();
    const res = await verify({
      handle: HANDLE,
      challengeId,
      code: ` ${CODE} `,
      email: "  Jordan@Example.COM ",
    });
    expect(res.status).toBe(200);
  });

  it("still signs in when membership resolution fails — /me re-resolves every request (I3)", async () => {
    fake.failOn("resolve_customer_membership_as_system", {
      code: "40001",
      message: "serialization failure",
    });
    const challengeId = await armedChallenge();
    const res = await verify({ handle: HANDLE, challengeId, code: CODE, email: EMAIL });
    expect(res.status).toBe(200);
    expect(sessionCookie(res)).toBeDefined();
    expect(await res.json()).toEqual({ ok: true, next: "/c/maverick-projects/home" });
  });
});

describe("POST /api/customer/auth/verify — code failures (no cookie ever)", () => {
  it("answers 400 invalid_code with attempts remaining for a wrong code", async () => {
    const challengeId = await armedChallenge();
    const res = await verify({ handle: HANDLE, challengeId, code: "000000", email: EMAIL });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_code", attemptsRemaining: 4 });
    expect(sessionCookie(res)).toBeUndefined();
    expect(fake.sessions.size).toBe(0);
    expect(fake.eventTypes()).toEqual(["otp_failed"]);
  });

  it("exhausts the challenge after five wrong codes and refuses before proxying (I8)", async () => {
    const challengeId = await armedChallenge();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await verify({ handle: HANDLE, challengeId, code: "000000", email: EMAIL });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "invalid_code",
        attemptsRemaining: 5 - attempt,
      });
    }
    const sixth = await verify({ handle: HANDLE, challengeId, code: CODE, email: EMAIL });
    expect(sixth.status).toBe(400);
    expect(await sixth.json()).toEqual({ error: "challenge_exhausted" });
    expect(sessionCookie(sixth)).toBeUndefined();
    // The right code was never proxied once the challenge was exhausted.
    expect(fake.codes.get(EMAIL)).toBe(CODE);

    const seventh = await verify({ handle: HANDLE, challengeId, code: CODE, email: EMAIL });
    expect(seventh.status).toBe(400);
    expect(await seventh.json()).toEqual({ error: "challenge_closed" });
  });

  it("answers 400 challenge_closed for a consumed challenge (no replay)", async () => {
    const challengeId = await armedChallenge();
    fake.codes.set(EMAIL, CODE);
    const first = await verify({ handle: HANDLE, challengeId, code: CODE, email: EMAIL });
    expect(first.status).toBe(200);
    fake.codes.set(EMAIL, CODE);
    const replay = await verify({ handle: HANDLE, challengeId, code: CODE, email: EMAIL });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: "challenge_closed" });
    expect(sessionCookie(replay)).toBeUndefined();
  });

  it("refuses a ref presented with another email exactly like a wrong code, charged and never proxied", async () => {
    const challengeId = await armedChallenge();
    const res = await verify({
      handle: HANDLE,
      challengeId,
      code: CODE,
      email: "someone-else@example.com",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_code", attemptsRemaining: 4 });
    expect(sessionCookie(res)).toBeUndefined();
    expect(fake.otpVerifies).toEqual([]);
    expect(fake.codes.get(EMAIL)).toBe(CODE);
    expect(fake.eventTypes()).toEqual(["otp_failed"]);
    expect(fake.events[0].args.p_metadata).toMatchObject({ binding: "mismatch", attempts: 1 });

    // Mismatches burn the challenge out exactly like wrong codes (I8).
    for (let attempt = 2; attempt <= 5; attempt += 1) {
      const again = await verify({
        handle: HANDLE,
        challengeId,
        code: CODE,
        email: "someone-else@example.com",
      });
      expect(await again.json()).toEqual({ error: "invalid_code", attemptsRemaining: 5 - attempt });
    }
    const sixth = await verify({ handle: HANDLE, challengeId, code: CODE, email: "someone-else@example.com" });
    expect(await sixth.json()).toEqual({ error: "challenge_exhausted" });
    // The rightful email can no longer use the burnt challenge either.
    const rightful = await verify({ handle: HANDLE, challengeId, code: CODE, email: EMAIL });
    expect(await rightful.json()).toEqual({ error: "challenge_closed" });
    expect(fake.otpVerifies).toEqual([]);
  });

  it("looks identical whether the email is wrong or the code is wrong (I5)", async () => {
    const wrongEmail = await verify({
      handle: HANDLE,
      challengeId: await armedChallenge(),
      code: CODE,
      email: "someone-else@example.com",
    });
    const wrongCode = await verify({
      handle: HANDLE,
      challengeId: await armedChallenge(),
      code: "000000",
      email: EMAIL,
    });
    expect(wrongEmail.status).toBe(wrongCode.status);
    expect(await wrongEmail.json()).toEqual(await wrongCode.json());
    expect([...wrongEmail.headers.keys()].sort()).toEqual([...wrongCode.headers.keys()].sort());
  });

  it("answers the same 400 challenge_closed for a ref that was never issued (decoys included)", async () => {
    const decoy = encodeChallengeRef("8a2f6b1c-3d4e-4f50-9a6b-7c8d9e0f1a2b", EMAIL, FAKE_KEY_RING);
    const res = await verify({ handle: HANDLE, challengeId: decoy, code: CODE, email: EMAIL });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "challenge_closed" });
    expect(fake.otpSends).toEqual([]);
  });
});

describe("POST /api/customer/auth/verify — refusals before the broker", () => {
  it("answers 400 invalid_request for a malformed challenge ref, code, or email", async () => {
    const challengeId = await armedChallenge();
    const cases: Array<Record<string, unknown>> = [
      { handle: HANDLE, challengeId: "11111111-1111-4111-8111-111111111111", code: CODE, email: EMAIL },
      { handle: HANDLE, challengeId: "ch_nope", code: CODE, email: EMAIL },
      { handle: HANDLE, challengeId: `ch_${"A".repeat(22)}`, code: CODE, email: EMAIL },
      { handle: HANDLE, challengeId: undefined, code: CODE, email: EMAIL },
      { handle: HANDLE, challengeId, code: "12345", email: EMAIL },
      { handle: HANDLE, challengeId, code: "abcdef", email: EMAIL },
      { handle: HANDLE, challengeId, code: 482913, email: EMAIL },
      { handle: HANDLE, challengeId, code: CODE, email: "not-an-email" },
      { handle: HANDLE, challengeId, code: CODE },
    ];
    for (const body of cases) {
      const res = await verify(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
      expect(sessionCookie(res)).toBeUndefined();
    }
    expect(fake.calls).toEqual([]);
  });

  it("answers 400 invalid_request for a non-object body", async () => {
    const res = await verify("not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it("answers 404 not_found for an unknown or malformed handle", async () => {
    const challengeId = await armedChallenge();
    for (const handle of ["nobody-here", "Bad Handle", undefined]) {
      const res = await verify({ handle, challengeId, code: CODE, email: EMAIL });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    expect(fake.calls).toEqual([]);
  });

  it("rate-limits per client address with the verify policy", async () => {
    mocks.rateLimit.mockResolvedValue({ exceeded: true, count: 99, retryAfterSec: 12 });
    const res = await verify({ handle: HANDLE, challengeId: "ch_x", code: CODE, email: EMAIL });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("12");
    expect(mocks.rateLimit).toHaveBeenCalledWith({
      key: `customer-api:${IP_LIMITS.authVerify.name}:${IP}`,
      limit: IP_LIMITS.authVerify.limit,
      windowSec: IP_LIMITS.authVerify.windowSec,
    });
    expect(mocks.getDeps).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the customer auth project is not configured", async () => {
    mocks.getDeps.mockImplementation(() => {
      throw new CustomerIdentityUnavailableError("blank", "OPS_CUSTOMER_AUTH_URL is blank");
    });
    const res = await verify({ handle: HANDLE, challengeId: "ch_x", code: CODE, email: EMAIL });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "customer_identity_unavailable" });
  });
});

describe("POST /api/customer/auth/verify — store failures", () => {
  it("answers the generic failure and sets no cookie when the session cannot be minted", async () => {
    const challengeId = await armedChallenge();
    fake.failOn("mint_customer_session_as_system", { code: "42501", message: "access_denied" });
    const res = await verify({ handle: HANDLE, challengeId, code: CODE, email: EMAIL });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "customer_identity_failed" });
    expect(sessionCookie(res)).toBeUndefined();
  });

  it("answers the generic failure when the verified email already belongs to another identity (I5)", async () => {
    fake.seedIdentity(
      "22222222-2222-4222-8222-222222222222",
      "99999999-9999-4999-8999-999999999999",
      EMAIL
    );
    // The auth project knows this email under a different subject.
    fake.authUsers.set(EMAIL, "88888888-8888-4888-8888-888888888888");
    const challengeId = await armedChallenge();
    const res = await verify({ handle: HANDLE, challengeId, code: CODE, email: EMAIL });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "customer_identity_failed" });
    expect(sessionCookie(res)).toBeUndefined();
    expect(fake.eventTypes()).toContain("contact_conflict");
  });
});

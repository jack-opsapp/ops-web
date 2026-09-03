/**
 * Request plumbing shared by the customer broker routes (P1 plan Task 4):
 * handle parsing, client address + fingerprint, per-IP limiting on top of
 * the broker's own limits (I8), opaque challenge refs (I4: no raw ids cross
 * the boundary), company resolution by public handle, and the uniform
 * privacy-safe error responses (I5).
 */

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerIdentityFake, FAKE_KEY_RING } from "../utils/customer-identity-fake";

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(),
}));

let fake: CustomerIdentityFake;

vi.mock("@/lib/utils/ratelimit", () => ({
  rateLimit: mocks.rateLimit,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => fake.serviceRoleClient(),
}));

import {
  CustomerIdentityInputError,
  CustomerIdentityStoreError,
  CustomerIdentityUnavailableError,
  CustomerContactConflictError,
  CustomerAccessError,
  networkFingerprint,
} from "@/lib/customer-identity";
import {
  IP_LIMITS,
  brokerErrorResponse,
  clientIp,
  customerHomePath,
  decodeChallengeRef,
  encodeChallengeRef,
  enforceIpLimit,
  parsePublicHandle,
  readJsonObject,
  requestFingerprint,
  resolveCompanyIdByHandle,
} from "@/app/api/customer/_lib/broker-request";

const COMPANY_ID = "ddee107c-33cd-483e-8278-0f8d8a180181";
const CHALLENGE_ID = "11111111-1111-4111-8111-111111111111";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function req(
  path: string,
  init: { headers?: Record<string, string>; method?: string; body?: string } = {}
): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: init.headers ?? {},
    body: init.body,
  });
}

beforeEach(() => {
  fake = new CustomerIdentityFake();
  mocks.rateLimit.mockReset().mockResolvedValue({ exceeded: false, count: 1, retryAfterSec: 0 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("parsePublicHandle", () => {
  it("accepts the handle grammar the database CHECK enforces", () => {
    expect(parsePublicHandle("maverick-projects")).toBe("maverick-projects");
    expect(parsePublicHandle("abc")).toBe("abc");
    expect(parsePublicHandle("a".repeat(48))).toBe("a".repeat(48));
    expect(parsePublicHandle("acme-2")).toBe("acme-2");
  });

  it("refuses anything outside the grammar without touching the database", () => {
    for (const bad of [
      "ab",
      "a".repeat(49),
      "Maverick",
      "maverick_projects",
      "-maverick",
      "maverick-",
      "mav--erick",
      "mav erick",
      "mav/erick",
      "",
      "   ",
      42,
      null,
      undefined,
      { handle: "x" },
      COMPANY_ID,
    ]) {
      expect(parsePublicHandle(bad)).toBeNull();
    }
  });

  it("does not trim or lowercase — the handle is exact or nothing", () => {
    expect(parsePublicHandle(" maverick ")).toBeNull();
    expect(parsePublicHandle("MAVERICK")).toBeNull();
  });
});

describe("clientIp / requestFingerprint", () => {
  it("takes the first hop of x-forwarded-for", () => {
    expect(
      clientIp(req("/", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } }))
    ).toBe("203.0.113.7");
  });

  it("falls back to unknown when no forwarded address is present", () => {
    expect(clientIp(req("/"))).toBe("unknown");
    expect(clientIp(req("/", { headers: { "x-forwarded-for": "  " } }))).toBe("unknown");
  });

  it("fingerprints exactly like the library, never exposing the raw address", () => {
    const request = req("/", {
      headers: { "x-forwarded-for": "203.0.113.7", "user-agent": "Safari/17" },
    });
    expect(requestFingerprint(request)).toBe(networkFingerprint("203.0.113.7", "Safari/17"));
    expect(requestFingerprint(request)).toMatch(/^[0-9a-f]{64}$/);
    expect(requestFingerprint(request)).not.toContain("203.0.113.7");
  });
});

describe("enforceIpLimit", () => {
  it("keys the shared limiter by route policy and client address", async () => {
    const request = req("/api/customer/auth/start", {
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    const denied = await enforceIpLimit(request, IP_LIMITS.authStart);
    expect(denied).toBeNull();
    expect(mocks.rateLimit).toHaveBeenCalledWith({
      key: "customer-api:auth-start:203.0.113.7",
      limit: IP_LIMITS.authStart.limit,
      windowSec: IP_LIMITS.authStart.windowSec,
    });
  });

  it("answers 429 rate_limited with Retry-After when the window is exhausted", async () => {
    mocks.rateLimit.mockResolvedValue({ exceeded: true, count: 99, retryAfterSec: 37 });
    const denied = await enforceIpLimit(req("/"), IP_LIMITS.authVerify);
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(429);
    expect(denied!.headers.get("retry-after")).toBe("37");
    expect(denied!.headers.get("cache-control")).toBe("no-store");
    expect(await denied!.json()).toEqual({ error: "rate_limited", retryAfterSeconds: 37 });
  });

  it("never reports a zero retry window on a denial", async () => {
    mocks.rateLimit.mockResolvedValue({ exceeded: true, count: 99, retryAfterSec: 0 });
    const denied = await enforceIpLimit(req("/"), IP_LIMITS.me);
    expect(await denied!.json()).toEqual({ error: "rate_limited", retryAfterSeconds: 1 });
    expect(denied!.headers.get("retry-after")).toBe("1");
  });

  it("has a distinct, bounded policy for every broker route", () => {
    const names = Object.values(IP_LIMITS).map((policy) => policy.name);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(IP_LIMITS).sort()).toEqual([
      "authSignout",
      "authStart",
      "authVerify",
      "bookingAvailability",
      "bookingContact",
      "bookingHold",
      "bookingManageStart",
      "bookingManageVerify",
      "bookingVerify",
      "me",
    ]);
    for (const policy of Object.values(IP_LIMITS)) {
      expect(policy.limit).toBeGreaterThan(0);
      expect(policy.windowSec).toBeGreaterThan(0);
    }
    // Sends are the scarce resource (I8): the start window is the tightest.
    expect(IP_LIMITS.authStart.limit / IP_LIMITS.authStart.windowSec).toBeLessThan(
      IP_LIMITS.me.limit / IP_LIMITS.me.windowSec
    );
    // Every step that sends a code or writes a row is bounded tighter than
    // reading times, which is the only cheap thing a booking page does.
    for (const policy of [
      IP_LIMITS.bookingContact,
      IP_LIMITS.bookingManageStart,
      IP_LIMITS.bookingHold,
    ]) {
      expect(policy.limit / policy.windowSec).toBeLessThan(
        IP_LIMITS.bookingAvailability.limit / IP_LIMITS.bookingAvailability.windowSec
      );
    }
  });
});

describe("challenge refs", () => {
  const EMAIL = "jordan@example.com";
  const REF = /^ch_[A-Za-z0-9_-]{46}$/;
  const OTHER_RING = Object.freeze({
    activeKid: 2,
    keys: new Map([[2, Buffer.alloc(32, 8)]]) as ReadonlyMap<number, Buffer>,
  });

  it("encodes a challenge id as an opaque ref that is not a uuid, bound to the email", () => {
    const ref = encodeChallengeRef(CHALLENGE_ID, EMAIL, FAKE_KEY_RING);
    expect(ref).toMatch(REF);
    expect(ref).not.toMatch(UUID);
    expect(ref).not.toContain("jordan");
    expect(decodeChallengeRef(ref, EMAIL, FAKE_KEY_RING)).toEqual({
      ok: true,
      challengeId: CHALLENGE_ID,
    });
  });

  it("round-trips every uuid bit pattern", () => {
    for (const id of [
      "00000000-0000-0000-0000-000000000000",
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
      "8a2f6b1c-3d4e-4f50-9a6b-7c8d9e0f1a2b",
    ]) {
      expect(decodeChallengeRef(encodeChallengeRef(id, EMAIL, FAKE_KEY_RING), EMAIL, FAKE_KEY_RING)).toEqual({
        ok: true,
        challengeId: id,
      });
    }
  });

  it("binds to the normalized email, so case and whitespace do not break the proof", () => {
    const ref = encodeChallengeRef(CHALLENGE_ID, "  Jordan@Example.COM ", FAKE_KEY_RING);
    expect(decodeChallengeRef(ref, EMAIL, FAKE_KEY_RING)).toEqual({ ok: true, challengeId: CHALLENGE_ID });
    expect(ref).toBe(encodeChallengeRef(CHALLENGE_ID, EMAIL, FAKE_KEY_RING));
  });

  it("reports a mismatch — naming the challenge so the attempt can be charged — for another email", () => {
    const ref = encodeChallengeRef(CHALLENGE_ID, EMAIL, FAKE_KEY_RING);
    expect(decodeChallengeRef(ref, "someone-else@example.com", FAKE_KEY_RING)).toEqual({
      ok: false,
      reason: "mismatch",
      challengeId: CHALLENGE_ID,
    });
  });

  it("reports a mismatch for a tampered tag and for a key this ring does not hold", () => {
    const ref = encodeChallengeRef(CHALLENGE_ID, EMAIL, FAKE_KEY_RING);
    const at = 40;
    const tampered = `${ref.slice(0, at)}${ref[at] === "A" ? "B" : "A"}${ref.slice(at + 1)}`;
    expect(decodeChallengeRef(tampered, EMAIL, FAKE_KEY_RING)).toMatchObject({
      ok: false,
      reason: "mismatch",
      challengeId: CHALLENGE_ID,
    });
    const foreign = encodeChallengeRef(CHALLENGE_ID, EMAIL, OTHER_RING);
    expect(decodeChallengeRef(foreign, EMAIL, FAKE_KEY_RING)).toEqual({
      ok: false,
      reason: "mismatch",
      challengeId: CHALLENGE_ID,
    });
  });

  it("verifies with any key still in the ring after rotation", () => {
    const rotated = Object.freeze({
      activeKid: 2,
      keys: new Map([
        [1, FAKE_KEY_RING.keys.get(1)!],
        [2, Buffer.alloc(32, 8)],
      ]) as ReadonlyMap<number, Buffer>,
    });
    const minted = encodeChallengeRef(CHALLENGE_ID, EMAIL, FAKE_KEY_RING);
    expect(decodeChallengeRef(minted, EMAIL, rotated)).toEqual({ ok: true, challengeId: CHALLENGE_ID });
  });

  it("refuses refs it did not mint as malformed", () => {
    for (const bad of [
      "",
      "ch_",
      "ch_short",
      CHALLENGE_ID,
      `ch_${"A".repeat(45)}`,
      `ch_${"A".repeat(47)}`,
      `cx_${"A".repeat(46)}`,
      `ch_${"A".repeat(45)}+`,
      42,
      null,
      undefined,
    ]) {
      expect(decodeChallengeRef(bad, EMAIL, FAKE_KEY_RING)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("refuses non-canonical encodings of the same bytes (one ref per challenge and email)", () => {
    const ref = encodeChallengeRef(CHALLENGE_ID, EMAIL, FAKE_KEY_RING);
    // 34 bytes render as 46 characters, so the final character carries four
    // padding bits. Flip its lowest bit: same bytes on a lenient decoder, a
    // different string. Exactly one string must decode.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = ref.at(-1)!;
    const alternative = alphabet[alphabet.indexOf(last) ^ 1];
    expect(alternative).not.toBe(last);
    expect(decodeChallengeRef(`${ref.slice(0, -1)}${alternative}`, EMAIL, FAKE_KEY_RING)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("treats an unusable email as malformed input, never as a mismatch", () => {
    const ref = encodeChallengeRef(CHALLENGE_ID, EMAIL, FAKE_KEY_RING);
    expect(decodeChallengeRef(ref, "not-an-email", FAKE_KEY_RING)).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses to encode anything that is not a canonical uuid, a real email, or with a missing active key", () => {
    expect(() => encodeChallengeRef("not-a-uuid", EMAIL, FAKE_KEY_RING)).toThrow(TypeError);
    expect(() =>
      encodeChallengeRef("8a2f6b1c-3d4e-4f50-9a6b-7c8d9e0f1a2b".toUpperCase(), EMAIL, FAKE_KEY_RING)
    ).toThrow(TypeError);
    expect(() => encodeChallengeRef(CHALLENGE_ID.replace(/-/g, ""), EMAIL, FAKE_KEY_RING)).toThrow(TypeError);
    expect(() => encodeChallengeRef(CHALLENGE_ID, "nope", FAKE_KEY_RING)).toThrow(TypeError);
    expect(() =>
      encodeChallengeRef(CHALLENGE_ID, EMAIL, { activeKid: 9, keys: FAKE_KEY_RING.keys })
    ).toThrow(TypeError);
  });
});

describe("resolveCompanyIdByHandle", () => {
  it("resolves a live company by public handle, selecting only what it needs", async () => {
    fake.addCompany("maverick-projects", { id: COMPANY_ID, deleted_at: null });
    await expect(resolveCompanyIdByHandle("maverick-projects")).resolves.toBe(COMPANY_ID);
    expect(fake.companyQueries).toEqual([
      { columns: "id, deleted_at", handle: "maverick-projects" },
    ]);
  });

  it("treats an unknown handle and a soft-deleted company identically (null)", async () => {
    fake.addCompany("gone-co", { id: COMPANY_ID, deleted_at: "2026-08-01T00:00:00Z" });
    await expect(resolveCompanyIdByHandle("gone-co")).resolves.toBeNull();
    await expect(resolveCompanyIdByHandle("nobody")).resolves.toBeNull();
  });

  it("never queries for a malformed handle", async () => {
    await expect(resolveCompanyIdByHandle("Not A Handle")).resolves.toBeNull();
    expect(fake.companyQueries).toEqual([]);
  });

  it("surfaces a database failure as a store error, never as not-found", async () => {
    fake.companyLookupFailure = { code: "57P01", message: "terminating connection" };
    await expect(resolveCompanyIdByHandle("maverick-projects")).rejects.toBeInstanceOf(
      CustomerIdentityStoreError
    );
  });
});

describe("readJsonObject", () => {
  it("returns the object for a JSON object body", async () => {
    const request = req("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: "x", email: "a@b.co" }),
    });
    await expect(readJsonObject(request)).resolves.toEqual({ handle: "x", email: "a@b.co" });
  });

  it("returns null for malformed JSON, arrays, primitives and empty bodies", async () => {
    for (const body of ["not json", "[1,2]", '"str"', "42", "null", ""]) {
      const request = req("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      await expect(readJsonObject(request)).resolves.toBeNull();
    }
  });
});

describe("brokerErrorResponse", () => {
  async function shape(error: unknown) {
    const res = brokerErrorResponse(error, "test-route");
    return { status: res.status, body: await res.json(), cache: res.headers.get("cache-control") };
  }

  it("maps an unconfigured broker to 503 customer_identity_unavailable", async () => {
    expect(await shape(new CustomerIdentityUnavailableError("blank", "x"))).toEqual({
      status: 503,
      body: { error: "customer_identity_unavailable" },
      cache: "no-store",
    });
  });

  it("maps bad input to 400 invalid_request without naming the field", async () => {
    expect(await shape(new CustomerIdentityInputError("email"))).toEqual({
      status: 400,
      body: { error: "invalid_request" },
      cache: "no-store",
    });
  });

  it("maps a contact conflict to the generic failure (I5: reveals nothing)", async () => {
    expect(await shape(new CustomerContactConflictError())).toEqual({
      status: 500,
      body: { error: "customer_identity_failed" },
      cache: "no-store",
    });
  });

  it("maps access denials to 403 without the denial detail", async () => {
    expect(await shape(new CustomerAccessError("FORWARD_ONLY"))).toEqual({
      status: 403,
      body: { error: "access_denied" },
      cache: "no-store",
    });
  });

  it("maps store failures and unknown errors to the generic failure", async () => {
    expect(await shape(new CustomerIdentityStoreError("mint_customer_session"))).toEqual({
      status: 500,
      body: { error: "customer_identity_failed" },
      cache: "no-store",
    });
    expect(await shape(new Error("boom"))).toEqual({
      status: 500,
      body: { error: "customer_identity_failed" },
      cache: "no-store",
    });
  });

  it("logs by route and code only — never the message of an unknown error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    brokerErrorResponse(new Error("jane@example.com did a thing"), "auth-start");
    const logged = error.mock.calls
      .map((call) => call.map((part) => JSON.stringify(part) ?? String(part)).join(" "))
      .join("\n");
    expect(logged).toContain("auth-start");
    expect(logged).not.toContain("jane@example.com");
  });
});

describe("customerHomePath", () => {
  it("builds the hosted home path from the handle only", () => {
    expect(customerHomePath("maverick-projects")).toBe("/c/maverick-projects/home");
  });
});

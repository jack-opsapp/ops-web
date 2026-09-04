/**
 * POST /api/customer/auth/start — email → six-digit code (P1 plan Task 4).
 *
 * The real broker library runs against an in-memory fake of the system RPCs
 * and the customer auth project. What is asserted: the HTTP contract, that
 * the response is identical for known, unknown and refused emails (I5),
 * that no raw identifier leaves (I4), the per-IP limiter on top of the
 * broker's own limits (I8), and that every refusal happens before any send.
 */

import { NextRequest } from "next/server";
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

import { CustomerIdentityUnavailableError } from "@/lib/customer-identity";
import { IP_LIMITS, decodeChallengeRef } from "@/app/api/customer/_lib/broker-request";
import { POST } from "@/app/api/customer/auth/start/route";

const HANDLE = "maverick-projects";
const COMPANY_ID = "ddee107c-33cd-483e-8278-0f8d8a180181";
const IP = "203.0.113.7";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function start(body: unknown, init: { ip?: string } = {}): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/customer/auth/start", {
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

beforeEach(() => {
  fake = new CustomerIdentityFake();
  fake.addCompany(HANDLE, { id: COMPANY_ID, deleted_at: null });
  mocks.rateLimit.mockReset().mockResolvedValue({ exceeded: false, count: 1, retryAfterSec: 0 });
  mocks.getDeps.mockReset().mockImplementation(() => fake.deps());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/customer/auth/start — happy path", () => {
  it("begins a challenge, sends the code, and answers with an opaque ref", async () => {
    const res = await start({ handle: HANDLE, email: "jordan@example.com" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["challengeId", "retryAfterSeconds"]);
    expect(body.challengeId).toMatch(/^ch_[A-Za-z0-9_-]{46}$/);
    expect(body.retryAfterSeconds).toBe(60);
    expect(fake.otpSends).toEqual(["jordan@example.com"]);
    expect(fake.eventTypes()).toEqual(["otp_started"]);
  });

  it("binds the ref to the email it was begun for, and to nothing else", async () => {
    const res = await start({ handle: HANDLE, email: "jordan@example.com" });
    const { challengeId } = await res.json();
    const [challenge] = fake.challenges.keys();
    expect(decodeChallengeRef(challengeId, "jordan@example.com", FAKE_KEY_RING)).toEqual({
      ok: true,
      challengeId: challenge,
    });
    expect(decodeChallengeRef(challengeId, "someone-else@example.com", FAKE_KEY_RING)).toMatchObject({
      ok: false,
      reason: "mismatch",
    });
  });

  it("normalizes the email before digesting and sending", async () => {
    await start({ handle: HANDLE, email: "  Jordan@Example.COM " });
    expect(fake.otpSends).toEqual(["jordan@example.com"]);
  });

  it("binds the challenge to the request's network fingerprint, never the raw address", async () => {
    await start({ handle: HANDLE, email: "jordan@example.com" });
    const [begin] = fake.callsTo("begin_customer_otp_challenge_as_system");
    expect(begin.args.p_network_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(begin.args.p_email_digest).toMatch(/^1:[0-9a-f]{64}$/);
    expect(JSON.stringify(begin.args)).not.toContain(IP);
    expect(JSON.stringify(begin.args)).not.toContain("jordan");
  });

  it("returns no uuid, no email and no digest in the body (I4)", async () => {
    const res = await start({ handle: HANDLE, email: "jordan@example.com" });
    const text = await res.text();
    expect(text).not.toMatch(UUID);
    expect(text).not.toContain("jordan");
    expect(text).not.toContain("example.com");
    expect(text).not.toMatch(/[0-9a-f]{64}/);
  });
});

describe("POST /api/customer/auth/start — enumeration safety (I5)", () => {
  it("answers the identical shape for a known and an unknown email", async () => {
    fake.authUsers.set("known@example.com", "88888888-8888-4888-8888-888888888888");
    const known = await start({ handle: HANDLE, email: "known@example.com" });
    const unknown = await start({ handle: HANDLE, email: "nobody@example.com" });
    expect(known.status).toBe(unknown.status);
    const knownBody = await known.json();
    const unknownBody = await unknown.json();
    expect(Object.keys(knownBody).sort()).toEqual(Object.keys(unknownBody).sort());
    expect(knownBody.retryAfterSeconds).toBe(unknownBody.retryAfterSeconds);
    expect(knownBody.challengeId).toMatch(/^ch_[A-Za-z0-9_-]{46}$/);
    expect(unknownBody.challengeId).toMatch(/^ch_[A-Za-z0-9_-]{46}$/);
  });

  it("answers the identical shape when the broker refuses to send (I8 send limits)", async () => {
    fake.refuseSends = true;
    fake.retryAfterSeconds = 42;
    const res = await start({ handle: HANDLE, email: "jordan@example.com" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["challengeId", "retryAfterSeconds"]);
    expect(body.challengeId).toMatch(/^ch_[A-Za-z0-9_-]{46}$/);
    expect(body.retryAfterSeconds).toBe(42);
    expect(fake.otpSends).toEqual([]);
    expect(fake.eventTypes()).toEqual(["otp_refused"]);
  });

  it("answers the identical shape when the provider fails to send", async () => {
    fake.sendError = { code: "over_email_send_rate_limit", status: 429 };
    const res = await start({ handle: HANDLE, email: "jordan@example.com" });
    expect(res.status).toBe(200);
    expect(Object.keys(await res.json()).sort()).toEqual(["challengeId", "retryAfterSeconds"]);
    expect(fake.eventTypes()).toEqual(["otp_send_failed"]);
  });
});

describe("POST /api/customer/auth/start — refusals happen before any send", () => {
  it("answers 404 not_found for an unknown handle", async () => {
    const res = await start({ handle: "nobody-here", email: "jordan@example.com" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(fake.calls).toEqual([]);
    expect(fake.otpSends).toEqual([]);
  });

  it("answers the same 404 for a soft-deleted company and a malformed handle", async () => {
    fake.addCompany("gone-co", { id: COMPANY_ID, deleted_at: "2026-08-01T00:00:00Z" });
    for (const handle of ["gone-co", "Not A Handle", "", 42, undefined]) {
      const res = await start({ handle, email: "jordan@example.com" });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    expect(fake.calls).toEqual([]);
  });

  it("answers 400 invalid_request for a missing or malformed email", async () => {
    for (const email of [undefined, "", "not-an-email", 42, "a@b", " @example.com"]) {
      const res = await start({ handle: HANDLE, email });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
    expect(fake.calls).toEqual([]);
    expect(fake.otpSends).toEqual([]);
  });

  it("answers 400 invalid_request for a non-object body", async () => {
    for (const body of ["not json", "[]", "42", ""]) {
      const res = await start(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
    expect(fake.calls).toEqual([]);
  });

  it("rate-limits per client address with the start policy, before anything else", async () => {
    mocks.rateLimit.mockResolvedValue({ exceeded: true, count: 99, retryAfterSec: 30 });
    const res = await start({ handle: HANDLE, email: "jordan@example.com" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(await res.json()).toEqual({ error: "rate_limited", retryAfterSeconds: 30 });
    expect(mocks.rateLimit).toHaveBeenCalledWith({
      key: `customer-api:${IP_LIMITS.authStart.name}:${IP}`,
      limit: IP_LIMITS.authStart.limit,
      windowSec: IP_LIMITS.authStart.windowSec,
    });
    expect(fake.companyQueries).toEqual([]);
    expect(fake.calls).toEqual([]);
    expect(mocks.getDeps).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the customer auth project is not configured", async () => {
    mocks.getDeps.mockImplementation(() => {
      throw new CustomerIdentityUnavailableError("blank", "OPS_CUSTOMER_AUTH_URL is blank");
    });
    const res = await start({ handle: HANDLE, email: "jordan@example.com" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "customer_identity_unavailable" });
    expect(fake.calls).toEqual([]);
    expect(fake.otpSends).toEqual([]);
  });

  it("answers the generic failure when the challenge store fails, without sending", async () => {
    fake.failOn("begin_customer_otp_challenge_as_system", {
      code: "42501",
      message: "access_denied",
    });
    const res = await start({ handle: HANDLE, email: "jordan@example.com" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "customer_identity_failed" });
    expect(fake.otpSends).toEqual([]);
  });

  it("answers the generic failure when the company lookup fails (never not_found)", async () => {
    fake.companyLookupFailure = { code: "57P01", message: "terminating connection" };
    const res = await start({ handle: HANDLE, email: "jordan@example.com" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "customer_identity_failed" });
  });
});

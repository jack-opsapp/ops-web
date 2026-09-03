/**
 * GET /api/customer/me?handle=… — who am I, for this company
 * (P1 plan Task 4, design I2, I3, I4, I5).
 *
 * Authority is re-resolved on every request from the session row and the
 * membership state for the handle's company; nothing is trusted from the
 * cookie beyond the digest lookup. The body carries a display name, a
 * masked email and the membership state — never an id, never the email.
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
import { GET } from "@/app/api/customer/me/route";

const HANDLE = "maverick-projects";
const COMPANY_ID = "ddee107c-33cd-483e-8278-0f8d8a180181";
const OTHER_HANDLE = "north-shore-electric";
const OTHER_COMPANY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IDENTITY_ID = "22222222-2222-4222-8222-222222222222";
const AUTH_SUBJECT = "88888888-8888-4888-8888-888888888888";
const EMAIL = "jordan@example.com";
const IP = "203.0.113.7";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function me(
  query: string | null,
  init: { cookie?: string } = {}
): Promise<NextResponse> {
  const url = `http://localhost/api/customer/me${query === null ? "" : `?${query}`}`;
  return GET(
    new NextRequest(url, {
      method: "GET",
      headers: {
        "x-forwarded-for": IP,
        "user-agent": "Safari/17",
        ...(init.cookie ? { cookie: `${SESSION_COOKIE_NAME}=${init.cookie}` } : {}),
      },
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

beforeEach(() => {
  fake = new CustomerIdentityFake();
  fake.addCompany(HANDLE, { id: COMPANY_ID, deleted_at: null });
  fake.addCompany(OTHER_HANDLE, { id: OTHER_COMPANY_ID, deleted_at: null });
  fake.seedIdentity(IDENTITY_ID, AUTH_SUBJECT, EMAIL);
  mocks.rateLimit.mockReset().mockResolvedValue({ exceeded: false, count: 1, retryAfterSec: 0 });
  mocks.getDeps.mockReset().mockImplementation(() => fake.deps());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/customer/me — signed in", () => {
  it("answers the display name, masked email and membership state for the handle's company", async () => {
    fake.setMembership(IDENTITY_ID, COMPANY_ID, {
      membership_id: "33333333-3333-4333-8333-333333333333",
      client_id: "44444444-4444-4444-8444-444444444444",
      sub_client_id: null,
      state: "active_forward_only",
      outcome: "existing",
    });
    fake.setProfile(IDENTITY_ID, COMPANY_ID, {
      display_name: "Jordan Lee",
      contact_email_masked: "j*****@example.com",
      membership_state: "active_forward_only",
    });
    const res = await me(`handle=${HANDLE}`, { cookie: liveCredential() });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      displayName: "Jordan Lee",
      maskedEmail: "j*****@example.com",
      membership: { state: "active_forward_only" },
    });
  });

  it("carries no id and no clear email (I4)", async () => {
    const res = await me(`handle=${HANDLE}`, { cookie: liveCredential() });
    const text = await res.text();
    expect(text).not.toMatch(UUID);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain("jordan@");
  });

  it("answers a null display name and a null state when the company has no membership for this identity", async () => {
    fake.setMembership(IDENTITY_ID, COMPANY_ID, null);
    const res = await me(`handle=${HANDLE}`, { cookie: liveCredential() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      displayName: null,
      maskedEmail: "j*****@example.com",
      membership: { state: null },
    });
  });

  it("re-reads membership on every request — nothing is cached from the session (I3)", async () => {
    const credential = liveCredential();
    await me(`handle=${HANDLE}`, { cookie: credential });
    await me(`handle=${HANDLE}`, { cookie: credential });
    const resolves = fake.callsTo("read_customer_membership_as_system");
    expect(resolves).toHaveLength(2);
    for (const call of resolves) {
      expect(call.args).toEqual({ p_identity_id: IDENTITY_ID, p_company_id: COMPANY_ID });
    }
    expect(fake.callsTo("resolve_customer_session_as_system")).toHaveLength(2);
  });

  it("scopes everything to the handle's company — one identity, isolated memberships", async () => {
    fake.setMembership(IDENTITY_ID, COMPANY_ID, {
      membership_id: "33333333-3333-4333-8333-333333333333",
      client_id: "44444444-4444-4444-8444-444444444444",
      sub_client_id: null,
      state: "active_full",
      outcome: "existing",
    });
    fake.setMembership(IDENTITY_ID, OTHER_COMPANY_ID, {
      membership_id: "55555555-5555-4555-8555-555555555555",
      client_id: "66666666-6666-4666-8666-666666666666",
      sub_client_id: null,
      state: "revoked",
      outcome: "existing",
    });
    fake.setProfile(IDENTITY_ID, COMPANY_ID, {
      display_name: "Jordan Lee",
      contact_email_masked: "j*****@example.com",
      membership_state: "active_full",
    });
    fake.setProfile(IDENTITY_ID, OTHER_COMPANY_ID, {
      display_name: "J. Lee (North Shore)",
      contact_email_masked: "j*****@example.com",
      membership_state: "revoked",
    });
    const credential = liveCredential();
    const here = await (await me(`handle=${HANDLE}`, { cookie: credential })).json();
    const there = await (await me(`handle=${OTHER_HANDLE}`, { cookie: credential })).json();
    expect(here).toEqual({
      displayName: "Jordan Lee",
      maskedEmail: "j*****@example.com",
      membership: { state: "active_full" },
    });
    expect(there).toEqual({
      displayName: "J. Lee (North Shore)",
      maskedEmail: "j*****@example.com",
      membership: { state: "revoked" },
    });
    const profileCalls = fake.callsTo("read_customer_profile_as_system");
    expect(profileCalls.map((call) => call.args.p_company_id)).toEqual([
      COMPANY_ID,
      OTHER_COMPANY_ID,
    ]);
  });

  /**
   * The 2026-09-03 live end-to-end run: a customer signed in with one business,
   * whose browser then asked about a different business's public handle. The
   * resolve-or-create RPC behind this route minted a client and a full-access
   * membership inside that second, live company. A read may not do that (I17).
   */
  it("creates nothing in a company the customer has no relationship with (I17)", async () => {
    fake.setMembership(IDENTITY_ID, COMPANY_ID, {
      membership_id: "33333333-3333-4333-8333-333333333333",
      client_id: "44444444-4444-4444-8444-444444444444",
      sub_client_id: null,
      state: "active_full",
      outcome: "existing",
    });
    const credential = liveCredential();
    await me(`handle=${HANDLE}`, { cookie: credential });

    const res = await me(`handle=${OTHER_HANDLE}`, { cookie: credential });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      displayName: null,
      maskedEmail: "j*****@example.com",
      membership: { state: null },
    });

    expect(fake.createdClients).toEqual([]);
    expect(fake.memberships.get(`${IDENTITY_ID}:${OTHER_COMPANY_ID}`)).toBeUndefined();
    expect(fake.callsTo("link_customer_membership_as_system")).toEqual([]);
    expect(fake.callsTo("resolve_or_create_customer_membership_as_system")).toEqual([]);
    // The membership this identity really holds is untouched by the detour.
    expect(fake.memberships.get(`${IDENTITY_ID}:${COMPANY_ID}`)?.state).toBe("active_full");
  });

  it("reports every membership state as the broker holds it", async () => {
    const credential = liveCredential();
    for (const state of ["active_forward_only", "active_full", "revoked", "merged"] as const) {
      fake.setMembership(IDENTITY_ID, COMPANY_ID, {
        membership_id: "33333333-3333-4333-8333-333333333333",
        client_id: "44444444-4444-4444-8444-444444444444",
        sub_client_id: null,
        state,
        outcome: "existing",
      });
      const body = await (await me(`handle=${HANDLE}`, { cookie: credential })).json();
      expect(body.membership).toEqual({ state });
    }
  });
});

describe("GET /api/customer/me — not signed in", () => {
  it("answers 401 unauthenticated with no cookie, touching no store", async () => {
    const res = await me(`handle=${HANDLE}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(fake.calls).toEqual([]);
  });

  it("answers 401 and clears the cookie for a dead session", async () => {
    const expired = mintSessionCredential();
    fake.seedSession(sessionDigest(expired)!, {
      identityId: IDENTITY_ID,
      status: "expired",
      networkFingerprint: "f".repeat(64),
    });
    const res = await me(`handle=${HANDLE}`, { cookie: expired });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    const cookie = res.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(cookie!.value).toBe("");
    expect(cookie!.maxAge).toBe(0);
    expect(cookie!.path).toBe(SESSION_COOKIE_PATH);
    expect(fake.callsTo("read_customer_membership_as_system")).toEqual([]);
  });

  it("answers 401 for an unknown or malformed credential", async () => {
    for (const cookie of [mintSessionCredential(), "garbage", `ops_mcp_${"A".repeat(43)}`]) {
      const res = await me(`handle=${HANDLE}`, { cookie });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthenticated" });
    }
    expect(fake.callsTo("read_customer_membership_as_system")).toEqual([]);
  });

  it("answers 401 for a revoked session on the very next request (I6)", async () => {
    const credential = liveCredential();
    expect((await me(`handle=${HANDLE}`, { cookie: credential })).status).toBe(200);
    fake.sessions.get(sessionDigest(credential)!)!.status = "revoked";
    expect((await me(`handle=${HANDLE}`, { cookie: credential })).status).toBe(401);
  });
});

describe("GET /api/customer/me — refusals", () => {
  it("answers 404 not_found for a missing, malformed or unknown handle before reading the session", async () => {
    const credential = liveCredential();
    for (const query of [null, "handle=", "handle=Bad%20Handle", "handle=nobody-here", "x=1"]) {
      const res = await me(query, { cookie: credential });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    expect(fake.calls).toEqual([]);
  });

  it("rate-limits per client address with the me policy", async () => {
    mocks.rateLimit.mockResolvedValue({ exceeded: true, count: 999, retryAfterSec: 3 });
    const res = await me(`handle=${HANDLE}`, { cookie: liveCredential() });
    expect(res.status).toBe(429);
    expect(mocks.rateLimit).toHaveBeenCalledWith({
      key: `customer-api:${IP_LIMITS.me.name}:${IP}`,
      limit: IP_LIMITS.me.limit,
      windowSec: IP_LIMITS.me.windowSec,
    });
    expect(fake.calls).toEqual([]);
  });

  it("fails closed with 503 when the broker is unconfigured", async () => {
    mocks.getDeps.mockImplementation(() => {
      throw new CustomerIdentityUnavailableError("blank", "OPS_CUSTOMER_AUTH_URL is blank");
    });
    const res = await me(`handle=${HANDLE}`, { cookie: mintSessionCredential() });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "customer_identity_unavailable" });
  });

  it("answers the generic failure when the store fails — never a false sign-out", async () => {
    const credential = liveCredential();
    fake.failOn("resolve_customer_session_as_system", { code: "57P01", message: "terminating" });
    const res = await me(`handle=${HANDLE}`, { cookie: credential });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "customer_identity_failed" });
    expect(res.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();

    fake.clearFailures();
    fake.failOn("read_customer_profile_as_system", { code: "42501", message: "access_denied" });
    const profileFailure = await me(`handle=${HANDLE}`, { cookie: credential });
    expect(profileFailure.status).toBe(500);
    expect(await profileFailure.json()).toEqual({ error: "customer_identity_failed" });
  });
});

import { describe, it, expect, vi } from "vitest";
import {
  classifyVerifyFailure,
  fetchCustomerMe,
  membershipView,
  signOutCustomer,
  startCustomerAuth,
  verifyCustomerAuth,
  DEFAULT_RETRY_AFTER_SECONDS,
} from "@/components/customer/customer-api";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function fetchReturning(response: Response | Error) {
  return vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch;
}

describe("startCustomerAuth", () => {
  it("posts handle + email and returns the challenge on success", async () => {
    const f = fetchReturning(jsonResponse(200, { challengeId: "ch_1", retryAfterSeconds: 45 }));
    const out = await startCustomerAuth("acme", "a@b.co", f);
    expect(out).toEqual({ ok: true, challengeId: "ch_1", retryAfterSeconds: 45 });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/customer/auth/start");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ handle: "acme", email: "a@b.co" });
  });

  it("returns the identical success shape whether or not the broker knew the email (I5)", async () => {
    const known = await startCustomerAuth("acme", "known@b.co", fetchReturning(jsonResponse(200, { challengeId: "ch_k", retryAfterSeconds: 60 })));
    const unknown = await startCustomerAuth("acme", "nobody@b.co", fetchReturning(jsonResponse(200, { challengeId: "ch_u", retryAfterSeconds: 60 })));
    expect(Object.keys(known).sort()).toEqual(Object.keys(unknown).sort());
  });

  it("defaults the resend window when the broker omits it", async () => {
    const out = await startCustomerAuth("acme", "a@b.co", fetchReturning(jsonResponse(200, { challengeId: "ch_1" })));
    expect(out).toEqual({ ok: true, challengeId: "ch_1", retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS });
  });

  it("maps 429 to rate_limited with the broker's window (body first, then Retry-After)", async () => {
    const fromBody = await startCustomerAuth("acme", "a@b.co", fetchReturning(jsonResponse(429, { error: "rate_limited", retryAfterSeconds: 37 })));
    expect(fromBody).toEqual({ ok: false, kind: "rate_limited", retryAfterSeconds: 37 });
    const fromHeader = await startCustomerAuth("acme", "a@b.co", fetchReturning(jsonResponse(429, { error: "rate_limited" }, { "Retry-After": "12" })));
    expect(fromHeader).toEqual({ ok: false, kind: "rate_limited", retryAfterSeconds: 12 });
    const none = await startCustomerAuth("acme", "a@b.co", fetchReturning(jsonResponse(429, undefined)));
    expect(none).toEqual({ ok: false, kind: "rate_limited", retryAfterSeconds: null });
  });

  it("maps 503 / unavailable, other failures, and network errors", async () => {
    expect(await startCustomerAuth("acme", "a@b.co", fetchReturning(jsonResponse(503, { error: "customer_identity_unavailable" })))).toMatchObject({ ok: false, kind: "unavailable" });
    expect(await startCustomerAuth("acme", "a@b.co", fetchReturning(jsonResponse(404, { error: "not_found" })))).toMatchObject({ ok: false, kind: "failed" });
    expect(await startCustomerAuth("acme", "a@b.co", fetchReturning(jsonResponse(200, { nope: true })))).toMatchObject({ ok: false, kind: "failed" });
    expect(await startCustomerAuth("acme", "a@b.co", fetchReturning(new TypeError("Failed to fetch")))).toMatchObject({ ok: false, kind: "offline" });
  });
});

describe("classifyVerifyFailure", () => {
  it("routes every broker code to one of the user-facing kinds", () => {
    expect(classifyVerifyFailure(400, "invalid_code")).toBe("invalid");
    expect(classifyVerifyFailure(410, "challenge_expired")).toBe("expired");
    expect(classifyVerifyFailure(400, "challenge_closed")).toBe("expired");
    expect(classifyVerifyFailure(429, "")).toBe("exhausted");
    expect(classifyVerifyFailure(400, "challenge_exhausted")).toBe("exhausted");
    expect(classifyVerifyFailure(400, "too_many_attempts")).toBe("exhausted");
    expect(classifyVerifyFailure(503, "")).toBe("unavailable");
    expect(classifyVerifyFailure(404, "")).toBe("invalid");
    expect(classifyVerifyFailure(500, "")).toBe("failed");
  });
});

describe("verifyCustomerAuth", () => {
  it("returns next on success without leaking anything else", async () => {
    const out = await verifyCustomerAuth("acme", "ch_1", "123456", fetchReturning(jsonResponse(200, { ok: true, next: "/c/acme/home", identityId: "should-not-matter" })));
    expect(out).toEqual({ ok: true, next: "/c/acme/home" });
  });

  it("treats a 200 without ok:true as a failure", async () => {
    const out = await verifyCustomerAuth("acme", "ch_1", "123456", fetchReturning(jsonResponse(200, { ok: false, error: "invalid_code" })));
    expect(out).toEqual({ ok: false, kind: "invalid" });
  });

  it("maps network errors to offline", async () => {
    const out = await verifyCustomerAuth("acme", "ch_1", "123456", fetchReturning(new TypeError("Failed to fetch")));
    expect(out).toEqual({ ok: false, kind: "offline" });
  });
});

describe("fetchCustomerMe", () => {
  it("parses the me contract and tolerates missing optional fields", async () => {
    const out = await fetchCustomerMe("acme", fetchReturning(jsonResponse(200, { displayName: "  Jo  ", maskedEmail: "j•••@x.co", membership: { state: "active_full" } })));
    expect(out).toEqual({ ok: true, me: { displayName: "Jo", maskedEmail: "j•••@x.co", membership: { state: "active_full" } } });
    const sparse = await fetchCustomerMe("acme", fetchReturning(jsonResponse(200, { maskedEmail: "j•••@x.co" })));
    expect(sparse).toEqual({ ok: true, me: { displayName: null, maskedEmail: "j•••@x.co", membership: { state: null } } });
  });

  it("maps 401/403 to unauthenticated and everything else to failed/offline", async () => {
    expect(await fetchCustomerMe("acme", fetchReturning(jsonResponse(401, { error: "unauthenticated" })))).toEqual({ ok: false, kind: "unauthenticated" });
    expect(await fetchCustomerMe("acme", fetchReturning(jsonResponse(500, undefined)))).toEqual({ ok: false, kind: "failed" });
    expect(await fetchCustomerMe("acme", fetchReturning(new TypeError("x")))).toEqual({ ok: false, kind: "offline" });
  });

  it("scopes the request to the handle", async () => {
    const f = fetchReturning(jsonResponse(200, { maskedEmail: "x" }));
    await fetchCustomerMe("acme-co", f);
    const [url] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("/api/customer/me?handle=acme-co");
  });
});

describe("membershipView", () => {
  it("collapses broker states to the three rendered realities", () => {
    expect(membershipView("active_full")).toBe("full");
    expect(membershipView("active_forward_only")).toBe("forward_only");
    expect(membershipView("revoked")).toBe("none");
    expect(membershipView("merged")).toBe("none");
    expect(membershipView(null)).toBe("none");
    expect(membershipView(undefined)).toBe("none");
  });
});

describe("signOutCustomer", () => {
  it("treats 2xx and 401 as signed out", async () => {
    expect(await signOutCustomer("acme", fetchReturning(jsonResponse(204, undefined)))).toEqual({ ok: true });
    expect(await signOutCustomer("acme", fetchReturning(jsonResponse(401, undefined)))).toEqual({ ok: true });
    expect(await signOutCustomer("acme", fetchReturning(jsonResponse(500, undefined)))).toEqual({ ok: false, kind: "failed" });
    expect(await signOutCustomer("acme", fetchReturning(new TypeError("x")))).toEqual({ ok: false, kind: "offline" });
  });
});

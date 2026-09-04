import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { CustomerIdentityDeps } from "@/lib/customer-identity/config";
import { mintSessionCredential } from "@/lib/customer-identity/credentials";
import { CustomerIdentityStoreError } from "@/lib/customer-identity/errors";
import {
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_PATH,
  SESSION_IDLE_TTL_SECONDS,
  clearSessionCookie,
  readSession,
  setSessionCookie,
  signOut,
  signOutEverywhere,
} from "@/lib/customer-identity/session";

const IDENTITY_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const FINGERPRINT = "c".repeat(64);

type RpcHandler = (
  fn: string,
  args: Record<string, unknown>
) => { data: unknown; error: unknown };

function makeDeps(handler: RpcHandler) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) =>
    handler(fn, args)
  );
  const deps: CustomerIdentityDeps = {
    rpc: { rpc },
    auth: {
      auth: {
        signInWithOtp: vi.fn(),
        verifyOtp: vi.fn(),
        admin: { updateUserById: vi.fn() },
      },
    },
    keyRing: { activeKid: 1, keys: new Map([[1, Buffer.alloc(32, 9)]]) },
  };
  return { deps, rpc };
}

function rpcCalls(rpc: ReturnType<typeof vi.fn>, fn: string) {
  return rpc.mock.calls.filter((call) => call[0] === fn);
}

function eventTypes(rpc: ReturnType<typeof vi.fn>): string[] {
  return rpcCalls(rpc, "append_customer_identity_event_as_system").map(
    (call) => (call[1] as { p_event_type: string }).p_event_type
  );
}

function requestWithCookie(value: string | null): NextRequest {
  return new NextRequest("https://app.opsapp.co/c/maverick/home", {
    headers: value === null ? {} : { cookie: `${SESSION_COOKIE_NAME}=${value}` },
  });
}

function digestOf(credential: string): string {
  return createHash("sha256").update(credential, "utf8").digest("hex");
}

const okResolver =
  (identityId = IDENTITY_ID, sessionId = SESSION_ID): RpcHandler =>
  (fn) => {
    switch (fn) {
      case "resolve_customer_session_as_system":
        return {
          data: [{ identity_id: identityId, session_id: sessionId, status: "ok" }],
          error: null,
        };
      case "revoke_customer_session_as_system":
        return { data: true, error: null };
      case "revoke_all_customer_sessions_as_system":
        return { data: 2, error: null };
      case "append_customer_identity_event_as_system":
        return { data: null, error: null };
      default:
        throw new Error(`unexpected rpc ${fn}`);
    }
  };

describe("session cookie contract", () => {
  it("pins the cookie name, path and lifetimes from the plan", () => {
    expect(SESSION_COOKIE_NAME).toBe("ops-customer-session");
    // Ruled 2026-09-02: Path=/ so the broker API under /api/customer receives it.
    expect(SESSION_COOKIE_PATH).toBe("/");
    expect(SESSION_ABSOLUTE_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(SESSION_IDLE_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it("sets the session cookie httpOnly, Secure, SameSite=Lax, Path=/, 30-day max age", () => {
    const credential = mintSessionCredential();
    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, credential);

    const cookie = response.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(cookie?.value).toBe(credential);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
    expect(cookie?.maxAge).toBe(SESSION_ABSOLUTE_TTL_SECONDS);

    const header = response.headers.get("set-cookie") ?? "";
    expect(header).toContain(`${SESSION_COOKIE_NAME}=${credential}`);
    expect(header).toMatch(/Path=\/(;|$)/);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toMatch(/SameSite=lax/i);
    expect(header).toContain(`Max-Age=${SESSION_ABSOLUTE_TTL_SECONDS}`);
    expect(header).not.toContain("Domain=");
  });

  it("refuses to set anything that is not a credential this broker minted", () => {
    const response = NextResponse.json({ ok: true });
    expect(() => setSessionCookie(response, "ops_mcp_at_x")).toThrow(TypeError);
    expect(() => setSessionCookie(response, "")).toThrow(TypeError);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("clears the cookie on the same path with the same attributes and a zero max age", () => {
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    const cookie = response.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie?.value).toBe("");
    expect(cookie?.path).toBe("/");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.maxAge).toBe(0);
  });
});

describe("readSession", () => {
  it("returns null without touching the database when no cookie is present", async () => {
    const { deps, rpc } = makeDeps(okResolver());
    expect(await readSession(deps, requestWithCookie(null))).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns null without touching the database for a malformed credential", async () => {
    const { deps, rpc } = makeDeps(okResolver());
    expect(await readSession(deps, requestWithCookie("ops_cs_short"))).toBeNull();
    expect(await readSession(deps, requestWithCookie("eyJhbGciOiJIUzI1NiJ9.x.y"))).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("resolves a live session by digest only and returns the identity and session ids", async () => {
    const credential = mintSessionCredential();
    const { deps, rpc } = makeDeps(okResolver());
    const session = await readSession(deps, requestWithCookie(credential));
    expect(session).toEqual({ identityId: IDENTITY_ID, sessionId: SESSION_ID });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("resolve_customer_session_as_system", {
      p_session_hash: digestOf(credential),
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(credential);
  });

  it.each(["expired", "revoked", "unknown"] as const)(
    "returns null for a %s session",
    async (status) => {
      const { deps } = makeDeps((fn) =>
        fn === "resolve_customer_session_as_system"
          ? { data: [{ identity_id: null, session_id: null, status }], error: null }
          : okResolver()(fn, {})
      );
      expect(await readSession(deps, requestWithCookie(mintSessionCredential()))).toBeNull();
    }
  );

  it("propagates a store failure rather than treating it as signed out", async () => {
    const { deps } = makeDeps(() => ({ data: null, error: { message: "down" } }));
    await expect(
      readSession(deps, requestWithCookie(mintSessionCredential()))
    ).rejects.toBeInstanceOf(CustomerIdentityStoreError);
  });

  it("accepts any object exposing the cookie getter shape (route handlers and server components)", async () => {
    const credential = mintSessionCredential();
    const { deps } = makeDeps(okResolver());
    const session = await readSession(deps, {
      cookies: { get: (name: string) => (name === SESSION_COOKIE_NAME ? { value: credential } : undefined) },
    });
    expect(session?.identityId).toBe(IDENTITY_ID);
  });
});

describe("signOut", () => {
  it("revokes the presented session and records the revocation against its ids", async () => {
    const credential = mintSessionCredential();
    const { deps, rpc } = makeDeps(okResolver());
    const revoked = await signOut(deps, requestWithCookie(credential), {
      networkFingerprint: FINGERPRINT,
    });
    expect(revoked).toBe(true);
    expect(rpcCalls(rpc, "revoke_customer_session_as_system")[0][1]).toEqual({
      p_session_hash: digestOf(credential),
      p_reason: "user_signout",
    });
    expect(eventTypes(rpc)).toEqual(["session_revoked"]);
    const event = rpcCalls(rpc, "append_customer_identity_event_as_system")[0][1];
    expect(event).toMatchObject({
      p_identity_id: IDENTITY_ID,
      p_session_id: SESSION_ID,
      p_network_fingerprint: FINGERPRINT,
    });
  });

  it("is a no-op without a usable cookie", async () => {
    const { deps, rpc } = makeDeps(okResolver());
    expect(await signOut(deps, requestWithCookie(null), { networkFingerprint: FINGERPRINT })).toBe(false);
    expect(await signOut(deps, requestWithCookie("junk"), { networkFingerprint: FINGERPRINT })).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("still revokes an already-expired session but records no event when nothing changed", async () => {
    const { deps, rpc } = makeDeps((fn) => {
      if (fn === "resolve_customer_session_as_system") {
        return { data: [{ identity_id: null, session_id: null, status: "expired" }], error: null };
      }
      if (fn === "revoke_customer_session_as_system") return { data: false, error: null };
      return okResolver()(fn, {});
    });
    expect(
      await signOut(deps, requestWithCookie(mintSessionCredential()), { networkFingerprint: FINGERPRINT })
    ).toBe(false);
    expect(rpcCalls(rpc, "revoke_customer_session_as_system")).toHaveLength(1);
    expect(eventTypes(rpc)).toEqual([]);
  });
});

describe("signOutEverywhere", () => {
  it("revokes every session for the identity and records the count", async () => {
    const { deps, rpc } = makeDeps(okResolver());
    const count = await signOutEverywhere(deps, IDENTITY_ID, {
      reason: "user_signout_everywhere",
      networkFingerprint: FINGERPRINT,
    });
    expect(count).toBe(2);
    expect(rpcCalls(rpc, "revoke_all_customer_sessions_as_system")[0][1]).toEqual({
      p_identity_id: IDENTITY_ID,
      p_reason: "user_signout_everywhere",
    });
    expect(eventTypes(rpc)).toEqual(["sessions_revoked_all"]);
    expect(rpcCalls(rpc, "append_customer_identity_event_as_system")[0][1]).toMatchObject({
      p_identity_id: IDENTITY_ID,
      p_metadata: { revoked_sessions: 2, reason: "user_signout_everywhere" },
    });
  });

  it("records nothing when there was nothing to revoke", async () => {
    const { deps, rpc } = makeDeps((fn) =>
      fn === "revoke_all_customer_sessions_as_system"
        ? { data: 0, error: null }
        : okResolver()(fn, {})
    );
    expect(
      await signOutEverywhere(deps, IDENTITY_ID, { reason: "staff_revoked", networkFingerprint: null })
    ).toBe(0);
    expect(eventTypes(rpc)).toEqual([]);
  });
});

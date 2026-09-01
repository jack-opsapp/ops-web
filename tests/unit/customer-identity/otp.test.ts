import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CustomerIdentityDeps } from "@/lib/customer-identity/config";
import { SESSION_CREDENTIAL_PREFIX } from "@/lib/customer-identity/credentials";
import {
  CustomerContactConflictError,
  CustomerIdentityInputError,
  CustomerIdentityStoreError,
} from "@/lib/customer-identity/errors";
import {
  OTP_MAX_ATTEMPTS,
  startOtp,
  verifyOtp,
} from "@/lib/customer-identity/otp";

const CHALLENGE_ID = "11111111-1111-4111-8111-111111111111";
const IDENTITY_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const AUTH_SUBJECT = "88888888-8888-4888-8888-888888888888";
const FINGERPRINT = "c".repeat(64);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACCESS_TOKEN = "eyJhbGciOiJIUzI1NiJ9.SUPABASE_ACCESS.sig";
const REFRESH_TOKEN = "supabase-refresh-token-value";
const CODE = "482913";

const SUPABASE_SESSION = {
  access_token: ACCESS_TOKEN,
  refresh_token: REFRESH_TOKEN,
  token_type: "bearer",
  expires_in: 3600,
  user: { id: AUTH_SUBJECT },
};

type RpcHandler = (
  fn: string,
  args: Record<string, unknown>
) => { data: unknown; error: unknown };

function makeDeps(
  rpcHandler: RpcHandler,
  auth: Partial<{
    signInWithOtp: ReturnType<typeof vi.fn>;
    verifyOtp: ReturnType<typeof vi.fn>;
    updateUserById: ReturnType<typeof vi.fn>;
  }> = {}
) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) =>
    rpcHandler(fn, args)
  );
  const signInWithOtp =
    auth.signInWithOtp ?? vi.fn(async () => ({ error: null }));
  const verifyOtpMock =
    auth.verifyOtp ??
    vi.fn(async () => ({
      data: { user: { id: AUTH_SUBJECT }, session: SUPABASE_SESSION },
      error: null,
    }));
  const updateUserById =
    auth.updateUserById ?? vi.fn(async () => ({ error: null }));
  const deps: CustomerIdentityDeps = {
    rpc: { rpc },
    auth: {
      auth: {
        signInWithOtp,
        verifyOtp: verifyOtpMock,
        admin: { updateUserById },
      },
    },
    keyRing: { activeKid: 1, keys: new Map([[1, Buffer.alloc(32, 9)]]) },
  };
  return { deps, rpc, signInWithOtp, verifyOtp: verifyOtpMock, updateUserById };
}

function rpcCalls(rpc: ReturnType<typeof vi.fn>, fn: string) {
  return rpc.mock.calls.filter((call) => call[0] === fn);
}

function eventTypes(rpc: ReturnType<typeof vi.fn>): string[] {
  return rpcCalls(rpc, "append_customer_identity_event_as_system").map(
    (call) => (call[1] as { p_event_type: string }).p_event_type
  );
}

const happyRpc: RpcHandler = (fn) => {
  switch (fn) {
    case "begin_customer_otp_challenge_as_system":
      return {
        data: [{ challenge_id: CHALLENGE_ID, allowed: true, retry_after_seconds: 60 }],
        error: null,
      };
    case "record_customer_otp_attempt_as_system":
      return { data: [{ attempts: 1, exhausted: false }], error: null };
    case "upsert_customer_identity_as_system":
      return { data: [{ identity_id: IDENTITY_ID, created: false }], error: null };
    case "mint_customer_session_as_system":
      return { data: SESSION_ID, error: null };
    case "append_customer_identity_event_as_system":
      return { data: null, error: null };
    default:
      throw new Error(`unexpected rpc ${fn}`);
  }
};

const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    consoleSpies.push(vi.spyOn(console, method).mockImplementation(() => {}));
  }
});
afterEach(() => {
  for (const spy of consoleSpies.splice(0)) spy.mockRestore();
});

function allConsoleText(): string {
  return consoleSpies
    .flatMap((spy) => spy.mock.calls)
    .map((call) => call.map((part) => JSON.stringify(part) ?? String(part)).join(" "))
    .join("\n");
}

describe("startOtp", () => {
  it("refuses an unnormalizable email before any network call", async () => {
    const { deps, rpc, signInWithOtp } = makeDeps(happyRpc);
    await expect(
      startOtp(deps, { email: "not an email", networkFingerprint: FINGERPRINT })
    ).rejects.toBeInstanceOf(CustomerIdentityInputError);
    expect(rpc).not.toHaveBeenCalled();
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("begins the challenge with the keyed digest, then proxies to the customer project with the normalized email", async () => {
    const { deps, rpc, signInWithOtp } = makeDeps(happyRpc);
    const result = await startOtp(deps, {
      email: "  Jane@Example.COM ",
      networkFingerprint: FINGERPRINT,
    });

    expect(result).toEqual({ challengeId: CHALLENGE_ID, retryAfterSeconds: 60 });

    const [begin] = rpcCalls(rpc, "begin_customer_otp_challenge_as_system");
    expect(begin[1]).toMatchObject({ p_network_fingerprint: FINGERPRINT });
    expect((begin[1] as { p_email_digest: string }).p_email_digest).toMatch(
      /^1:[0-9a-f]{64}$/
    );
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("example.com");

    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "jane@example.com",
      options: { shouldCreateUser: true },
    });
    expect(eventTypes(rpc)).toEqual(["otp_started"]);
  });

  it("refuses before proxying when the broker send limit is hit, with the same response shape", async () => {
    const { deps, rpc, signInWithOtp } = makeDeps((fn) =>
      fn === "begin_customer_otp_challenge_as_system"
        ? {
            data: [{ challenge_id: null, allowed: false, retry_after_seconds: 42 }],
            error: null,
          }
        : happyRpc(fn, {})
    );
    const result = await startOtp(deps, {
      email: "jane@example.com",
      networkFingerprint: FINGERPRINT,
    });

    expect(Object.keys(result).sort()).toEqual(["challengeId", "retryAfterSeconds"]);
    expect(result.challengeId).toMatch(UUID);
    expect(result.retryAfterSeconds).toBe(42);
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(eventTypes(rpc)).toEqual(["otp_refused"]);
  });

  it("returns the identical shape when the customer project refuses the send (I5)", async () => {
    const { deps, rpc } = makeDeps(happyRpc, {
      signInWithOtp: vi.fn(async () => ({
        error: { name: "AuthApiError", status: 429, code: "over_email_send_rate_limit", message: "rate limit" },
      })),
    });
    const result = await startOtp(deps, {
      email: "jane@example.com",
      networkFingerprint: FINGERPRINT,
    });
    expect(result).toEqual({ challengeId: CHALLENGE_ID, retryAfterSeconds: 60 });
    expect(eventTypes(rpc)).toEqual(["otp_send_failed"]);
    expect(allConsoleText()).not.toContain("jane@example.com");
  });

  it("returns the identical shape when the customer project throws", async () => {
    const { deps } = makeDeps(happyRpc, {
      signInWithOtp: vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    });
    const result = await startOtp(deps, {
      email: "jane@example.com",
      networkFingerprint: FINGERPRINT,
    });
    expect(result).toEqual({ challengeId: CHALLENGE_ID, retryAfterSeconds: 60 });
  });

  it("does not let the customer project's answer shape the response for known vs unknown emails", async () => {
    const known = await startOtp(
      makeDeps(happyRpc, {
        signInWithOtp: vi.fn(async () => ({ error: null, data: { user: null, session: null, messageId: "m1" } })),
      }).deps,
      { email: "known@example.com", networkFingerprint: FINGERPRINT }
    );
    const unknown = await startOtp(
      makeDeps(happyRpc, {
        signInWithOtp: vi.fn(async () => ({ error: null, data: { user: null, session: null, messageId: null } })),
      }).deps,
      { email: "unknown@example.com", networkFingerprint: FINGERPRINT }
    );
    expect(Object.keys(known)).toEqual(Object.keys(unknown));
    expect(known).toEqual(unknown);
  });

  it("propagates a store failure from the challenge RPC (not an existence signal)", async () => {
    const { deps, signInWithOtp } = makeDeps((fn) =>
      fn === "begin_customer_otp_challenge_as_system"
        ? { data: null, error: { message: "down" } }
        : happyRpc(fn, {})
    );
    await expect(
      startOtp(deps, { email: "jane@example.com", networkFingerprint: FINGERPRINT })
    ).rejects.toBeInstanceOf(CustomerIdentityStoreError);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
});

describe("verifyOtp", () => {
  const input = {
    challengeId: CHALLENGE_ID,
    email: "jane@example.com",
    code: CODE,
    networkFingerprint: FINGERPRINT,
  };

  it("pins five attempts per challenge (I8)", () => {
    expect(OTP_MAX_ATTEMPTS).toBe(5);
  });

  it.each([
    ["challengeId", { ...input, challengeId: "nope" }],
    ["email", { ...input, email: "nope" }],
    ["code", { ...input, code: "12345" }],
    ["code", { ...input, code: "12345a" }],
    ["code", { ...input, code: "" }],
  ])("refuses malformed %s before touching the database", async (field, bad) => {
    const { deps, rpc, verifyOtp: proxy } = makeDeps(happyRpc);
    let caught: unknown;
    try {
      await verifyOtp(deps, bad);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CustomerIdentityInputError);
    expect((caught as CustomerIdentityInputError).field).toBe(field);
    expect(rpc).not.toHaveBeenCalled();
    expect(proxy).not.toHaveBeenCalled();
  });

  it("accepts a code with surrounding whitespace and forwards the trimmed digits", async () => {
    const { deps, verifyOtp: proxy } = makeDeps(happyRpc);
    const result = await verifyOtp(deps, { ...input, code: ` ${CODE}\n` });
    expect(result.ok).toBe(true);
    expect(proxy).toHaveBeenCalledWith({
      email: "jane@example.com",
      token: CODE,
      type: "email",
    });
  });

  it("charges the attempt before proxying and refuses an exhausted challenge without calling the customer project", async () => {
    const { deps, rpc, verifyOtp: proxy } = makeDeps((fn) =>
      fn === "record_customer_otp_attempt_as_system"
        ? { data: [{ attempts: 6, exhausted: true }], error: null }
        : happyRpc(fn, {})
    );
    const result = await verifyOtp(deps, input);
    expect(result).toEqual({ ok: false, reason: "challenge_exhausted" });
    expect(proxy).not.toHaveBeenCalled();
    const [record] = rpcCalls(rpc, "record_customer_otp_attempt_as_system");
    expect(record[1]).toEqual({ p_challenge_id: CHALLENGE_ID, p_success: false });
    expect(eventTypes(rpc)).toEqual(["otp_refused"]);
  });

  it("refuses a challenge the database closed (expired or consumed) as closed, not exhausted", async () => {
    const { deps, verifyOtp: proxy } = makeDeps((fn) =>
      fn === "record_customer_otp_attempt_as_system"
        ? { data: [{ attempts: 2, exhausted: true }], error: null }
        : happyRpc(fn, {})
    );
    expect(await verifyOtp(deps, input)).toEqual({ ok: false, reason: "challenge_closed" });
    expect(proxy).not.toHaveBeenCalled();
  });

  it("refuses an unknown challenge uniformly as closed", async () => {
    const { deps, verifyOtp: proxy } = makeDeps((fn) =>
      fn === "record_customer_otp_attempt_as_system"
        ? { data: [], error: null }
        : happyRpc(fn, {})
    );
    expect(await verifyOtp(deps, input)).toEqual({ ok: false, reason: "challenge_closed" });
    expect(proxy).not.toHaveBeenCalled();
  });

  it("reports a wrong code with the attempts left, having already charged the attempt", async () => {
    const { deps, rpc } = makeDeps(
      (fn) =>
        fn === "record_customer_otp_attempt_as_system"
          ? { data: [{ attempts: 2, exhausted: false }], error: null }
          : happyRpc(fn, {}),
      {
        verifyOtp: vi.fn(async () => ({
          data: { user: null, session: null },
          error: { name: "AuthApiError", status: 403, code: "otp_expired", message: "Token has expired or is invalid" },
        })),
      }
    );
    const result = await verifyOtp(deps, input);
    expect(result).toEqual({ ok: false, reason: "invalid_code", attemptsRemaining: 3 });
    expect(rpcCalls(rpc, "record_customer_otp_attempt_as_system")).toHaveLength(1);
    expect(rpcCalls(rpc, "upsert_customer_identity_as_system")).toHaveLength(0);
    expect(eventTypes(rpc)).toEqual(["otp_failed"]);
  });

  it("treats a proxy answer without a user as a wrong code", async () => {
    const { deps } = makeDeps(happyRpc, {
      verifyOtp: vi.fn(async () => ({ data: { user: null, session: null }, error: null })),
    });
    expect(await verifyOtp(deps, input)).toEqual({
      ok: false,
      reason: "invalid_code",
      attemptsRemaining: 4,
    });
  });

  it("treats a proxy exception as a wrong code rather than leaking the transport failure", async () => {
    const { deps } = makeDeps(happyRpc, {
      verifyOtp: vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    });
    expect(await verifyOtp(deps, input)).toEqual({
      ok: false,
      reason: "invalid_code",
      attemptsRemaining: 4,
    });
  });

  it("on success: consumes the challenge, upserts the identity, mints a broker session and records the events", async () => {
    const { deps, rpc, updateUserById } = makeDeps(happyRpc);
    const result = await verifyOtp(deps, input);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.credential.startsWith(SESSION_CREDENTIAL_PREFIX)).toBe(true);
    expect(result.identityId).toBe(IDENTITY_ID);
    expect(result.created).toBe(false);

    const records = rpcCalls(rpc, "record_customer_otp_attempt_as_system");
    expect(records.map((call) => call[1])).toEqual([
      { p_challenge_id: CHALLENGE_ID, p_success: false },
      { p_challenge_id: CHALLENGE_ID, p_success: true },
    ]);

    const [upsert] = rpcCalls(rpc, "upsert_customer_identity_as_system");
    expect(upsert[1]).toEqual({ p_auth_subject: AUTH_SUBJECT, p_email: "jane@example.com" });

    const [mint] = rpcCalls(rpc, "mint_customer_session_as_system");
    expect(mint[1]).toEqual({
      p_identity_id: IDENTITY_ID,
      p_session_hash: createHash("sha256").update(result.credential, "utf8").digest("hex"),
      p_network_fingerprint: FINGERPRINT,
    });

    expect(updateUserById).not.toHaveBeenCalled();
    expect(eventTypes(rpc)).toEqual(["otp_verified", "session_issued"]);
    const issued = rpcCalls(rpc, "append_customer_identity_event_as_system")[1][1] as Record<string, unknown>;
    expect(issued).toMatchObject({
      p_identity_id: IDENTITY_ID,
      p_session_id: SESSION_ID,
      p_network_fingerprint: FINGERPRINT,
    });
  });

  it("marks a brand-new auth user as a customer principal and records identity_created", async () => {
    const { deps, rpc, updateUserById } = makeDeps((fn) =>
      fn === "upsert_customer_identity_as_system"
        ? { data: [{ identity_id: IDENTITY_ID, created: true }], error: null }
        : happyRpc(fn, {})
    );
    const result = await verifyOtp(deps, input);
    expect(result.ok && result.created).toBe(true);
    expect(updateUserById).toHaveBeenCalledWith(AUTH_SUBJECT, {
      app_metadata: { principal: "customer" },
    });
    expect(eventTypes(rpc)).toEqual(["otp_verified", "identity_created", "session_issued"]);
  });

  it("fails closed when the principal marker cannot be written", async () => {
    const { deps, rpc } = makeDeps(
      (fn) =>
        fn === "upsert_customer_identity_as_system"
          ? { data: [{ identity_id: IDENTITY_ID, created: true }], error: null }
          : happyRpc(fn, {}),
      { updateUserById: vi.fn(async () => ({ error: { message: "nope" } })) }
    );
    await expect(verifyOtp(deps, input)).rejects.toBeInstanceOf(CustomerIdentityStoreError);
    expect(rpcCalls(rpc, "mint_customer_session_as_system")).toHaveLength(0);
  });

  it("surfaces a verified contact owned by another identity as the typed conflict, without a session", async () => {
    const { deps, rpc } = makeDeps((fn) =>
      fn === "upsert_customer_identity_as_system"
        ? { data: null, error: { code: "23505", message: "customer_contact_conflict" } }
        : happyRpc(fn, {})
    );
    await expect(verifyOtp(deps, input)).rejects.toBeInstanceOf(CustomerContactConflictError);
    expect(rpcCalls(rpc, "mint_customer_session_as_system")).toHaveLength(0);
    expect(eventTypes(rpc)).toEqual(["otp_verified", "contact_conflict"]);
  });

  it("never persists, logs or returns the Supabase session", async () => {
    const { deps, rpc } = makeDeps(happyRpc);
    const result = await verifyOtp(deps, input);

    const serializedResult = JSON.stringify(result);
    expect(serializedResult).not.toContain(ACCESS_TOKEN);
    expect(serializedResult).not.toContain(REFRESH_TOKEN);
    expect(serializedResult).not.toContain("session");

    const serializedRpc = JSON.stringify(rpc.mock.calls);
    expect(serializedRpc).not.toContain(ACCESS_TOKEN);
    expect(serializedRpc).not.toContain(REFRESH_TOKEN);
    expect(serializedRpc).not.toContain(CODE);
    if (result.ok) expect(serializedRpc).not.toContain(result.credential);

    const logged = allConsoleText();
    expect(logged).not.toContain(ACCESS_TOKEN);
    expect(logged).not.toContain(REFRESH_TOKEN);
    expect(logged).not.toContain(CODE);
    expect(logged).not.toContain("jane@example.com");
  });
});

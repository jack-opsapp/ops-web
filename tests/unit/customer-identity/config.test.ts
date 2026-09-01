import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getServiceRoleClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));

import {
  CUSTOMER_AUTH_SECRET_KEY_ENV,
  CUSTOMER_AUTH_URL_ENV,
  CUSTOMER_IDENTITY_HMAC_KEYS_ENV,
  getCustomerIdentityDeps,
  parseCustomerIdentityHmacKeyRing,
  readCustomerIdentityConfig,
} from "@/lib/customer-identity/config";
import { CustomerIdentityUnavailableError } from "@/lib/customer-identity/errors";

const KEY_1 = Buffer.alloc(32, 1).toString("base64url");
const KEY_2 = Buffer.alloc(48, 2).toString("base64url");
const RING = JSON.stringify({ activeKid: "2", keys: { "1": KEY_1, "2": KEY_2 } });

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    [CUSTOMER_AUTH_URL_ENV]: "https://abcdefgh.supabase.co",
    [CUSTOMER_AUTH_SECRET_KEY_ENV]: "sb_secret_test",
    [CUSTOMER_IDENTITY_HMAC_KEYS_ENV]: RING,
    ...overrides,
  };
}

function expectUnavailable(
  run: () => unknown,
  reason: "blank" | "malformed"
): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(CustomerIdentityUnavailableError);
  const error = caught as CustomerIdentityUnavailableError;
  expect(error.code).toBe("customer_identity_unavailable");
  expect(error.reason).toBe(reason);
}

describe("readCustomerIdentityConfig", () => {
  it("pins the server-only env var names (never NEXT_PUBLIC_)", () => {
    for (const name of [
      CUSTOMER_AUTH_URL_ENV,
      CUSTOMER_AUTH_SECRET_KEY_ENV,
      CUSTOMER_IDENTITY_HMAC_KEYS_ENV,
    ]) {
      expect(name.startsWith("OPS_CUSTOMER_")).toBe(true);
      expect(name.startsWith("NEXT_PUBLIC_")).toBe(false);
    }
  });

  it("returns the validated origin, secret and parsed ring when everything is set", () => {
    const config = readCustomerIdentityConfig(env());
    expect(config.authUrl).toBe("https://abcdefgh.supabase.co");
    expect(config.authSecretKey).toBe("sb_secret_test");
    expect(config.keyRing.activeKid).toBe(2);
    expect([...config.keyRing.keys.keys()]).toEqual([1, 2]);
  });

  it("fails closed as blank when any of the three vars is missing or whitespace", () => {
    expectUnavailable(
      () => readCustomerIdentityConfig(env({ [CUSTOMER_AUTH_URL_ENV]: undefined })),
      "blank"
    );
    expectUnavailable(
      () => readCustomerIdentityConfig(env({ [CUSTOMER_AUTH_URL_ENV]: "   " })),
      "blank"
    );
    expectUnavailable(
      () =>
        readCustomerIdentityConfig(env({ [CUSTOMER_AUTH_SECRET_KEY_ENV]: "" })),
      "blank"
    );
    expectUnavailable(
      () =>
        readCustomerIdentityConfig(
          env({ [CUSTOMER_IDENTITY_HMAC_KEYS_ENV]: undefined })
        ),
      "blank"
    );
    expectUnavailable(() => readCustomerIdentityConfig({}), "blank");
  });

  it("fails closed as malformed when the auth URL is not a bare http(s) origin", () => {
    for (const bad of [
      "not a url",
      "ftp://abcdefgh.supabase.co",
      "https://user:pw@abcdefgh.supabase.co",
      "https://abcdefgh.supabase.co/?x=1",
      "https://abcdefgh.supabase.co/#frag",
    ]) {
      expectUnavailable(
        () => readCustomerIdentityConfig(env({ [CUSTOMER_AUTH_URL_ENV]: bad })),
        "malformed"
      );
    }
  });

  it("normalizes the auth URL to its origin", () => {
    expect(
      readCustomerIdentityConfig(
        env({ [CUSTOMER_AUTH_URL_ENV]: "HTTPS://ABCDEFGH.supabase.co/" })
      ).authUrl
    ).toBe("https://abcdefgh.supabase.co");
  });
});

describe("parseCustomerIdentityHmacKeyRing", () => {
  it("parses the intake ring format with numeric key ids and decoded material", () => {
    const ring = parseCustomerIdentityHmacKeyRing(RING);
    expect(ring.activeKid).toBe(2);
    expect(ring.keys.get(1)?.equals(Buffer.alloc(32, 1))).toBe(true);
    expect(ring.keys.get(2)?.equals(Buffer.alloc(48, 2))).toBe(true);
    expect(Object.isFrozen(ring)).toBe(true);
  });

  it("is blank for undefined or whitespace", () => {
    expectUnavailable(() => parseCustomerIdentityHmacKeyRing(undefined), "blank");
    expectUnavailable(() => parseCustomerIdentityHmacKeyRing("  "), "blank");
  });

  it.each([
    ["invalid JSON", "{"],
    ["an array", "[]"],
    ["extra fields", JSON.stringify({ activeKid: "1", keys: { "1": KEY_1 }, x: 1 })],
    ["missing keys", JSON.stringify({ activeKid: "1" })],
    ["keys as array", JSON.stringify({ activeKid: "1", keys: [KEY_1] })],
    ["numeric activeKid", JSON.stringify({ activeKid: 1, keys: { "1": KEY_1 } })],
    ["zero activeKid", JSON.stringify({ activeKid: "0", keys: { "0": KEY_1 } })],
    ["active key absent", JSON.stringify({ activeKid: "3", keys: { "1": KEY_1 } })],
    ["no keys", JSON.stringify({ activeKid: "1", keys: {} })],
    [
      "four keys",
      JSON.stringify({
        activeKid: "1",
        keys: {
          "1": KEY_1,
          "2": KEY_2,
          "3": Buffer.alloc(32, 3).toString("base64url"),
          "4": Buffer.alloc(32, 4).toString("base64url"),
        },
      }),
    ],
    ["short key", JSON.stringify({ activeKid: "1", keys: { "1": Buffer.alloc(31, 1).toString("base64url") } })],
    ["long key", JSON.stringify({ activeKid: "1", keys: { "1": Buffer.alloc(65, 1).toString("base64url") } })],
    ["non-base64url key", JSON.stringify({ activeKid: "1", keys: { "1": "abc+/=" } })],
    ["padded base64", JSON.stringify({ activeKid: "1", keys: { "1": `${KEY_1}=` } })],
    ["duplicate material", JSON.stringify({ activeKid: "1", keys: { "1": KEY_1, "2": KEY_1 } })],
    ["key id out of range", JSON.stringify({ activeKid: "1", keys: { "1": KEY_1, "40000": KEY_2 } })],
  ])("is malformed for %s", (_label, serialized) => {
    expectUnavailable(
      () => parseCustomerIdentityHmacKeyRing(serialized),
      "malformed"
    );
  });
});

describe("getCustomerIdentityDeps", () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.getServiceRoleClient.mockReset();
  });

  it("fails closed before constructing any client when unconfigured", () => {
    expectUnavailable(() => getCustomerIdentityDeps({}), "blank");
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.getServiceRoleClient).not.toHaveBeenCalled();
  });

  it("wires the main-project service-role RPC client and a non-persisting customer admin client", () => {
    const rpcClient = { rpc: vi.fn() };
    const authClient = { auth: {} };
    mocks.getServiceRoleClient.mockReturnValue(rpcClient);
    mocks.createClient.mockReturnValue(authClient);

    const deps = getCustomerIdentityDeps(env());

    expect(deps.rpc).toBe(rpcClient);
    expect(deps.auth).toBe(authClient);
    expect(deps.keyRing.activeKid).toBe(2);
    expect(mocks.createClient).toHaveBeenCalledWith(
      "https://abcdefgh.supabase.co",
      "sb_secret_test",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    );
  });

  it("reuses the customer admin client for the same configuration and rebuilds it when it changes", () => {
    mocks.getServiceRoleClient.mockReturnValue({ rpc: vi.fn() });
    mocks.createClient.mockImplementation(() => ({ auth: {} }));

    // A URL this file has not used yet, so the module cache starts cold here.
    const cold = env({ [CUSTOMER_AUTH_URL_ENV]: "https://coldstart.supabase.co" });
    const first = getCustomerIdentityDeps(cold);
    const second = getCustomerIdentityDeps(cold);
    expect(second.auth).toBe(first.auth);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);

    const rotated = getCustomerIdentityDeps({
      ...cold,
      [CUSTOMER_AUTH_SECRET_KEY_ENV]: "sb_secret_rotated",
    });
    expect(rotated.auth).not.toBe(first.auth);
    expect(mocks.createClient).toHaveBeenCalledTimes(2);
  });
});

/**
 * Unit tests for AccountingTokenService — the single server-side gate for
 * accounting OAuth tokens. Asserts the security + robustness contract:
 *
 *  1. getValidToken DECRYPTS stored ciphertext (caller gets plaintext).
 *  2. A refresh persists ENCRYPTED tokens (stored value isEncrypted()).
 *  3. invalid_grant on refresh → is_connected=false + ReconnectRequiredError.
 *  4. A transient 429 retries ONCE, then succeeds.
 *
 * QB_TOKEN_ENC_KEY is provided by tests/setup.ts (fail-closed without it).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AccountingTokenService,
  ReconnectRequiredError,
} from "@/lib/api/services/accounting-token-service";
import { encryptToken, isEncrypted } from "@/lib/api/services/token-cipher";

const CONNECTION_ID = "conn-1";

process.env.QB_CLIENT_ID = "qb-client";
process.env.QB_CLIENT_SECRET = "qb-secret";

type Row = Record<string, unknown>;

/**
 * Minimal in-memory Supabase double for a single accounting_connections row.
 * Records the last .update() payload so tests can assert what was persisted.
 */
function makeSupabase(initial: Row) {
  const row: Row = { ...initial };
  const updates: Row[] = [];

  const client = {
    from() {
      const filters: Array<(r: Row) => boolean> = [];
      const api: Record<string, unknown> = {
        select: () => api,
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return api;
        },
        single: () =>
          Promise.resolve(
            filters.every((f) => f(row))
              ? { data: { ...row }, error: null }
              : { data: null, error: { message: "not found" } }
          ),
        update: (patch: Row) => ({
          eq: () => {
            Object.assign(row, patch);
            updates.push(patch);
            return Promise.resolve({ error: null });
          },
        }),
      };
      return api;
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    get row() {
      return row;
    },
    get updates() {
      return updates;
    },
  };
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const PAST = () => new Date(Date.now() - 60 * 1000).toISOString();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AccountingTokenService.getValidToken — decrypt on read", () => {
  it("decrypts stored ciphertext and returns plaintext token + realm id", async () => {
    const db = makeSupabase({
      id: CONNECTION_ID,
      provider: "quickbooks",
      access_token: encryptToken("plain-access"),
      refresh_token: encryptToken("plain-refresh"),
      realm_id: encryptToken("realm-123"),
      token_expires_at: FUTURE(), // not expired → no refresh
    });

    const result = await AccountingTokenService.getValidToken(db.client, CONNECTION_ID);

    expect(result.accessToken).toBe("plain-access");
    expect(result.realmId).toBe("realm-123");
    // Stored values stay ENCRYPTED — the read must not rewrite them as plaintext.
    expect(isEncrypted(db.row.access_token as string)).toBe(true);
    expect(isEncrypted(db.row.realm_id as string)).toBe(true);
  });
});

describe("AccountingTokenService.getValidToken — refresh persists encrypted", () => {
  it("re-encrypts the refreshed tokens before persisting", async () => {
    const db = makeSupabase({
      id: CONNECTION_ID,
      provider: "quickbooks",
      access_token: encryptToken("old-access"),
      refresh_token: encryptToken("old-refresh"),
      realm_id: encryptToken("realm-123"),
      token_expires_at: PAST(), // expired → triggers refresh
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
        })
      )
    );

    const result = await AccountingTokenService.getValidToken(db.client, CONNECTION_ID);

    // Caller receives the PLAINTEXT new access token.
    expect(result.accessToken).toBe("new-access");

    // Persisted tokens must be ENCRYPTED, not the raw provider values.
    const persisted = db.updates.at(-1)!;
    expect(isEncrypted(persisted.access_token as string)).toBe(true);
    expect(isEncrypted(persisted.refresh_token as string)).toBe(true);
    expect(persisted.access_token).not.toBe("new-access");
    expect(persisted.refresh_token).not.toBe("new-refresh");
  });
});

describe("AccountingTokenService.getValidToken — invalid_grant → reconnect", () => {
  it("sets is_connected=false and throws ReconnectRequiredError", async () => {
    const db = makeSupabase({
      id: CONNECTION_ID,
      provider: "quickbooks",
      access_token: encryptToken("old-access"),
      refresh_token: encryptToken("dead-refresh"),
      realm_id: encryptToken("realm-123"),
      token_expires_at: PAST(),
      is_connected: true,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(400, { error: "invalid_grant" }))
    );

    await expect(
      AccountingTokenService.getValidToken(db.client, CONNECTION_ID)
    ).rejects.toBeInstanceOf(ReconnectRequiredError);

    expect(db.row.is_connected).toBe(false);
    // The connection was flipped via an update carrying is_connected=false.
    expect(db.updates.some((u) => u.is_connected === false)).toBe(true);
  });

  it("ReconnectRequiredError carries a stable .code", async () => {
    const err = new ReconnectRequiredError("QuickBooks");
    expect(err.code).toBe("reconnect_required");
    expect(err.provider).toBe("QuickBooks");
  });
});

describe("AccountingTokenService.getValidToken — transient 429 retries once", () => {
  it("retries exactly once on 429, then succeeds", async () => {
    const db = makeSupabase({
      id: CONNECTION_ID,
      provider: "quickbooks",
      access_token: encryptToken("old-access"),
      refresh_token: encryptToken("old-refresh"),
      realm_id: encryptToken("realm-123"),
      token_expires_at: PAST(),
    });

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, "rate limited"))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: "after-retry-access",
          refresh_token: "after-retry-refresh",
          expires_in: 3600,
        })
      );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await AccountingTokenService.getValidToken(db.client, CONNECTION_ID);

    expect(fetchSpy).toHaveBeenCalledTimes(2); // initial + one retry
    expect(result.accessToken).toBe("after-retry-access");
    expect(isEncrypted(db.updates.at(-1)!.access_token as string)).toBe(true);
  });

  it("does not retry on a non-transient 4xx (other than 429)", async () => {
    const db = makeSupabase({
      id: CONNECTION_ID,
      provider: "quickbooks",
      access_token: encryptToken("old-access"),
      refresh_token: encryptToken("old-refresh"),
      realm_id: encryptToken("realm-123"),
      token_expires_at: PAST(),
    });

    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, "forbidden"));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      AccountingTokenService.getValidToken(db.client, CONNECTION_ID)
    ).rejects.toThrow(/HTTP 403/);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no retry
  });
});

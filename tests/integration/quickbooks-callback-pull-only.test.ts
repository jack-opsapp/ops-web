/**
 * Integration test: the QuickBooks OAuth callback must land the connection in
 * read-only mode — sync_direction='pull_only', sync_enabled=false — and must
 * NOT auto-trigger any sync. This is a hard safety requirement for the Canpro
 * live test (spec §4, §6): a connected real company file must never be eligible
 * for the untested push path or for the scheduler.
 *
 * Mocking strategy mirrors stripe-webhook-billing-events.test.ts: a hand-rolled
 * Supabase mock records every .update(...) payload so we assert on the row the
 * callback tried to write. We stub global fetch for the Intuit token exchange.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { isEncrypted, decryptToken } from "@/lib/api/services/token-cipher";

process.env.QB_CLIENT_ID = "AB_test_client_id";
process.env.QB_CLIENT_SECRET = "test_client_secret";
process.env.QB_REDIRECT_URI =
  "https://app.opsapp.co/api/integrations/quickbooks/callback";
process.env.QB_ENVIRONMENT = "production";
process.env.NEXT_PUBLIC_APP_URL = "https://app.opsapp.co";

const COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";
const STATE = `${COMPANY_ID}:deadbeefdeadbeefdeadbeefdeadbeef`;

const updateCalls: Array<{ payload: Record<string, unknown> }> = [];

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({
              data: { webhook_verifier_token: STATE },
              error: null,
            }),
          }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        updateCalls.push({ payload });
        return {
          eq: () => ({ eq: async () => ({ error: null }) }),
        };
      },
    }),
  }),
}));

import { GET } from "@/app/api/integrations/quickbooks/callback/route";

describe("QuickBooks OAuth callback — pull_only landing", () => {
  beforeEach(() => {
    updateCalls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          access_token: "qb_access_token",
          refresh_token: "qb_refresh_token",
          expires_in: 3600,
        }),
      })),
    );
  });

  it("sets sync_direction='pull_only' and sync_enabled=false on connect", async () => {
    const url =
      "https://app.opsapp.co/api/integrations/quickbooks/callback" +
      `?code=auth_code_123&state=${encodeURIComponent(STATE)}&realmId=9999999999`;
    const req = new Request(url, { method: "GET" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(req as any);

    // Redirects to the connected confirmation, not an error.
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("connected=quickbooks");

    // The token-storing update is the one that flips is_connected=true.
    const tokenUpdate = updateCalls.find(
      (c) => c.payload.is_connected === true,
    );
    expect(tokenUpdate).toBeDefined();
    expect(tokenUpdate!.payload.sync_direction).toBe("pull_only");
    expect(tokenUpdate!.payload.sync_enabled).toBe(false);
    expect(tokenUpdate!.payload.is_connected).toBe(true);

    // Tokens + realm id must be ENCRYPTED at rest (Intuit security req) —
    // never the raw plaintext from the token exchange.
    const accessToken = tokenUpdate!.payload.access_token as string;
    const refreshToken = tokenUpdate!.payload.refresh_token as string;
    const realmId = tokenUpdate!.payload.realm_id as string;
    expect(isEncrypted(accessToken)).toBe(true);
    expect(isEncrypted(refreshToken)).toBe(true);
    expect(isEncrypted(realmId)).toBe(true);
    expect(accessToken).not.toBe("qb_access_token");
    expect(realmId).not.toBe("9999999999");
    // …and round-trip back to the original plaintext.
    expect(decryptToken(accessToken)).toBe("qb_access_token");
    expect(decryptToken(refreshToken)).toBe("qb_refresh_token");
    expect(decryptToken(realmId)).toBe("9999999999");
  });
});

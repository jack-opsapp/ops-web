/**
 * Data Manager API transport. Same mocking strategy as the Ads client tests:
 * google-auth-library mocked, fetch stubbed, module re-imported per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    scopes: string[];
    constructor(opts: { scopes: string[] }) {
      this.scopes = opts.scopes;
      (globalThis as Record<string, unknown>).__lastScopes = opts.scopes;
    }
    async getClient() {
      return { getAccessToken: async () => ({ token: "dm-access-token" }) };
    }
  },
}));

interface Recorded { url: string; headers: Record<string, string>; body: Record<string, unknown> }
let requests: Recorded[];

function stubFetch(status: number, payload: unknown) {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      } as unknown as Response;
    })
  );
}

const sampleRequest = {
  destinations: [
    {
      operatingAccount: { accountType: "GOOGLE_ADS" as const, accountId: "4454506598" },
      loginAccount: { accountType: "GOOGLE_ADS" as const, accountId: "5448339076" },
      productDestinationId: "123",
    },
  ],
  events: [
    {
      transactionId: "trial_started:c1",
      eventTimestamp: "2026-09-08T10:00:00-07:00",
      eventSource: "WEB" as const,
      adIdentifiers: { gclid: "abc" },
      consent: { adUserData: "CONSENT_GRANTED" as const, adPersonalization: "CONSENT_GRANTED" as const },
    },
  ],
  encoding: "HEX" as const,
};

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("FIREBASE_ADMIN_SERVICE_ACCOUNT", JSON.stringify({ client_email: "t@t", private_key: "k" }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("data-manager-client", () => {
  it("posts the request body verbatim to events:ingest with a bearer token and the datamanager scope", async () => {
    stubFetch(200, { requestId: "req-9", fieldWarnings: [] });
    const { ingestEvents } = await import("@/lib/ads/data-manager-client");
    const out = await ingestEvents(sampleRequest);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://datamanager.googleapis.com/v1/events:ingest");
    expect(requests[0].headers.Authorization).toBe("Bearer dm-access-token");
    expect(requests[0].body).toMatchObject({ ...sampleRequest, validateOnly: false });
    expect((globalThis as Record<string, unknown>).__lastScopes).toEqual([
      "https://www.googleapis.com/auth/datamanager",
    ]);
    expect(out).toEqual({ requestId: "req-9", fieldWarnings: [] });
  });

  it("honours validateOnly", async () => {
    stubFetch(200, { requestId: "req-v" });
    const { ingestEvents } = await import("@/lib/ads/data-manager-client");
    const out = await ingestEvents(sampleRequest, { validateOnly: true });
    expect(requests[0].body.validateOnly).toBe(true);
    expect(out).toEqual({ requestId: "req-v", fieldWarnings: [] });
  });

  it("throws a typed DataManagerApiError on a non-2xx", async () => {
    const body = { error: { code: 403, status: "PERMISSION_DENIED", message: "Data Manager API has not been used" } };
    stubFetch(403, body);
    const mod = await import("@/lib/ads/data-manager-client");
    const failure = await mod.ingestEvents(sampleRequest).catch((e) => e);
    expect(failure).toBeInstanceOf(mod.DataManagerApiError);
    expect(failure.status).toBe(403);
    expect(failure.body).toBe(JSON.stringify(body));
    expect(failure.errorStatus).toBe("PERMISSION_DENIED");
    expect(failure.name).toBe("DataManagerApiError");
  });
});

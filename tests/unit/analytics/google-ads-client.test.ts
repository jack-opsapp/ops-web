/**
 * Unit tests for the Google Ads client request layer — specifically the two
 * production failure modes surfaced on 2026-08-05 (the first day the
 * developer token had Basic access) plus the manager→client resolution that
 * fixed the second:
 *
 *   1. PAGE_SIZE_NOT_SUPPORTED — requests must NOT contain pageSize.
 *   2. REQUESTED_METRICS_FOR_MANAGER — GOOGLE_ADS_CUSTOMER_ID is the manager
 *      account (holds the developer token); metrics queries must run against
 *      the serving client account underneath, with login-customer-id set to
 *      the manager.
 *
 * Mocking strategy:
 *   - vi.mock("google-auth-library") so no real JWT signing happens.
 *   - vi.stubGlobal("fetch", ...) with scripted per-call responses, recording
 *     every request (URL, headers, body) for assertions.
 *   - vi.resetModules() + dynamic import per test because the module memoizes
 *     the resolved serving customer for the instance lifetime.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    async getClient() {
      return {
        getAccessToken: async () => ({ token: "test-access-token" }),
      };
    }
  },
}));

const MANAGER_ID = "5448339076";
const CLIENT_ID = "4454506598";

interface RecordedRequest {
  url: string;
  loginCustomerId: string | undefined;
  body: Record<string, unknown>;
}

let requests: RecordedRequest[];

function customerClientRow(
  id: string,
  level: number,
  manager: boolean,
  status = "ENABLED",
  name = "acct"
) {
  return {
    customerClient: {
      id,
      descriptiveName: name,
      level: String(level),
      manager,
      status,
    },
  };
}

/** Install a fetch stub that answers discovery + data calls from a script. */
function installFetch(discoveryRows: unknown[], dataRows: unknown[] = []) {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const headers = (init?.headers ?? {}) as Record<string, string>;
      requests.push({
        url: String(url),
        loginCustomerId: headers["login-customer-id"],
        body,
      });
      const isDiscovery = String(body.query).includes("FROM customer_client");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: isDiscovery ? discoveryRows : dataRows,
        }),
        text: async () => "",
      } as unknown as Response;
    })
  );
}

async function importClient() {
  return import("@/lib/analytics/google-ads-client");
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("GOOGLE_ADS_DEVELOPER_TOKEN", "dev-token");
  vi.stubEnv("GOOGLE_ADS_CUSTOMER_ID", MANAGER_ID);
  vi.stubEnv(
    "FIREBASE_ADMIN_SERVICE_ACCOUNT",
    JSON.stringify({ client_email: "t@t", private_key: "k" })
  );
  vi.stubEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("google-ads-client request layer", () => {
  it("resolves a manager id to its single enabled client and sends login-customer-id", async () => {
    installFetch(
      [
        customerClientRow(MANAGER_ID, 0, true, "ENABLED", "OPS LTD"),
        customerClientRow(CLIENT_ID, 1, false, "ENABLED", "OPS"),
      ],
      [{ segments: { date: "2026-08-01" }, metrics: { costMicros: "1000000" } }]
    );
    const client = await importClient();
    const rows = await client.queryDailyAccountData(
      new Date("2026-08-01T00:00:00Z"),
      new Date("2026-08-01T00:00:00Z")
    );

    expect(rows).toHaveLength(1);
    // Call 1 = discovery against the configured (manager) id, no login header
    expect(requests[0].url).toContain(`/customers/${MANAGER_ID}/`);
    expect(requests[0].loginCustomerId).toBeUndefined();
    // Call 2 = metrics against the resolved client id WITH the manager login header
    expect(requests[1].url).toContain(`/customers/${CLIENT_ID}/`);
    expect(requests[1].loginCustomerId).toBe(MANAGER_ID);
  });

  it("never sends pageSize in any request body", async () => {
    installFetch(
      [
        customerClientRow(MANAGER_ID, 0, true, "ENABLED", "OPS LTD"),
        customerClientRow(CLIENT_ID, 1, false, "ENABLED", "OPS"),
      ],
      []
    );
    const client = await importClient();
    await client.queryDailyAccountData(
      new Date("2026-08-01T00:00:00Z"),
      new Date("2026-08-02T00:00:00Z")
    );

    expect(requests.length).toBeGreaterThan(0);
    for (const req of requests) {
      expect(req.body).not.toHaveProperty("pageSize");
    }
  });

  it("queries a non-manager configured id directly with no login header", async () => {
    vi.stubEnv("GOOGLE_ADS_CUSTOMER_ID", CLIENT_ID);
    installFetch([customerClientRow(CLIENT_ID, 0, false, "ENABLED", "OPS")], []);
    const client = await importClient();
    await client.queryDailyAccountData(
      new Date("2026-08-01T00:00:00Z"),
      new Date("2026-08-01T00:00:00Z")
    );

    expect(requests[1].url).toContain(`/customers/${CLIENT_ID}/`);
    expect(requests[1].loginCustomerId).toBeUndefined();
  });

  it("shares one discovery call across parallel queries", async () => {
    installFetch(
      [
        customerClientRow(MANAGER_ID, 0, true, "ENABLED", "OPS LTD"),
        customerClientRow(CLIENT_ID, 1, false, "ENABLED", "OPS"),
      ],
      []
    );
    const client = await importClient();
    await Promise.all([
      client.queryDailyAccountData(
        new Date("2026-08-01T00:00:00Z"),
        new Date("2026-08-01T00:00:00Z")
      ),
      client.queryDailyCampaignData(
        new Date("2026-08-01T00:00:00Z"),
        new Date("2026-08-01T00:00:00Z")
      ),
    ]);

    const discoveryCalls = requests.filter((r) =>
      String(r.body.query).includes("FROM customer_client")
    );
    expect(discoveryCalls).toHaveLength(1);
  });

  it("throws (and does not guess) when a manager has multiple enabled clients", async () => {
    installFetch([
      customerClientRow(MANAGER_ID, 0, true, "ENABLED", "OPS LTD"),
      customerClientRow(CLIENT_ID, 1, false, "ENABLED", "OPS"),
      customerClientRow("1111111111", 1, false, "ENABLED", "OPS US"),
    ]);
    const client = await importClient();
    await expect(
      client.queryDailyAccountData(
        new Date("2026-08-01T00:00:00Z"),
        new Date("2026-08-01T00:00:00Z")
      )
    ).rejects.toThrow(/multiple enabled clients[\s\S]*4454506598[\s\S]*1111111111/);
  });

  it("rejects a non-OK response with a typed GoogleAdsApiError", async () => {
    const errorBody = JSON.stringify({
      error: {
        code: 403,
        status: "PERMISSION_DENIED",
        details: [
          {
            errors: [
              {
                errorCode: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" },
                message:
                  "The developer token is only approved for use with test accounts.",
              },
            ],
          },
        ],
      },
    });
    requests = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ({
          ok: false,
          status: 403,
          json: async () => ({}),
          text: async () => errorBody,
        }) as unknown as Response
      )
    );
    const client = await importClient();

    const failure = await client
      .queryDailyAccountData(
        new Date("2026-08-01T00:00:00Z"),
        new Date("2026-08-01T00:00:00Z")
      )
      .catch((error) => error);

    expect(failure).toBeInstanceOf(client.GoogleAdsApiError);
    expect(failure.status).toBe(403);
    expect(failure.body).toBe(errorBody);
    expect(failure.name).toBe("GoogleAdsApiError");
    // Message template is unchanged from the untyped throw it replaces.
    expect(failure.message).toBe(
      `Google Ads API error (403): ${errorBody}`
    );
  });

  it("does not cache a failed resolution", async () => {
    // First attempt: manager with no clients → throws.
    installFetch([customerClientRow(MANAGER_ID, 0, true, "ENABLED", "OPS LTD")]);
    const client = await importClient();
    await expect(
      client.queryDailyAccountData(
        new Date("2026-08-01T00:00:00Z"),
        new Date("2026-08-01T00:00:00Z")
      )
    ).rejects.toThrow(/no enabled client accounts/);

    // Second attempt with a healthy hierarchy must re-run discovery and succeed.
    installFetch(
      [
        customerClientRow(MANAGER_ID, 0, true, "ENABLED", "OPS LTD"),
        customerClientRow(CLIENT_ID, 1, false, "ENABLED", "OPS"),
      ],
      []
    );
    await expect(
      client.queryDailyAccountData(
        new Date("2026-08-01T00:00:00Z"),
        new Date("2026-08-01T00:00:00Z")
      )
    ).resolves.toEqual([]);
  });
});

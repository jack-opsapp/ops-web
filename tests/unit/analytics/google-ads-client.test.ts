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

/**
 * Install a fetch stub that answers discovery + data calls from a script.
 * Discovery (`FROM customer_client`) answers on `googleAds:search` with a
 * paged object; report reads answer on `googleAds:searchStream` with an ARRAY
 * of chunks — one chunk holding `dataRows` — exactly as the REST API does.
 */
function installFetch(discoveryRows: unknown[], dataRows: unknown[] = []) {
  installStreamFetch(discoveryRows, [{ results: dataRows }]);
}

/** Like installFetch, but the searchStream answer is an explicit chunk list. */
function installStreamFetch(
  discoveryRows: unknown[],
  chunks: Array<{ results?: unknown[]; requestId?: string }>
) {
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
      const isStream = String(url).endsWith("googleAds:searchStream");
      const payload = isStream ? chunks : { results: discoveryRows };
      return {
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      } as unknown as Response;
    })
  );
}

/**
 * Discovery answers on :search; the mutate call answers with the given body.
 * Anything else (a report read) answers with an empty stream.
 */
function installMutateFetch(mutateResponse: Record<string, unknown>) {
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
      const u = String(url);
      const payload = u.endsWith("googleAds:mutate")
        ? mutateResponse
        : u.endsWith("googleAds:searchStream")
          ? []
          : {
              results: [
                customerClientRow(MANAGER_ID, 0, true, "ENABLED", "OPS LTD"),
                customerClientRow(CLIENT_ID, 1, false, "ENABLED", "OPS"),
              ],
            };
      return {
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
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
  it("targets v25 for every request", async () => {
    installFetch(
      [customerClientRow(MANAGER_ID, 0, true), customerClientRow(CLIENT_ID, 1, false)],
      []
    );
    const client = await importClient();
    await client.getAccountSummaryForRange(
      new Date("2026-09-01T00:00:00Z"),
      new Date("2026-09-07T00:00:00Z")
    );
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) expect(r.url).toContain("/v25/");
  });

  /**
   * v25 removed the bare `campaign.start_date` / `campaign.end_date` fields;
   * the account answers a query that selects them with
   * `UNRECOGNIZED_FIELD`, which took the whole daily sync down on
   * 2026-09-08 (Google request CnGpVfygOu0M3ED2DpjO3w). The replacements are
   * `campaign.start_date_time` / `campaign.end_date_time`.
   */
  it("selects only v25 campaign date fields in the entity snapshot", async () => {
    installFetch(
      [customerClientRow(MANAGER_ID, 0, true), customerClientRow(CLIENT_ID, 1, false)],
      []
    );
    const client = await importClient();
    await client.queryEntitySnapshot();
    const campaignQuery = requests
      .map((r) => String((r.body as { query?: string }).query ?? ""))
      .find((q) => /FROM campaign\s/.test(q));
    expect(campaignQuery).toBeDefined();
    expect(campaignQuery).toContain("campaign.start_date_time");
    expect(campaignQuery).toContain("campaign.end_date_time");
    // The removed names, matched without swallowing their replacements.
    expect(campaignQuery).not.toMatch(/campaign\.start_date(?!_time)/);
    expect(campaignQuery).not.toMatch(/campaign\.end_date(?!_time)/);
  });

  /**
   * Negative-keyword lists are attached to campaigns through
   * campaign_shared_set. Without those rows the snapshot holds the lists and
   * the campaigns but nothing joining them, so the engine cannot tell which
   * list guards which campaign.
   */
  it("reads campaign_shared_set attachments in the entity snapshot", async () => {
    installFetch(
      [customerClientRow(MANAGER_ID, 0, true), customerClientRow(CLIENT_ID, 1, false)],
      []
    );
    const client = await importClient();
    await client.queryEntitySnapshot();
    const query = requests
      .map((r) => String((r.body as { query?: string }).query ?? ""))
      .find((q) => /FROM campaign_shared_set/.test(q));
    expect(query).toBeDefined();
    expect(query).toContain("campaign_shared_set.resource_name");
    expect(query).toContain("campaign_shared_set.campaign");
    expect(query).toContain("campaign_shared_set.shared_set");
    expect(query).toContain("campaign_shared_set.status");
  });

  it("reads reports through searchStream and merges chunks in order", async () => {
    installStreamFetch(
      [customerClientRow(MANAGER_ID, 0, true), customerClientRow(CLIENT_ID, 1, false)],
      [
        {
          results: [
            { segments: { date: "2026-09-01" }, metrics: { costMicros: "1000000", clicks: "1", conversions: 0 } },
          ],
          requestId: "req-1",
        },
        {
          results: [
            { segments: { date: "2026-09-02" }, metrics: { costMicros: "2000000", clicks: "2", conversions: 0 } },
          ],
          requestId: "req-2",
        },
      ]
    );
    const client = await importClient();
    const rows = await client.getDailySpendForRange(
      new Date("2026-09-01T00:00:00Z"),
      new Date("2026-09-02T00:00:00Z")
    );
    expect(rows.map((r) => r.date)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(rows.map((r) => r.spend)).toEqual([1, 2]);
    const stream = requests.find((r) => r.url.endsWith("googleAds:searchStream"));
    expect(stream).toBeDefined();
    expect(stream!.url).toContain(`/customers/${CLIENT_ID}/`);
    expect(stream!.loginCustomerId).toBe(MANAGER_ID);
    expect(stream!.body).not.toHaveProperty("pageSize");
    // Discovery stays on the paged :search endpoint (tiny result).
    const discovery = requests.find((r) => String(r.body.query).includes("FROM customer_client"));
    expect(discovery!.url).toMatch(/googleAds:search$/);
  });

  it("mutate sends validateOnly + partialFailure and login-customer-id, and decodes partial failures by operation index", async () => {
    installMutateFetch({
      partialFailureError: {
        code: 3,
        message: "Multiple errors in ‘details’.",
        details: [
          {
            "@type": "type.googleapis.com/google.ads.googleads.v25.errors.GoogleAdsFailure",
            errors: [
              {
                errorCode: { policyFindingError: "POLICY_FINDING" },
                message: "x",
                location: {
                  fieldPathElements: [{ fieldName: "mutate_operations", index: 1 }],
                },
              },
            ],
            requestId: "mutate-req-1",
          },
        ],
      },
      mutateOperationResponses: [
        { campaignBudgetResult: { resourceName: "customers/1/campaignBudgets/2" } },
        {},
      ],
    });
    const client = await importClient();
    const result = await client.mutateGoogleAds(
      [
        { campaignBudgetOperation: { create: { name: "a" } } },
        { campaignBudgetOperation: { create: { name: "b" } } },
      ],
      { validateOnly: true }
    );
    const req = requests.find((r) => r.url.endsWith("googleAds:mutate"))!;
    expect(req).toBeDefined();
    expect(req.url).toContain(`/v25/customers/${CLIENT_ID}/`);
    expect(req.body.validateOnly).toBe(true);
    expect(req.body.partialFailure).toBe(true);
    expect(req.body.mutateOperations).toHaveLength(2);
    expect(req.loginCustomerId).toBe(MANAGER_ID);
    expect(result.results[0]?.campaignBudgetResult).toEqual({
      resourceName: "customers/1/campaignBudgets/2",
    });
    expect(result.failures).toEqual([{ index: 1, code: "POLICY_FINDING", message: "x" }]);
    expect(result.requestId).toBe("mutate-req-1");
  });

  it("mutate defaults validateOnly to false and rejects non-2xx with GoogleAdsApiError", async () => {
    installMutateFetch({ mutateOperationResponses: [{}] });
    const client = await importClient();
    const ok = await client.mutateGoogleAds([{ conversionActionOperation: { create: { name: "c" } } }]);
    const req = requests.find((r) => r.url.endsWith("googleAds:mutate"))!;
    expect(req.body.validateOnly).toBe(false);
    expect(ok.failures).toEqual([]);

    const errorBody = JSON.stringify({ error: { code: 403, status: "PERMISSION_DENIED", details: [{ errors: [{ errorCode: { authorizationError: "ACTION_NOT_PERMITTED" }, message: "no" }] }] } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) =>
        String(url).endsWith("googleAds:mutate")
          ? ({ ok: false, status: 403, json: async () => ({}), text: async () => errorBody } as unknown as Response)
          : ({
              ok: true,
              status: 200,
              json: async () => ({ results: [customerClientRow(MANAGER_ID, 0, true), customerClientRow(CLIENT_ID, 1, false)] }),
              text: async () => "",
            } as unknown as Response)
      )
    );
    const failure = await client
      .mutateGoogleAds([{ conversionActionOperation: { create: { name: "c" } } }], { validateOnly: true })
      .catch((e) => e);
    expect(failure).toBeInstanceOf(client.GoogleAdsApiError);
    expect(failure.status).toBe(403);
  });

  it("mutateConversionActions uses ConversionActionService with the same validateOnly + partial-failure contract", async () => {
    requests = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        const headers = (init?.headers ?? {}) as Record<string, string>;
        requests.push({ url: String(url), loginCustomerId: headers["login-customer-id"], body });
        const u = String(url);
        const payload = u.endsWith("conversionActions:mutate")
          ? {
              results: [{ resourceName: "customers/1/conversionActions/9" }, {}],
              partialFailureError: {
                details: [
                  {
                    requestId: "ca-req-1",
                    errors: [
                      {
                        errorCode: { conversionActionError: "DUPLICATE_NAME" },
                        message: "dup",
                        location: { fieldPathElements: [{ fieldName: "operations", index: 1 }] },
                      },
                    ],
                  },
                ],
              },
            }
          : { results: [customerClientRow(MANAGER_ID, 0, true), customerClientRow(CLIENT_ID, 1, false)] };
        return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) } as unknown as Response;
      })
    );
    const client = await importClient();
    const result = await client.mutateConversionActions(
      [{ create: { name: "a" } }, { update: { resourceName: "customers/1/conversionActions/2", primaryForGoal: false }, updateMask: "primaryForGoal" }],
      { validateOnly: true }
    );
    const req = requests.find((r) => r.url.endsWith("conversionActions:mutate"))!;
    expect(req.url).toBe(`https://googleads.googleapis.com/v25/customers/${CLIENT_ID}/conversionActions:mutate`);
    expect(req.loginCustomerId).toBe(MANAGER_ID);
    expect(req.body).toEqual({
      operations: [{ create: { name: "a" } }, { update: { resourceName: "customers/1/conversionActions/2", primaryForGoal: false }, updateMask: "primaryForGoal" }],
      partialFailure: true,
      validateOnly: true,
    });
    expect(req.body).not.toHaveProperty("mutateOperations");
    expect(req.body).not.toHaveProperty("responseContentType");
    expect(result.results[0]).toEqual({ resourceName: "customers/1/conversionActions/9" });
    expect(result.failures).toEqual([{ index: 1, code: "DUPLICATE_NAME", message: "dup" }]);
    expect(result.requestId).toBe("ca-req-1");
  });

  it("exposes the resolved serving and login ids for sibling clients", async () => {
    installFetch(
      [customerClientRow(MANAGER_ID, 0, true), customerClientRow(CLIENT_ID, 1, false)],
      []
    );
    const client = await importClient();
    await expect(client.getServingCustomerIds()).resolves.toEqual({
      servingId: CLIENT_ID,
      loginId: MANAGER_ID,
    });
  });
});

describe("engine budget pacing", () => {
  it("reads search_budget_lost_impression_share per enabled campaign per day", async () => {
    installFetch(
      [
        customerClientRow(MANAGER_ID, 0, true, "ENABLED", "OPS LTD"),
        customerClientRow(CLIENT_ID, 1, false, "ENABLED", "OPS"),
      ],
      [
        { segments: { date: "2026-10-15" }, campaign: { id: "11", name: "CORE · CA" }, metrics: { searchBudgetLostImpressionShare: 0.42 } },
        { segments: { date: "2026-10-16" }, campaign: { id: "11", name: "CORE · CA" }, metrics: { searchBudgetLostImpressionShare: 0 } },
      ]
    );
    const client = await importClient();
    const rows = await client.queryCampaignBudgetPacing(
      new Date("2026-10-15T00:00:00Z"),
      new Date("2026-10-17T00:00:00Z")
    );
    expect(rows).toEqual([
      { date: "2026-10-15", campaignId: "11", campaignName: "CORE · CA", lostShare: 0.42 },
      { date: "2026-10-16", campaignId: "11", campaignName: "CORE · CA", lostShare: 0 },
    ]);
    const query = String(requests[1].body.query);
    expect(query).toContain("metrics.search_budget_lost_impression_share");
    expect(query).toContain("campaign.status = 'ENABLED'");
    expect(query).toContain("segments.date >= '2026-10-15'");
    expect(requests[1].body).not.toHaveProperty("pageSize");
  });
});

describe("guardrail live reads", () => {
  const DISCOVERY = [
    customerClientRow(MANAGER_ID, 0, true, "ENABLED", "OPS LTD"),
    customerClientRow(CLIENT_ID, 1, false, "ENABLED", "OPS"),
  ];
  const AD_A = `customers/${CLIENT_ID}/adGroupAds/200351113415~824125294528`;
  const AD_B = `customers/${CLIENT_ID}/adGroupAds/200351114095~824125294696`;

  it("reads status, verdict and policy topics for exactly the named ads, removed ones included", async () => {
    installFetch(DISCOVERY, [
      {
        adGroupAd: {
          resourceName: AD_A,
          status: "ENABLED",
          policySummary: {
            approvalStatus: "DISAPPROVED",
            reviewStatus: "REVIEWED",
            policyTopicEntries: [{ topic: "DESTINATION_NOT_WORKING", type: "PROHIBITED", evidences: [{ destinationNotWorking: { device: "DESKTOP" } }] }],
          },
        },
      },
      { adGroupAd: { resourceName: AD_B, status: "REMOVED", policySummary: { approvalStatus: "APPROVED", reviewStatus: "REVIEWED" } } },
    ]);
    const client = await importClient();
    const states = await client.queryAdPolicyStates([AD_A, AD_B]);
    expect(states).toEqual([
      { resourceName: AD_A, status: "ENABLED", approvalStatus: "DISAPPROVED", reviewStatus: "REVIEWED", policyTopics: [{ topic: "DESTINATION_NOT_WORKING", type: "PROHIBITED" }] },
      { resourceName: AD_B, status: "REMOVED", approvalStatus: "APPROVED", reviewStatus: "REVIEWED", policyTopics: [] },
    ]);
    const query = String(requests[1].body.query);
    // Field paths checked against v25 ad_group_ad.proto and policy_summary.proto.
    expect(query).toContain("ad_group_ad.policy_summary.policy_topic_entries");
    expect(query).toContain("ad_group_ad.policy_summary.approval_status");
    expect(query).toContain("ad_group_ad.policy_summary.review_status");
    expect(query).toContain(`ad_group_ad.resource_name IN ('${AD_A}', '${AD_B}')`);
    // A removed ad must come back so the guardrail can let go of it.
    expect(query).not.toContain("REMOVED");
  });

  it("makes no request for an empty list and refuses anything that is not an ad resource name", async () => {
    installFetch(DISCOVERY, []);
    const client = await importClient();
    await expect(client.queryAdPolicyStates([])).resolves.toEqual([]);
    expect(requests).toEqual([]);
    await expect(client.queryAdPolicyStates([`${AD_A}') OR ('1'='1`])).rejects.toThrow(/not an ad resource name/);
    expect(requests).toEqual([]);
  });

  it("reads ad status changes with the bounded window Google requires and decodes each event", async () => {
    installFetch(DISCOVERY, [
      {
        changeEvent: {
          resourceName: `customers/${CLIENT_ID}/changeEvents/1789052369290063~0~0`,
          changeDateTime: "2026-09-10 07:59:29.290063",
          changeResourceType: "AD_GROUP_AD",
          changeResourceName: AD_A,
          clientType: "GOOGLE_ADS_API",
          userEmail: "firebase-adminsdk-fbsvc@ops-ios-app.iam.gserviceaccount.com",
          resourceChangeOperation: "UPDATE",
          changedFields: "ad,status",
          oldResource: { adGroupAd: { status: "ENABLED" } },
          newResource: { adGroupAd: { status: "PAUSED" } },
        },
      },
      {
        changeEvent: {
          resourceName: `customers/${CLIENT_ID}/changeEvents/1789017638036560~0~92`,
          changeDateTime: "2026-09-09 22:20:38.03656",
          changeResourceType: "AD_GROUP_AD",
          changeResourceName: AD_B,
          clientType: "GOOGLE_ADS_WEB_CLIENT",
          userEmail: "j@example.com",
          resourceChangeOperation: "CREATE",
          changedFields: "ad,adGroup,resourceName,status",
          oldResource: { adGroupAd: { ad: {} } },
          newResource: { adGroupAd: { resourceName: AD_B, status: "ENABLED" } },
        },
      },
    ]);
    const client = await importClient();
    const result = await client.queryAdGroupAdChangeEvents("2026-09-09", "2026-09-12");
    expect(result).toEqual({
      truncated: false,
      events: [
        {
          micros: 1789052369290063,
          resourceName: AD_A,
          operation: "UPDATE",
          changedFields: ["ad", "status"],
          clientType: "GOOGLE_ADS_API",
          userEmail: "firebase-adminsdk-fbsvc@ops-ios-app.iam.gserviceaccount.com",
          oldStatus: "ENABLED",
          newStatus: "PAUSED",
        },
        {
          micros: 1789017638036560,
          resourceName: AD_B,
          operation: "CREATE",
          changedFields: ["ad", "adGroup", "resourceName", "status"],
          clientType: "GOOGLE_ADS_WEB_CLIENT",
          userEmail: "j@example.com",
          oldStatus: null,
          newStatus: "ENABLED",
        },
      ],
    });
    const query = String(requests[1].body.query);
    // Google refuses an open-ended range, a start older than 30 days, and a
    // filter on change_resource_name (probe 2026-09-11) — so both bounds, the
    // resource type, a LIMIT, and the per-ad filter happens in code.
    expect(query).toContain("FROM change_event");
    expect(query).toContain("change_event.change_date_time >= '2026-09-09'");
    expect(query).toContain("change_event.change_date_time <= '2026-09-12'");
    expect(query).toContain("change_event.change_resource_type = 'AD_GROUP_AD'");
    expect(query).toContain("LIMIT 10000");
    expect(query).not.toContain("change_resource_name IN");
  });

  it("flags a change history that hit Google's row limit, and refuses a malformed date", async () => {
    const rows = Array.from({ length: 10000 }, (_, i) => ({
      changeEvent: {
        resourceName: `customers/${CLIENT_ID}/changeEvents/${1789052369290063 + i}~0~0`,
        changeResourceName: AD_A,
        resourceChangeOperation: "UPDATE",
        changedFields: "status",
        newResource: { adGroupAd: { status: "PAUSED" } },
        oldResource: { adGroupAd: { status: "ENABLED" } },
      },
    }));
    installFetch(DISCOVERY, rows);
    const client = await importClient();
    const result = await client.queryAdGroupAdChangeEvents("2026-09-09", "2026-09-12");
    expect(result.truncated).toBe(true);
    await expect(client.queryAdGroupAdChangeEvents("2026-9-9", "2026-09-12")).rejects.toThrow(/YYYY-MM-DD/);
  });
});

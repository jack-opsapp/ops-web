// @vitest-environment node
/**
 * Bug 964cf782: an unapproved developer token kept three ads cron routes
 * hard-500ing for four weeks with no operator signal. These tests pin the
 * degrade contract: classify standing access failures, persist one shared
 * state row, and notify only on the healthy<->blocked transition.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOptionalPmfOperatorIdentity: vi.fn(),
}));

vi.mock("@/lib/pmf/recipients", () => ({
  getOptionalPmfOperatorIdentity: mocks.getOptionalPmfOperatorIdentity,
}));

import { GoogleAdsApiError } from "@/lib/analytics/google-ads-client";
import {
  classifyGoogleAdsAccessFailure,
  reportAdsProviderHealth,
} from "@/lib/admin/ads-provider-health";

const DENIED_BODY = JSON.stringify({
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

interface StatusRow {
  id: string;
  status: string;
}

function makeSupabase(options: {
  existing?: StatusRow | null;
  readError?: unknown;
  writeError?: unknown;
} = {}) {
  const upserts: Record<string, unknown>[] = [];
  const notifications: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      if (table === "ads_sync_status") {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: () =>
            Promise.resolve({
              data: options.existing ?? null,
              error: options.readError ?? null,
            }),
          upsert: (row: Record<string, unknown>) => {
            upserts.push(row);
            return Promise.resolve({
              data: null,
              error: options.writeError ?? null,
            });
          },
        };
        return query;
      }
      return {
        insert: (row: Record<string, unknown>) => {
          notifications.push(row);
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  return { client: client as never, upserts, notifications };
}

const IDENTITY = {
  operatorUserId: "11111111-1111-4111-8111-111111111111",
  operatorCompanyId: "22222222-2222-4222-8222-222222222222",
};

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.getOptionalPmfOperatorIdentity.mockReset();
  mocks.getOptionalPmfOperatorIdentity.mockReturnValue(IDENTITY);
});

describe("classifyGoogleAdsAccessFailure", () => {
  it("classifies a top-level 403 authorization failure", () => {
    const reason = classifyGoogleAdsAccessFailure(
      new GoogleAdsApiError(403, DENIED_BODY)
    );
    expect(reason).toContain("DEVELOPER_TOKEN_NOT_APPROVED");
    expect(reason).toContain("paused");
  });

  it("classifies a 401 the same way", () => {
    expect(
      classifyGoogleAdsAccessFailure(
        new GoogleAdsApiError(401, "UNAUTHENTICATED")
      )
    ).toContain("UNAUTHENTICATED");
  });

  it("walks the cause chain (the pmf route wraps the provider error)", () => {
    const wrapped = new Error("Google Ads provider unavailable", {
      cause: new GoogleAdsApiError(403, DENIED_BODY),
    });
    expect(classifyGoogleAdsAccessFailure(wrapped)).toContain(
      "DEVELOPER_TOKEN_NOT_APPROVED"
    );
  });

  it("matches an untyped legacy error carrying the same message shape", () => {
    const legacy = new Error(
      `Google Ads API error (403): ${DENIED_BODY}`
    );
    expect(classifyGoogleAdsAccessFailure(legacy)).toContain(
      "DEVELOPER_TOKEN_NOT_APPROVED"
    );
  });

  it("falls back to PERMISSION_DENIED when no marker is recognised", () => {
    expect(
      classifyGoogleAdsAccessFailure(new GoogleAdsApiError(403, "nope"))
    ).toContain("PERMISSION_DENIED");
  });

  it("does not classify a 400 request defect", () => {
    expect(
      classifyGoogleAdsAccessFailure(
        new GoogleAdsApiError(400, "PAGE_SIZE_NOT_SUPPORTED")
      )
    ).toBeNull();
  });

  it("does not classify a 5xx, a network error, or a database error", () => {
    expect(
      classifyGoogleAdsAccessFailure(new GoogleAdsApiError(503, "unavailable"))
    ).toBeNull();
    expect(classifyGoogleAdsAccessFailure(new TypeError("fetch failed"))).toBeNull();
    expect(
      classifyGoogleAdsAccessFailure(
        new Error("cron workload cursor read failed for ads-sync")
      )
    ).toBeNull();
    expect(classifyGoogleAdsAccessFailure(null)).toBeNull();
  });
});

describe("reportAdsProviderHealth", () => {
  it("writes the blocked state and notifies on the healthy->blocked transition", async () => {
    const sb = makeSupabase({ existing: { id: "provider-access", status: "complete" } });

    await reportAdsProviderHealth(sb.client, {
      blocked: true,
      reason: "Google Ads API access blocked (DEVELOPER_TOKEN_NOT_APPROVED).",
    });

    expect(sb.upserts).toHaveLength(1);
    expect(sb.upserts[0]).toMatchObject({
      id: "provider-access",
      status: "failed",
      error: "Google Ads API access blocked (DEVELOPER_TOKEN_NOT_APPROVED).",
    });
    expect(sb.notifications).toHaveLength(1);
    expect(sb.notifications[0]).toMatchObject({
      user_id: IDENTITY.operatorUserId,
      company_id: IDENTITY.operatorCompanyId,
      type: "ads_provider_alert",
      title: "GOOGLE ADS ACCESS BLOCKED",
      persistent: true,
      is_read: false,
      action_url: "/admin/google-ads",
      action_label: "VIEW ADS",
    });
  });

  it("stays silent while the condition persists", async () => {
    const sb = makeSupabase({ existing: { id: "provider-access", status: "failed" } });

    await reportAdsProviderHealth(sb.client, { blocked: true, reason: "still blocked" });

    expect(sb.upserts).toHaveLength(1);
    expect(sb.notifications).toHaveLength(0);
  });

  it("notifies once on recovery, with a non-persistent notification", async () => {
    const sb = makeSupabase({ existing: { id: "provider-access", status: "failed" } });

    await reportAdsProviderHealth(sb.client, { blocked: false });

    expect(sb.upserts[0]).toMatchObject({ status: "complete", error: null });
    expect(sb.notifications).toHaveLength(1);
    expect(sb.notifications[0]).toMatchObject({
      title: "GOOGLE ADS ACCESS RESTORED",
      body: "Scheduled ads syncs are running again.",
      persistent: false,
    });
  });

  it("stays silent when a healthy run finds no row (first ever run)", async () => {
    const sb = makeSupabase({ existing: null });

    await reportAdsProviderHealth(sb.client, { blocked: false });

    expect(sb.upserts).toHaveLength(1);
    expect(sb.notifications).toHaveLength(0);
  });

  it("notifies when the first ever row is written blocked", async () => {
    const sb = makeSupabase({ existing: null });

    await reportAdsProviderHealth(sb.client, { blocked: true, reason: "blocked" });

    expect(sb.notifications).toHaveLength(1);
  });

  it("skips the notification when operator identity is unset", async () => {
    mocks.getOptionalPmfOperatorIdentity.mockReturnValue(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sb = makeSupabase({ existing: { id: "provider-access", status: "complete" } });

    await reportAdsProviderHealth(sb.client, { blocked: true, reason: "blocked" });

    expect(sb.upserts).toHaveLength(1);
    expect(sb.notifications).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it("never throws and never notifies when the state write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = makeSupabase({
      existing: { id: "provider-access", status: "complete" },
      writeError: { message: "permission denied" },
    });

    await expect(
      reportAdsProviderHealth(sb.client, { blocked: true, reason: "blocked" })
    ).resolves.toBeUndefined();
    expect(sb.notifications).toHaveLength(0);
  });

  it("never throws when the state read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = makeSupabase({ readError: { message: "timeout" } });

    await expect(
      reportAdsProviderHealth(sb.client, { blocked: true, reason: "blocked" })
    ).resolves.toBeUndefined();
    expect(sb.upserts).toHaveLength(0);
    expect(sb.notifications).toHaveLength(0);
  });

  it("never throws when the identity helper itself throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getOptionalPmfOperatorIdentity.mockImplementation(() => {
      throw new Error("PMF_OPERATOR_USER_ID must be a UUID");
    });
    const sb = makeSupabase({ existing: { id: "provider-access", status: "complete" } });

    await expect(
      reportAdsProviderHealth(sb.client, { blocked: true, reason: "blocked" })
    ).resolves.toBeUndefined();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Bug a2042514. Logging two activities back to back must cost ONE model call
 * now and one coalesced call later — never one per write. The endpoint debounces
 * on the summary's own stamp and hands the second write to the durable queue.
 */

const {
  verifyAuthTokenMock,
  refreshLeadSummariesMock,
  accessTokenRpcMock,
  serviceFromMock,
} = vi.hoisted(() => ({
  verifyAuthTokenMock: vi.fn(),
  refreshLeadSummariesMock: vi.fn(),
  accessTokenRpcMock: vi.fn(),
  serviceFromMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAuthToken: verifyAuthTokenMock,
}));

vi.mock("@/lib/api/services/lead-summary-service", () => ({
  refreshLeadSummariesForOpportunities: refreshLeadSummariesMock,
}));

vi.mock("@/lib/supabase/accessToken-client", () => ({
  getAccessTokenClient: () => ({ rpc: accessTokenRpcMock }),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ from: serviceFromMock }),
}));

import { POST } from "@/app/api/opportunities/[id]/summary-refresh/route";

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const OPPORTUNITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let upserts: Array<{ payload: Record<string, unknown>; options: unknown }>;
let summaryStamp: string | null;

function request(): NextRequest {
  return new NextRequest(
    new URL(
      `https://example.com/api/opportunities/${OPPORTUNITY_ID}/summary-refresh`
    ),
    { method: "POST", headers: new Headers({ authorization: "Bearer token" }) }
  );
}

function invoke() {
  return POST(request(), { params: Promise.resolve({ id: OPPORTUNITY_ID }) });
}

beforeEach(() => {
  upserts = [];
  summaryStamp = null;
  verifyAuthTokenMock.mockReset();
  verifyAuthTokenMock.mockResolvedValue({ uid: "user-1" });
  accessTokenRpcMock.mockReset();
  accessTokenRpcMock.mockResolvedValue({ data: COMPANY_ID, error: null });
  refreshLeadSummariesMock.mockReset();
  refreshLeadSummariesMock.mockResolvedValue({
    requested: 1,
    attempted: 1,
    written: 1,
    skippedFeatureDisabled: false,
    failed: [],
    deferred: [],
    remainingOpportunityIds: [],
  });
  serviceFromMock.mockReset();
  serviceFromMock.mockImplementation((table: string) => {
    if (table === "opportunities") {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({
        data: { ai_summary_updated_at: summaryStamp },
        error: null,
      });
      return chain;
    }
    if (table === "lead_summary_refresh_requests") {
      return {
        upsert: async (payload: Record<string, unknown>, options: unknown) => {
          upserts.push({ payload, options });
          return { error: null };
        },
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
});

describe("POST /api/opportunities/[id]/summary-refresh — debounce", () => {
  it("refreshes immediately when the summary is old", async () => {
    summaryStamp = new Date(Date.now() - 10 * 60_000).toISOString();

    const response = await invoke();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, refreshed: true });
    expect(refreshLeadSummariesMock).toHaveBeenCalledTimes(1);
    expect(upserts).toHaveLength(0);
  });

  it("refreshes immediately when the lead has never been summarized", async () => {
    summaryStamp = null;

    const response = await invoke();

    expect(response.status).toBe(200);
    expect(refreshLeadSummariesMock).toHaveBeenCalledTimes(1);
    expect(upserts).toHaveLength(0);
  });

  it("queues instead of paying for a second model call inside the window", async () => {
    summaryStamp = new Date(Date.now() - 5_000).toISOString();

    const response = await invoke();

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true,
      refreshed: false,
      reason: "debounced",
    });
    expect(refreshLeadSummariesMock).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(1);
    expect(upserts[0].payload).toMatchObject({
      opportunity_id: OPPORTUNITY_ID,
      company_id: COMPANY_ID,
    });
    expect(upserts[0].options).toEqual({ onConflict: "opportunity_id" });
  });

  it("keeps debouncing right up to the edge of the window", async () => {
    summaryStamp = new Date(Date.now() - 89_000).toISOString();

    const response = await invoke();

    expect(response.status).toBe(202);
    expect(refreshLeadSummariesMock).not.toHaveBeenCalled();
  });

  it("refreshes again once the window has passed", async () => {
    summaryStamp = new Date(Date.now() - 91_000).toISOString();

    const response = await invoke();

    expect(response.status).toBe(200);
    expect(refreshLeadSummariesMock).toHaveBeenCalledTimes(1);
  });

  it("reports a failed enqueue instead of silently dropping the request", async () => {
    summaryStamp = new Date(Date.now() - 5_000).toISOString();
    serviceFromMock.mockImplementation((table: string) => {
      if (table === "opportunities") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.maybeSingle = async () => ({
          data: { ai_summary_updated_at: summaryStamp },
          error: null,
        });
        return chain;
      }
      return {
        upsert: async () => ({ error: { code: "42501", message: "denied" } }),
      };
    });

    const response = await invoke();

    expect(response.status).toBe(503);
    expect(refreshLeadSummariesMock).not.toHaveBeenCalled();
  });

  it("still refuses an unauthorized caller before touching the database", async () => {
    verifyAuthTokenMock.mockRejectedValue(new Error("bad token"));

    const response = await invoke();

    expect(response.status).toBe(401);
    expect(serviceFromMock).not.toHaveBeenCalled();
  });
});

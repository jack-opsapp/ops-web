/**
 * Integration tests for /api/cron/email/dispatcher.
 *
 * Covers: auth gating, no-op when no scheduled campaigns, audience
 * resolution + enqueue path, and failure → mark campaign 'failed'.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const enqueueCampaignJobsMock = vi.fn();
const resolveAudienceMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/email/campaigns", () => ({
  enqueueCampaignJobs: (...args: unknown[]) =>
    enqueueCampaignJobsMock(...args),
}));

vi.mock("@/lib/email/audiences", () => ({
  resolveAudience: (...args: unknown[]) => resolveAudienceMock(...args),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ from: fromMock, rpc: vi.fn() }),
}));

import { GET } from "@/app/api/cron/email/dispatcher/route";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
});

function buildRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new NextRequest(
    new URL("https://example.com/api/cron/email/dispatcher"),
    { headers }
  );
}

function mockReadyCampaigns(rows: Array<{ id: string; audience_filter?: unknown; audience_template_id?: string | null; name?: string }>) {
  fromMock.mockImplementation((table: string) => {
    if (table === "email_campaigns") {
      return {
        select: () => ({
          eq: () => ({
            lte: () => ({
              order: () => ({
                limit: async () => ({ data: rows, error: null }),
              }),
            }),
          }),
        }),
        update: () => ({
          eq: async () => ({ data: null, error: null }),
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });
}

describe("email dispatcher cron", () => {
  it("rejects requests without bearer auth", async () => {
    const res = await GET(buildRequest());
    expect(res.status).toBe(401);
  });

  it("rejects requests with the wrong secret", async () => {
    const res = await GET(buildRequest("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("returns processed=0 when no scheduled campaigns are ready", async () => {
    mockReadyCampaigns([]);
    const res = await GET(buildRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(0);
  });

  it("resolves audience and enqueues jobs for each ready campaign", async () => {
    mockReadyCampaigns([
      { id: "c1", audience_filter: { segment: "all_users" }, audience_template_id: null, name: "X" },
    ]);
    resolveAudienceMock.mockResolvedValue({
      recipients: [
        { email: "a@example.com", userId: "u1" },
        { email: "b@example.com", userId: "u2" },
      ],
    });
    enqueueCampaignJobsMock.mockResolvedValue({ enqueued: 2, suppressedSkipped: 0 });

    const res = await GET(buildRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(1);
    expect(body.results[0].enqueued).toBe(2);
    expect(resolveAudienceMock).toHaveBeenCalledWith(
      { segment: "all_users" },
      expect.anything()
    );
    expect(enqueueCampaignJobsMock).toHaveBeenCalledTimes(1);
  });

  it("marks campaign failed when audience resolution throws", async () => {
    const updateSpy = vi.fn(() => ({
      eq: async () => ({ data: null, error: null }),
    }));
    fromMock.mockImplementation((table: string) => {
      if (table === "email_campaigns") {
        return {
          select: () => ({
            eq: () => ({
              lte: () => ({
                order: () => ({
                  limit: async () => ({
                    data: [{ id: "c1", audience_filter: {}, audience_template_id: null }],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
          update: updateSpy,
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });
    resolveAudienceMock.mockRejectedValue(new Error("audience boom"));

    const res = await GET(buildRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].error).toContain("audience boom");
    // Campaign should be marked failed.
    const failedCall = updateSpy.mock.calls.find((call) => {
      const payload = (call as unknown[])[0] as { send_status?: string };
      return payload?.send_status === "failed";
    });
    expect(failedCall).toBeTruthy();
  });
});

// @vitest-environment node
/**
 * Bug 964cf782 — the weekly ads briefing 500'd on every scheduled run for four
 * weeks while the developer token lacked Basic access, filing duplicate health
 * reports and no operator signal. generateBriefing already persists the failure
 * truthfully (failBriefing with the full 403 body) and rethrows, so the route
 * classifies and degrades. Unexpected failures must still 500.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  generateBriefing: vi.fn(),
  runWithCronWorkloadControl: vi.fn(),
  reportAdsProviderHealth: vi.fn(),
  adminClient: { from: vi.fn(), rpc: vi.fn() },
}));

vi.mock("@/lib/admin/briefing-agent", () => ({
  generateBriefing: mocks.generateBriefing,
}));
vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => mocks.adminClient,
}));
vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  runWithCronWorkloadControl: mocks.runWithCronWorkloadControl,
}));
vi.mock("@/lib/admin/ads-provider-health", () => ({
  classifyGoogleAdsAccessFailure: (error: unknown) =>
    error instanceof Error && /Google Ads API error \((401|403)\)/.test(error.message)
      ? "Google Ads API access blocked (DEVELOPER_TOKEN_NOT_APPROVED). Scheduled ads syncs are paused until access is restored."
      : null,
  reportAdsProviderHealth: mocks.reportAdsProviderHealth,
}));

import { GET } from "@/app/api/cron/ads-briefing/route";

const req = (auth?: string) =>
  new NextRequest("http://localhost/api/cron/ads-briefing", {
    headers: auth ? { authorization: auth } : {},
  });

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  vi.clearAllMocks();
  mocks.generateBriefing.mockResolvedValue("briefing-1");
  mocks.reportAdsProviderHealth.mockResolvedValue(undefined);
  mocks.runWithCronWorkloadControl.mockImplementation(
    async ({ work }: { work: () => Promise<unknown> }) => ({
      status: "completed",
      value: await work(),
    })
  );
});

describe("ads-briefing cron", () => {
  it("returns 401 without the cron bearer token", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mocks.runWithCronWorkloadControl).not.toHaveBeenCalled();
  });

  it("starts the briefing and records provider health as healthy", async () => {
    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "briefing-1",
      status: "started",
      ran: true,
    });
    expect(mocks.reportAdsProviderHealth).toHaveBeenCalledWith(
      mocks.adminClient,
      { blocked: false }
    );
  });

  it("degrades with 200 when Google Ads access is blocked", async () => {
    mocks.generateBriefing.mockRejectedValue(
      new Error(
        'Google Ads API error (403): {"error":{"status":"PERMISSION_DENIED"}}'
      )
    );

    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "degraded", ran: true });
    expect(body.reason).toContain("DEVELOPER_TOKEN_NOT_APPROVED");
    expect(mocks.reportAdsProviderHealth).toHaveBeenCalledWith(
      mocks.adminClient,
      {
        blocked: true,
        reason: expect.stringContaining("DEVELOPER_TOKEN_NOT_APPROVED"),
      }
    );
  });

  it("still 500s on an unexpected failure", async () => {
    mocks.generateBriefing.mockRejectedValue(new Error("model timeout"));

    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "model timeout" });
    expect(mocks.reportAdsProviderHealth).not.toHaveBeenCalled();
  });

  it("returns an idempotent no-op while another briefing owns the lease", async () => {
    mocks.runWithCronWorkloadControl.mockResolvedValue({
      status: "skipped",
      reason: "lease_held",
    });

    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "already_running",
      ran: false,
      reason: "lease_held",
    });
    expect(mocks.reportAdsProviderHealth).not.toHaveBeenCalled();
  });

  it("fails closed when workload control is unavailable", async () => {
    mocks.runWithCronWorkloadControl.mockResolvedValue({
      status: "skipped",
      reason: "control_unavailable",
      error: new Error("control unavailable"),
    });

    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(503);
    expect(mocks.reportAdsProviderHealth).not.toHaveBeenCalled();
  });
});

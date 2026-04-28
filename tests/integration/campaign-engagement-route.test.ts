import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/admin/api-auth", () => ({
  withAdmin: <H extends (...args: unknown[]) => unknown>(h: H) => h,
  requireAdmin: vi.fn(async () => ({ uid: "admin", email: "a@x.com" })),
}));

const statsMock = vi.fn();
const funnelMock = vi.fn();
vi.mock("@/lib/admin/email-campaign-queries", () => ({
  getCampaignEngagementStats: (...a: unknown[]) => statsMock(...a),
  getCampaignFunnelStages: (...a: unknown[]) => funnelMock(...a),
}));

import { GET } from "@/app/api/admin/email/campaigns/[id]/engagement/route";

const mkReq = () => new Request("https://x") as never;
const mkCtx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/admin/email/campaigns/[id]/engagement", () => {
  it("rejects malformed UUID with 400", async () => {
    const r = await GET(mkReq(), mkCtx("not-a-uuid"));
    expect(r.status).toBe(400);
  });

  it("returns 404 when campaign not found", async () => {
    statsMock.mockResolvedValueOnce(null);
    funnelMock.mockResolvedValueOnce([]);
    const r = await GET(
      mkReq(),
      mkCtx("11111111-1111-1111-1111-111111111111")
    );
    expect(r.status).toBe(404);
  });

  it("returns 200 with stats + funnel + 60s Cache-Control", async () => {
    statsMock.mockResolvedValueOnce({
      campaign_id: "11111111-1111-1111-1111-111111111111",
      sent: 10,
    });
    funnelMock.mockResolvedValueOnce([
      { stage: "enqueued", value: 10 },
      { stage: "delivered", value: 9 },
    ]);
    const r = await GET(
      mkReq(),
      mkCtx("11111111-1111-1111-1111-111111111111")
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toContain("max-age=60");
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.stats.sent).toBe(10);
    expect(body.funnel).toHaveLength(2);
  });
});

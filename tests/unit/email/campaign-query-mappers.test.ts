import { describe, it, expect, vi } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ rpc: (...a: unknown[]) => rpcMock(...a) }),
}));

import {
  getCampaignFunnelStages,
  getCampaignEngagementStats,
} from "@/lib/admin/email-campaign-queries";

describe("query mappers", () => {
  it("getCampaignFunnelStages coerces value to number", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        { stage: "delivered", value: "42" },
        { stage: "opened", value: 7 },
      ],
      error: null,
    });
    const result = await getCampaignFunnelStages("c1");
    expect(result).toEqual([
      { stage: "delivered", value: 42 },
      { stage: "opened", value: 7 },
    ]);
  });

  it("getCampaignEngagementStats returns null on error", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await getCampaignEngagementStats("c1")).toBeNull();
  });

  it("getCampaignEngagementStats returns null when RPC returns null", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    expect(await getCampaignEngagementStats("c1")).toBeNull();
  });
});

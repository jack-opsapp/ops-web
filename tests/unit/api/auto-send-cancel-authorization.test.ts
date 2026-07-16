import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServiceRoleClient: vi.fn(),
  setSupabaseOverride: vi.fn(),
  resolveActor: vi.fn(),
  cancelAutoSend: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: mocks.setSupabaseOverride,
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: mocks.resolveActor,
}));

vi.mock("@/lib/api/services/auto-send-service", () => ({
  AutoSendService: { cancelAutoSend: mocks.cancelAutoSend },
}));

import { POST } from "@/app/api/integrations/email/auto-send/cancel/route";

function request(body: Record<string, unknown>) {
  return new NextRequest(
    "https://ops.test/api/integrations/email/auto-send/cancel",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("auto-send cancellation authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServiceRoleClient.mockReturnValue({ rpc: vi.fn() });
    mocks.resolveActor.mockResolvedValue({
      ok: true,
      actor: { userId: "actor-1", companyId: "company-1" },
    });
    mocks.cancelAutoSend.mockResolvedValue(true);
  });

  it("derives actor and company from auth and ignores spoofed body identity", async () => {
    const response = await POST(
      request({
        id: "queue-1",
        companyId: "spoofed-company",
        userId: "spoofed-user",
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.cancelAutoSend).toHaveBeenCalledWith(
      "queue-1",
      "company-1",
      { actorUserId: "actor-1" }
    );
  });

  it("does not touch the queue when canonical actor resolution fails", async () => {
    mocks.resolveActor.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      }),
    });

    const response = await POST(request({ id: "queue-1" }));

    expect(response.status).toBe(401);
    expect(mocks.cancelAutoSend).not.toHaveBeenCalled();
  });
});

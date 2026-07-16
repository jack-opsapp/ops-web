import { describe, expect, it, vi } from "vitest";

const { getServiceRoleClientMock } = vi.hoisted(() => ({
  getServiceRoleClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

import { POST } from "@/app/api/integrations/email/verify-leads/route";

describe("retired email lead verification route", () => {
  it("returns Gone without reading or writing the database", async () => {
    const response = await POST();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Lead verification moved to import review",
    });
    expect(getServiceRoleClientMock).not.toHaveBeenCalled();
  });
});

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveActorMock, rpcMock } = vi.hoisted(() => ({
  resolveActorMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: resolveActorMock,
}));

import { resolvePhaseCCategorySettingsAccess } from "@/lib/email/phase-c-category-settings-access";

const request = new NextRequest("https://ops.test/settings");
const supabase = { rpc: rpcMock } as never;

describe("Phase C category settings access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveActorMock.mockResolvedValue({
      ok: true,
      actor: { userId: "actor-1", companyId: "company-1" },
    });
  });

  it("authorizes the canonical OPS actor through the guarded database bridge", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });

    await expect(
      resolvePhaseCCategorySettingsAccess({
        request,
        claimedCompanyId: "company-1",
        connectionId: "connection-1",
        supabase,
      })
    ).resolves.toEqual({
      allowed: true,
      actor: { userId: "actor-1", companyId: "company-1" },
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "authorize_phase_c_category_settings_as_system",
      {
        p_actor_user_id: "actor-1",
        p_connection_id: "connection-1",
      }
    );
  });

  it("fails closed when the actor cannot configure this mailbox", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });

    await expect(
      resolvePhaseCCategorySettingsAccess({
        request,
        claimedCompanyId: "company-1",
        connectionId: "connection-1",
        supabase,
      })
    ).resolves.toEqual({ allowed: false, status: 403 });
  });

  it("surfaces authorization bridge failures without widening access", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "authorization unavailable" },
    });

    await expect(
      resolvePhaseCCategorySettingsAccess({
        request,
        claimedCompanyId: "company-1",
        connectionId: "connection-1",
        supabase,
      })
    ).resolves.toEqual({ allowed: false, status: 500 });
  });
});

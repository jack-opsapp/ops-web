import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkPermissionById: vi.fn(),
  findUserByAuth: vi.fn(),
  getServiceRoleClient: vi.fn(),
  verifyAdminAuth: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: mocks.verifyAdminAuth,
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: mocks.findUserByAuth,
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: mocks.checkPermissionById,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));

import { PUT } from "@/app/api/settings/schedule/route";

type CompanyRow = {
  id: string;
  schedule_settings: Record<string, unknown>;
};

function makeSupabaseDouble(company: CompanyRow) {
  class Query {
    private updatePayload: Record<string, unknown> | null = null;

    update(payload: Record<string, unknown>) {
      this.updatePayload = payload;
      return this;
    }

    eq() {
      if (this.updatePayload?.schedule_settings) {
        company.schedule_settings = this.updatePayload
          .schedule_settings as Record<string, unknown>;
      }
      return Promise.resolve({ data: null, error: null });
    }
  }

  return { from: vi.fn(() => new Query()) };
}

function request() {
  return new NextRequest("http://test.local/api/settings/schedule", {
    method: "PUT",
    body: JSON.stringify({
      companyId: "company-1",
      config: {
        enabled: true,
        optimization_window_days: 3,
        travel_optimization: true,
        conflict_detection: true,
        weather_awareness: true,
        climate_zone: "auto",
        cascade_detection: true,
        outdoor_task_type_ids: ["outdoor-1"],
      },
    }),
  });
}

describe("/api/settings/schedule", () => {
  let company: CompanyRow;

  beforeEach(() => {
    vi.clearAllMocks();
    company = { id: "company-1", schedule_settings: {} };
    mocks.verifyAdminAuth.mockResolvedValue({
      uid: "auth-1",
      email: "operator@example.com",
    });
    mocks.findUserByAuth.mockResolvedValue({
      id: "user-1",
      company_id: "company-1",
      role: "dispatcher",
    });
    mocks.checkPermissionById.mockResolvedValue(true);
    mocks.getServiceRoleClient.mockReturnValue(makeSupabaseDouble(company));
  });

  it("allows a custom role with settings.company permission", async () => {
    const response = await PUT(request());

    expect(response.status).toBe(200);
    expect(mocks.checkPermissionById).toHaveBeenCalledWith(
      "user-1",
      "settings.company"
    );
    expect(company.schedule_settings).toMatchObject({
      optimization_window_days: 3,
      outdoor_task_type_ids: ["outdoor-1"],
    });
  });

  it("rejects the write when settings.company is denied", async () => {
    mocks.findUserByAuth.mockResolvedValue({
      id: "user-1",
      company_id: "company-1",
      role: "owner",
    });
    mocks.checkPermissionById.mockResolvedValue(false);

    const response = await PUT(request());

    expect(response.status).toBe(403);
    expect(company.schedule_settings).toEqual({});
  });
});

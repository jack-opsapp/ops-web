import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getSubscriptionInfoMock,
  resolveEmailConnectionOperationAccessMock,
  runSyncMock,
  runWithSupabaseMock,
  setSupabaseOverrideMock,
  supabaseContext,
  serviceRoleClient,
} = vi.hoisted(() => {
  const supabaseContext: { current: unknown; seenBySync: unknown } = {
    current: null,
    seenBySync: null,
  };
  const companyQuery = {
    select: () => companyQuery,
    eq: () => companyQuery,
    single: () =>
      Promise.resolve({
        data: {
          subscription_plan: "business",
          subscription_status: "active",
          trial_end_date: null,
          seated_employee_ids: [],
          admin_ids: [],
          max_seats: 10,
        },
        error: null,
      }),
  };
  const connectionResult = {
    data: [{ id: "connection-1", email: "owner@example.com" }],
    error: null,
  };
  const connectionQuery = {
    select: () => connectionQuery,
    in: () => connectionQuery,
    eq: () => connectionQuery,
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(connectionResult).then(resolve),
  };
  const serviceRoleClient = {
    from: vi.fn((table: string) =>
      table === "companies" ? companyQuery : connectionQuery
    ),
  };

  return {
    getSubscriptionInfoMock: vi.fn(),
    resolveEmailConnectionOperationAccessMock: vi.fn(),
    runSyncMock: vi.fn(),
    runWithSupabaseMock: vi.fn(),
    setSupabaseOverrideMock: vi.fn(),
    supabaseContext,
    serviceRoleClient,
  };
});

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => serviceRoleClient,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: runWithSupabaseMock,
  setSupabaseOverride: setSupabaseOverrideMock,
}));

vi.mock("@/lib/api/services/sync-engine", () => ({
  SyncEngine: {
    runSync: runSyncMock,
  },
}));

vi.mock("@/lib/subscription", () => ({
  getSubscriptionInfo: getSubscriptionInfoMock,
}));

vi.mock("@/lib/email/email-connection-operation-access", () => ({
  resolveEmailConnectionOperationAccess:
    resolveEmailConnectionOperationAccessMock,
}));

import {
  dynamic,
  POST,
  runtime,
} from "@/app/api/integrations/gmail/manual-sync/route";

function manualRequest(): NextRequest {
  return new NextRequest(
    "https://ops.test/api/integrations/gmail/manual-sync",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: "company-1" }),
    }
  );
}

describe("legacy Gmail manual sync route context", () => {
  beforeEach(() => {
    getSubscriptionInfoMock.mockReset();
    getSubscriptionInfoMock.mockReturnValue({ isActive: true });
    resolveEmailConnectionOperationAccessMock.mockReset();
    resolveEmailConnectionOperationAccessMock.mockResolvedValue({
      allowed: true,
      connections: [{ id: "connection-1", status: "active" }],
    });
    runSyncMock.mockReset();
    runSyncMock.mockImplementation(async () => {
      supabaseContext.seenBySync = supabaseContext.current;
      return {
        activitiesCreated: 1,
        matched: 1,
        needsReview: 0,
        newLeads: 1,
        errors: [],
      };
    });
    runWithSupabaseMock.mockReset();
    runWithSupabaseMock.mockImplementation(
      async (client: unknown, work: () => Promise<unknown>) => {
        supabaseContext.current = client;
        try {
          return await work();
        } finally {
          supabaseContext.current = null;
        }
      }
    );
    setSupabaseOverrideMock.mockReset();
    supabaseContext.current = null;
    supabaseContext.seenBySync = null;
  });

  it("keeps user-triggered sync inside an isolated service-role context", async () => {
    const response = await POST(manualRequest());

    expect(response.status).toBe(200);
    expect(runWithSupabaseMock).toHaveBeenCalledWith(
      serviceRoleClient,
      expect.any(Function)
    );
    expect(supabaseContext.seenBySync).toBe(serviceRoleClient);
    expect(setSupabaseOverrideMock).not.toHaveBeenCalled();
    expect(runSyncMock).toHaveBeenCalledWith("connection-1");
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
  });
});

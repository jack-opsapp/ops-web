import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  requireEmailPipelineSecretMock,
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
  const query = {
    select: () => query,
    eq: () => query,
    single: () =>
      Promise.resolve({ data: { company_id: "company-1" }, error: null }),
  };
  const serviceRoleClient = {
    from: vi.fn(() => query),
  };

  return {
    requireEmailPipelineSecretMock: vi.fn(),
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

vi.mock("@/lib/email/email-route-auth", () => ({
  requireEmailPipelineSecret: requireEmailPipelineSecretMock,
}));

vi.mock("@/lib/email/email-connection-operation-access", () => ({
  resolveEmailConnectionOperationAccess:
    resolveEmailConnectionOperationAccessMock,
}));

import {
  dynamic,
  POST,
  runtime,
} from "@/app/api/integrations/email/manual-sync/route";

function webhookRequest(): NextRequest {
  return new NextRequest(
    "https://ops.test/api/integrations/email/manual-sync",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connectionId: "connection-1",
        source: "webhook",
      }),
    }
  );
}

describe("email manual sync route context", () => {
  beforeEach(() => {
    requireEmailPipelineSecretMock.mockReset();
    requireEmailPipelineSecretMock.mockReturnValue(null);
    resolveEmailConnectionOperationAccessMock.mockReset();
    runSyncMock.mockReset();
    runSyncMock.mockImplementation(async () => {
      supabaseContext.seenBySync = supabaseContext.current;
      return {
        activitiesCreated: 1,
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

  it("keeps webhook-triggered sync inside an isolated service-role context", async () => {
    const response = await POST(webhookRequest());

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

  it("returns a retryable non-2xx contract when the engine reports errors", async () => {
    runSyncMock.mockResolvedValue({
      activitiesCreated: 0,
      newLeads: 0,
      continuationPending: false,
      errors: ["cursor intentionally unchanged"],
    });

    const response = await POST(webhookRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      state: "failed",
      retryable: true,
      connectionsProcessed: 1,
      failedConnections: 1,
      pendingConnections: 0,
    });
    expect(body.results[0].errors).toEqual(["cursor intentionally unchanged"]);
  });

  it("reports an accepted nonterminal checkpoint without claiming completion", async () => {
    runSyncMock.mockResolvedValue({
      activitiesCreated: 25,
      newLeads: 1,
      continuationPending: true,
      errors: [],
    });

    const response = await POST(webhookRequest());
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      ok: true,
      state: "continuing",
      retryable: false,
      failedConnections: 0,
      pendingConnections: 1,
    });
  });
});

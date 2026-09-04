import { afterEach, describe, expect, it, vi } from "vitest";

const CURSOR_KEY_ENV = "OPS_AGENT_OPERATIONAL_READ_CURSOR_KEY";

afterEach(() => {
  vi.doUnmock("@/lib/supabase/server-client");
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("MCP production runtime", () => {
  it("preserves Supabase cancellation through the composed authority adapter", async () => {
    vi.resetModules();
    vi.stubEnv(CURSOR_KEY_ENV, "ab".repeat(32));
    const signal = new AbortController().signal;
    const result = {
      data: [
        {
          actor_user_id: "11111111-1111-4111-8111-111111111111",
          company_id: "22222222-2222-4222-8222-222222222222",
          is_active: true,
          is_admin: false,
          role_ids: [],
          configured_permissions: ["projects.view"],
          effective_permissions: [
            { permission: "projects.view", scope: "all" },
          ],
          permission_snapshot_revision: "sha256:runtime-authority",
        },
      ],
      error: null,
    };
    const rawRequest = Promise.resolve(result);
    const abortSignal = vi.fn((receivedSignal: AbortSignal) => {
      expect(receivedSignal).toBe(signal);
      return rawRequest;
    });
    const rpc = vi.fn(() => Object.assign(rawRequest, { abortSignal }));
    vi.doMock("@/lib/supabase/server-client", () => ({
      getServiceRoleClient: () => ({ rpc }),
    }));
    const runtimeModule = await import("../runtime");
    const runtime = runtimeModule.getMcpServerRuntime();

    await expect(
      runtime.authorityRepository.resolveActorAuthority(
        {
          actorUserId: "11111111-1111-4111-8111-111111111111",
          companyId: "22222222-2222-4222-8222-222222222222",
          registeredPermissionKeys: ["projects.view"],
        },
        signal
      )
    ).resolves.toMatchObject({
      actorUserId: "11111111-1111-4111-8111-111111111111",
      companyId: "22222222-2222-4222-8222-222222222222",
    });
    expect(abortSignal).toHaveBeenCalledOnce();
  }, 60_000);

  it("constructs and caches the read catalogue plus dormant verticals without reading", async () => {
    vi.resetModules();
    vi.stubEnv(CURSOR_KEY_ENV, "ab".repeat(32));
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    vi.doMock("@/lib/supabase/server-client", () => ({
      getServiceRoleClient: () => ({ rpc }),
    }));
    const runtimeModule = await import("../runtime");

    expect(runtimeModule.mcpRuntimeConfigured()).toBe(true);
    const runtime = runtimeModule.getMcpServerRuntime();
    expect(runtimeModule.getMcpServerRuntime()).toBe(runtime);
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(runtime.durableRateLimiter)).toBe(true);
    expect(Object.keys(runtime.domainService)).toEqual([
      "getJobConversationContext",
      "listScheduledJobs",
      "listJobReadinessIssues",
      "getJobCommunicationContext",
      "resolveJobParticipants",
      "listCustomerJobs",
      "getJobSummary",
      "searchJobHistory",
      "getCorrespondenceEvidence",
      "searchCustomers",
      "searchJobs",
      "getCustomerContext",
      "listTasks",
      "getTaskContext",
      "listJobArtifacts",
      "getJobArtifactEvidence",
      "listSiteVisits",
      "getSiteVisitContext",
      "getDeckDesignGeometry",
      "listSalesDocuments",
      "getSalesDocument",
      "listPayments",
      "listExpenses",
      "getExpenseContext",
      "listWorkQueue",
      "searchCatalogItems",
      "getCatalogItem",
      "listPurchaseOrders",
      "getPurchaseOrder",
      "getCompanyContext",
      "listTeamMembers",
      "listTeamAvailability",
      "getIntegrationHealth",
      "getOperationalOverview",
      "prepareDayCloseout",
      "prepareCollections",
      "analyzeHiringBreakEven",
      "checkCustomerReply",
      "analyzeSalesTruth",
      "checkPayrollReadiness",
      "prepareRecurringServicePriceChange",
      "prepareEstimateFromPastJob",
      "prepareWeatherReschedule",
      "prepareCrewCalloutRecovery",
    ]);
    expect(runtime.hiringWhatIf).toBeDefined();
    expect(runtime.promiseRecovery).toBeDefined();
    expect(runtime.salesTruth).toBeDefined();
    expect(runtime.payrollReadiness).toBeDefined();
    expect(runtime.recurringServicePriceChange).toBeDefined();
    expect(runtime.estimateDraft).toBeDefined();
    expect(runtime.weatherReschedule).toBeDefined();
    expect(runtime.crewCalloutRecovery).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shares the service-role transport with the strict durable limiter adapter", async () => {
    vi.resetModules();
    vi.stubEnv(CURSOR_KEY_ENV, "ab".repeat(32));
    const rpc = vi.fn(async (functionName: string) => {
      if (functionName === "consume_agent_mcp_rate_limit_as_system") {
        return {
          data: [
            {
              allowed: true,
              remaining_units: 119,
              reset_at: "2026-08-23T18:21:00.000Z",
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    });
    vi.doMock("@/lib/supabase/server-client", () => ({
      getServiceRoleClient: () => ({ rpc }),
    }));
    const runtimeModule = await import("../runtime");
    const runtime = runtimeModule.getMcpServerRuntime();

    await expect(
      runtime.durableRateLimiter.consume({
        requestId: "req-runtime-rate",
        grantId: "11111111-1111-4111-8111-111111111111",
        actorUserId: "22222222-2222-4222-8222-222222222222",
        companyId: "33333333-3333-4333-8333-333333333333",
        capabilityId: "list_scheduled_jobs",
        protocolEra: "modern",
        bucket: "lightweight_read",
      })
    ).resolves.toEqual({
      allowed: true,
      remainingUnits: 119,
      resetAt: "2026-08-23T18:21:00.000Z",
    });
    expect(rpc).toHaveBeenCalledWith(
      "consume_agent_mcp_rate_limit_as_system",
      expect.objectContaining({
        p_capability_id: "list_scheduled_jobs",
        p_policy_id: "mcp-lightweight-read:2026-08-23.v1",
      })
    );
  });

  it("remains unusable without an exact cursor key", async () => {
    vi.resetModules();
    vi.stubEnv(CURSOR_KEY_ENV, "not-a-key");
    vi.doMock("@/lib/supabase/server-client", () => ({
      getServiceRoleClient: vi.fn(),
    }));
    const runtimeModule = await import("../runtime");

    expect(runtimeModule.mcpRuntimeConfigured()).toBe(false);
    expect(() => runtimeModule.getMcpServerRuntime()).toThrow(TypeError);
  });
});

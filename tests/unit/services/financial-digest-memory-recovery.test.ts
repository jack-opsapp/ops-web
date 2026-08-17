import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isEnabled: vi.fn(),
  proposeAction: vi.fn(),
  requireSupabase: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: mocks.requireSupabase,
}));

vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: {
    isAIFeatureEnabled: mocks.isEnabled,
  },
}));

vi.mock("@/lib/api/services/approval-queue-service", () => ({
  ApprovalQueueService: { proposeAction: mocks.proposeAction },
}));

import { FinancialIntelligenceService } from "@/lib/api/services/financial-intelligence-service";

describe("financial digest memory recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isEnabled.mockResolvedValue(true);
    mocks.proposeAction
      .mockResolvedValueOnce("action-created")
      .mockResolvedValueOnce(null);
  });

  it("retries memory persistence after the weekly action already deduplicates", async () => {
    let memoryInsertAttempt = 0;
    const companyQuery = {
      select: () => companyQuery,
      eq: () => companyQuery,
      single: async () => ({
        data: {
          invoice_settings: { financial_intelligence: { enabled: true } },
        },
        error: null,
      }),
    };
    const supabase = {
      from: (table: string) => {
        if (table !== "companies") {
          throw new Error(`unexpected non-atomic table write: ${table}`);
        }
        return companyQuery;
      },
      rpc: vi.fn(async (name: string) => {
        expect(name).toBe("replace_financial_analysis_memories");
        memoryInsertAttempt += 1;
        return memoryInsertAttempt === 1
          ? { error: { code: "42501", message: "permission denied" } }
          : { data: 1, error: null };
      }),
    };
    mocks.requireSupabase.mockReturnValue(supabase);

    vi.spyOn(
      FinancialIntelligenceService,
      "getRevenueForecasting"
    ).mockResolvedValue({
      monthlyRevenue: [],
      avgMonthly: 100,
      pipelineValue: 200,
      forecast: [],
      yoyChange: 10,
    });
    vi.spyOn(
      FinancialIntelligenceService,
      "getCashFlowProjection"
    ).mockResolvedValue({
      outstanding: 50,
      overdue: 0,
      receivedThisMonth: 100,
      projection: [],
      alerts: [],
    });
    vi.spyOn(
      FinancialIntelligenceService,
      "getPricingOptimization"
    ).mockResolvedValue({
      serviceAnalysis: [],
    });
    vi.spyOn(
      FinancialIntelligenceService,
      "getSeasonalPatterns"
    ).mockResolvedValue({
      monthlyIndex: [],
      peakMonths: [],
      slowMonths: [],
      servicePatterns: [],
    });

    await expect(
      FinancialIntelligenceService.generateFinancialDigest(
        "company-1",
        "user-1"
      )
    ).rejects.toThrow(
      "Failed to replace financial memories: permission denied"
    );
    await expect(
      FinancialIntelligenceService.generateFinancialDigest(
        "company-1",
        "user-1"
      )
    ).resolves.toBeNull();

    expect(memoryInsertAttempt).toBe(2);
    expect(mocks.proposeAction).toHaveBeenCalledTimes(2);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "replace_financial_analysis_memories",
      expect.objectContaining({ p_company_id: "company-1" })
    );
  });

  it("replaces stale memories with an explicit empty projection", async () => {
    mocks.proposeAction.mockReset().mockResolvedValue(null);
    const companyQuery = {
      select: () => companyQuery,
      eq: () => companyQuery,
      single: async () => ({
        data: {
          invoice_settings: { financial_intelligence: { enabled: true } },
        },
        error: null,
      }),
    };
    const rpc = vi.fn(async () => ({ data: 0, error: null }));
    mocks.requireSupabase.mockReturnValue({
      from: () => companyQuery,
      rpc,
    });
    vi.spyOn(
      FinancialIntelligenceService,
      "getRevenueForecasting"
    ).mockResolvedValue({
      monthlyRevenue: [],
      avgMonthly: 0,
      pipelineValue: 0,
      forecast: [],
      yoyChange: null,
    });
    vi.spyOn(
      FinancialIntelligenceService,
      "getCashFlowProjection"
    ).mockResolvedValue({
      outstanding: 0,
      overdue: 0,
      receivedThisMonth: 0,
      projection: [],
      alerts: [],
    });
    vi.spyOn(
      FinancialIntelligenceService,
      "getPricingOptimization"
    ).mockResolvedValue({ serviceAnalysis: [] });
    vi.spyOn(
      FinancialIntelligenceService,
      "getSeasonalPatterns"
    ).mockResolvedValue({
      monthlyIndex: [],
      peakMonths: [],
      slowMonths: [],
      servicePatterns: [],
    });

    await FinancialIntelligenceService.generateFinancialDigest(
      "company-1",
      "user-1"
    );

    expect(rpc).toHaveBeenCalledWith("replace_financial_analysis_memories", {
      p_company_id: "company-1",
      p_memories: [],
    });
  });
});

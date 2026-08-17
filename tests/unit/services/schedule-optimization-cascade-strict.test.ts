import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupabase: vi.fn(),
  isAIFeatureEnabled: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: mocks.requireSupabase,
}));
vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: {
    isAIFeatureEnabled: mocks.isAIFeatureEnabled,
  },
}));

import {
  cascadeAutomationSourceId,
  ScheduleOptimizationService,
} from "@/lib/api/services/schedule-optimization-service";
import { isDatabasePressureError } from "@/lib/api/services/cron-workload-error-contract";

type SupabaseResult = {
  data: unknown;
  error: unknown;
  status?: number;
  statusText?: string;
};

function builder(result: SupabaseResult) {
  const value: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "is", "single"]) {
    value[method] =
      method === "single" ? vi.fn(async () => result) : vi.fn(() => value);
  }
  return value;
}

function db(...results: SupabaseResult[]) {
  const builders = results.map(builder);
  const pendingBuilders = [...builders];
  return {
    builders,
    from: vi.fn(() => {
      const next = pendingBuilders.shift();
      if (!next) throw new Error("Unexpected query");
      return next;
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAIFeatureEnabled.mockResolvedValue(true);
});

describe("ScheduleOptimizationService strict cascade mode", () => {
  it("preserves legacy error swallowing by default but propagates for durable workers", async () => {
    const settings = {
      data: { schedule_settings: { cascade_detection: true } },
      error: null,
    };
    const failure = {
      data: null,
      error: { code: "XX000", message: "task lookup failed" },
    };
    const legacySettingsDb = db(settings);
    mocks.requireSupabase
      .mockReturnValueOnce(legacySettingsDb)
      .mockReturnValueOnce(db(failure));
    await expect(
      ScheduleOptimizationService.handleRescheduleCascade(
        "company-1",
        "actor-1",
        "task-1",
        "manual_update"
      )
    ).resolves.toEqual({ cascadeProposed: 0 });
    expect(legacySettingsDb.builders[0].select).toHaveBeenCalledWith(
      "schedule_settings"
    );

    const durableSettingsDb = db(settings);
    mocks.requireSupabase
      .mockReturnValueOnce(durableSettingsDb)
      .mockReturnValueOnce(db(failure));
    await expect(
      ScheduleOptimizationService.handleRescheduleCascade(
        "company-1",
        "actor-1",
        "task-1",
        "manual_update",
        { throwOnError: true }
      )
    ).rejects.toThrow("task lookup failed");
    expect(durableSettingsDb.builders[0].select).toHaveBeenCalledWith(
      "schedule_settings"
    );
  });

  it("preserves the raw Supabase cause for strict durable workers", async () => {
    const settings = {
      data: { schedule_optimization_settings: { cascade_detection: true } },
      error: null,
    };
    const cause = {
      data: null,
      error: {
        code: "",
        details: null,
        hint: null,
        message: "Service unavailable",
      },
      status: 503,
      statusText: "Service Unavailable",
    };
    mocks.requireSupabase
      .mockReturnValueOnce(db(settings))
      .mockReturnValueOnce(db(cause));

    const failure = await ScheduleOptimizationService.handleRescheduleCascade(
      "company-1",
      "actor-1",
      "task-1",
      "manual_update",
      { throwOnError: true }
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: "CronDatabaseOperationError",
      cause: {
        error: cause.error,
        status: 503,
        statusText: "Service Unavailable",
      },
    });
    expect(isDatabasePressureError(failure)).toBe(true);
  });

  it("uses the stable worker prefix in every affected-task proposal id", () => {
    expect(
      cascadeAutomationSourceId("task-1", "affected-1", {
        sourceIdPrefix: "task-automation:event-1:cascade",
      })
    ).toBe("task-automation:event-1:cascade:affected-1");
    expect(cascadeAutomationSourceId("task-1", "affected-1")).toBe(
      "cascade:task-1:affected-1"
    );
  });
});

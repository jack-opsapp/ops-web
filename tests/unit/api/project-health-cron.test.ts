import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServiceRoleClient: vi.fn(),
  setSupabaseOverride: vi.fn(),
  detectOverdueTasks: vi.fn(),
  detectClosableProjects: vi.fn(),
  runBoundedPhaseCCompanyFanout: vi.fn(),
  runWithCronWorkloadControl: vi.fn(),
  client: { rpc: vi.fn(), from: vi.fn() },
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: mocks.setSupabaseOverride,
}));

vi.mock("@/lib/api/services/project-lifecycle-service", () => ({
  ProjectLifecycleService: {
    detectOverdueTasks: mocks.detectOverdueTasks,
    detectClosableProjects: mocks.detectClosableProjects,
  },
}));

vi.mock("@/lib/api/services/cron-company-fanout-service", () => ({
  runBoundedPhaseCCompanyFanout: mocks.runBoundedPhaseCCompanyFanout,
}));

vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  runWithCronWorkloadControl: mocks.runWithCronWorkloadControl,
}));

import { GET } from "@/app/api/cron/project-health/route";

function request(token = "cron-secret") {
  return new NextRequest("https://ops.test/api/cron/project-health", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("project health cron", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getServiceRoleClient.mockReturnValue(mocks.client);
    mocks.runWithCronWorkloadControl.mockImplementation(
      async ({ work }: { work: (lease: object) => Promise<unknown> }) => ({
        status: "completed",
        value: await work({}),
      })
    );
    mocks.runBoundedPhaseCCompanyFanout.mockImplementation(
      async ({
        onCompanyError,
      }: {
        onCompanyError: (id: string, error: Error) => unknown;
      }) => ({
        companyIds: ["company-1"],
        results: [
          onCompanyError(
            "company-1",
            new Error("column project_tasks.calendar_event_id does not exist")
          ),
        ],
        cursor: { previous: null, next: null },
      })
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("fails the workload and exposes company errors instead of returning a false success", async () => {
    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Project health failed for 1 of 1 companies",
      results: [
        {
          companyId: "company-1",
          overdueTasks: 0,
          closableProjects: 0,
          error: "column project_tasks.calendar_event_id does not exist",
        },
      ],
    });
    expect(mocks.runWithCronWorkloadControl).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase: mocks.client,
        workloadKey: "project-health",
        leaseSeconds: 360,
        work: expect.any(Function),
      })
    );
    expect(mocks.setSupabaseOverride).toHaveBeenLastCalledWith(null);
  });
});

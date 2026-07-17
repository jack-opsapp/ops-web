import { beforeEach, describe, expect, it, vi } from "vitest";

const TASK_ID = "44444444-4444-4444-8444-444444444444";
const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const TASK_TYPE_ID = "55555555-5555-4555-8555-555555555555";

const mocks = vi.hoisted(() => ({
  authedFetch: vi.fn(),
  getIdToken: vi.fn(),
}));

vi.mock("@/lib/utils/authed-fetch", () => ({
  authedFetch: mocks.authedFetch,
}));
vi.mock("@/lib/firebase/auth", () => ({
  getIdToken: mocks.getIdToken,
}));

import { LifecycleMutationService } from "@/lib/api/services/lifecycle-mutation-service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getIdToken.mockResolvedValue("legacy-token");
  mocks.authedFetch.mockResolvedValue(
    new Response(JSON.stringify({ taskId: TASK_ID, created: true }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    })
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ taskId: TASK_ID, created: true }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
    )
  );
});

describe("LifecycleMutationService", () => {
  it("uses the canonical refresh-aware authedFetch transport", async () => {
    await LifecycleMutationService.updateTask(TASK_ID, {
      customTitle: "Site visit",
    });

    expect(mocks.authedFetch).toHaveBeenCalledWith(`/api/tasks/${TASK_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ data: { customTitle: "Site visit" } }),
      headers: { "Content-Type": "application/json" },
    });
    expect(mocks.getIdToken).not.toHaveBeenCalled();
  });

  it("generates one client mutation id, preserves caller retries, and strips company authority", async () => {
    await LifecycleMutationService.createTaskWithEvent({
      task: {
        projectId: PROJECT_ID,
        companyId: COMPANY_ID,
        taskTypeId: TASK_TYPE_ID,
      },
    });

    const firstInit = mocks.authedFetch.mock.calls[0][1] as RequestInit;
    const firstBody = JSON.parse(String(firstInit.body)) as {
      task: Record<string, unknown>;
    };
    expect(firstBody.task.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(firstBody.task.companyId).toBeUndefined();

    mocks.authedFetch.mockClear();
    await LifecycleMutationService.createTaskWithEvent({
      task: {
        id: TASK_ID,
        projectId: PROJECT_ID,
        companyId: COMPANY_ID,
        taskTypeId: TASK_TYPE_ID,
      },
    });
    const retryInit = mocks.authedFetch.mock.calls[0][1] as RequestInit;
    const retryBody = JSON.parse(String(retryInit.body)) as {
      task: Record<string, unknown>;
    };
    expect(retryBody.task.id).toBe(TASK_ID);
  });
});

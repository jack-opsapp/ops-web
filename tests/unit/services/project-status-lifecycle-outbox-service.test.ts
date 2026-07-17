import { beforeEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/services/project-lifecycle-service", () => ({
  ProjectLifecycleService: { onProjectStageChange: lifecycle },
}));

import { ProjectStatusLifecycleOutboxService } from "@/lib/api/services/project-status-lifecycle-outbox-service";

const claim = {
  event_id: "event-1",
  lease_token: "lease-1",
  company_id: "company-1",
  project_id: "project-1",
  actor_user_id: "actor-1",
  old_status: "rfq",
  new_status: "estimated",
  project_status_version: 4,
  project_updated_at: "2026-07-16T00:00:00.000Z",
  requested_at: "2026-07-16T00:00:00.000Z",
  attempt: 1,
};

function userQuery() {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "is"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => ({
    data: { first_name: "Jason", last_name: "Zavarella" },
    error: null,
  }));
  return builder;
}

beforeEach(() => {
  lifecycle.mockReset();
  lifecycle.mockResolvedValue(undefined);
});

describe("ProjectStatusLifecycleOutboxService", () => {
  it("attributes and completes a leased event", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: 0, error: null })
      .mockResolvedValueOnce({ data: [claim], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const db = { rpc, from: vi.fn(() => userQuery()) };

    const result = await ProjectStatusLifecycleOutboxService.processBatch(
      db as never,
      { workerId: "worker-1", limit: 1 }
    );

    expect(lifecycle).toHaveBeenCalledWith(
      "company-1",
      "project-1",
      "rfq",
      "estimated",
      "actor-1",
      "Jason Zavarella",
      "event-1",
      true,
      4,
      "2026-07-16T00:00:00.000Z"
    );
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      "complete_project_status_lifecycle_event",
      { p_event_id: "event-1", p_lease_token: "lease-1" }
    );
    expect(result).toMatchObject({ claimed: 1, completed: 1, requeued: 0 });
  });

  it("persists a retry when lifecycle work fails", async () => {
    lifecycle.mockRejectedValueOnce(new Error("timeline unavailable"));
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: 0, error: null })
      .mockResolvedValueOnce({ data: [claim], error: null })
      .mockResolvedValueOnce({ data: "pending", error: null });
    const db = { rpc, from: vi.fn(() => userQuery()) };

    const result = await ProjectStatusLifecycleOutboxService.processBatch(
      db as never,
      { workerId: "worker-1", limit: 1 }
    );

    expect(rpc).toHaveBeenNthCalledWith(
      3,
      "fail_project_status_lifecycle_event",
      {
        p_event_id: "event-1",
        p_lease_token: "lease-1",
        p_error: "timeline unavailable",
        p_retryable: true,
      }
    );
    expect(result.requeued).toBe(1);
  });

  it("reports rows terminalized after an expired final lease", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: 2, error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const db = { rpc, from: vi.fn(() => userQuery()) };

    const result = await ProjectStatusLifecycleOutboxService.processBatch(
      db as never,
      { workerId: "worker-1" }
    );

    expect(result).toMatchObject({
      claimed: 0,
      completed: 0,
      terminalFailed: 2,
    });
  });
});

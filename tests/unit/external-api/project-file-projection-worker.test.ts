import { beforeEach, describe, expect, it, vi } from "vitest";

import { processExternalIntakeProjectFileProjectionBatch } from "@/lib/external-api/uploads/project-file-projection-worker";

const JOB = {
  id: "11111111-1111-4111-8111-111111111111",
  company_id: "22222222-2222-4222-8222-222222222222",
  project_id: "33333333-3333-4333-8333-333333333333",
  opportunity_id: "44444444-4444-4444-8444-444444444444",
  submission_id: "55555555-5555-4555-8555-555555555555",
  intent_id: "66666666-6666-4666-8666-666666666666",
  attempt_count: 1,
  lease_generation: 2,
  lease_token: "77777777-7777-4777-8777-777777777777",
};

describe("external intake project file projection worker", () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("claims a bounded batch and completes the fenced relationship", async () => {
    rpc
      .mockResolvedValueOnce({ data: [JOB], error: null })
      .mockResolvedValueOnce({ data: { status: "complete" }, error: null });

    const result = await processExternalIntakeProjectFileProjectionBatch(
      { rpc } as never,
      { workerId: "worker-1", limit: 50, leaseSeconds: 999 }
    );

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "claim_external_intake_project_file_projections_as_system",
      {
        p_worker_id: "worker-1",
        p_limit: 25,
        p_lease_seconds: 900,
      }
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "finish_external_intake_project_file_projection_as_system",
      expect.objectContaining({
        p_job_id: JOB.id,
        p_generation: 2,
        p_lease_token: JOB.lease_token,
        p_outcome: "project",
      })
    );
    expect(result).toEqual({
      claimed: 1,
      completed: 1,
      requeued: 0,
      blocked: 0,
      stale: 0,
      errors: 0,
    });
  });

  it("requeues a failed projection without failing conversion", async () => {
    rpc
      .mockResolvedValueOnce({ data: [JOB], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "temporary" },
      })
      .mockResolvedValueOnce({ data: { status: "retrying" }, error: null });

    const result = await processExternalIntakeProjectFileProjectionBatch(
      { rpc } as never,
      { workerId: "worker-2" }
    );

    expect(rpc).toHaveBeenNthCalledWith(
      3,
      "finish_external_intake_project_file_projection_as_system",
      expect.objectContaining({
        p_outcome: "retry",
        p_safe_code: "projection_retry",
      })
    );
    expect(result).toMatchObject({
      claimed: 1,
      completed: 0,
      requeued: 1,
      errors: 1,
    });
  });
});

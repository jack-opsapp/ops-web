import { describe, expect, it, vi } from "vitest";

import {
  executeExternalLeadProjectionBackfill,
  verifyExternalLeadProjectionBackfill,
} from "@/lib/external-api/analytics/projection-backfill";

const runId = "11111111-1111-4111-8111-111111111111";
const leaseToken = "22222222-2222-4222-8222-222222222222";

function run(
  status: "pending" | "running" | "complete" | "verified",
  processedCount: number,
  checkpoint: string | null
) {
  return {
    id: runId,
    company_id: null,
    status,
    checkpoint_opportunity_id: checkpoint,
    processed_count: processedCount,
    projected_count: processedCount,
    lease_token: status === "running" ? leaseToken : null,
    lease_generation: status === "pending" ? 0 : 1,
    lease_expires_at: status === "running" ? "2099-01-01T00:00:00.000Z" : null,
  };
}

describe("external lead projection backfill orchestration", () => {
  it("checkpoints committed batches and completes without replaying them", async () => {
    const firstCheckpoint = "33333333-3333-4333-8333-333333333333";
    const finalCheckpoint = "44444444-4444-4444-8444-444444444444";
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: run("pending", 0, null), error: null })
      .mockResolvedValueOnce({ data: run("running", 0, null), error: null })
      .mockResolvedValueOnce({
        data: run("running", 100, firstCheckpoint),
        error: null,
      })
      .mockResolvedValueOnce({
        data: run("complete", 125, finalCheckpoint),
        error: null,
      });

    await expect(
      executeExternalLeadProjectionBackfill(
        { rpc },
        { companyId: null, batchSize: 100 }
      )
    ).resolves.toMatchObject({
      status: "complete",
      processed_count: 125,
      checkpoint_opportunity_id: finalCheckpoint,
    });

    const processCalls = rpc.mock.calls.filter(
      ([name]) => name === "process_external_lead_projection_backfill_as_system"
    );
    expect(processCalls).toHaveLength(2);
    expect(processCalls[0]?.[1]).toMatchObject({
      p_lease_token: leaseToken,
      p_lease_generation: 1,
      p_batch_size: 100,
    });
  });

  it("resumes the same complete run and verifies protected state", async () => {
    const checkpoint = "44444444-4444-4444-8444-444444444444";
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: run("complete", 125, checkpoint),
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          run_id: runId,
          status: "verified",
          stable_public_handle: true,
          current_baseline_complete: true,
          company_monotonic_sequence: true,
          tombstones_valid: true,
          business_rows_unchanged: true,
          processed_count: 125,
          verified_at: "2026-07-27T12:00:00.000Z",
        },
        error: null,
      });

    await expect(
      executeExternalLeadProjectionBackfill({ rpc }, { companyId: null })
    ).resolves.toMatchObject({ id: runId, status: "complete" });
    await expect(
      verifyExternalLeadProjectionBackfill({ rpc }, runId)
    ).resolves.toMatchObject({
      status: "verified",
      business_rows_unchanged: true,
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { processExternalIntakeOutboxBatch } from "@/lib/external-api/intake/outbox-worker";

const COMPANY_ID = "10000000-0000-4000-8000-000000000001";
const OPPORTUNITY_ID = "10000000-0000-4000-8000-000000000002";
const OUTBOX_ID = "10000000-0000-4000-8000-000000000003";
const LEASE_TOKEN = "10000000-0000-4000-8000-000000000004";

describe("external intake post-commit outbox worker", () => {
  const rpc = vi.fn();
  const refreshLeadSummary = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockImplementation((name: string) => {
      if (name === "claim_external_intake_post_commit_outbox_as_system") {
        return Promise.resolve({
          data: [
            {
              outbox_id: OUTBOX_ID,
              lease_token: LEASE_TOKEN,
              company_id: COMPANY_ID,
              opportunity_id: OPPORTUNITY_ID,
              original_context: {
                work: { workSummary: "Replace the deck." },
                serviceAddress: { city: "Victoria" },
                answers: [],
                occurredAt: "2026-07-26T22:00:00.000Z",
              },
            },
          ],
          error: null,
        });
      }
      if (name === "complete_external_intake_post_commit_outbox_as_system") {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "retry_external_intake_post_commit_outbox_as_system") {
        return Promise.resolve({ data: true, error: null });
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    refreshLeadSummary.mockResolvedValue({
      requested: 1,
      written: 1,
      failed: [],
      deferred: [],
    });
  });

  it("refreshes from protected original context and completes the lease once", async () => {
    const result = await processExternalIntakeOutboxBatch(
      { limit: 5, workerId: "external-intake-test" },
      {
        client: { rpc },
        refreshLeadSummary,
      }
    );

    expect(refreshLeadSummary).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      opportunityId: OPPORTUNITY_ID,
      originalContext: {
        work: { workSummary: "Replace the deck." },
        serviceAddress: { city: "Victoria" },
        answers: [],
        occurredAt: "2026-07-26T22:00:00.000Z",
      },
    });
    expect(rpc).toHaveBeenCalledWith(
      "complete_external_intake_post_commit_outbox_as_system",
      {
        p_outbox_id: OUTBOX_ID,
        p_lease_token: LEASE_TOKEN,
      }
    );
    expect(result).toEqual({
      claimed: 1,
      completed: 1,
      requeued: 0,
      errors: [],
    });
  });

  it("requeues derived enrichment failure without undoing or duplicating the lead", async () => {
    refreshLeadSummary.mockRejectedValueOnce(new Error("provider unavailable"));

    const result = await processExternalIntakeOutboxBatch(
      { limit: 1, workerId: "external-intake-test" },
      {
        client: { rpc },
        refreshLeadSummary,
      }
    );

    expect(rpc).toHaveBeenCalledWith(
      "retry_external_intake_post_commit_outbox_as_system",
      {
        p_outbox_id: OUTBOX_ID,
        p_lease_token: LEASE_TOKEN,
        p_error_code: "summary_refresh_failed",
      }
    );
    expect(result).toMatchObject({ claimed: 1, completed: 0, requeued: 1 });
    expect(result.errors[0]).toEqual({
      outboxId: OUTBOX_ID,
      error: "summary_refresh_failed",
    });
    expect(JSON.stringify(result)).not.toContain("provider unavailable");
  });
});

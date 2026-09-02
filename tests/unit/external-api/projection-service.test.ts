import { describe, expect, it, vi } from "vitest";

import {
  ExternalLeadProjectionError,
  refreshExternalLeadProjection,
} from "@/lib/external-api/analytics/projection-service";

describe("external lead projection service", () => {
  it("calls the fixed service-only projection command", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        public_lead_id: "lead_AAAAAAAAAAAAAAAAAAAAAA",
        change_sequence: 42,
        operation: "upsert",
      },
      error: null,
    });

    await expect(
      refreshExternalLeadProjection(
        { rpc },
        {
          companyId: "co-1",
          opportunityId: "opp-1",
          reason: "opportunity_changed",
        }
      )
    ).resolves.toEqual({
      publicLeadId: "lead_AAAAAAAAAAAAAAAAAAAAAA",
      changeSequence: 42,
      operation: "upsert",
    });
    expect(rpc).toHaveBeenCalledWith(
      "refresh_external_lead_projection_as_system",
      {
        p_company_id: "co-1",
        p_opportunity_id: "opp-1",
        p_reason: "opportunity_changed",
      }
    );
  });

  it("fails closed when the fixed command errors or returns no row", async () => {
    await expect(
      refreshExternalLeadProjection(
        {
          rpc: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "projection failed" },
          }),
        },
        {
          companyId: "co-1",
          opportunityId: "opp-1",
          reason: "financial_changed",
        }
      )
    ).rejects.toBeInstanceOf(ExternalLeadProjectionError);
  });
});

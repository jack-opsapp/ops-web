import { describe, expect, it, vi } from "vitest";

import { SagePurchasingService } from "../sage-purchasing-service";

describe("SagePurchasingService", () => {
  it("posts purchase invoices to the Sage Accounting 3.1 endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "sage-bill-1" }),
    });
    const service = new SagePurchasingService({
      accessToken: "token",
      fetchImpl,
    });

    await expect(
      service.create("purchase_invoices", {
        purchase_invoice: { contact_id: "vendor" },
      })
    ).resolves.toMatchObject({ sageId: "sage-bill-1" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.accounting.sage.com/v3.1/purchase_invoices",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("deletes a voided purchase invoice using the provider identity", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const service = new SagePurchasingService({
      accessToken: "token",
      fetchImpl,
    });
    await service.delete("purchase_invoices", "bill/1");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.accounting.sage.com/v3.1/purchase_invoices/bill%2F1",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});

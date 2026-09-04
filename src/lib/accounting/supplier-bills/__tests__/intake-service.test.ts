import { describe, expect, it, vi } from "vitest";

import {
  SupplierBillIntakeService,
  type SupplierBillIntakeServiceDependencies,
} from "../intake-service";

const ACTOR = {
  actorUserId: "10000000-0000-4000-8000-000000000001",
  companyId: "10000000-0000-4000-8000-000000000002",
  idToken: "verified-token",
};
const INTAKE_ID = "10000000-0000-4000-8000-000000000003";

function dependencies(
  overrides: Partial<SupplierBillIntakeServiceDependencies> = {}
): SupplierBillIntakeServiceDependencies {
  return {
    repository: {
      list: vi
        .fn()
        .mockResolvedValue([{ id: INTAKE_ID, review_stage: "review" }]),
      detail: vi.fn().mockResolvedValue({ intake: { id: INTAKE_ID } }),
      duplicateCandidates: vi.fn().mockResolvedValue([
        {
          id: "existing-intake",
          normalizedSupplierName: "deksmart vinyl products",
          normalizedInvoiceNumber: "42995",
          sourceSha256: "b".repeat(64),
        },
      ]),
    },
    rpc: vi.fn().mockResolvedValue({
      data: { intentId: "intent-1", confirmationText: "CONFIRM" },
      error: null,
    }),
    storeDocument: vi.fn().mockResolvedValue({
      uploaded: true,
      descriptor: {
        bucket: "ops-files",
        objectKey: `${ACTOR.companyId}/supplier-bills/${INTAKE_ID}.pdf`,
        publicUrl: "https://cdn.example.test/invoice.pdf",
        originalFilename: "invoice.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1000,
        sha256: "a".repeat(64),
      },
    }),
    removeDocument: vi.fn().mockResolvedValue(undefined),
    extractDocument: vi.fn().mockResolvedValue({
      pages: ["invoice"],
      text: "invoice",
    }),
    parseDocument: vi.fn().mockReturnValue({
      supplierName: "DeksMart Vinyl Products",
      invoiceNumber: "42995",
      invoiceDate: "2026-08-25",
      dueDate: null,
      purchaseOrder: null,
      shippingReference: "Ace Prepaid · AA5255032",
      currency: "CAD",
      subtotal: "100.00",
      taxTotal: "5.00",
      total: "105.00",
      lines: [
        {
          position: 1,
          sku: "VVBO68",
          description: "Ultra Boardwalk 68 mil",
          orderedQuantity: "35",
          invoicedQuantity: "35",
          unitOfMeasure: "FT",
          unitPrice: "2.86",
          subtotal: "100.00",
          taxAmount: "0.00",
          total: "100.00",
          jobHint: "74 Sims Ave",
        },
      ],
      confidence: "review_required",
      provenance: { invoiceNumber: "42995" },
    }),
    ...overrides,
  };
}

describe("supplier bill intake service", () => {
  it("lists only the actor company's requested lifecycle", async () => {
    const deps = dependencies();
    const result = await new SupplierBillIntakeService(ACTOR, deps).list(
      "review"
    );

    expect(result).toEqual([{ id: INTAKE_ID, review_stage: "review" }]);
    expect(deps.repository.list).toHaveBeenCalledWith(
      ACTOR.companyId,
      "review"
    );
  });

  it("reads detail through an exact company and intake identity", async () => {
    const deps = dependencies();
    await new SupplierBillIntakeService(ACTOR, deps).detail(INTAKE_ID);

    expect(deps.repository.detail).toHaveBeenCalledWith(
      ACTOR.companyId,
      INTAKE_ID
    );
  });

  it("persists a parsed material invoice with tax allocated and review gates", async () => {
    const deps = dependencies();
    await new SupplierBillIntakeService(ACTOR, deps).prepareCapture({
      metadata: {
        requestId: INTAKE_ID,
        idempotencyKey: "capture:42995",
        documentKind: "material",
      },
      filename: "invoice.pdf",
      bytes: Buffer.from("%PDF-1.7\n%%EOF"),
    });

    expect(deps.storeDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: ACTOR.companyId,
        requestId: INTAKE_ID,
      })
    );
    expect(deps.rpc).toHaveBeenCalledWith(
      "prepare_supplier_bill_intake_write",
      expect.objectContaining({
        p_actor_user_id: ACTOR.actorUserId,
        p_command: expect.objectContaining({
          companyId: ACTOR.companyId,
          actorUserId: ACTOR.actorUserId,
          dueDate: null,
          lines: [
            expect.objectContaining({
              subtotal: "100.00",
              taxAmount: "5.00",
              total: "105.00",
              jobHint: "74 Sims Ave",
            }),
          ],
          checks: expect.arrayContaining([
            expect.objectContaining({
              key: "duplicate_billing",
              outcome: "exception",
              disposition: "unresolved",
            }),
            expect.objectContaining({
              key: "order_specification",
              outcome: "pending",
            }),
            expect.objectContaining({ key: "receipt", outcome: "pending" }),
          ]),
        }),
      })
    );
  });

  it("removes newly stored custody when database preparation fails", async () => {
    const deps = dependencies({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "23505" } }),
    });
    const service = new SupplierBillIntakeService(ACTOR, deps);

    await expect(
      service.prepareCapture({
        metadata: {
          requestId: INTAKE_ID,
          idempotencyKey: "capture:42995",
          documentKind: "material",
        },
        filename: "invoice.pdf",
        bytes: Buffer.from("%PDF-1.7\n%%EOF"),
      })
    ).rejects.toMatchObject({ code: "23505" });
    expect(deps.removeDocument).toHaveBeenCalledTimes(1);
  });

  it("binds every review action to the authenticated actor and intake", async () => {
    const deps = dependencies();
    await new SupplierBillIntakeService(ACTOR, deps).prepareAction(INTAKE_ID, {
      kind: "hold",
      expectedRevision: 2,
      idempotencyKey: "hold:42995:v2",
      holdReason: "Quantity mismatch",
      nextAction: "Confirm with the foreman",
    });

    expect(deps.rpc).toHaveBeenCalledWith(
      "prepare_supplier_bill_intake_write",
      {
        p_actor_user_id: ACTOR.actorUserId,
        p_command: expect.objectContaining({
          intakeId: INTAKE_ID,
          companyId: ACTOR.companyId,
          actorUserId: ACTOR.actorUserId,
        }),
      }
    );
  });

  it("commits only the server-issued intent and exact confirmation", async () => {
    const deps = dependencies();
    await new SupplierBillIntakeService(ACTOR, deps).commit({
      intentId: "intent-1",
      confirmationText: "CONFIRM",
    });

    expect(deps.rpc).toHaveBeenCalledWith("commit_supplier_bill_intake_write", {
      p_actor_user_id: ACTOR.actorUserId,
      p_intent_id: "intent-1",
      p_confirmation_text: "CONFIRM",
    });
  });
});

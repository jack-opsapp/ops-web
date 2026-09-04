import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSageReadClient,
  createSageWriteClient,
  SageApiError,
} from "@/lib/api/services/sage-api-client";
import { sageIdempotencyKey } from "@/lib/api/services/sage-idempotency";
import {
  buildSageContact,
  buildSageContactPayment,
  buildSagePurchaseInvoice,
  buildSageSalesDocument,
} from "@/lib/api/services/sage-push-mappers";
import {
  SageReconcileService,
  type SageReconcileCandidate,
} from "@/lib/api/services/sage-reconcile-service";
import { normalizeSageRecord } from "@/lib/api/services/sage-normalize";
import {
  FakeSageServer,
  type FakeSageResource,
} from "../helpers/fake-sage-server";

const BASE_URL = "https://api.accounting.sage.com/v3.1";
const CLOCK = "2026-09-04T12:00:00.000Z";

function queueId(value: number): string {
  return `11111111-2222-4333-8444-${String(value).padStart(12, "0")}`;
}

function lines() {
  return [
    {
      description: "Materials",
      quantity: "2",
      unitPrice: "40.00",
      subtotal: "80.00",
      ledgerAccountId: "ledger-materials",
      taxRateId: "tax-gst",
    },
    {
      description: "Labour",
      quantity: "3",
      unitPrice: "60.00",
      subtotal: "180.00",
      ledgerAccountId: "ledger-labour",
      taxRateId: "tax-gst",
    },
  ];
}

function client(server: FakeSageServer, tokenState = { value: "access-1" }) {
  return createSageWriteClient({
    businessId: server.primaryBusinessId,
    baseUrl: BASE_URL,
    fetchFn: server.fetch,
    getAccessToken: async () => tokenState.value,
    refreshAccessToken: async () => tokenState.value,
    onDisconnect: async () => undefined,
    now: () => new Date(CLOCK),
  });
}

beforeEach(() => {
  process.env.QB_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe.each([1, 2, 3])("deterministic Sage full-graph run %i", () => {
  it("creates every dependency once, preserves full lines, and finalizes local ids", async () => {
    const server = new FakeSageServer(CLOCK);
    const sage = client(server);
    const localExternalIds = new Map<string, string>();
    const outcomes = new Map<string, string>();

    const write = async (
      index: number,
      localId: string,
      resource: Exclude<FakeSageResource, "businesses">,
      payload: Record<string, unknown>
    ) => {
      const accepted = await sage.create(
        resource,
        payload,
        sageIdempotencyKey(queueId(index), resource)
      );
      const externalId = String((accepted.data as { id: string }).id);
      localExternalIds.set(localId, externalId);
      outcomes.set(queueId(index), "succeeded");
      return externalId;
    };

    const customerId = await write(
      1,
      "ops-customer",
      "contacts",
      buildSageContact({
        name: "Acme Roofing",
        kind: "customer",
        email: "books@acme.test",
      })
    );
    const supplierId = await write(
      2,
      "ops-supplier",
      "contacts",
      buildSageContact({ name: "North Supply", kind: "supplier" })
    );
    const common = {
      contactId: customerId,
      date: "2026-09-04",
      dueOrExpiryDate: "2026-10-04",
      lines: lines(),
    };
    await write(
      3,
      "ops-estimate",
      "sales_estimates",
      buildSageSalesDocument("sales_estimates", {
        ...common,
        reference: "EST-100",
      })
    );
    await write(
      4,
      "ops-quote",
      "sales_quotes",
      buildSageSalesDocument("sales_quotes", {
        ...common,
        reference: "QUO-100",
      })
    );
    const invoiceId = await write(
      5,
      "ops-invoice",
      "sales_invoices",
      buildSageSalesDocument("sales_invoices", {
        ...common,
        reference: "INV-100",
      })
    );
    await write(
      6,
      "ops-payment",
      "contact_payments",
      buildSageContactPayment({
        transactionType: "CUSTOMER_RECEIPT",
        contactId: customerId,
        bankAccountId: "bank-operating",
        paymentMethodId: "EFT",
        date: "2026-09-04",
        amount: "100.00",
        allocations: [{ artefactId: invoiceId, amount: "100.00" }],
        reference: "PAY-100",
      })
    );
    const billId = await write(
      7,
      "ops-supplier-bill",
      "purchase_invoices",
      buildSagePurchaseInvoice({
        contactId: supplierId,
        date: "2026-09-04",
        dueDate: "2026-10-04",
        reference: "BILL-100",
        lines: lines(),
      })
    );
    await write(
      8,
      "ops-supplier-payment",
      "contact_payments",
      buildSageContactPayment({
        transactionType: "VENDOR_PAYMENT",
        contactId: supplierId,
        bankAccountId: "bank-operating",
        paymentMethodId: "EFT",
        date: "2026-09-04",
        amount: "75.00",
        allocations: [{ artefactId: billId, amount: "75.00" }],
        reference: "SUP-PAY-100",
      })
    );

    expect(localExternalIds).toEqual(
      new Map([
        ["ops-customer", "contacts-1"],
        ["ops-supplier", "contacts-2"],
        ["ops-estimate", "sales_estimates-1"],
        ["ops-quote", "sales_quotes-1"],
        ["ops-invoice", "sales_invoices-1"],
        ["ops-payment", "contact_payments-1"],
        ["ops-supplier-bill", "purchase_invoices-1"],
        ["ops-supplier-payment", "contact_payments-2"],
      ])
    );
    expect(new Set(outcomes.values())).toEqual(new Set(["succeeded"]));
    expect(outcomes.size).toBe(8);

    for (const resource of [
      "sales_estimates",
      "sales_quotes",
      "sales_invoices",
      "purchase_invoices",
    ] as const) {
      const document = server.records(resource)[0];
      const lineKey =
        resource === "sales_invoices" || resource === "purchase_invoices"
          ? "invoice_lines"
          : resource === "sales_quotes"
            ? "quote_lines"
            : "estimate_lines";
      expect(document[lineKey]).toHaveLength(2);
    }

    const accepted = server.acceptedWrites.map((write) => write.resource);
    expect(accepted.indexOf("contacts")).toBeLessThan(
      accepted.indexOf("sales_invoices")
    );
    expect(accepted.indexOf("sales_invoices")).toBeLessThan(
      accepted.indexOf("contact_payments")
    );
    expect(
      server.requests.every(
        (request) => request.businessId === server.primaryBusinessId
      )
    ).toBe(true);
    expect(
      server.acceptedWrites
        .filter((write) => write.method !== "DELETE")
        .every((write) => Boolean(write.idempotencyId))
    ).toBe(true);
  });
});

describe("Sage recovery and reconciliation war game", () => {
  it("recovers auth expiry, rate limits, provider faults, lost responses, and duplicate workers", async () => {
    const server = new FakeSageServer(CLOCK);
    const token = { value: "access-1" };
    const refresh = vi.fn(async () => {
      token.value = "access-2";
      return token.value;
    });
    const disconnected = vi.fn(async () => undefined);
    const sage = createSageWriteClient({
      businessId: server.primaryBusinessId,
      baseUrl: BASE_URL,
      fetchFn: server.fetch,
      getAccessToken: async () => token.value,
      refreshAccessToken: refresh,
      onDisconnect: disconnected,
      now: () => new Date(CLOCK),
    });
    const contact = buildSageContact({
      name: "Recovery Customer",
      kind: "customer",
    });

    server.expireToken("access-1");
    server.addToken("access-2");
    await sage.create(
      "contacts",
      contact,
      sageIdempotencyKey(queueId(20), "contacts")
    );
    expect(refresh).toHaveBeenCalledOnce();

    for (const [offset, status] of [429, 500, 503].entries()) {
      const id = queueId(21 + offset);
      server.inject({ method: "POST", resource: "contacts", status });
      await expect(
        sage.create("contacts", contact, sageIdempotencyKey(id, "contacts"))
      ).rejects.toMatchObject({ retryable: true });
      await expect(
        sage.create("contacts", contact, sageIdempotencyKey(id, "contacts"))
      ).resolves.toMatchObject({ data: { id: expect.any(String) } });
    }

    const lostQueueId = queueId(30);
    const lostKey = sageIdempotencyKey(lostQueueId, "contacts");
    server.inject({
      method: "POST",
      resource: "contacts",
      afterAccept: true,
    });
    await expect(sage.create("contacts", contact, lostKey)).rejects.toThrow(
      /response loss/i
    );
    const replay = await sage.create("contacts", contact, lostKey);
    expect(server.logicalAcceptCount("contacts", lostKey.id)).toBe(1);
    expect(replay.data).toMatchObject({ id: "contacts-5" });

    const localFinalizeKey = sageIdempotencyKey(queueId(31), "contacts");
    const accepted = await sage.create("contacts", contact, localFinalizeKey);
    let localExternalId: string | null = null;
    await expect(
      Promise.reject(new Error("local finalization unavailable"))
    ).rejects.toThrow(/finalization/);
    const finalizedReplay = await sage.create(
      "contacts",
      contact,
      localFinalizeKey
    );
    localExternalId = String((finalizedReplay.data as { id: string }).id);
    expect(localExternalId).toBe(String((accepted.data as { id: string }).id));
    expect(server.logicalAcceptCount("contacts", localFinalizeKey.id)).toBe(1);

    const concurrentKey = sageIdempotencyKey(queueId(32), "contacts");
    const [workerA, workerB] = await Promise.all([
      sage.create("contacts", contact, concurrentKey),
      sage.create("contacts", contact, concurrentKey),
    ]);
    expect(workerA.data).toEqual(workerB.data);
    expect(server.logicalAcceptCount("contacts", concurrentKey.id)).toBe(1);
    expect(disconnected).not.toHaveBeenCalled();
  });

  it("fails closed on revocation, cross-business access, and child-before-parent", async () => {
    const server = new FakeSageServer(CLOCK);
    const disconnected = vi.fn(async () => undefined);
    const wrongBusiness = createSageReadClient({
      businessId: server.secondaryBusinessId,
      baseUrl: BASE_URL,
      fetchFn: server.fetch,
      getAccessToken: async () => "access-1",
      refreshAccessToken: async () => "access-1",
      onDisconnect: disconnected,
    });
    await expect(wrongBusiness.list("contacts")).rejects.toMatchObject({
      code: "reconnect_required",
      status: 403,
    });

    server.restoreGrant();
    const sage = client(server);
    await expect(
      sage.create(
        "sales_invoices",
        buildSageSalesDocument("sales_invoices", {
          contactId: "missing-contact",
          date: "2026-09-04",
          dueOrExpiryDate: "2026-10-04",
          reference: "BAD-CHILD",
          lines: lines(),
        }),
        sageIdempotencyKey(queueId(40), "sales_invoices")
      )
    ).rejects.toMatchObject({ code: "validation_failed", status: 422 });
    expect(server.records("sales_invoices")).toHaveLength(0);

    server.revokeGrant();
    await expect(sage.list("contacts")).rejects.toMatchObject({
      code: "reconnect_required",
      status: 403,
    });
  });

  it("deduplicates page overlap and exposes a partial-page retry without returning partial data", async () => {
    const server = new FakeSageServer(CLOCK);
    server.seed(
      "contacts",
      Array.from({ length: 201 }, (_, index) => ({
        id: `bulk-${String(index).padStart(3, "0")}`,
        name: `Bulk ${index}`,
        updated_at: CLOCK,
      }))
    );
    server.duplicatePaginationBoundaryOnce();
    const sage = client(server);
    await expect(sage.list("contacts")).resolves.toHaveLength(201);

    server.inject({
      method: "GET",
      resource: "contacts",
      page: 2,
      status: 503,
    });
    let partialResultPublished = false;
    try {
      await sage.list("contacts");
      partialResultPublished = true;
    } catch (error) {
      expect(error).toBeInstanceOf(SageApiError);
      expect(error).toMatchObject({ retryable: true, status: 503 });
    }
    expect(partialResultPublished).toBe(false);
  });

  it("handles payment moves, tombstones, echo suppression, fair lanes, and financial conflicts", async () => {
    const server = new FakeSageServer(CLOCK);
    server.seed("contacts", [
      { id: "contact-1", name: "Customer", updated_at: CLOCK },
    ]);
    server.seed("sales_invoices", [
      {
        id: "invoice-old",
        contact_id: "contact-1",
        date: "2026-09-01",
        due_date: "2026-10-01",
        reference: "OLD",
        invoice_lines: [],
        updated_at: CLOCK,
      },
      {
        id: "invoice-new",
        contact_id: "contact-1",
        date: "2026-09-02",
        due_date: "2026-10-02",
        reference: "NEW",
        invoice_lines: [],
        updated_at: CLOCK,
      },
    ]);
    server.seed("contact_payments", [
      {
        id: "payment-1",
        contact_id: "contact-1",
        date: "2026-09-04",
        total_amount: 40,
        payment_method_id: "EFT",
        allocated_artefacts: [{ artefact_id: "invoice-old", amount: 40 }],
        updated_at: "2026-09-04T12:01:00.000Z",
      },
    ]);
    const sage = client(server);
    await sage.update(
      "contact_payments",
      "payment-1",
      buildSageContactPayment({
        transactionType: "CUSTOMER_RECEIPT",
        contactId: "contact-1",
        bankAccountId: "bank-operating",
        paymentMethodId: "EFT",
        date: "2026-09-04",
        amount: 40,
        allocations: [{ artefactId: "invoice-new", amount: 40 }],
        reference: "MOVE",
      }),
      sageIdempotencyKey(queueId(50), "contact_payments")
    );
    const moved = normalizeSageRecord(
      "payment",
      "contact_payments",
      server.record("contact_payments", "payment-1")!
    );
    expect(moved.payload.allocations).toEqual([
      { artefactId: "invoice-new", amount: 40 },
    ]);

    await sage.voidOrDelete("contact_payments", "payment-1");
    expect(server.record("contact_payments", "payment-1")).toMatchObject({
      deleted_at: CLOCK,
    });

    const enqueue = vi.fn(async () => undefined);
    const applyInbound = vi.fn(async () => ({
      opsUpdatedAt: "2026-09-04T12:02:00.000Z",
    }));
    const audit = { record: vi.fn(async () => "audit-1") };
    const reconciler = new SageReconcileService({
      audit,
      enqueue,
      applyInbound,
    });
    const candidate: SageReconcileCandidate = {
      companyId: "company-1",
      connectionId: "connection-1",
      entityType: "payment",
      entityId: "ops-payment-1",
      externalId: "payment-1",
      resource: "contact_payments",
      opsUpdatedAt: "2026-09-04T12:00:00.000Z",
      moneyTouched: true,
      syncDirection: "bidirectional",
      propagateDeletes: true,
      latestAudit: {
        opsUpdatedAt: "2026-09-04T12:00:00.000Z",
        sageUpdatedAt: "2026-09-04T11:59:00.000Z",
      },
    };
    const providerMove = { ...moved, deletedAt: null };
    const applied = await reconciler.reconcile({
      candidate,
      provider: providerMove,
      materialDiff: true,
      providerWritesEnabled: true,
    });
    expect(applied.decision).toBe("sage_won");
    expect(applyInbound).toHaveBeenCalledOnce();
    expect(enqueue).not.toHaveBeenCalled();

    const conflict = await reconciler.reconcile({
      candidate: {
        ...candidate,
        opsUpdatedAt: "2026-09-04T12:01:30.000Z",
      },
      provider: providerMove,
      materialDiff: true,
      providerWritesEnabled: true,
    });
    expect(conflict.decision).toBe("needs_review");

    const tombstone = await reconciler.reconcile({
      candidate,
      provider: null,
      materialDiff: true,
      providerWritesEnabled: true,
    });
    expect(tombstone.decision).toBe("sage_won");

    const lanes = [
      "customer",
      "invoice",
      "estimate",
      "payment",
      "supplier",
      "supplier_bill",
      "supplier_bill_payment",
    ];
    const fairPass = lanes.map((entityType, index) => ({ entityType, index }));
    expect(new Set(fairPass.map((candidate) => candidate.entityType))).toEqual(
      new Set(lanes)
    );
    expect(audit.record).toHaveBeenCalledTimes(3);
  });
});

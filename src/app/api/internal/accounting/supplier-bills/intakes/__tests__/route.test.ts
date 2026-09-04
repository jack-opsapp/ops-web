import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  actor: {
    actorUserId: "10000000-0000-4000-8000-000000000001",
    companyId: "10000000-0000-4000-8000-000000000002",
    idToken: "verified-token",
  },
  resolveActor: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  prepareCapture: vi.fn(),
  prepareAction: vi.fn(),
  commit: vi.fn(),
}));

vi.mock("@/lib/accounting/supplier-bills/route-auth", () => ({
  resolveSupplierBillActor: mocks.resolveActor,
}));
vi.mock("@/lib/accounting/supplier-bills/intake-service", () => ({
  SupplierBillIntakeService: vi.fn(() => ({
    list: mocks.list,
    detail: mocks.detail,
    prepareCapture: mocks.prepareCapture,
    prepareAction: mocks.prepareAction,
    commit: mocks.commit,
  })),
  supplierBillIntakeHttpStatus: vi.fn(() => 400),
}));

import { GET as listBills, POST as captureBill } from "../route";
import { GET as billDetail } from "../[intakeId]/route";
import { POST as prepareBill } from "../[intakeId]/prepare/route";
import { POST as commitBill } from "../[intakeId]/commit/route";

const INTAKE_ID = "10000000-0000-4000-8000-000000000003";

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      authorization: "Bearer verified-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("supplier bill intake routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveActor.mockResolvedValue(mocks.actor);
    mocks.list.mockResolvedValue([{ id: INTAKE_ID }]);
    mocks.detail.mockResolvedValue({ intake: { id: INTAKE_ID } });
    mocks.prepareCapture.mockResolvedValue({ intentId: "intent-capture" });
    mocks.prepareAction.mockResolvedValue({ intentId: "intent-action" });
    mocks.commit.mockResolvedValue({ intakeId: INTAKE_ID, revision: 2 });
  });

  it("lists one company lifecycle behind accounting view authority", async () => {
    const response = await listBills(
      new NextRequest(
        "http://localhost/api/internal/accounting/supplier-bills/intakes?stage=held",
        { headers: { authorization: "Bearer verified-token" } }
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [{ id: INTAKE_ID }],
    });
    expect(mocks.resolveActor).toHaveBeenCalledWith(expect.anything(), [
      "accounting.view",
    ]);
    expect(mocks.list).toHaveBeenCalledWith("held");
  });

  it("rejects an unknown lifecycle instead of widening the query", async () => {
    const response = await listBills(
      new NextRequest(
        "http://localhost/api/internal/accounting/supplier-bills/intakes?stage=all"
      )
    );

    expect(response.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("captures only an original PDF with metadata and capture authority", async () => {
    const metadata = JSON.stringify({
      requestId: INTAKE_ID,
      idempotencyKey: "capture:42995",
      documentKind: "material",
    });
    const document = {
      name: "invoice.pdf",
      type: "application/pdf",
      arrayBuffer: vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode("%PDF-1.7\n%%EOF").buffer),
    };
    const request = {
      headers: new Headers({
        "content-type": "multipart/form-data; boundary=ops-test",
      }),
      formData: vi.fn().mockResolvedValue({
        get: (key: string) =>
          key === "metadata" ? metadata : key === "document" ? document : null,
      }),
    } as unknown as NextRequest;
    const response = await captureBill(request);

    expect({
      status: response.status,
      body: await response.clone().json(),
    }).toEqual({
      status: 200,
      body: { intentId: "intent-capture" },
    });
    expect(mocks.resolveActor).toHaveBeenCalledWith(expect.anything(), [
      "accounting.view",
      "accounting.bills.capture",
    ]);
    expect(mocks.prepareCapture).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "invoice.pdf" })
    );
  });

  it("returns exact company-scoped detail", async () => {
    const response = await billDetail(
      new NextRequest(
        `http://localhost/api/internal/accounting/supplier-bills/intakes/${INTAKE_ID}`
      ),
      { params: Promise.resolve({ intakeId: INTAKE_ID }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.detail).toHaveBeenCalledWith(INTAKE_ID);
  });

  it("binds review preparation to the path intake", async () => {
    const body = {
      kind: "hold",
      intakeId: "client-controlled",
      expectedRevision: 1,
      idempotencyKey: "hold:42995:v1",
      holdReason: "Quantity mismatch",
      nextAction: "Confirm with the foreman",
    };
    const response = await prepareBill(
      jsonRequest(
        `http://localhost/api/internal/accounting/supplier-bills/intakes/${INTAKE_ID}/prepare`,
        body
      ),
      { params: Promise.resolve({ intakeId: INTAKE_ID }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.prepareAction).toHaveBeenCalledWith(INTAKE_ID, body);
  });

  it("commits only the server-issued intent and exact confirmation", async () => {
    const response = await commitBill(
      jsonRequest(
        `http://localhost/api/internal/accounting/supplier-bills/intakes/${INTAKE_ID}/commit`,
        { intentId: "intent-action", confirmationText: "CONFIRM" }
      )
    );

    expect(response.status).toBe(200);
    expect(mocks.commit).toHaveBeenCalledWith({
      intentId: "intent-action",
      confirmationText: "CONFIRM",
    });
  });
});

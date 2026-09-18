// tests/integration/expense-export-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Invented ids — ops-web is a PUBLIC repo.
const COMPANY = "11111111-1111-4111-8111-111111111111";
const OTHER_PERSON = "22222222-2222-4222-8222-222222222222";
const ME = "33333333-3333-4333-8333-333333333333";
const BATCH = "44444444-4444-4444-8444-444444444444";

const verifyAdminAuth = vi.fn();
const findUserByAuth = vi.fn();
const checkPermissionById = vi.fn();
const loadExpenseExportSource = vi.fn();
const fetchExportLogo = vi.fn();

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: (r: unknown) => verifyAdminAuth(r),
}));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: (...a: unknown[]) => findUserByAuth(...a),
}));
vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: (...a: unknown[]) => checkPermissionById(...a),
}));
vi.mock("@/lib/expenses/export/expense-export-source", () => ({
  loadExpenseExportSource: (...a: unknown[]) => loadExpenseExportSource(...a),
}));
vi.mock("@/lib/expenses/export/expense-export-logo", () => ({
  fetchExportLogo: (...a: unknown[]) => fetchExportLogo(...a),
}));
vi.mock("@/i18n/server-render", () => ({
  getCompanyLocale: async () => "en",
  renderServerString: async (_l: string, _n: string, key: string) => key,
}));

function source(over: Record<string, unknown> = {}) {
  return {
    batch: {
      batchNumber: "EXP-BATCH-0042",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      status: "approved",
      totalAmount: 60,
      approvedAmount: 0,
      reimbursementAmount: 60,
    },
    lines: [
      {
        id: "l1",
        expenseDate: "2026-08-07",
        merchantName: "Harbour Supply",
        description: "Sanding pads",
        amount: 60,
        taxAmount: null,
        currency: "CAD",
        status: "approved",
        paymentMethod: "personal_card",
        isRecurring: false,
        receiptMissingReason: null,
        receiptMissingNote: null,
        rejectionReason: null,
        allocations: [],
      },
    ],
    company: {
      name: "Northgate Decking",
      address: "88 Harbour Rd",
      phone: null,
      email: null,
      website: null,
      logoUrl: null,
    },
    person: {
      firstName: "Dana",
      lastName: "Whitfield",
      email: null,
      phone: null,
      homeAddress: null,
    },
    accentColor: "#417394",
    submittedBy: OTHER_PERSON,
    ...over,
  };
}

async function call() {
  const { GET } = await import(
    "@/app/api/expenses/batches/[batchId]/export/route"
  );
  return GET(
    new Request(`http://localhost/api/expenses/batches/${BATCH}/export`) as never,
    { params: Promise.resolve({ batchId: BATCH }) }
  );
}

describe("GET /api/expenses/batches/[batchId]/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAdminAuth.mockResolvedValue({ uid: "fb-1", email: "dana@x.test" });
    findUserByAuth.mockResolvedValue({ id: ME, company_id: COMPANY });
    loadExpenseExportSource.mockResolvedValue(source());
    fetchExportLogo.mockResolvedValue(null);
    checkPermissionById.mockResolvedValue(true);
  });

  it("rejects a caller who is not signed in", async () => {
    verifyAdminAuth.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("rejects a caller with no company", async () => {
    findUserByAuth.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("scopes the lookup to the caller's own company", async () => {
    await call();
    expect(loadExpenseExportSource).toHaveBeenCalledWith(BATCH, COMPANY);
  });

  it("returns 404 for a batch that is not this company's", async () => {
    loadExpenseExportSource.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });

  it("lets an approver export someone else's envelope", async () => {
    checkPermissionById.mockImplementation(async (_id, permission) =>
      permission === "expenses.approve"
    );
    expect((await call()).status).toBe(200);
  });

  it("refuses someone else's envelope without expenses.approve", async () => {
    checkPermissionById.mockResolvedValue(false);
    const response = await call();
    expect(response.status).toBe(403);
  });

  it("lets a crew member export their own envelope on expenses.view own", async () => {
    loadExpenseExportSource.mockResolvedValue(source({ submittedBy: ME }));
    checkPermissionById.mockImplementation(async (_id, permission) =>
      permission === "expenses.view"
    );
    expect((await call()).status).toBe(200);
  });

  it("refuses even an own envelope when the caller cannot view expenses", async () => {
    loadExpenseExportSource.mockResolvedValue(source({ submittedBy: ME }));
    checkPermissionById.mockResolvedValue(false);
    expect((await call()).status).toBe(403);
  });

  it("never asks for own-scope permission on someone else's envelope", async () => {
    checkPermissionById.mockResolvedValue(false);
    await call();
    const asked = checkPermissionById.mock.calls.map((c) => c[1]);
    expect(asked).toContain("expenses.approve");
    expect(asked).not.toContain("expenses.view");
  });

  it("returns a real xlsx with a download filename", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    const disposition = response.headers.get("Content-Disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toContain("Northgate Decking");
    expect(disposition).toContain("Dana Whitfield");

    const body = Buffer.from(await response.arrayBuffer());
    // Every xlsx is a zip — "PK" is the signature.
    expect(body.subarray(0, 2).toString()).toBe("PK");
    expect(body.length).toBeGreaterThan(1000);
  });

  it("does not cache a document containing someone's pay", async () => {
    expect((await call()).headers.get("Cache-Control")).toBe("no-store");
  });

  it("still returns a document when the logo cannot be fetched", async () => {
    fetchExportLogo.mockResolvedValue(null);
    expect((await call()).status).toBe(200);
  });

  it("fails closed with a 500 rather than a partial file", async () => {
    loadExpenseExportSource.mockRejectedValue(new Error("db down"));
    expect((await call()).status).toBe(500);
  });
});

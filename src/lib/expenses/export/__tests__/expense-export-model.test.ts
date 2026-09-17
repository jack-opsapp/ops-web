import { describe, it, expect } from "vitest";
import {
  buildExpenseExportDocument,
  DEFAULT_EXPORT_LABELS,
  type ExportBatchInput,
  type ExportCompanyInput,
  type ExportLineInput,
  type ExportPersonInput,
} from "../expense-export-model";

// ─── Fixtures ────────────────────────────────────────────────────────────────
// ops-web is a PUBLIC repo. Every company, person, job and figure below is
// invented. Never put a real crew member, customer or amount in a fixture.

const COMPANY: ExportCompanyInput = {
  name: "Northgate Decking",
  address: "88 Harbour Rd, Springfield, ST A1B 2C3",
  phone: "(555) 010-4477",
  email: "office@northgatedecking.example",
  website: "https://northgatedecking.example",
  logoUrl: "https://cdn.example/logo.png",
};

const PERSON: ExportPersonInput = {
  firstName: "Dana",
  lastName: "Whitfield",
  email: "dana@northgatedecking.example",
  phone: "(555) 010-9922",
  homeAddress: "14 Cedar Lane, Springfield, ST A1B 9Z9",
};

const BATCH: ExportBatchInput = {
  batchNumber: "EXP-BATCH-0042",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  status: "approved",
  totalAmount: 210,
  approvedAmount: 0,
  reimbursementAmount: 210,
};

function line(over: Partial<ExportLineInput> = {}): ExportLineInput {
  return {
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
    allocations: [{ projectId: "p1", projectTitle: "Deck 1 - 200 Alder St", percentage: 100 }],
    ...over,
  };
}

function build(over: {
  batch?: Partial<ExportBatchInput>;
  lines?: ExportLineInput[];
  company?: Partial<ExportCompanyInput>;
  person?: Partial<ExportPersonInput>;
} = {}) {
  return buildExpenseExportDocument({
    batch: { ...BATCH, ...over.batch },
    lines: over.lines ?? [line()],
    company: { ...COMPANY, ...over.company },
    person: { ...PERSON, ...over.person },
    accentColor: "#417394",
    labels: DEFAULT_EXPORT_LABELS,
    locale: "en-CA",
  });
}

// ─── Rows ────────────────────────────────────────────────────────────────────

describe("rows", () => {
  it("maps one row per line with real Date and number cells", () => {
    const doc = build({ lines: [line({ amount: 78.34 })] });
    expect(doc.rows).toHaveLength(1);
    const row = doc.rows[0];
    expect(row.date).toBeInstanceOf(Date);
    expect(row.date?.getFullYear()).toBe(2026);
    expect(row.date?.getMonth()).toBe(7); // August
    expect(row.date?.getDate()).toBe(7);
    expect(typeof row.cost).toBe("number");
    expect(row.cost).toBe(78.34);
    expect(row.item).toBe("Sanding pads");
    expect(row.store).toBe("Harbour Supply");
  });

  it("parses a date-only string in local time, never shifting a day backwards", () => {
    // "2026-08-01" via new Date() is UTC midnight — in any negative-offset zone
    // that renders as July 31. The document must show the date the crew entered.
    const doc = build({ lines: [line({ expenseDate: "2026-08-01" })] });
    expect(doc.rows[0].date?.getDate()).toBe(1);
    expect(doc.rows[0].date?.getMonth()).toBe(7);
  });

  it("joins a split line's jobs and counts its cost exactly once", () => {
    const doc = build({
      lines: [
        line({
          amount: 87.93,
          allocations: [
            { projectId: "p1", projectTitle: "Deck 1 - 200 Alder St", percentage: 50 },
            { projectId: "p2", projectTitle: "Deck 2 - 200 Alder St", percentage: 50 },
          ],
        }),
      ],
    });
    expect(doc.rows).toHaveLength(1);
    expect(doc.rows[0].job).toBe("Deck 1 - 200 Alder St · Deck 2 - 200 Alder St");
    expect(doc.rows[0].cost).toBe(87.93);
    expect(doc.linesTotal).toBe(87.93);
  });

  it("shows an em dash for an overhead line with no job", () => {
    const doc = build({ lines: [line({ allocations: [] })] });
    expect(doc.rows[0].job).toBe("—");
  });

  it("falls back to the job id when a project title cannot be resolved", () => {
    const doc = build({
      lines: [line({ allocations: [{ projectId: "p9", projectTitle: null, percentage: 100 }] })],
    });
    expect(doc.rows[0].job).toBe("p9");
  });

  it("leaves the note blank for an ordinary clean line", () => {
    expect(build().rows[0].note).toBe("");
  });

  it("blanks missing item and store rather than printing null", () => {
    const doc = build({ lines: [line({ description: null, merchantName: null })] });
    expect(doc.rows[0].item).toBe("");
    expect(doc.rows[0].store).toBe("");
  });

  it("trims whitespace the crew left in merchant names", () => {
    const doc = build({ lines: [line({ merchantName: "Home Depot " })] });
    expect(doc.rows[0].store).toBe("Home Depot");
  });

  it("orders rows oldest first, keeping undated lines last", () => {
    const doc = build({
      lines: [
        line({ id: "b", expenseDate: "2026-08-20" }),
        line({ id: "c", expenseDate: null }),
        line({ id: "a", expenseDate: "2026-08-02" }),
      ],
    });
    expect(doc.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

// ─── Notes ───────────────────────────────────────────────────────────────────

describe("notes", () => {
  it("marks a recurring line as having no receipt by design", () => {
    const doc = build({
      lines: [line({ isRecurring: true, receiptMissingReason: "other", allocations: [] })],
    });
    expect(doc.rows[0].note).toBe("Recurring — no receipt");
    expect(doc.rows[0].payable).toBe(true);
  });

  it("marks a company-card line as not owed to the person", () => {
    const doc = build({ lines: [line({ paymentMethod: "company_card" })] });
    expect(doc.rows[0].note).toBe("Company card");
    expect(doc.rows[0].payable).toBe(false);
  });

  it("stops repeating 'company card' once the whole envelope is company-funded", () => {
    // The totals block already states it; stamping every row would be noise.
    const doc = build({
      batch: { reimbursementAmount: 0 },
      lines: [line({ paymentMethod: "company_card" })],
    });
    expect(doc.companyFunded).toBe(true);
    expect(doc.rows[0].note).toBe("");
  });

  it("still explains a rejection on a company-funded envelope", () => {
    const doc = build({
      batch: { reimbursementAmount: 0 },
      lines: [line({ paymentMethod: "company_card", status: "rejected", rejectionReason: "Duplicate" })],
    });
    expect(doc.rows[0].note).toBe("Rejected — Duplicate");
  });

  it("explains each missing-receipt reason in plain words", () => {
    const cases: Array<[string, string]> = [
      ["lost", "Receipt lost"],
      ["cash", "Paid cash — no receipt"],
      ["digital", "Digital receipt"],
      ["other", "No receipt"],
    ];
    for (const [reason, expected] of cases) {
      const doc = build({ lines: [line({ receiptMissingReason: reason })] });
      expect(doc.rows[0].note).toBe(expected);
    }
  });

  it("appends the crew's own missing-receipt note when they wrote one", () => {
    const doc = build({
      lines: [line({ receiptMissingReason: "lost", receiptMissingNote: "blew out of the truck" })],
    });
    expect(doc.rows[0].note).toBe("Receipt lost — blew out of the truck");
  });

  it("marks a rejected line, carries its reason, and drops it from payable", () => {
    const doc = build({
      lines: [line({ status: "rejected", rejectionReason: "Personal purchase" })],
    });
    expect(doc.rows[0].note).toBe("Rejected — Personal purchase");
    expect(doc.rows[0].payable).toBe(false);
    expect(doc.rows[0].muted).toBe(true);
  });

  it("marks a rejected line with no stated reason", () => {
    const doc = build({ lines: [line({ status: "rejected", rejectionReason: null })] });
    expect(doc.rows[0].note).toBe("Rejected");
  });

  it("prefers the rejection over a missing-receipt explanation", () => {
    const doc = build({
      lines: [line({ status: "rejected", rejectionReason: "Duplicate", receiptMissingReason: "lost" })],
    });
    expect(doc.rows[0].note).toBe("Rejected — Duplicate");
  });
});

// ─── Totals ──────────────────────────────────────────────────────────────────

describe("totals", () => {
  it("sums every live line into the lines total, matching the console's TOTAL", () => {
    const doc = build({
      batch: { totalAmount: 100, reimbursementAmount: 100 },
      lines: [line({ id: "a", amount: 60 }), line({ id: "b", amount: 40 })],
    });
    expect(doc.linesTotal).toBe(100);
  });

  it("keeps a rejected line inside the lines total, as the database does", () => {
    // recalculate_expense_batch_total sums every non-deleted line regardless of
    // status, so the document must not quietly disagree with the console.
    const doc = build({
      batch: { status: "partially_approved", totalAmount: 100, approvedAmount: 60, reimbursementAmount: null },
      lines: [line({ id: "a", amount: 60 }), line({ id: "b", amount: 40, status: "rejected" })],
    });
    expect(doc.linesTotal).toBe(100);
    expect(doc.payableTotal).toBe(60);
    expect(doc.excludedTotal).toBe(40);
  });

  it("uses the reimbursement amount as the payable figure when it is set", () => {
    const doc = build({
      batch: { totalAmount: 518.94, approvedAmount: 0, reimbursementAmount: 350 },
      lines: [line({ id: "a", amount: 350 }), line({ id: "b", amount: 168.94 })],
    });
    expect(doc.linesTotal).toBe(518.94);
    expect(doc.payableTotal).toBe(350);
    expect(doc.excludedTotal).toBe(168.94);
  });

  it("treats a zero reimbursement as company-funded with nothing owed", () => {
    const doc = build({
      batch: { totalAmount: 184.72, approvedAmount: 0, reimbursementAmount: 0 },
      lines: [line({ amount: 184.72 })],
    });
    expect(doc.companyFunded).toBe(true);
    expect(doc.payableTotal).toBe(0);
    expect(doc.linesTotal).toBe(184.72);
  });

  it("falls back to the batch total when no reimbursement figure exists", () => {
    const doc = build({
      batch: { status: "pending_review", totalAmount: 62.95, approvedAmount: 0, reimbursementAmount: null },
      lines: [line({ amount: 62.95 })],
    });
    expect(doc.payableTotal).toBe(62.95);
    expect(doc.excludedTotal).toBe(0);
  });

  it("never reports a negative excluded amount", () => {
    const doc = build({
      batch: { totalAmount: 50, approvedAmount: 0, reimbursementAmount: 80 },
      lines: [line({ amount: 50 })],
    });
    expect(doc.excludedTotal).toBe(0);
  });

  it("reports tax only when a line actually carries it", () => {
    expect(build().taxTotal).toBeNull();
    const taxed = build({
      batch: { totalAmount: 60, reimbursementAmount: 60 },
      lines: [line({ amount: 60, taxAmount: 7.8 })],
    });
    expect(taxed.taxTotal).toBe(7.8);
  });

  it("adds money in cents so repeated decimals cannot drift", () => {
    const doc = build({
      batch: { totalAmount: 0.3, reimbursementAmount: 0.3 },
      lines: [line({ id: "a", amount: 0.1 }), line({ id: "b", amount: 0.2 })],
    });
    expect(doc.linesTotal).toBe(0.3);
  });

  it("keeps currencies apart instead of summing across them", () => {
    const doc = build({
      lines: [line({ id: "a", amount: 10, currency: "CAD" }), line({ id: "b", amount: 10, currency: "USD" })],
    });
    expect(doc.currencies).toEqual(["CAD", "USD"]);
  });

  it("uses the dominant line currency for the document", () => {
    const doc = build({
      lines: [
        line({ id: "a", amount: 10, currency: "CAD" }),
        line({ id: "b", amount: 10, currency: "CAD" }),
        line({ id: "c", amount: 10, currency: "USD" }),
      ],
    });
    expect(doc.currency).toBe("CAD");
  });
});

// ─── Identity ────────────────────────────────────────────────────────────────

describe("identity", () => {
  it("names a whole calendar month as that month", () => {
    expect(build().periodLabel).toBe("August 2026");
  });

  it("names a part-month period by its exact span", () => {
    const doc = build({ batch: { periodStart: "2026-08-28", periodEnd: "2026-09-10" } });
    expect(doc.periodLabel).toBe("August 28 – September 10, 2026");
  });

  it("spells out both years when a period crosses new year", () => {
    const doc = build({ batch: { periodStart: "2026-12-28", periodEnd: "2027-01-10" } });
    expect(doc.periodLabel).toBe("December 28, 2026 – January 10, 2027");
  });

  it("falls back to an em dash when the period is unknown", () => {
    const doc = build({ batch: { periodStart: null, periodEnd: null } });
    expect(doc.periodLabel).toBe("—");
  });

  it("drops person fields that are missing instead of printing empty labels", () => {
    const doc = build({ person: { homeAddress: null, phone: null } });
    expect(doc.person.address).toBeNull();
    expect(doc.person.phone).toBeNull();
    expect(doc.person.name).toBe("Dana Whitfield");
  });

  it("falls back to email when a person has no name", () => {
    const doc = build({ person: { firstName: null, lastName: null } });
    expect(doc.person.name).toBe("dana@northgatedecking.example");
  });

  it("drops company contact fields that are missing", () => {
    const doc = build({ company: { phone: null, website: null, address: null } });
    expect(doc.company.address).toBeNull();
    expect(doc.company.contactLine).toBe("office@northgatedecking.example");
  });

  it("keeps the address on its own line and joins the ways to reach them", () => {
    const doc = build();
    expect(doc.company.address).toBe("88 Harbour Rd, Springfield, ST A1B 2C3");
    expect(doc.company.contactLine).toBe(
      "(555) 010-4477 · office@northgatedecking.example · northgatedecking.example"
    );
  });

  it("prints a website without its protocol, www or trailing slash", () => {
    const doc = build({
      company: { phone: null, email: null, website: "https://www.northgatedecking.example/" },
    });
    expect(doc.company.contactLine).toBe("northgatedecking.example");
  });

  it("has no contact line at all when there is nothing to reach them by", () => {
    const doc = build({ company: { phone: null, email: null, website: null } });
    expect(doc.company.contactLine).toBeNull();
  });

  it("carries the batch number and a readable status", () => {
    const doc = build();
    expect(doc.batchNumber).toBe("EXP-BATCH-0042");
    expect(doc.statusLabel).toBe("APPROVED");
  });
});

// ─── Filename ────────────────────────────────────────────────────────────────

describe("filename", () => {
  it("names the file by company, person and period", () => {
    expect(build().filename).toBe(
      "Northgate Decking - Expenses - Dana Whitfield - August 2026.xlsx"
    );
  });

  it("strips characters a filesystem cannot take, keeping the word boundary", () => {
    // A slash separates words, so it becomes a space — "Smith/Jones Decking"
    // should read "Smith Jones Decking", not "SmithJones Decking".
    const doc = build({ company: { name: 'North/gate: "Decking"*?' } });
    expect(doc.filename).toBe("North gate Decking - Expenses - Dana Whitfield - August 2026.xlsx");
  });

  it("never emits a path separator even when every field is hostile", () => {
    const doc = build({
      company: { name: "../../etc" },
      person: { firstName: "..", lastName: "/passwd" },
    });
    expect(doc.filename).not.toContain("/");
    expect(doc.filename).not.toContain("\\");
    expect(doc.filename).not.toContain("..");
  });
});

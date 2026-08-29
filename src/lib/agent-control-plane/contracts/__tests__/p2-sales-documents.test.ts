import { describe, expect, it } from "vitest";

import { MoneySchema } from "../common";
import {
  GetSalesDocumentInputSchema,
  GetSalesDocumentResultSchema,
  ListSalesDocumentsInputSchema,
  ListSalesDocumentsResultSchema,
  SALES_DOCUMENT_FETCH_LIMIT,
  SALES_DOCUMENT_KINDS,
  SALES_DOCUMENT_MAX_LINES,
  SALES_DOCUMENT_MAX_MILESTONES,
  SALES_DOCUMENT_MAX_PAGE_ITEMS,
  SALES_DOCUMENT_MAX_SOURCE_ROWS,
  SALES_DOCUMENT_SCHEMA_REVISION,
  SalesDocumentHeaderSchema,
  assertNoSalesDocumentForbiddenFields,
} from "../sales-documents";

const UUID = {
  customer: "11111111-1111-4111-8111-111111111111",
  documentA: "22222222-2222-4222-8222-222222222222",
  documentB: "33333333-3333-4333-8333-333333333333",
  job: "44444444-4444-4444-8444-444444444444",
  line: "55555555-5555-4555-8555-555555555555",
  milestone: "66666666-6666-4666-8666-666666666666",
} as const;

const READ_AT = "2026-08-28T12:00:00.000Z";
const REVISIONS = [
  { domain: "legacy_operational", source_revision: 7 },
  { domain: "sales_documents", source_revision: 11 },
] as const;

function money(amountMinor: number, currency = "CAD") {
  return { amount_minor: amountMinor, currency };
}

function proof(fill: string, collection?: { count: number; more: boolean }) {
  return {
    proof_ref: `ops_proof:v1:${fill.repeat(64)}`,
    read_at: READ_AT,
    source_revisions: REVISIONS,
    ...(collection
      ? { returned_count: collection.count, has_more: collection.more }
      : {}),
  };
}

function evidence(fill: string, sourceType: "estimate" | "invoice") {
  return {
    evidence_ref: `ops_evidence:v1:${fill.repeat(64)}`,
    source_domain: "sales_documents",
    source_type: sourceType,
    occurred_at: READ_AT,
  };
}

function estimateHeader(id = UUID.documentA) {
  return {
    document_ref: { kind: "estimate", id },
    customer_ref: { kind: "customer", id: UUID.customer },
    job_ref: { kind: "opportunity", id: UUID.job },
    document_number: "EST-2026-00001",
    title: "Rear deck replacement",
    status: "sent",
    issue_date: "2026-08-20",
    expiration_date: "2026-09-20",
    total: money(125_000),
    updated_at: "2026-08-28T11:00:00.000Z",
    content_kind: "untrusted_business_data",
  } as const;
}

function invoiceHeader(id = UUID.documentB) {
  return {
    document_ref: { kind: "invoice", id },
    customer_ref: { kind: "customer", id: UUID.customer },
    job_ref: { kind: "project", id: UUID.job },
    document_number: "INV-2026-00001",
    title: "Rear deck replacement",
    status: "partially_paid",
    issue_date: "2026-08-21",
    due_date: "2026-09-20",
    paid_at: null,
    total: money(125_000),
    amount_paid: money(25_000),
    balance_due: money(100_000),
    updated_at: "2026-08-28T10:00:00.000Z",
    content_kind: "untrusted_business_data",
  } as const;
}

describe("P2 sales-document inputs", () => {
  it("freezes the P2 bounds, closed kinds, and canonical list defaults", () => {
    expect(SALES_DOCUMENT_SCHEMA_REVISION).toBe("2026-08-22.v1");
    expect(SALES_DOCUMENT_KINDS).toEqual(["estimate", "invoice"]);
    expect(Object.isFrozen(SALES_DOCUMENT_KINDS)).toBe(true);
    expect(SALES_DOCUMENT_MAX_PAGE_ITEMS).toBe(25);
    expect(SALES_DOCUMENT_FETCH_LIMIT).toBe(26);
    expect(SALES_DOCUMENT_MAX_SOURCE_ROWS).toBe(501);
    expect(SALES_DOCUMENT_MAX_LINES).toBe(50);
    expect(SALES_DOCUMENT_MAX_MILESTONES).toBe(32);

    expect(ListSalesDocumentsInputSchema.parse({})).toEqual({
      document_kinds: ["estimate", "invoice"],
      limit: 25,
    });
  });

  it("accepts only sorted unique document kinds and canonical opaque filters", () => {
    const valid = {
      document_kinds: ["estimate", "invoice"],
      customer_ref: { kind: "customer", id: UUID.customer },
      job_ref: { kind: "project", id: UUID.job },
      limit: 25,
    } as const;
    expect(ListSalesDocumentsInputSchema.safeParse(valid).success).toBe(true);
    for (const invalid of [
      { ...valid, document_kinds: ["invoice", "estimate"] },
      { ...valid, document_kinds: ["estimate", "estimate"] },
      { ...valid, document_kinds: [] },
      { ...valid, document_kinds: ["payment"] },
      { ...valid, limit: 26 },
      { ...valid, company_id: UUID.customer },
      { ...valid, customer_ref: { kind: "client", id: UUID.customer } },
      {
        ...valid,
        job_ref: {
          kind: "project",
          id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
        },
      },
    ]) {
      expect(ListSalesDocumentsInputSchema.safeParse(invalid).success).toBe(
        false
      );
    }
  });

  it("selects detail only through a strict typed document reference", () => {
    const input = {
      document_ref: { kind: "estimate", id: UUID.documentA },
    } as const;
    expect(GetSalesDocumentInputSchema.parse(input)).toEqual(input);
    for (const invalid of [
      { document_id: UUID.documentA, kind: "estimate" },
      { document_ref: { kind: "payment", id: UUID.documentA } },
      { ...input, include_internal_notes: true },
    ]) {
      expect(GetSalesDocumentInputSchema.safeParse(invalid).success).toBe(
        false
      );
    }
  });
});

describe("P2 sales-document outputs", () => {
  it("reuses strict MoneySchema and requires one currency across each document", () => {
    expect(SalesDocumentHeaderSchema.parse(estimateHeader()).total).toEqual(
      MoneySchema.parse(money(125_000))
    );
    expect(
      SalesDocumentHeaderSchema.safeParse({
        ...invoiceHeader(),
        balance_due: money(100_000, "USD"),
      }).success
    ).toBe(false);
    expect(
      SalesDocumentHeaderSchema.safeParse({
        ...estimateHeader(),
        total: { amount: 1_250, currency: "CAD" },
      }).success
    ).toBe(false);
    expect(
      SalesDocumentHeaderSchema.safeParse({
        ...estimateHeader(),
        issue_date: "0000-01-01",
      }).success
    ).toBe(false);
  });

  it("couples canonical list ordering, proofs, evidence, and pagination", () => {
    const result = {
      items: [estimateHeader(), invoiceHeader()],
      item_proofs: [proof("a"), proof("b")],
      evidence: [evidence("c", "estimate"), evidence("d", "invoice")],
      collection_proof: proof("e", { count: 2, more: false }),
      next_cursor: null,
    } as const;
    expect(ListSalesDocumentsResultSchema.parse(result)).toEqual(result);
    expect(
      ListSalesDocumentsResultSchema.safeParse({
        ...result,
        items: [...result.items].reverse(),
      }).success
    ).toBe(false);
    expect(
      ListSalesDocumentsResultSchema.safeParse({
        ...result,
        evidence: [result.evidence[0]],
      }).success
    ).toBe(false);
  });

  it("accepts bounded ordered estimate lines and milestones with client-facing text marked untrusted", () => {
    const result = {
      document: estimateHeader(),
      client_text: [
        {
          kind: "message",
          text: "Please approve before the expiry date.",
          content_kind: "untrusted_business_data",
        },
        {
          kind: "terms",
          text: "Deposit due before mobilization.",
          content_kind: "untrusted_business_data",
        },
      ],
      lines: [
        {
          line_ref: { kind: "sales_document_line", id: UUID.line },
          name: "Vinyl deck surface",
          description: "Includes perimeter trim.",
          quantity_milliunits: 12_500,
          unit: "sqft",
          unit_price: money(10_000),
          line_total: money(125_000),
          discount_basis_points: 0,
          is_taxable: true,
          is_optional: false,
          is_selected: true,
          sort_order: 0,
          content_kind: "untrusted_business_data",
        },
      ],
      milestones: [
        {
          milestone_ref: {
            kind: "estimate_payment_milestone",
            id: UUID.milestone,
          },
          name: "Deposit",
          schedule_value: { kind: "percentage", basis_points: 5_000 },
          amount: money(62_500),
          expected_date: "2026-08-30",
          state: "pending",
          paid_at: null,
          sort_order: 0,
          content_kind: "untrusted_business_data",
        },
      ],
      evidence: [evidence("f", "estimate")],
      proof: proof("g"),
    } as const;
    expect(GetSalesDocumentResultSchema.parse(result)).toEqual(result);
    expect(
      GetSalesDocumentResultSchema.safeParse({
        ...result,
        lines: [result.lines[0], { ...result.lines[0], sort_order: 1 }],
      }).success
    ).toBe(false);
    expect(
      GetSalesDocumentResultSchema.safeParse({
        ...result,
        milestones: [
          result.milestones[0],
          { ...result.milestones[0], sort_order: 1 },
        ],
      }).success
    ).toBe(false);
  });

  it("rejects unlike currency children and every forbidden private/provider/cost/configuration field", () => {
    const header = invoiceHeader();
    const base = {
      document: header,
      client_text: [],
      lines: [],
      evidence: [evidence("a", "invoice")],
      proof: proof("b"),
    } as const;
    expect(GetSalesDocumentResultSchema.safeParse(base).success).toBe(true);
    expect(
      GetSalesDocumentResultSchema.safeParse({
        ...base,
        lines: [
          {
            line_ref: { kind: "sales_document_line", id: UUID.line },
            name: "Labour",
            description: null,
            quantity_milliunits: 1_000,
            unit: "hour",
            unit_price: money(10_000, "USD"),
            line_total: money(10_000, "USD"),
            discount_basis_points: 0,
            is_taxable: true,
            is_optional: false,
            is_selected: true,
            sort_order: 0,
            content_kind: "untrusted_business_data",
          },
        ],
      }).success
    ).toBe(false);

    for (const field of [
      "internal_notes",
      "notes",
      "pdf_storage_path",
      "provider_id",
      "qb_id",
      "sage_id",
      "created_by",
      "unit_cost",
      "product_id",
      "configured_selections",
      "pricing_rule_snapshot",
      "source_payload",
      "parent_line_item_id",
      "task_type_ref",
    ]) {
      const candidate = { ...base, [field]: "forbidden" };
      expect(GetSalesDocumentResultSchema.safeParse(candidate).success).toBe(
        false
      );
      expect(() => assertNoSalesDocumentForbiddenFields(candidate)).toThrow();
    }
  });
});

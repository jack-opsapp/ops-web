import { describe, expect, it } from "vitest";
import { PrepareFinancialDocumentInputSchema } from "../financial-document";

const id = "11111111-1111-4111-8111-111111111111";
const hash = `sha256:${"a".repeat(64)}`;
const input = {
  document_kind: "estimate",
  operation: "create",
  client_id: id,
  opportunity_id: id,
  project_id: null,
  revises_estimate_id: null,
  expected_revision_sha256: null,
  baseline_estimate_id: null,
  policy_id: id,
  policy_sha256: hash,
  currency: "CAD",
  issue_date: "2026-09-07",
  expiration_date: "2026-10-07",
  title: "Deck repair",
  client_message: "",
  terms: "Payment on completion",
  inclusions: "Replace damaged boards",
  exclusions: "Railing",
  scope_evidence: {
    kind: "operator",
    reference_id: null,
    sha256: null,
    statement: "Price the measured repair scope",
  },
  increase_percent: "8",
  adjustment_base: "unit_prices_and_minimum_charges",
  lines: [
    {
      name: "Board installation",
      description: "",
      quantity: "1.125",
      unit: "hour",
      type: "LABOR",
      source: {
        kind: "operator",
        reference_id: null,
        sha256: null,
        unit_price: "12.50",
        minimum_charge: "0.00",
      },
      discount_percent: "0",
      is_taxable: true,
    },
  ],
  idempotency_key: "financial-test-001",
};
describe("exact financial document preparation", () => {
  it("accepts explicitly attributed prices and decimal quantities", () => {
    expect(PrepareFinancialDocumentInputSchema.safeParse(input).success).toBe(
      true
    );
  });
  it.each([
    "status",
    "approved_at",
    "total",
    "send",
    "invoice_id",
    "customer_signature",
  ])("rejects hidden financial field %s", (field) => {
    expect(
      PrepareFinancialDocumentInputSchema.safeParse({ ...input, [field]: true })
        .success
    ).toBe(false);
  });
  it.each([1.125, "1.1234", "NaN", "1e3", "-1", "0"])(
    "rejects unsupported quantity %s",
    (quantity) => {
      expect(
        PrepareFinancialDocumentInputSchema.safeParse({
          ...input,
          lines: [{ ...input.lines[0], quantity }],
        }).success
      ).toBe(false);
    }
  );
  it("requires a project and accepted baseline for a change order", () => {
    expect(
      PrepareFinancialDocumentInputSchema.safeParse({
        ...input,
        document_kind: "change_order",
      }).success
    ).toBe(false);
    expect(
      PrepareFinancialDocumentInputSchema.safeParse({
        ...input,
        document_kind: "change_order",
        opportunity_id: null,
        project_id: id,
        baseline_estimate_id: id,
      }).success
    ).toBe(true);
  });
  it("requires the exact predecessor hash for a revision", () => {
    expect(
      PrepareFinancialDocumentInputSchema.safeParse({
        ...input,
        operation: "revise",
      }).success
    ).toBe(false);
    expect(
      PrepareFinancialDocumentInputSchema.safeParse({
        ...input,
        operation: "revise",
        revises_estimate_id: id,
        expected_revision_sha256: hash,
      }).success
    ).toBe(true);
  });
  it("requires source identity and hash instead of caller price for catalog pricing", () => {
    const line = input.lines[0];
    expect(
      PrepareFinancialDocumentInputSchema.safeParse({
        ...input,
        lines: [{ ...line, source: { ...line.source, kind: "catalog" } }],
      }).success
    ).toBe(false);
    expect(
      PrepareFinancialDocumentInputSchema.safeParse({
        ...input,
        lines: [
          {
            ...line,
            source: {
              kind: "catalog",
              reference_id: id,
              sha256: hash,
              unit_price: null,
              minimum_charge: null,
            },
          },
        ],
      }).success
    ).toBe(true);
  });
  it("rejects adjustment scope substitution and impossible dates", () => {
    expect(
      PrepareFinancialDocumentInputSchema.safeParse({
        ...input,
        adjustment_base: "total_including_tax",
      }).success
    ).toBe(false);
    expect(
      PrepareFinancialDocumentInputSchema.safeParse({
        ...input,
        issue_date: "2026-02-30",
      }).success
    ).toBe(false);
    expect(
      PrepareFinancialDocumentInputSchema.safeParse({
        ...input,
        expiration_date: "2026-09-06",
      }).success
    ).toBe(false);
  });
});

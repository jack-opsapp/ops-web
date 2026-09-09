import { describe, expect, it } from "vitest";
import {
  CatalogAuthoringRequestSchema,
  CatalogVisibleValuesSchema,
} from "../catalog-authoring";
const source = {
  key: "supplier-sheet",
  sha256: "sha256:" + "a".repeat(64),
  name: "Price sheet",
  kind: "file",
};
const row = {
  row_key: "installation",
  source_row: "Sheet1:2",
  entity: "product",
  existing_id: null,
  expected_sha256: null,
  values: {
    name: "Installation",
    kind: "service",
    price: "12.50",
    unit: "hour",
    pricing_unit: "hour",
    taxable: true,
  },
};
const request = {
  operation: "catalog",
  currency: "CAD",
  source,
  rows: [row],
  skipped_rows: [],
  idempotency_key: "catalog-test-001",
};
describe("catalog authoring request", () => {
  it("accepts explicitly priced service evidence", () =>
    expect(CatalogAuthoringRequestSchema.parse(request)).toEqual(request));
  it("rejects stock hidden in price imports", () =>
    expect(
      CatalogAuthoringRequestSchema.safeParse({
        ...request,
        rows: [{ ...row, values: { ...row.values, quantity: "20" } }],
      }).success
    ).toBe(false));
  it("rejects duplicate input identities", () =>
    expect(
      CatalogAuthoringRequestSchema.safeParse({ ...request, rows: [row, row] })
        .success
    ).toBe(false));
  it("requires exact source version for existing records", () =>
    expect(
      CatalogAuthoringRequestSchema.safeParse({
        ...request,
        rows: [{ ...row, existing_id: "10000000-0000-4000-8000-000000000001" }],
      }).success
    ).toBe(false));
  it("rejects invented or imprecise money", () =>
    expect(
      CatalogAuthoringRequestSchema.safeParse({
        ...request,
        rows: [{ ...row, values: { ...row.values, price: "12.555" } }],
      }).success
    ).toBe(false));
  it("keeps stock in a separate proposal", () =>
    expect(
      CatalogAuthoringRequestSchema.safeParse({
        ...request,
        operation: "inventory",
      }).success
    ).toBe(false));
  it("requires an explanation for a skipped source row", () =>
    expect(
      CatalogAuthoringRequestSchema.safeParse({
        ...request,
        skipped_rows: [{ source_row: "Sheet1:3", reason: "" }],
      }).success
    ).toBe(false));
  it("rejects unsupported instructions and approval fields", () =>
    expect(
      CatalogAuthoringRequestSchema.safeParse({ ...request, approved: true })
        .success
    ).toBe(false));
});

describe("observed catalog compatibility", () => {
  it("preserves nullable legacy fields and package pricing in an exact preview", () => {
    const values = {
      name: "Legacy package",
      kind: "package",
      pricing_unit: "custom",
      unit: null,
      price: null,
      taxable: null,
    };
    expect(CatalogVisibleValuesSchema.parse(values)).toEqual(values);
  });
  it("preserves a negative prior stock count while input requires a nonnegative count", () => {
    expect(CatalogVisibleValuesSchema.parse({ quantity: -3 })).toEqual({
      quantity: -3,
    });
  });
  it("shows inherited prices without allowing arbitrary database fields", () => {
    expect(
      CatalogVisibleValuesSchema.parse({ price: null, effective_price: 10 })
    ).toEqual({ price: null, effective_price: 10 });
    expect(
      CatalogVisibleValuesSchema.safeParse({ internal_secret: "hidden" })
        .success
    ).toBe(false);
  });
});

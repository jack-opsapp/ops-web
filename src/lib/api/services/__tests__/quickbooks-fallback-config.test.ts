import { describe, expect, it } from "vitest";

import {
  resolveQboFallbackServiceItem,
  resolveQboTaxCodeRefs,
} from "../quickbooks-config";

describe("resolveQboFallbackServiceItem — environment-strict", () => {
  it("resolves the sandbox-suffixed fallback item for a sandbox connection", () => {
    const item = resolveQboFallbackServiceItem("sandbox", {
      QB_SANDBOX_FALLBACK_SERVICE_ITEM_ID: "19",
      QB_SANDBOX_FALLBACK_SERVICE_ITEM_NAME: "Sandbox Service",
    });
    expect(item).toEqual({ qbItemId: "19", name: "Sandbox Service" });
  });

  it("resolves the production-suffixed fallback item for a production connection", () => {
    const item = resolveQboFallbackServiceItem("production", {
      QB_PROD_FALLBACK_SERVICE_ITEM_ID: "42",
    });
    expect(item).toEqual({ qbItemId: "42", name: "OPS Service" });
  });

  it("accepts the QB_PRODUCTION_ alias for production", () => {
    const item = resolveQboFallbackServiceItem("production", {
      QB_PRODUCTION_FALLBACK_SERVICE_ITEM_ID: "7",
    });
    expect(item?.qbItemId).toBe("7");
  });

  it("NEVER lets a legacy unsuffixed env poison a production connection (the bug)", () => {
    // Historically the unsuffixed env held a SANDBOX item id. Reading it for a
    // production write attaches an item that does not exist in the production
    // realm → QuickBooks 400. Production must resolve to null here.
    const item = resolveQboFallbackServiceItem("production", {
      QB_FALLBACK_SERVICE_ITEM_ID: "19",
      QBO_FALLBACK_SERVICE_ITEM_ID: "19",
    });
    expect(item).toBeNull();
  });

  it("does not let a sandbox-suffixed env leak into production", () => {
    const item = resolveQboFallbackServiceItem("production", {
      QB_SANDBOX_FALLBACK_SERVICE_ITEM_ID: "19",
    });
    expect(item).toBeNull();
  });

  it("does not let a production-suffixed env leak into sandbox", () => {
    const item = resolveQboFallbackServiceItem("sandbox", {
      QB_PROD_FALLBACK_SERVICE_ITEM_ID: "42",
    });
    expect(item).toBeNull();
  });

  it("falls back to a legacy unsuffixed env for SANDBOX only (no regression)", () => {
    // Unsuffixed has always meant sandbox/default. Keeping it as a sandbox
    // last-resort means a pre-existing dev config never breaks — while
    // production (tested above) still refuses it.
    const item = resolveQboFallbackServiceItem("sandbox", {
      QB_FALLBACK_SERVICE_ITEM_ID: "19",
    });
    expect(item).toEqual({ qbItemId: "19", name: "OPS Service" });
  });

  it("prefers the sandbox-suffixed env over the unsuffixed one", () => {
    const item = resolveQboFallbackServiceItem("sandbox", {
      QB_SANDBOX_FALLBACK_SERVICE_ITEM_ID: "19",
      QB_FALLBACK_SERVICE_ITEM_ID: "99",
    });
    expect(item?.qbItemId).toBe("19");
  });

  it("returns null when no fallback env is configured", () => {
    expect(resolveQboFallbackServiceItem("sandbox", {})).toBeNull();
    expect(resolveQboFallbackServiceItem("production", {})).toBeNull();
  });
});

describe("resolveQboTaxCodeRefs — environment-strict", () => {
  it("resolves sandbox taxable + non-taxable codes", () => {
    const refs = resolveQboTaxCodeRefs("sandbox", {
      QB_SANDBOX_TAX_CODE_TAXABLE_ID: "4",
      QB_SANDBOX_TAX_CODE_NONTAXABLE_ID: "3",
    });
    expect(refs).toEqual({ taxable: "4", nonTaxable: "3" });
  });

  it("accepts the NON_TAXABLE alias", () => {
    const refs = resolveQboTaxCodeRefs("sandbox", {
      QB_SANDBOX_TAX_CODE_NON_TAXABLE_ID: "3",
    });
    expect(refs).toEqual({ taxable: null, nonTaxable: "3" });
  });

  it("resolves production codes and does not read sandbox codes", () => {
    const refs = resolveQboTaxCodeRefs("production", {
      QB_PROD_TAX_CODE_TAXABLE_ID: "TAX",
      QB_SANDBOX_TAX_CODE_TAXABLE_ID: "4",
    });
    expect(refs).toEqual({ taxable: "TAX", nonTaxable: null });
  });

  it("falls back to a legacy unsuffixed tax env for SANDBOX only", () => {
    const refs = resolveQboTaxCodeRefs("sandbox", {
      QB_TAX_CODE_TAXABLE_ID: "4",
    });
    expect(refs).toEqual({ taxable: "4", nonTaxable: null });
  });

  it("does not read a legacy unsuffixed tax env for production", () => {
    const refs = resolveQboTaxCodeRefs("production", {
      QB_TAX_CODE_TAXABLE_ID: "4",
    });
    expect(refs).toBeNull();
  });

  it("returns null when no tax code env is configured", () => {
    expect(resolveQboTaxCodeRefs("sandbox", {})).toBeNull();
  });
});

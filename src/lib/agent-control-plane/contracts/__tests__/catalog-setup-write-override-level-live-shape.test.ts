import { describe, expect, it } from "vitest";

import live from "../__fixtures__/catalog-setup-write-override-level-live-documents.json";
import {
  CatalogSetupWriteReceiptSchema,
  CatalogSetupWriteResultSchema,
  PrepareCreateCatalogVariantInputSchema,
  PrepareSetCatalogPricingInputSchema,
  PrepareSetSupplierCostInputSchema,
  PrepareSetVariantThresholdsInputSchema,
  type CatalogSetupWriteReceipt,
  type CatalogSetupWriteResult,
} from "../catalog-setup-write";
import {
  matchesCreateVariantRequest,
  matchesSetPricingRequest,
  matchesSetSupplierCostRequest,
  matchesSetThresholdsRequest,
} from "@/lib/agent-control-plane/services/catalog-setup-write/catalog-setup-write-repository";

/**
 * Five writes whose whole point is the level a value lands at, as the database
 * actually returned them: request, prepare result and commit receipt, captured
 * by `docs/artifacts/mcp-catalog-setup-writes/override-level-live-capture.sql`
 * against a local copy of production structure and Canpro's real catalogue
 * with `20260916090000_agent_catalog_setup_write_override_level.sql` applied.
 *
 * The hand-built fixtures elsewhere prove the contract accepts the shapes the
 * contract describes. This proves the contract, the request/preview matchers
 * and the database agree about the shapes the database emits — including a
 * value that ends up inherited rather than written.
 */
type Scenario = {
  name: string;
  kind: string;
  request: unknown;
  prepare: unknown;
  receipt: unknown;
};

const scenarios = (live as { scenarios: Scenario[] }).scenarios;

function scenario(name: string) {
  const found = scenarios.find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing live scenario ${name}`);
  const result = CatalogSetupWriteResultSchema.parse(found.prepare);
  const receipt = CatalogSetupWriteReceiptSchema.parse(found.receipt);
  return { found, result, receipt };
}

function matches(found: Scenario, result: CatalogSetupWriteResult) {
  switch (found.kind) {
    case "create_variant":
      return matchesCreateVariantRequest(
        result,
        PrepareCreateCatalogVariantInputSchema.parse(found.request)
      );
    case "set_pricing":
      return matchesSetPricingRequest(
        result,
        PrepareSetCatalogPricingInputSchema.parse(found.request)
      );
    case "set_thresholds":
      return matchesSetThresholdsRequest(
        result,
        PrepareSetVariantThresholdsInputSchema.parse(found.request)
      );
    case "set_supplier_cost":
      return matchesSetSupplierCostRequest(
        result,
        PrepareSetSupplierCostInputSchema.parse(found.request)
      );
    default:
      throw new Error(`Unexpected kind ${found.kind}`);
  }
}

/** The approved `after` as the read-back must show it: live rows carry no
 * per-row state, so a cost sheet's states are stripped before comparing. */
function expectedReadback(result: CatalogSetupWriteResult) {
  const proposal = result.proposal;
  if (proposal.kind === "create_variant") return proposal.after.variant;
  if (proposal.kind === "set_supplier_cost") {
    return {
      ...proposal.after,
      profiles: proposal.after.profiles.map(({ state: _state, ...row }) => row),
    };
  }
  return proposal.after;
}

describe("catalogue override level: live database documents", () => {
  it("captured all five level scenarios", () => {
    expect(scenarios.map((entry) => entry.name)).toEqual([
      "create_variant_inheriting_everything",
      "variant_price_back_to_family",
      "warning_back_to_category",
      "supplier_cost_keeps_family_level",
      "family_price_with_shadowing_variants",
    ]);
  });

  for (const entry of scenarios) {
    it(`${entry.name}: parses, matches its own request, and reads back the approved preview`, () => {
      const parsedResult = CatalogSetupWriteResultSchema.safeParse(entry.prepare);
      expect(parsedResult.success ? null : parsedResult.error.issues).toBeNull();
      const parsedReceipt = CatalogSetupWriteReceiptSchema.safeParse(entry.receipt);
      expect(parsedReceipt.success ? null : parsedReceipt.error.issues).toBeNull();
      const result = parsedResult.data as CatalogSetupWriteResult;
      const receipt = parsedReceipt.data as CatalogSetupWriteReceipt;
      expect(result.kind).toBe(entry.kind);
      expect(receipt.kind).toBe(entry.kind);
      expect(matches(entry, result)).toBe(true);
      expect(receipt.readback).toEqual(expectedReadback(result));
      expect(receipt.effects).toEqual(result.proposal.effects);
      expect(receipt.preview_sha256).toBe(result.preview_sha256);
    });
  }

  it("creates a variant that inherits a price, a cost and both levels it was given equal values for", () => {
    const { result } = scenario("create_variant_inheriting_everything");
    if (result.proposal.kind !== "create_variant") throw new Error("kind");
    expect(result.proposal.before.default_price).toBe("15.0000");
    expect(result.proposal.after.variant.sale_price).toEqual({
      amount: "15.0000",
      origin: "family",
    });
    expect(result.proposal.after.variant.unit_cost).toEqual({
      amount: "8.5000",
      origin: "family",
    });
    expect(result.proposal.after.variant.warning_threshold).toEqual({
      value: "30",
      origin: "category",
    });
    expect(result.proposal.after.variant.critical_threshold).toEqual({
      value: "10",
      origin: "family",
    });
  });

  it("clears a variant's own price when it is set back to the family price", () => {
    const { result } = scenario("variant_price_back_to_family");
    if (result.proposal.kind !== "set_pricing") throw new Error("kind");
    expect(result.proposal.before.price).toEqual({
      amount: "18.0000",
      currency: "CAD",
      origin: "variant",
    });
    expect(result.proposal.after.price).toEqual({
      amount: "15.0000",
      currency: "CAD",
      origin: "family",
    });
    expect(result.proposal.after.shadowing_variants).toEqual([]);
    expect(result.proposal.effects.variants_updated).toBe(1);
    expect(result.proposal.effects.prices_changed).toBe(1);
  });

  it("clears a variant's own warning level when it equals the category's", () => {
    const { result } = scenario("warning_back_to_category");
    if (result.proposal.kind !== "set_thresholds") throw new Error("kind");
    expect(result.proposal.before.warning).toEqual({ value: "30", origin: "variant" });
    expect(result.proposal.after.warning).toEqual({ value: "30", origin: "category" });
    // The level the request did not name stays exactly where it was.
    expect(result.proposal.after.critical).toEqual(result.proposal.before.critical);
    expect(result.proposal.effects.thresholds_changed).toBe(1);
  });

  it("keeps an item-level-costed variant inheriting when its new default equals the family cost", () => {
    const { result } = scenario("supplier_cost_keeps_family_level");
    if (result.proposal.kind !== "set_supplier_cost") throw new Error("kind");
    expect(result.proposal.effects.variant_unit_cost_mirrored).toBe(true);
    expect(result.proposal.before.variant_unit_cost).toEqual({
      amount: "8.5000",
      origin: "family",
    });
    expect(result.proposal.after.variant_unit_cost).toEqual({
      amount: "8.5000",
      origin: "family",
    });
  });

  it("lists the variant a family price does not reach, and flags its override redundant only while it equals the default", () => {
    const { result } = scenario("family_price_with_shadowing_variants");
    if (result.proposal.kind !== "set_pricing") throw new Error("kind");
    const white = {
      variant_ref: {
        kind: "catalog_variant",
        id: "2c7cdf44-3473-499b-b086-73737505a565",
      },
      value_labels: ["White", "Normal"],
      price_override: "15.0000",
    };
    expect(result.proposal.before.shadowing_variants).toEqual([
      { ...white, redundant: true },
    ]);
    expect(result.proposal.after.shadowing_variants).toEqual([
      { ...white, redundant: false },
    ]);
    expect(
      result.proposal.after.affected_variants.map((row) => row.value_labels)
    ).toEqual([
      ["Black", "Normal"],
      ["Bronze", "Normal"],
    ]);
    expect(result.proposal.effects).toMatchObject({
      families_updated: 1,
      variants_updated: 0,
      prices_changed: 2,
    });
  });
});

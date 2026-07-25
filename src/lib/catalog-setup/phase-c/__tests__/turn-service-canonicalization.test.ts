import { describe, expect, it } from "vitest";
import { SetupAgentOutputError } from "@/lib/catalog-setup/agent/setup-agent-service";
import { CANPRO_VINYL_LIVE_SNAPSHOT } from "../__fixtures__/canpro-vinyl";
import {
  canonicalizeVerifiedSupplierTurn,
  supplierAdapterForTurn,
} from "../turn-service";
import type {
  CatalogAction,
  CatalogAgentTurn,
} from "../types";

function action(
  actionKey: string,
  actionType: CatalogAction["actionType"],
  payload: Record<string, unknown>,
): CatalogAction {
  return {
    actionKey,
    actionType,
    group: "CREATE",
    targetKind: actionType,
    clientId: actionKey.replaceAll(":", "-"),
    dependsOn: [],
    payload,
  };
}

function deksmartReview(): CatalogAgentTurn {
  return {
    kind: "review",
    facts: [],
    blueprint: {
      version: 1,
      summary: "DekSmart vinyl",
      ready: true,
      issues: [],
      actions: [
        action("create:product:68", "upsert_product", {
          name: "Vinyl membrane installation",
          description: "Supply and install DekSmart Ultra 68mil.",
          basePrice: 11.73,
          unitCost: 2,
          pricingUnit: "sqft",
          minimumCharge: 1500,
          isTaxable: true,
          showInStorefront: true,
        }),
        action("create:product:60", "upsert_product", {
          name: "Vinyl membrane installation — 60mil",
          description: "Supply and install DekSmart Smoothback 60mil.",
          basePrice: 12.73,
          unitCost: 2.25,
          pricingUnit: "sqft",
          minimumCharge: 1500,
          isTaxable: true,
          showInStorefront: false,
        }),
        action("create:tax:gst", "upsert_tax_rate", {
          name: "GST",
          rate: 0.05,
          isDefault: true,
          isActive: true,
        }),
        action("reuse:task:vinyl", "reuse_task_type", {
          display: "Vinyl Install",
        }),
      ],
    },
  };
}

describe("verified supplier turn canonicalization", () => {
  it("exposes DekSmart reference data only after the operator identifies that supplier", () => {
    expect(
      supplierAdapterForTurn(
        { intent: "start_guided_catalog_setup" },
        [],
      ),
    ).toBeNull();
    expect(
      supplierAdapterForTurn("We install Dek Smart vinyl membrane", []),
    ).toBe("deksmart");
  });

  it("replaces the model's DekSmart sketch with the complete reconciled plan", () => {
    const turn = canonicalizeVerifiedSupplierTurn(
      deksmartReview(),
      CANPRO_VINYL_LIVE_SNAPSHOT,
    );

    expect(turn.kind).toBe("review");
    if (turn.kind !== "review") return;
    expect(
      turn.blueprint.actions.filter(
        (entry) => entry.actionType === "upsert_product",
      ),
    ).toHaveLength(2);
    expect(
      turn.blueprint.actions.filter(
        (entry) =>
          entry.actionType === "upsert_product_material",
      ),
    ).toHaveLength(10);
    expect(
      turn.blueprint.actions.filter(
        (entry) =>
          entry.actionType === "upsert_catalog_option_value" &&
          String(entry.payload.optionRef).startsWith(
            "deksmart-ultra-68:",
          ),
      ),
    ).toHaveLength(19);
    expect(turn.blueprint.actions).toContainEqual(
      expect.objectContaining({
        actionType: "reuse_task_type",
        existingId: "a53dd13d-dc0c-4df0-88d6-118404b161ce",
      }),
    );
  });

  it("uses the selected supplier adapter even if the model omits the brand word", () => {
    const turn = deksmartReview();
    if (turn.kind === "review") {
      turn.blueprint.summary = "Vinyl membrane";
      for (const product of turn.blueprint.actions.filter(
        (entry) => entry.actionType === "upsert_product",
      )) {
        product.payload.description = String(
          product.payload.description,
        ).replaceAll("DekSmart ", "");
      }
    }

    const canonical = canonicalizeVerifiedSupplierTurn(
      turn,
      CANPRO_VINYL_LIVE_SNAPSHOT,
      "deksmart",
    );

    expect(canonical.kind).toBe("review");
    if (canonical.kind !== "review") return;
    expect(
      canonical.blueprint.actions.filter(
        (entry) => entry.actionType === "upsert_product_material",
      ),
    ).toHaveLength(10);
  });

  it("rejects a review that omits required pricing or labor facts", () => {
    const turn = deksmartReview();
    if (turn.kind === "review") {
      const standard = turn.blueprint.actions.find(
        (entry) => entry.actionKey === "create:product:68",
      )!;
      delete standard.payload.unitCost;
    }

    expect(() =>
      canonicalizeVerifiedSupplierTurn(
        turn,
        CANPRO_VINYL_LIVE_SNAPSHOT,
      ),
    ).toThrow(SetupAgentOutputError);
  });
});

import { describe, expect, it } from "vitest";
import { CANPRO_VINYL_LIVE_SNAPSHOT } from "../__fixtures__/canpro-vinyl";
import {
  canonicalizeVerifiedSupplierTurn,
  confirmExplicitSupplierFact,
  constrainDeksmartCommercialFactsToQuestion,
  supplierAdapterForTurn,
} from "../turn-service";
import type { CatalogAction, CatalogAgentTurn, CatalogFact } from "../types";

function action(
  actionKey: string,
  actionType: CatalogAction["actionType"],
  payload: Record<string, unknown>
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

function fact(
  id: string,
  key: string,
  value: unknown,
  classification: CatalogFact["classification"] = "pricing_rule"
): CatalogFact {
  return {
    id,
    classification,
    key,
    value,
    source: { kind: "operator", reference: "guided answer" },
    confidence: 1,
    status: "confirmed",
    contradicts: [],
  };
}

function confirmedCommercialFacts(): CatalogFact[] {
  return [
    fact(
      "fact:price:68",
      "customer_products.vinyl_install.basePrice",
      11.73,
      "customer_product"
    ),
    fact(
      "fact:price:60",
      "customer_products.vinyl_install_60mil_exception.basePrice",
      12.73,
      "customer_product"
    ),
    fact(
      "fact:labor:68",
      "customer_products.vinyl_install_68mil.unitCost",
      2,
      "labor_cost"
    ),
    fact(
      "fact:labor:60",
      "customer_products.vinyl_install_60mil_exception.unitCost",
      2.25,
      "labor_cost"
    ),
    fact(
      "fact:minimum",
      "customer_products.vinyl_install.minimumCharge",
      1500,
      "pricing_rule"
    ),
    fact("fact:gst", "tax_rates.gst.ratePercent", 5, "pricing_rule"),
  ];
}

describe("verified supplier turn canonicalization", () => {
  it("exposes DekSmart reference data only after the operator identifies that supplier", () => {
    expect(
      supplierAdapterForTurn({ intent: "start_guided_catalog_setup" }, [])
    ).toBeNull();
    expect(
      supplierAdapterForTurn("We install Dek Smart vinyl membrane", [])
    ).toBe("deksmart");
  });

  it("replaces the model's DekSmart sketch with the complete reconciled plan", () => {
    const turn = canonicalizeVerifiedSupplierTurn(
      deksmartReview(),
      CANPRO_VINYL_LIVE_SNAPSHOT,
      "deksmart",
      confirmedCommercialFacts()
    );

    expect(turn.kind).toBe("review");
    if (turn.kind !== "review") return;
    expect(
      turn.blueprint.actions.filter(
        (entry) => entry.actionType === "upsert_product"
      )
    ).toHaveLength(2);
    expect(
      turn.blueprint.actions.filter(
        (entry) => entry.actionType === "upsert_product_material"
      )
    ).toHaveLength(10);
    expect(
      turn.blueprint.actions.filter(
        (entry) =>
          entry.actionType === "upsert_catalog_option_value" &&
          String(entry.payload.optionRef).startsWith("deksmart-ultra-68:")
      )
    ).toHaveLength(19);
    expect(turn.blueprint.actions).toContainEqual(
      expect.objectContaining({
        actionType: "reuse_task_type",
        existingId: "a53dd13d-dc0c-4df0-88d6-118404b161ce",
      })
    );
  });

  it("does not trust a model-authored supplier name without a selected adapter", () => {
    const modelTurn = deksmartReview();
    const canonical = canonicalizeVerifiedSupplierTurn(
      modelTurn,
      CANPRO_VINYL_LIVE_SNAPSHOT
    );

    expect(canonical).toEqual(modelTurn);
    expect(canonical.kind).toBe("review");
    if (canonical.kind !== "review") return;
    expect(
      canonical.blueprint.actions.filter(
        (entry) => entry.actionType === "upsert_product_material"
      )
    ).toHaveLength(0);
  });

  it("uses the selected supplier adapter even if the model omits the brand word", () => {
    const turn = deksmartReview();
    if (turn.kind === "review") {
      turn.blueprint.summary = "Vinyl membrane";
      for (const product of turn.blueprint.actions.filter(
        (entry) => entry.actionType === "upsert_product"
      )) {
        product.payload.description = String(
          product.payload.description
        ).replaceAll("DekSmart ", "");
      }
    }

    const canonical = canonicalizeVerifiedSupplierTurn(
      turn,
      CANPRO_VINYL_LIVE_SNAPSHOT,
      "deksmart",
      confirmedCommercialFacts()
    );

    expect(canonical.kind).toBe("review");
    if (canonical.kind !== "review") return;
    expect(
      canonical.blueprint.actions.filter(
        (entry) => entry.actionType === "upsert_product_material"
      )
    ).toHaveLength(10);
  });

  it("keeps interviewing when confirmed commercial facts are still missing", () => {
    const currentFacts = confirmedCommercialFacts().filter(
      (entry) =>
        ![
          "customer_products.vinyl_install_60mil_exception.basePrice",
          "customer_products.vinyl_install_68mil.unitCost",
          "customer_products.vinyl_install_60mil_exception.unitCost",
          "tax_rates.gst.ratePercent",
        ].includes(entry.key)
    );

    const turn = canonicalizeVerifiedSupplierTurn(
      deksmartReview(),
      CANPRO_VINYL_LIVE_SNAPSHOT,
      "deksmart",
      currentFacts
    );

    expect(turn.kind).toBe("question");
    if (turn.kind !== "question") return;
    expect(turn.question.id).toBe("deksmart-commercial-values");
    expect(turn.question.factKeys).toEqual([
      "customer_products.vinyl_install_60mil_exception.basePrice",
      "customer_products.vinyl_install_68mil.unitCost",
      "customer_products.vinyl_install_60mil_exception.unitCost",
      "tax_rates.gst.ratePercent",
    ]);
  });

  it("builds the supplier plan from confirmed facts instead of model-authored values", () => {
    const modelTurn = deksmartReview();
    if (modelTurn.kind === "review") {
      const products = modelTurn.blueprint.actions.filter(
        (entry) => entry.actionType === "upsert_product"
      );
      products[0].payload.basePrice = 99;
      products[0].payload.unitCost = 88;
      products[1].payload.basePrice = 77;
      products[1].payload.unitCost = 66;
      const tax = modelTurn.blueprint.actions.find(
        (entry) => entry.actionType === "upsert_tax_rate"
      );
      if (tax) tax.payload.rate = 0.13;
    }

    const turn = canonicalizeVerifiedSupplierTurn(
      modelTurn,
      CANPRO_VINYL_LIVE_SNAPSHOT,
      "deksmart",
      confirmedCommercialFacts()
    );

    expect(turn.kind).toBe("review");
    if (turn.kind !== "review") return;
    const products = turn.blueprint.actions.filter(
      (entry) => entry.actionType === "upsert_product"
    );
    expect(products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            name: "Vinyl membrane installation",
            basePrice: 11.73,
            unitCost: 2,
          }),
        }),
        expect.objectContaining({
          payload: expect.objectContaining({
            name: "Vinyl membrane installation — 60mil",
            basePrice: 12.73,
            unitCost: 2.25,
          }),
        }),
      ])
    );
    expect(
      turn.blueprint.actions.find(
        (entry) => entry.actionType === "upsert_tax_rate"
      )?.payload.rate
    ).toBe(0.05);
  });

  it("asks for GST again when the confirmed percentage is invalid", () => {
    const invalidFacts = confirmedCommercialFacts().map((entry) =>
      entry.key === "tax_rates.gst.ratePercent"
        ? { ...entry, value: 101 }
        : entry
    );

    const turn = canonicalizeVerifiedSupplierTurn(
      deksmartReview(),
      CANPRO_VINYL_LIVE_SNAPSHOT,
      "deksmart",
      invalidFacts
    );

    expect(turn.kind).toBe("question");
    if (turn.kind !== "question") return;
    expect(turn.question.factKeys).toEqual(["tax_rates.gst.ratePercent"]);
  });

  it("does not persist commercial values the model invents while answering another question", () => {
    const turn = deksmartReview();
    if (turn.kind !== "review") return;
    turn.facts.push(
      fact(
        "fact:model-invented-price",
        "customer_products.vinyl_install_60mil_exception.basePrice",
        99,
        "customer_product"
      ),
      fact(
        "fact:confirmed-supplier",
        "suppliers.vinyl_membrane.manufacturer",
        "DekSmart",
        "material_compatibility"
      )
    );

    const constrained = constrainDeksmartCommercialFactsToQuestion(turn, {
      id: "supplier",
      prompt: "Which supplier do you use?",
      answerKind: "text",
      factKeys: ["suppliers.vinyl_membrane.manufacturer"],
    });

    expect(
      constrained.facts.some(
        (entry) =>
          entry.key ===
          "customer_products.vinyl_install_60mil_exception.basePrice"
      )
    ).toBe(false);
    expect(
      constrained.facts.some(
        (entry) => entry.key === "suppliers.vinyl_membrane.manufacturer"
      )
    ).toBe(true);
  });

  it("persists an explicitly identified supplier as a confirmed fact", () => {
    const confirmed = confirmExplicitSupplierFact(
      {
        kind: "question",
        facts: [],
        question: {
          id: "next-question",
          prompt: "What do you charge?",
          answerKind: "text",
          factKeys: ["customer_products.price"],
        },
      },
      "We install DekSmart vinyl membrane",
      "deksmart"
    );

    expect(confirmed.facts).toContainEqual({
      id: "fact:supplier:vinyl_membrane:deksmart",
      classification: "material_compatibility",
      key: "suppliers.vinyl_membrane.manufacturer",
      value: "DekSmart",
      source: {
        kind: "operator",
        reference: "explicit supplier selection",
      },
      confidence: 1,
      status: "confirmed",
      contradicts: [],
    });
  });
});

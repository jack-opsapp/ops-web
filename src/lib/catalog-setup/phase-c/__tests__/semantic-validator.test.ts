import { describe, expect, it } from "vitest";
import { CATALOG_CAPABILITY_MANIFEST_REVISION } from "../catalog-capability-manifest";
import { validateCatalogAgentTurn } from "../semantic-validator";

const requiredProductPayload = {
  name: "Vinyl membrane installation",
  basePrice: 11.73,
  pricingUnit: "sqft",
  minimumCharge: 1500,
  isTaxable: true,
  showInStorefront: true,
  taskTypeRef: "vinyl-install",
};

describe("Phase C semantic validator", () => {
  it("rejects a customer Thickness option when thickness is classified staff-only", () => {
    const result = validateCatalogAgentTurn({
      kind: "review",
      facts: [
        {
          id: "staff-thickness",
          classification: "staff_only_choice",
          key: "product.vinyl.thickness",
          value: true,
          source: { kind: "operator" },
          confidence: 1,
          status: "confirmed",
          contradicts: [],
        },
      ],
      blueprint: {
        version: 1,
        summary: "Vinyl",
        ready: true,
        issues: [],
        actions: [
          {
            actionKey: "create:product:vinyl",
            group: "CREATE",
            actionType: "upsert_product",
            targetKind: "product",
            clientId: "vinyl",
            dependsOn: [],
            payload: requiredProductPayload,
          },
          {
            actionKey: "create:product-option:thickness",
            group: "CREATE",
            actionType: "upsert_product_option",
            targetKind: "product_option",
            clientId: "vinyl:thickness",
            dependsOn: ["create:product:vinyl"],
            payload: { productRef: "vinyl", name: "Thickness" },
          },
        ],
      },
    });

    expect(result.success).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "staff_choice_exposed" }),
      ])
    );
  });

  it("blocks review when required quote fields are unresolved", () => {
    const result = validateCatalogAgentTurn({
      kind: "review",
      facts: [],
      blueprint: {
        version: 1,
        summary: "Incomplete",
        ready: true,
        issues: [],
        actions: [
          {
            actionKey: "create:product:vinyl",
            group: "CREATE",
            actionType: "upsert_product",
            targetKind: "product",
            clientId: "vinyl",
            dependsOn: [],
            payload: { name: "Vinyl membrane installation" },
          },
        ],
      },
    });

    expect(result.success).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "incomplete_product_plan" }),
      ]),
    );
  });

  it("blocks review while a company knowledge fact still needs confirmation", () => {
    const result = validateCatalogAgentTurn({
      kind: "review",
      facts: [
        {
          id: "memory-price",
          classification: "pricing_rule",
          key: "product.vinyl.base_price",
          value: 11.73,
          source: {
            kind: "company_knowledge",
            reference: "memory-price",
          },
          confidence: 0.92,
          status: "unresolved",
          contradicts: [],
        },
      ],
      blueprint: {
        version: 1,
        summary: "Vinyl",
        ready: true,
        issues: [],
        actions: [
          {
            actionKey: "create:product:vinyl",
            group: "CREATE",
            actionType: "upsert_product",
            targetKind: "product",
            clientId: "vinyl",
            dependsOn: [],
            payload: requiredProductPayload,
          },
        ],
      },
    });

    expect(result.success).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "company_knowledge_unconfirmed",
        }),
      ])
    );
  });

  it("accepts one safe question turn", () => {
    const result = validateCatalogAgentTurn({
      kind: "question",
      facts: [],
      question: {
        id: "minimum",
        intent: "pricing",
        capabilityRef: "catalog-core/v1",
        prompt: "Do you have a minimum charge?",
        answerKind: "boolean",
        factKeys: ["product.minimum_charge"],
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects a question without a released capability contract", () => {
    const result = validateCatalogAgentTurn({
      kind: "question",
      facts: [],
      question: {
        id: "deck-waste",
        intent: "static_material_quantity",
        capabilityRef: "deck-geometry/v1",
        prompt: "Should OPS calculate waste from Deck Designer?",
        answerKind: "boolean",
        factKeys: ["product.deck_geometry"],
      },
    });

    expect(result.success).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "capability_unavailable",
        }),
      ]),
    );
  });

  it("rejects unsupported blueprint actions even when their metadata is writable", () => {
    const result = validateCatalogAgentTurn({
      kind: "review",
      facts: [],
      blueprint: {
        version: 1,
        capabilityRevision: CATALOG_CAPABILITY_MANIFEST_REVISION,
        summary: "Invented geometry automation",
        ready: true,
        issues: [],
        actions: [
          {
            actionKey: "create:material-rule:vinyl",
            group: "CREATE",
            actionType: "upsert_material_quantity_rule",
            targetKind: "material_quantity_rule",
            clientId: "vinyl-rule",
            dependsOn: [],
            payload: {
              measureSource: "deck_geometry/v1",
            },
          },
        ],
      },
    });

    expect(result.success).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "capability_unavailable",
          actionKey: "create:material-rule:vinyl",
        }),
      ]),
    );
  });

  it("rejects a review generated against a different capability revision", () => {
    const result = validateCatalogAgentTurn({
      kind: "review",
      facts: [],
      blueprint: {
        version: 1,
        capabilityRevision: "phase-c-capabilities/older",
        summary: "Stale",
        ready: true,
        issues: [],
        actions: [],
      },
    });

    expect(result.success).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "capability_manifest_changed",
        }),
      ]),
    );
  });
});

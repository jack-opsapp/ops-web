import { describe, expect, it } from "vitest";
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
    expect(result.issues[0]).toEqual(
      expect.objectContaining({ code: "incomplete_product_plan" })
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
        prompt: "Do you have a minimum charge?",
        answerKind: "boolean",
        factKeys: ["product.minimum_charge"],
      },
    });

    expect(result.success).toBe(true);
  });
});

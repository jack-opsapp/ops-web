import { describe, expect, it } from "vitest";
import { resolveGuidedQuestion } from "../question-policy";

describe("Phase C server-owned question policy", () => {
  it("replaces model-written supplier copy with the exact supported question", () => {
    const question = resolveGuidedQuestion({
      id: "supplier",
      intent: "supplier_identity",
      capabilityRef: "catalog-core/v1",
      factKeys: ["service.vinyl.supplier"],
      context: { serviceLabel: "vinyl decking" },
    });

    expect(question).toEqual({
      id: "supplier",
      intent: "supplier_identity",
      capabilityRef: "catalog-core/v1",
      context: { serviceLabel: "vinyl decking" },
      prompt:
        "Which manufacturer, supplier, or product line do you use for vinyl decking?",
      answerKind: "text",
      factKeys: ["service.vinyl.supplier"],
      help:
        "Use the name your staff recognizes. OPS will not assume supplier products or pricing.",
    });
  });

  it("uses server-owned options for customer versus staff choices", () => {
    const question = resolveGuidedQuestion({
      id: "option-audience",
      intent: "option_audience",
      capabilityRef: "catalog-core/v1",
      factKeys: ["product.vinyl.colour.audience"],
      context: { optionLabel: "colour or pattern" },
    });

    expect(question).toMatchObject({
      answerKind: "single_choice",
      options: [
        "Customers choose it",
        "Staff choose it",
        "Customers choose, staff confirms",
      ],
    });
  });

  it("never resolves Deck Designer geometry while its integration is unavailable", () => {
    expect(
      resolveGuidedQuestion({
        id: "deck-waste",
        intent: "static_material_quantity",
        capabilityRef: "deck-geometry/v1",
        factKeys: ["product.vinyl.deck_geometry"],
        context: { productLabel: "Vinyl membrane" },
      }),
    ).toBeNull();
  });

  it("never asks the operator to decide whether Phase C is ready for review", () => {
    expect(
      resolveGuidedQuestion({
        id: "review-ready",
        intent: "review_readiness",
        capabilityRef: "catalog-core/v1",
        factKeys: ["catalog.review"],
        context: {},
      }),
    ).toBeNull();
  });

  it("offers only released handling when roll inventory was requested", () => {
    expect(
      resolveGuidedQuestion({
        id: "material-tracking-scope",
        intent: "material_tracking_scope" as never,
        capabilityRef: "static-product-materials/v1",
        factKeys: ["materials.vinyl.inventory_policy"],
        context: { productLabel: "68mil Deksmart PVC Membrane" },
      }),
    ).toEqual({
      id: "material-tracking-scope",
      intent: "material_tracking_scope",
      capabilityRef: "static-product-materials/v1",
      context: { productLabel: "68mil Deksmart PVC Membrane" },
      prompt:
        "OPS does not track roll or sheet inventory yet. How should 68mil Deksmart PVC Membrane be handled for now?",
      answerKind: "single_choice",
      factKeys: ["materials.vinyl.inventory_policy"],
      options: [
        "Keep purchasing and inventory staff-managed",
        "Add a fixed material quantity per product unit",
      ],
      help:
        "Fixed quantities are supported. Roll tracking, offcuts, coverage calculations, and purchasing automation are not connected yet.",
    });
  });

  it("fails closed for unknown question intent or capability input", () => {
    expect(
      resolveGuidedQuestion({
        id: "invented",
        intent: "invented" as never,
        capabilityRef: "invented/v99" as never,
        factKeys: ["invented"],
        context: {},
      }),
    ).toBeNull();
  });
});

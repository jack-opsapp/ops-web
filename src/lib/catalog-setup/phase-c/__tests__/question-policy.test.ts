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

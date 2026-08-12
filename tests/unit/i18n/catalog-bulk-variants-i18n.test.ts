import { describe, expect, it } from "vitest";
import en from "@/i18n/dictionaries/en/catalog.json";
import es from "@/i18n/dictionaries/es/catalog.json";

describe("catalog bulk variant copy", () => {
  it("ships every workflow string in English and Spanish", () => {
    const required = [
      "kebab.stock",
      "kebab.bulkAddVariants",
      "bulkVariants.title",
      "bulkVariants.stage.families",
      "bulkVariants.stage.change",
      "bulkVariants.stage.review",
      "bulkVariants.family.disabled.duplicateVariantSignature",
      "bulkVariants.change.axisName",
      "bulkVariants.change.existingValue",
      "bulkVariants.change.newValue",
      "bulkVariants.review.preservation",
      "bulkVariants.offline",
      "bulkVariants.error.stale",
      "bulkVariants.action.apply",
    ] as const;

    for (const key of required) {
      expect(en[key]).toBeTruthy();
      expect(es[key]).toBeTruthy();
    }
  });
});

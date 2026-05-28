import { describe, it, expect } from "vitest";
import { TEMPLATE_REGISTRY, getTemplateEntry, renderTemplate } from "@/lib/email/template-registry";

describe("template-registry — onboarding entries", () => {
  const ids = [
    "onboarding_day_0_welcome",
    "onboarding_day_1_no_project",
    "onboarding_day_1_has_project",
    "onboarding_day_3_inbox",
    "onboarding_day_4_no_notification",
    "onboarding_day_4_has_notification",
    "onboarding_day_8_estimates",
    "onboarding_day_14_quiet",
    "onboarding_day_14_active",
    "onboarding_lost_you",
  ];

  it("registers all 10 onboarding template ids", () => {
    for (const id of ids) {
      const entry = getTemplateEntry(id);
      expect(entry, `expected entry for ${id}`).toBeTruthy();
      expect(entry?.Component).toBeTruthy();
      expect(entry?.previewProps).toBeTruthy();
    }
  });

  it("renders each onboarding template with its previewProps", async () => {
    for (const id of ids) {
      const entry = getTemplateEntry(id)!;
      const result = await renderTemplate(id, entry.previewProps);
      expect(result?.html, `html for ${id}`).toBeTruthy();
      expect(result?.html.length, `html length for ${id}`).toBeGreaterThan(100);
    }
  });
});

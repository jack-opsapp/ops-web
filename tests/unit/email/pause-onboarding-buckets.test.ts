import { describe, it, expect } from "vitest";
import { resolveEmailBucket } from "@/lib/email/pause";

describe("resolveEmailBucket — onboarding kinds", () => {
  const kinds = [
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

  for (const kind of kinds) {
    it(`maps ${kind} to dispatch bucket`, () => {
      expect(resolveEmailBucket(kind)).toBe("dispatch");
    });
  }
});

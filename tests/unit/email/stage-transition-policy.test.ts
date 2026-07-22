import { describe, expect, it } from "vitest";

import { isAllowedAutomatedEmailStageTransition } from "@/lib/api/services/stage-evaluator";

describe("automated email stage-transition policy", () => {
  it("never resets an active lead to new_lead", () => {
    for (const stage of [
      "qualifying",
      "quoting",
      "quoted",
      "follow_up",
      "negotiation",
    ]) {
      expect(isAllowedAutomatedEmailStageTransition(stage, "new_lead")).toBe(
        false
      );
    }
  });

  it("allows evidence-driven lifecycle loops without treating stages as a total order", () => {
    expect(
      isAllowedAutomatedEmailStageTransition("negotiation", "quoted")
    ).toBe(true);
    expect(
      isAllowedAutomatedEmailStageTransition("negotiation", "follow_up")
    ).toBe(true);
    expect(isAllowedAutomatedEmailStageTransition("quoted", "quoting")).toBe(
      true
    );
    expect(
      isAllowedAutomatedEmailStageTransition("follow_up", "negotiation")
    ).toBe(true);
  });

  it("never moves a terminal or unknown stage through active automation", () => {
    for (const stage of ["won", "lost", "discarded", "unknown"]) {
      expect(isAllowedAutomatedEmailStageTransition(stage, "quoted")).toBe(
        false
      );
    }
  });
});

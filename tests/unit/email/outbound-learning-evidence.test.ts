import { describe, expect, it } from "vitest";
import { outboundLearningEvidenceKey } from "@/lib/email/outbound-learning-evidence";

describe("outboundLearningEvidenceKey", () => {
  it("normalizes insignificant whitespace and casing", () => {
    expect(
      outboundLearningEvidenceKey("fact", ["Timeline", "Start Monday"])
    ).toBe(
      outboundLearningEvidenceKey("fact", [" timeline ", "START   MONDAY"])
    );
  });

  it("keeps long values index-safe without collapsing distinct suffixes", () => {
    const shared = "cedar scope ".repeat(500);
    const first = outboundLearningEvidenceKey("draft-correction", [
      `${shared}option a`,
    ]);
    const second = outboundLearningEvidenceKey("draft-correction", [
      `${shared}option b`,
    ]);

    expect(first.length).toBeLessThanOrEqual(200);
    expect(second.length).toBeLessThanOrEqual(200);
    expect(first).not.toBe(second);
  });
});

import { describe, it, expect } from "vitest";
import {
  tryDeterministicCustomer,
  LIVE_CUSTOMER_OPPORTUNITY_STAGES,
  type DeterministicCustomerInput,
} from "../deterministic-customer-rule";

// ─── Fixture helper ──────────────────────────────────────────────────────────

function baseInput(
  overrides: Partial<DeterministicCustomerInput> = {}
): DeterministicCustomerInput {
  return {
    subject: "Canpro Deck and Rail Estimate",
    opportunityId: "opp-1",
    opportunityStage: "qualifying",
    opportunityArchivedAt: null,
    categoryManuallySet: false,
    ...overrides,
  };
}

// ─── Happy path ──────────────────────────────────────────────────────────────

describe("tryDeterministicCustomer — matches every live stage", () => {
  for (const stage of LIVE_CUSTOMER_OPPORTUNITY_STAGES) {
    it(`returns CUSTOMER for stage="${stage}"`, () => {
      const result = tryDeterministicCustomer(
        baseInput({ opportunityStage: stage })
      );
      expect(result).not.toBeNull();
      expect(result!.category).toBe("CUSTOMER");
      expect(result!.classifierVersion).toBe("customer-deterministic-v1");
      expect(result!.confidence).toBe(1);
    });
  }

  it("normalizes mixed-case stage strings", () => {
    const result = tryDeterministicCustomer(
      baseInput({ opportunityStage: "New_Lead" })
    );
    expect(result).not.toBeNull();
  });

  it("trims whitespace around the stage value", () => {
    const result = tryDeterministicCustomer(
      baseInput({ opportunityStage: "  qualifying  " })
    );
    expect(result).not.toBeNull();
  });

  it("includes the subject and a humanized stage in the summary", () => {
    const result = tryDeterministicCustomer(
      baseInput({
        subject: "Canpro Deck and Rail Estimate",
        opportunityStage: "follow_up",
      })
    );
    expect(result!.summary).toContain("follow up");
    expect(result!.summary).toContain("Canpro Deck and Rail Estimate");
  });

  it("substitutes (no subject) when subject is blank", () => {
    const result = tryDeterministicCustomer(baseInput({ subject: "   " }));
    expect(result!.summary).toContain("(no subject)");
  });
});

// ─── Bail: terminal / unknown stages ─────────────────────────────────────────

describe("tryDeterministicCustomer — bails on terminal or unknown stages", () => {
  it("returns null for stage='lost'", () => {
    expect(
      tryDeterministicCustomer(baseInput({ opportunityStage: "lost" }))
    ).toBeNull();
  });

  it("returns null for stage='discarded'", () => {
    expect(
      tryDeterministicCustomer(baseInput({ opportunityStage: "discarded" }))
    ).toBeNull();
  });

  it("returns null for an unrecognized stage value", () => {
    expect(
      tryDeterministicCustomer(baseInput({ opportunityStage: "no-such-stage" }))
    ).toBeNull();
  });

  it("returns null when the stage is null", () => {
    expect(
      tryDeterministicCustomer(baseInput({ opportunityStage: null }))
    ).toBeNull();
  });

  it("returns null when the stage is empty", () => {
    expect(
      tryDeterministicCustomer(baseInput({ opportunityStage: "" }))
    ).toBeNull();
  });
});

// ─── Bail: no opportunity / archived opportunity ─────────────────────────────

describe("tryDeterministicCustomer — bails when there's no live opportunity", () => {
  it("returns null when opportunityId is null", () => {
    expect(
      tryDeterministicCustomer(baseInput({ opportunityId: null }))
    ).toBeNull();
  });

  it("returns null when the opportunity is archived", () => {
    expect(
      tryDeterministicCustomer(
        baseInput({ opportunityArchivedAt: "2026-04-01T00:00:00Z" })
      )
    ).toBeNull();
  });
});

// ─── Bail: manual override ───────────────────────────────────────────────────

describe("tryDeterministicCustomer — respects manual override", () => {
  it("returns null when categoryManuallySet is true", () => {
    expect(
      tryDeterministicCustomer(baseInput({ categoryManuallySet: true }))
    ).toBeNull();
  });
});

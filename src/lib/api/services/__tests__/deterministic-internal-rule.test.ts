import { describe, it, expect } from "vitest";
import {
  tryDeterministicInternal,
  type CompanyUser,
  type DeterministicInternalInput,
} from "../deterministic-internal-rule";

// ─── Fixture helpers ─────────────────────────────────────────────────────────

function makeCompanyUsers(
  entries: Array<[string, string]>
): Map<string, CompanyUser> {
  const m = new Map<string, CompanyUser>();
  for (const [email, displayName] of entries) {
    const key = email.toLowerCase();
    m.set(key, { email: key, displayName });
  }
  return m;
}

function baseInput(
  overrides: Partial<DeterministicInternalInput> = {}
): DeterministicInternalInput {
  return {
    subject: "crew schedule for Friday",
    firstMessageBody: "Hey team — confirming crew list for Friday.",
    participants: ["jared@ops.co", "meghan@ops.co"],
    senderEmail: "jared@ops.co",
    categoryManuallySet: false,
    companyUsers: makeCompanyUsers([
      ["jared@ops.co", "Jared Reed"],
      ["meghan@ops.co", "Meghan Lee"],
    ]),
    teamForwarders: [],
    connectionEmail: "meghan@ops.co",
    ...overrides,
  };
}

// ─── Happy path ──────────────────────────────────────────────────────────────

describe("tryDeterministicInternal — matches", () => {
  it("returns INTERNAL when all participants are company users", () => {
    const result = tryDeterministicInternal(baseInput());
    expect(result).not.toBeNull();
    expect(result!.category).toBe("INTERNAL");
    expect(result!.classifierVersion).toBe("deterministic-v1");
    expect(result!.confidence).toBe(1);
    expect(result!.summary).toMatch(/^Internal thread between /);
    expect(result!.summary).toContain("crew schedule for Friday");
  });

  it("resolves participant display names from companyUsers", () => {
    const result = tryDeterministicInternal(baseInput());
    expect(result!.summary).toContain("Jared Reed");
    expect(result!.summary).toContain("Meghan Lee");
  });

  it("handles participants formatted as 'Name <email>'", () => {
    const result = tryDeterministicInternal(
      baseInput({
        participants: ["Jared Reed <jared@ops.co>", "Meghan Lee <meghan@ops.co>"],
      })
    );
    expect(result).not.toBeNull();
    expect(result!.category).toBe("INTERNAL");
  });

  it("is case-insensitive on participant emails", () => {
    const result = tryDeterministicInternal(
      baseInput({ participants: ["JARED@ops.co", "Meghan@OPS.CO"] })
    );
    expect(result).not.toBeNull();
  });

  it("truncates to 3 names and appends +N for the overflow", () => {
    const result = tryDeterministicInternal(
      baseInput({
        participants: [
          "a@ops.co",
          "b@ops.co",
          "c@ops.co",
          "d@ops.co",
          "e@ops.co",
        ],
        companyUsers: makeCompanyUsers([
          ["a@ops.co", "Alpha"],
          ["b@ops.co", "Bravo"],
          ["c@ops.co", "Charlie"],
          ["d@ops.co", "Delta"],
          ["e@ops.co", "Echo"],
        ]),
      })
    );
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("Alpha, Bravo, Charlie +2");
    expect(result!.summary).not.toContain("Delta");
  });

  it("uses (no subject) placeholder when subject is blank", () => {
    const result = tryDeterministicInternal(
      baseInput({ subject: "   " })
    );
    expect(result!.summary).toContain("(no subject)");
  });

  it("accepts connectionEmail as a fallback when user row is missing", () => {
    const result = tryDeterministicInternal(
      baseInput({
        participants: ["new-user@ops.co", "meghan@ops.co"],
        companyUsers: makeCompanyUsers([["meghan@ops.co", "Meghan Lee"]]),
        connectionEmail: "new-user@ops.co",
      })
    );
    expect(result).not.toBeNull();
  });
});

// ─── Bail: manual override ───────────────────────────────────────────────────

describe("tryDeterministicInternal — bails on manual override", () => {
  it("returns null when categoryManuallySet is true", () => {
    expect(
      tryDeterministicInternal(baseInput({ categoryManuallySet: true }))
    ).toBeNull();
  });
});

// ─── Bail: forward subject ───────────────────────────────────────────────────

describe("tryDeterministicInternal — bails on forward subjects", () => {
  it("bails on 'Fwd: ...'", () => {
    expect(
      tryDeterministicInternal(baseInput({ subject: "Fwd: Website inquiry" }))
    ).toBeNull();
  });

  it("bails on 'FW: ...' (uppercase)", () => {
    expect(
      tryDeterministicInternal(baseInput({ subject: "FW: Quote request" }))
    ).toBeNull();
  });

  it("bails on 'Fw: ...' (mixed case)", () => {
    expect(
      tryDeterministicInternal(baseInput({ subject: "Fw: update" }))
    ).toBeNull();
  });

  it("bails with leading whitespace on subject", () => {
    expect(
      tryDeterministicInternal(baseInput({ subject: "   FWD: pricing" }))
    ).toBeNull();
  });
});

// ─── Bail: forward body markers ──────────────────────────────────────────────

describe("tryDeterministicInternal — bails on forward body markers", () => {
  it("bails on '---------- Forwarded message ----------'", () => {
    expect(
      tryDeterministicInternal(
        baseInput({
          firstMessageBody:
            "Thought you'd want to see this.\n\n---------- Forwarded message ----------\nFrom: customer@example.com",
        })
      )
    ).toBeNull();
  });

  it("bails on 'Begin forwarded message:'", () => {
    expect(
      tryDeterministicInternal(
        baseInput({
          firstMessageBody:
            "FYI\n\nBegin forwarded message:\nFrom: customer@example.com",
        })
      )
    ).toBeNull();
  });
});

// ─── Bail: known-forwarder + form subject ────────────────────────────────────

describe("tryDeterministicInternal — bails on likely-forwarded-inquiry pattern", () => {
  it("bails when sender is in teamForwarders AND subject matches form pattern", () => {
    expect(
      tryDeterministicInternal(
        baseInput({
          senderEmail: "jared@ops.co",
          teamForwarders: ["jared@ops.co"],
          subject: "Got a new submission from your contact form",
        })
      )
    ).toBeNull();
  });

  it("does NOT bail when sender is in teamForwarders but subject is NOT a form", () => {
    const result = tryDeterministicInternal(
      baseInput({
        senderEmail: "jared@ops.co",
        teamForwarders: ["jared@ops.co"],
        subject: "lunch tomorrow",
      })
    );
    expect(result).not.toBeNull();
  });

  it("does NOT bail when subject matches form pattern but sender is not a forwarder", () => {
    const result = tryDeterministicInternal(
      baseInput({
        senderEmail: "meghan@ops.co",
        teamForwarders: ["someone-else@ops.co"],
        subject: "new inquiry about scheduling",
      })
    );
    expect(result).not.toBeNull();
  });
});

// ─── Bail: external participant ──────────────────────────────────────────────

describe("tryDeterministicInternal — bails when a participant is external", () => {
  it("returns null when one participant is NOT in companyUsers", () => {
    expect(
      tryDeterministicInternal(
        baseInput({
          participants: ["jared@ops.co", "customer@example.com"],
        })
      )
    ).toBeNull();
  });

  it("returns null when participant email extraction yields empty string", () => {
    expect(
      tryDeterministicInternal(
        baseInput({
          participants: ["jared@ops.co", "not-an-email"],
        })
      )
    ).toBeNull();
  });
});

// ─── Bail: empty participants ────────────────────────────────────────────────

describe("tryDeterministicInternal — bails on empty participants", () => {
  it("returns null when participants is empty", () => {
    expect(
      tryDeterministicInternal(baseInput({ participants: [] }))
    ).toBeNull();
  });
});

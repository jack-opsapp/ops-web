import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SPEC03_LOCKED_TOTAL_MAX_CENTS,
  SCOPE_DOC_LOCKED_TOTAL_KEY,
  composeScopeLockedTotal,
  formatCadCents,
  lockBlockedLabel,
  lockedTotalGate,
  parseLockedTotalInput,
  pickCurrentScopeDocument,
  readScopeDocTotalCents,
  scopeContentHash,
  withLockedTotal,
} from "../spec-locked-total";
import { SPEC_TIER_TOTAL_CENTS } from "../spec-tiers";

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── parseLockedTotalInput ───────────────────────────────────────────────────

describe("parseLockedTotalInput", () => {
  it("accepts a plain dollar figure and returns integer cents", () => {
    expect(parseLockedTotalInput("31000")).toEqual({ ok: true, cents: 3_100_000 });
  });

  it("accepts thousands separators, a dollar sign, and surrounding whitespace", () => {
    expect(parseLockedTotalInput(" $31,000 ")).toEqual({ ok: true, cents: 3_100_000 });
  });

  it("accepts up to two decimal places without floating-point drift", () => {
    expect(parseLockedTotalInput("31,000.50")).toEqual({ ok: true, cents: 3_100_050 });
    expect(parseLockedTotalInput("31000.1")).toEqual({ ok: true, cents: 3_100_010 });
    expect(parseLockedTotalInput("25000.07")).toEqual({ ok: true, cents: 2_500_007 });
  });

  it("accepts exactly the floor", () => {
    expect(parseLockedTotalInput("25000")).toEqual({ ok: true, cents: SPEC_TIER_TOTAL_CENTS.spec03 });
  });

  it("rejects an empty or non-string input", () => {
    expect(parseLockedTotalInput("")).toEqual({ ok: false, reason: "empty" });
    expect(parseLockedTotalInput("   ")).toEqual({ ok: false, reason: "empty" });
    expect(parseLockedTotalInput(null)).toEqual({ ok: false, reason: "empty" });
    expect(parseLockedTotalInput(undefined)).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects anything that is not a money figure", () => {
    expect(parseLockedTotalInput("thirty-one thousand")).toEqual({ ok: false, reason: "not_a_number" });
    expect(parseLockedTotalInput("31.000,00")).toEqual({ ok: false, reason: "not_a_number" });
    expect(parseLockedTotalInput("-31000")).toEqual({ ok: false, reason: "not_a_number" });
    expect(parseLockedTotalInput("31000e2")).toEqual({ ok: false, reason: "not_a_number" });
  });

  it("rejects fractional cents", () => {
    expect(parseLockedTotalInput("31000.123")).toEqual({ ok: false, reason: "fractional_cents" });
  });

  it("rejects a figure below the SPEC-03 floor", () => {
    expect(parseLockedTotalInput("24999.99")).toEqual({ ok: false, reason: "below_floor" });
    expect(parseLockedTotalInput("0")).toEqual({ ok: false, reason: "below_floor" });
  });

  it("rejects a figure the integer column cannot hold", () => {
    expect(SPEC03_LOCKED_TOTAL_MAX_CENTS).toBe(2_147_483_647);
    expect(parseLockedTotalInput("21474836.47")).toEqual({ ok: true, cents: 2_147_483_647 });
    expect(parseLockedTotalInput("21474836.48")).toEqual({ ok: false, reason: "above_max" });
  });
});

// ─── lockedTotalGate ─────────────────────────────────────────────────────────

const openDoc = { sentAt: null };
const sentDoc = { sentAt: "2026-09-05T12:00:00Z" };

const allowedInput = {
  tier: "spec03" as const,
  status: "discovery" as const,
  currentDoc: openDoc,
  hasScopeSignoff: false,
  hasP2Payment: false,
};

describe("lockedTotalGate", () => {
  it("allows a lock on an open SPEC-03 engagement with an unsent, unsigned current doc", () => {
    expect(lockedTotalGate(allowedInput)).toEqual({ allowed: true });
  });

  it("allows a lock while the engagement is still at deposit_paid or building", () => {
    expect(lockedTotalGate({ ...allowedInput, status: "deposit_paid" })).toEqual({ allowed: true });
    expect(lockedTotalGate({ ...allowedInput, status: "building" })).toEqual({ allowed: true });
  });

  it("refuses fixed-total tiers", () => {
    expect(lockedTotalGate({ ...allowedInput, tier: "spec01" })).toEqual({
      allowed: false,
      reason: "not_variable_tier",
    });
    expect(lockedTotalGate({ ...allowedInput, tier: "spec02" })).toEqual({
      allowed: false,
      reason: "not_variable_tier",
    });
  });

  it("refuses a closed engagement", () => {
    for (const status of ["completed", "cancelled", "refunded"] as const) {
      expect(lockedTotalGate({ ...allowedInput, status })).toEqual({
        allowed: false,
        reason: "engagement_closed",
      });
    }
  });

  it("refuses once the customer has signed the scope doc", () => {
    expect(lockedTotalGate({ ...allowedInput, hasScopeSignoff: true })).toEqual({
      allowed: false,
      reason: "signed",
    });
  });

  it("refuses once P2 has been invoiced, even without an acceptance row", () => {
    expect(lockedTotalGate({ ...allowedInput, hasP2Payment: true })).toEqual({
      allowed: false,
      reason: "p2_invoiced",
    });
  });

  it("refuses when there is no scope doc to carry the figure", () => {
    expect(lockedTotalGate({ ...allowedInput, currentDoc: null })).toEqual({
      allowed: false,
      reason: "no_scope_doc",
    });
  });

  it("refuses once the current doc has been sent to the customer", () => {
    expect(lockedTotalGate({ ...allowedInput, currentDoc: sentDoc })).toEqual({
      allowed: false,
      reason: "doc_sent",
    });
  });

  it("reports the most decisive reason when several apply", () => {
    expect(
      lockedTotalGate({
        tier: "spec02",
        status: "cancelled",
        currentDoc: sentDoc,
        hasScopeSignoff: true,
        hasP2Payment: true,
      }),
    ).toEqual({ allowed: false, reason: "not_variable_tier" });
    expect(
      lockedTotalGate({
        ...allowedInput,
        status: "cancelled",
        currentDoc: sentDoc,
        hasScopeSignoff: true,
        hasP2Payment: true,
      }),
    ).toEqual({ allowed: false, reason: "engagement_closed" });
    expect(
      lockedTotalGate({ ...allowedInput, currentDoc: sentDoc, hasScopeSignoff: true, hasP2Payment: true }),
    ).toEqual({ allowed: false, reason: "signed" });
    expect(lockedTotalGate({ ...allowedInput, currentDoc: null, hasP2Payment: true })).toEqual({
      allowed: false,
      reason: "p2_invoiced",
    });
  });
});

describe("lockBlockedLabel", () => {
  it("names the blocker in the console voice", () => {
    expect(lockBlockedLabel("not_variable_tier")).toBe("ONLY SPEC-03 CARRIES A VARIABLE TOTAL");
    expect(lockBlockedLabel("engagement_closed")).toBe("ENGAGEMENT CLOSED");
    expect(lockBlockedLabel("signed")).toBe("SIGNED — CHANGES GO THROUGH A CHANGE ORDER");
    expect(lockBlockedLabel("p2_invoiced")).toBe("P2 INVOICED — TOTAL IS BINDING");
    expect(lockBlockedLabel("no_scope_doc")).toBe("DRAFT V1 FIRST — THE TOTAL LIVES ON THE SCOPE DOC");
    expect(lockBlockedLabel("doc_sent")).toBe("SENT — CUT A NEW REVISION TO CHANGE THE TOTAL");
  });

  it("stamps the version and the signature date when the caller knows them", () => {
    expect(lockBlockedLabel("doc_sent", { version: 2 })).toBe(
      "V2 SENT — CUT A NEW REVISION TO CHANGE THE TOTAL",
    );
    expect(lockBlockedLabel("signed", { signedAt: "2026-09-05T12:00:00Z" })).toBe(
      "SIGNED · SEP 05, 2026 — CHANGES GO THROUGH A CHANGE ORDER",
    );
  });
});

// ─── Scope-doc content helpers ───────────────────────────────────────────────

describe("scope-doc content helpers", () => {
  it("hashes content exactly like the scope-revision writer", () => {
    const content = { features: ["takeoff"], exclusions: [] };
    expect(scopeContentHash(content)).toBe(
      createHash("sha256").update(JSON.stringify(content)).digest("hex"),
    );
  });

  it("writes the locked total onto a copy of the content without mutating the input", () => {
    const content = { features: ["takeoff"] };
    const next = withLockedTotal(content, 3_100_000);
    expect(next).toEqual({ features: ["takeoff"], [SCOPE_DOC_LOCKED_TOTAL_KEY]: 3_100_000 });
    expect(content).toEqual({ features: ["takeoff"] });
    expect(next).not.toBe(content);
  });

  it("seeds an object when the doc has no content", () => {
    expect(withLockedTotal(null, 3_100_000)).toEqual({ [SCOPE_DOC_LOCKED_TOTAL_KEY]: 3_100_000 });
  });

  it("changes the hash when the total changes", () => {
    const a = withLockedTotal({ features: [] }, 3_100_000);
    const b = withLockedTotal({ features: [] }, 3_250_000);
    expect(scopeContentHash(a)).not.toBe(scopeContentHash(b));
  });

  it("reads only a positive integer total back out of the content", () => {
    expect(readScopeDocTotalCents({ [SCOPE_DOC_LOCKED_TOTAL_KEY]: 3_100_000 })).toBe(3_100_000);
    expect(readScopeDocTotalCents({ [SCOPE_DOC_LOCKED_TOTAL_KEY]: "3100000" })).toBeNull();
    expect(readScopeDocTotalCents({ [SCOPE_DOC_LOCKED_TOTAL_KEY]: 31000.5 })).toBeNull();
    expect(readScopeDocTotalCents({ [SCOPE_DOC_LOCKED_TOTAL_KEY]: 0 })).toBeNull();
    expect(readScopeDocTotalCents({})).toBeNull();
    expect(readScopeDocTotalCents(null)).toBeNull();
    expect(readScopeDocTotalCents("nope")).toBeNull();
  });
});

// ─── composeScopeLockedTotal ─────────────────────────────────────────────────

const baseParams = {
  tier: "spec03" as const,
  status: "discovery" as const,
  lockedTotalRaw: null as unknown,
  currentDoc: { version: 2, sentAt: null, contentJson: {} as unknown },
  acceptanceEvents: [] as Array<{ event_type: string; accepted_at: string }>,
  payments: [] as Array<{ milestone: string }>,
};

describe("composeScopeLockedTotal", () => {
  it("is absent for fixed-total tiers", () => {
    expect(composeScopeLockedTotal({ ...baseParams, tier: "spec01" })).toBeNull();
    expect(composeScopeLockedTotal({ ...baseParams, tier: "spec02" })).toBeNull();
  });

  it("projects an unlocked, lockable SPEC-03 engagement", () => {
    expect(composeScopeLockedTotal(baseParams)).toEqual({
      tier: "spec03",
      floorCents: 2_500_000,
      lockedTotalCents: null,
      currentDocVersion: 2,
      currentDocTotalCents: null,
      signedAt: null,
      blockedReason: null,
    });
  });

  it("projects a locked engagement and the figure the current doc carries", () => {
    expect(
      composeScopeLockedTotal({
        ...baseParams,
        lockedTotalRaw: 3_100_000,
        currentDoc: { version: 3, sentAt: null, contentJson: { locked_total_cents: 3_000_000 } },
      }),
    ).toEqual({
      tier: "spec03",
      floorCents: 2_500_000,
      lockedTotalCents: 3_100_000,
      currentDocVersion: 3,
      currentDocTotalCents: 3_000_000,
      signedAt: null,
      blockedReason: null,
    });
  });

  it("fails closed on a sub-floor project figure, same as the milestones tab", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = composeScopeLockedTotal({ ...baseParams, lockedTotalRaw: 2_000_000 });
    expect(out?.lockedTotalCents).toBeNull();
    expect(error).toHaveBeenCalled();
  });

  it("carries the signature date and the signed blocker once the customer signs", () => {
    expect(
      composeScopeLockedTotal({
        ...baseParams,
        lockedTotalRaw: 3_100_000,
        acceptanceEvents: [
          { event_type: "tos_accepted", accepted_at: "2026-08-28T00:00:00Z" },
          { event_type: "scope_signoff", accepted_at: "2026-09-05T12:00:00Z" },
        ],
      }),
    ).toMatchObject({ signedAt: "2026-09-05T12:00:00Z", blockedReason: "signed" });
  });

  it("blocks when P2 is already invoiced", () => {
    expect(
      composeScopeLockedTotal({ ...baseParams, payments: [{ milestone: "deposit" }, { milestone: "scope_signoff" }] }),
    ).toMatchObject({ blockedReason: "p2_invoiced" });
  });

  it("blocks when there is no scope doc yet", () => {
    expect(composeScopeLockedTotal({ ...baseParams, currentDoc: null })).toMatchObject({
      currentDocVersion: null,
      currentDocTotalCents: null,
      blockedReason: "no_scope_doc",
    });
  });

  it("blocks when the current doc has been sent", () => {
    expect(
      composeScopeLockedTotal({
        ...baseParams,
        currentDoc: { version: 2, sentAt: "2026-09-05T12:00:00Z", contentJson: {} },
      }),
    ).toMatchObject({ blockedReason: "doc_sent" });
  });
});

// ─── pickCurrentScopeDocument ────────────────────────────────────────────────

describe("pickCurrentScopeDocument", () => {
  it("returns null when the engagement has no scope docs", () => {
    expect(pickCurrentScopeDocument([])).toBeNull();
  });

  it("prefers the highest unsuperseded version regardless of input order", () => {
    const docs = [
      { id: "v1", version: 1, superseded_at: "2026-09-01T00:00:00Z" },
      { id: "v3", version: 3, superseded_at: null },
      { id: "v2", version: 2, superseded_at: "2026-09-03T00:00:00Z" },
    ];
    expect(pickCurrentScopeDocument(docs)?.id).toBe("v3");
    expect(pickCurrentScopeDocument([...docs].reverse())?.id).toBe("v3");
  });

  it("falls back to the highest version when every row is marked superseded", () => {
    const docs = [
      { id: "v1", version: 1, superseded_at: "2026-09-01T00:00:00Z" },
      { id: "v2", version: 2, superseded_at: "2026-09-03T00:00:00Z" },
    ];
    expect(pickCurrentScopeDocument(docs)?.id).toBe("v2");
  });

  it("does not mutate the caller's array", () => {
    const docs = [
      { id: "v1", version: 1, superseded_at: null },
      { id: "v2", version: 2, superseded_at: null },
    ];
    pickCurrentScopeDocument(docs);
    expect(docs.map((d) => d.id)).toEqual(["v1", "v2"]);
  });
});

// ─── formatCadCents ──────────────────────────────────────────────────────────

describe("formatCadCents", () => {
  it("prints whole dollars without decimals and cents with exactly two", () => {
    expect(formatCadCents(2_500_000)).toBe("$25,000");
    expect(formatCadCents(3_250_050)).toBe("$32,500.50");
    expect(formatCadCents(825_001)).toBe("$8,250.01");
    expect(formatCadCents(2_147_483_647)).toBe("$21,474,836.47");
    expect(formatCadCents(5)).toBe("$0.05");
  });
});

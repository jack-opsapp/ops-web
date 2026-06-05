import { describe, expect, it } from "vitest";

import { decideQboConflict } from "../qbo-conflict";

describe("decideQboConflict", () => {
  it("skips records without a material diff", () => {
    expect(
      decideQboConflict({
        opsUpdatedAt: "2026-06-05T10:00:00.000Z",
        qbUpdatedAt: "2026-06-05T10:02:00.000Z",
        materialDiff: false,
      }),
    ).toEqual({ decision: "skipped" });
  });

  it("requires review when either timestamp is missing", () => {
    expect(
      decideQboConflict({
        opsUpdatedAt: null,
        qbUpdatedAt: "2026-06-05T10:02:00.000Z",
        materialDiff: true,
      }),
    ).toEqual({ decision: "needs_review", reason: "missing timestamp" });
  });

  it("requires review when either timestamp is invalid", () => {
    expect(
      decideQboConflict({
        opsUpdatedAt: "not-a-date",
        qbUpdatedAt: "2026-06-05T10:02:00.000Z",
        materialDiff: true,
      }),
    ).toEqual({ decision: "needs_review", reason: "invalid timestamp" });
  });

  it("lets QB win when QB was updated after OPS", () => {
    expect(
      decideQboConflict({
        opsUpdatedAt: "2026-06-05T10:00:00.000Z",
        qbUpdatedAt: "2026-06-05T10:02:00.000Z",
        materialDiff: true,
      }),
    ).toEqual({ decision: "qb_won" });
  });

  it("lets OPS win when OPS was updated after QB", () => {
    expect(
      decideQboConflict({
        opsUpdatedAt: "2026-06-05T10:03:00.000Z",
        qbUpdatedAt: "2026-06-05T10:02:00.000Z",
        materialDiff: true,
      }),
    ).toEqual({ decision: "ops_won" });
  });

  it("requires review for equal timestamps with material money differences", () => {
    expect(
      decideQboConflict({
        opsUpdatedAt: "2026-06-05T10:00:00.000Z",
        qbUpdatedAt: "2026-06-05T10:00:00.000Z",
        materialDiff: true,
        moneyTouched: true,
      }),
    ).toEqual({
      decision: "needs_review",
      reason: "equal timestamps with money difference",
    });
  });

  it("requires review for equal timestamps without money differences", () => {
    expect(
      decideQboConflict({
        opsUpdatedAt: "2026-06-05T10:00:00.000Z",
        qbUpdatedAt: "2026-06-05T10:00:00.000Z",
        materialDiff: true,
      }),
    ).toEqual({ decision: "needs_review", reason: "equal timestamps" });
  });
});

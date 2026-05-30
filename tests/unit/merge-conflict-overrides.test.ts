/**
 * Pure builder for the merge RESOLVE step (Surface 1).
 *
 * Asserts that operator selections translate into the correct confirmedOverrides
 * payload: only USE-ABSORBED (loser) fields are emitted; KEEP-WINNER fields are
 * omitted; single-loser clusters produce a flat map, multi-loser clusters a
 * per-loser keyed map. Also covers the gating helpers.
 */

import { describe, it, expect } from "vitest";
import {
  buildConfirmedOverrides,
  countConflicts,
  countResolved,
  allConflictsResolved,
} from "@/lib/utils/merge-conflict-overrides";
import type { MergeConflictsResult, ConflictSelections } from "@/lib/hooks/use-duplicate-reviews";

const singleLoser: MergeConflictsResult["perLoser"] = [
  {
    loserId: "loser-1",
    reconciliation: {
      fieldFill: {},
      conflicts: [
        { field: "contact_email", winnerValue: "a@x.com", loserValue: "b@y.com" },
        { field: "contact_phone", winnerValue: "111", loserValue: "222" },
      ],
    },
  },
];

const multiLoser: MergeConflictsResult["perLoser"] = [
  {
    loserId: "loser-1",
    reconciliation: {
      fieldFill: {},
      conflicts: [{ field: "contact_email", winnerValue: "a@x.com", loserValue: "b@y.com" }],
    },
  },
  {
    loserId: "loser-2",
    reconciliation: {
      fieldFill: {},
      conflicts: [{ field: "address", winnerValue: "1 St", loserValue: "2 Ave" }],
    },
  },
];

describe("buildConfirmedOverrides — single loser (flat map)", () => {
  it("emits only USE-ABSORBED fields; KEEP-WINNER fields are omitted", () => {
    const selections: ConflictSelections = {
      "loser-1": { contact_email: "loser", contact_phone: "winner" },
    };
    expect(buildConfirmedOverrides(singleLoser, selections)).toEqual({
      contact_email: "b@y.com",
    });
  });

  it("emits an empty map when every field keeps the winner", () => {
    const selections: ConflictSelections = {
      "loser-1": { contact_email: "winner", contact_phone: "winner" },
    };
    expect(buildConfirmedOverrides(singleLoser, selections)).toEqual({});
  });

  it("emits both fields when both choose USE-ABSORBED", () => {
    const selections: ConflictSelections = {
      "loser-1": { contact_email: "loser", contact_phone: "loser" },
    };
    expect(buildConfirmedOverrides(singleLoser, selections)).toEqual({
      contact_email: "b@y.com",
      contact_phone: "222",
    });
  });
});

describe("buildConfirmedOverrides — multi loser (keyed map)", () => {
  it("keys overrides per loser id, dropping losers with no absorbed picks", () => {
    const selections: ConflictSelections = {
      "loser-1": { contact_email: "loser" },
      "loser-2": { address: "winner" },
    };
    expect(buildConfirmedOverrides(multiLoser, selections)).toEqual({
      "loser-1": { contact_email: "b@y.com" },
    });
  });

  it("keys both losers when both pick absorbed", () => {
    const selections: ConflictSelections = {
      "loser-1": { contact_email: "loser" },
      "loser-2": { address: "loser" },
    };
    expect(buildConfirmedOverrides(multiLoser, selections)).toEqual({
      "loser-1": { contact_email: "b@y.com" },
      "loser-2": { address: "2 Ave" },
    });
  });
});

describe("gating helpers", () => {
  it("countConflicts sums across losers", () => {
    expect(countConflicts(singleLoser)).toBe(2);
    expect(countConflicts(multiLoser)).toBe(2);
  });

  it("allConflictsResolved is false until every conflict has an explicit pick", () => {
    expect(allConflictsResolved(singleLoser, { "loser-1": { contact_email: "loser" } })).toBe(false);
    expect(
      allConflictsResolved(singleLoser, {
        "loser-1": { contact_email: "loser", contact_phone: "winner" },
      })
    ).toBe(true);
  });

  it("allConflictsResolved is false on empty selections", () => {
    expect(allConflictsResolved(multiLoser, {})).toBe(false);
  });

  it("countResolved counts explicit picks regardless of side", () => {
    expect(
      countResolved(singleLoser, {
        "loser-1": { contact_email: "loser", contact_phone: "winner" },
      })
    ).toBe(2);
    expect(countResolved(singleLoser, { "loser-1": { contact_email: "loser" } })).toBe(1);
  });
});

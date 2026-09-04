import { describe, expect, it } from "vitest";

import {
  buildConfirmedLineAllocations,
  countSupplierBillStages,
  suggestProjectForJobHint,
} from "../supplier-bill-presenter";

describe("supplier bill presenter", () => {
  it("counts every operational lifecycle without collapsing held or payroll", () => {
    expect(
      countSupplierBillStages([
        { review_stage: "review" },
        { review_stage: "review" },
        { review_stage: "to_pay" },
        { review_stage: "held" },
        { review_stage: "payroll" },
      ])
    ).toEqual({ review: 2, to_pay: 1, paid: 0, held: 1, payroll: 1 });
  });

  it("suggests a project from a normalized Canpro invoice address", () => {
    expect(
      suggestProjectForJobHint("74 Sims Ave, Victoria BC", [
        {
          id: "project-1",
          title: "Sims",
          address: "74 Sims Avenue, Victoria, BC",
        },
        { id: "project-2", title: "Terrace", address: "1050 Terrace Avenue" },
      ])
    ).toBe("project-1");
  });

  it("does not turn an ambiguous weak address into a confirmed job", () => {
    expect(
      suggestProjectForJobHint("Terrace", [
        {
          id: "project-1",
          title: "East Terrace",
          address: "1050 Terrace Avenue",
        },
        {
          id: "project-2",
          title: "West Terrace",
          address: "209 Terrace Avenue",
        },
      ])
    ).toBeNull();
  });

  it("builds exact per-line confirmed allocations for review persistence", () => {
    expect(
      buildConfirmedLineAllocations(
        [
          { position: 1, total: "105.00" },
          { position: 2, total: "25.50" },
        ],
        { 1: "project-1", 2: "project-2" }
      )
    ).toEqual([
      {
        linePosition: 1,
        projectId: "project-1",
        amount: "105.00",
        basis: "confirmed_suggestion",
      },
      {
        linePosition: 2,
        projectId: "project-2",
        amount: "25.50",
        basis: "confirmed_suggestion",
      },
    ]);
  });
});

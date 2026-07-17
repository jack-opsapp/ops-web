import { describe, expect, it } from "vitest";

import {
  actorLosesAccessOnAssign,
  effectivePipelineScope,
  getLeadAccess,
} from "@/lib/permissions/lead-access-policy";
import type { PermissionState } from "@/lib/store/permissions-store";
import { OpportunityStage, type Opportunity } from "@/lib/types/pipeline";

function state(
  permissions: Record<string, "all" | "assigned" | "own">,
  configured = Object.keys(permissions),
  legacyManageAll = false
): PermissionState {
  return {
    permissions: new Map(Object.entries(permissions)),
    configuredPermissions: new Set(configured),
    can: (permission, scope) =>
      permission === "pipeline.manage" && scope === "all" && legacyManageAll,
  } as PermissionState;
}

function lead(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "lead-1",
    assignedTo: "actor-1",
    stage: "qualifying",
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  } as Opportunity;
}

describe("lead access policy", () => {
  it("uses legacy manage only when the exact granular action is absent", () => {
    expect(effectivePipelineScope(state({}, [], true), "pipeline.edit")).toBe(
      "all"
    );
    expect(
      effectivePipelineScope(
        state({}, ["pipeline.edit"], true),
        "pipeline.edit"
      )
    ).toBeNull();
  });

  it("supports view all with edit assigned without widening the edit", () => {
    const permissions = state({
      "pipeline.view": "all",
      "pipeline.edit": "assigned",
    });

    expect(getLeadAccess(permissions, "actor-1", lead())).toMatchObject({
      canView: true,
      canEdit: true,
    });
    expect(
      getLeadAccess(permissions, "actor-1", lead({ assignedTo: "actor-2" }))
    ).toMatchObject({ canView: true, canEdit: false });
  });

  it("keeps assigned transfer row-bound and never exposes unassign", () => {
    const permissions = state({
      "pipeline.view": "assigned",
      "pipeline.edit": "assigned",
      "pipeline.assign": "assigned",
    });

    expect(getLeadAccess(permissions, "actor-1", lead())).toMatchObject({
      canView: true,
      canEdit: true,
      canAssign: true,
      canUnassign: false,
    });
    expect(
      getLeadAccess(permissions, "actor-1", lead({ assignedTo: "actor-2" }))
    ).toMatchObject({ canView: false, canEdit: false, canAssign: false });
    expect(
      getLeadAccess(
        permissions,
        "actor-1",
        lead({ stage: OpportunityStage.Won })
      )
    ).toMatchObject({ canAssign: false });
  });

  it("allows assign all to assign, unassign, and correct terminal responsibility", () => {
    const permissions = state({
      "pipeline.view": "all",
      "pipeline.edit": "all",
      "pipeline.assign": "all",
    });

    expect(
      getLeadAccess(
        permissions,
        "actor-1",
        lead({ assignedTo: "actor-2", stage: OpportunityStage.Won })
      )
    ).toMatchObject({ canAssign: true, canUnassign: true });
  });

  it("intersects malformed write scopes with the required view and edit scopes", () => {
    const noView = state({
      "pipeline.edit": "all",
      "pipeline.assign": "all",
      "pipeline.convert": "all",
    });
    expect(getLeadAccess(noView, "actor-1", lead())).toEqual({
      canView: false,
      canEdit: false,
      canAssign: false,
      canUnassign: false,
      canConvert: false,
    });

    const noEdit = state({
      "pipeline.view": "all",
      "pipeline.assign": "all",
      "pipeline.convert": "all",
    });
    expect(getLeadAccess(noEdit, "actor-1", lead())).toMatchObject({
      canView: true,
      canEdit: false,
      canAssign: false,
      canUnassign: false,
      canConvert: false,
    });
  });

  it("keeps explicit prerequisite revokes authoritative over legacy manage", () => {
    const permissions = state(
      {
        "pipeline.edit": "all",
        "pipeline.assign": "all",
        "pipeline.convert": "all",
      },
      ["pipeline.view", "pipeline.edit", "pipeline.assign", "pipeline.convert"],
      true
    );

    expect(getLeadAccess(permissions, "actor-1", lead())).toEqual({
      canView: false,
      canEdit: false,
      canAssign: false,
      canUnassign: false,
      canConvert: false,
    });
  });

  it("denies every row action for deleted leads", () => {
    const permissions = state({
      "pipeline.view": "all",
      "pipeline.edit": "all",
      "pipeline.assign": "all",
      "pipeline.convert": "all",
    });
    expect(
      getLeadAccess(
        permissions,
        "actor-1",
        lead({ deletedAt: new Date("2026-07-15") })
      )
    ).toEqual({
      canView: false,
      canEdit: false,
      canAssign: false,
      canUnassign: false,
      canConvert: false,
    });
  });
});

describe("actorLosesAccessOnAssign", () => {
  const assignedScope = state({
    "pipeline.view": "assigned",
    "pipeline.edit": "assigned",
    "pipeline.assign": "assigned",
  });

  it("is true for an assigned-scope self-transfer to someone else", () => {
    expect(
      actorLosesAccessOnAssign(
        assignedScope,
        "actor-1",
        { assignedTo: "actor-1" },
        "actor-2"
      )
    ).toBe(true);
  });

  it("is true for an assigned-scope unassign of the actor's own lead", () => {
    expect(
      actorLosesAccessOnAssign(
        assignedScope,
        "actor-1",
        { assignedTo: "actor-1" },
        null
      )
    ).toBe(true);
  });

  it("is false for all-scope viewers — reassignment never costs them visibility", () => {
    expect(
      actorLosesAccessOnAssign(
        state({
          "pipeline.view": "all",
          "pipeline.edit": "all",
          "pipeline.assign": "assigned",
        }),
        "actor-1",
        { assignedTo: "actor-1" },
        "actor-2"
      )
    ).toBe(false);
  });

  it("is false for unassign-capable operators (assign scope all)", () => {
    expect(
      actorLosesAccessOnAssign(
        state({
          "pipeline.view": "assigned",
          "pipeline.edit": "assigned",
          "pipeline.assign": "all",
        }),
        "actor-1",
        { assignedTo: "actor-1" },
        "actor-2"
      )
    ).toBe(false);
  });

  it("is false when the lead is not currently the actor's", () => {
    expect(
      actorLosesAccessOnAssign(
        assignedScope,
        "actor-1",
        { assignedTo: "actor-2" },
        "actor-3"
      )
    ).toBe(false);
  });

  it("is false for a self-keeping no-op and for a missing actor", () => {
    expect(
      actorLosesAccessOnAssign(
        assignedScope,
        "actor-1",
        { assignedTo: "actor-1" },
        "actor-1"
      )
    ).toBe(false);
    expect(
      actorLosesAccessOnAssign(
        assignedScope,
        null,
        { assignedTo: "actor-1" },
        "actor-2"
      )
    ).toBe(false);
  });

  it("is false under legacy manage-all compatibility (view resolves to all)", () => {
    expect(
      actorLosesAccessOnAssign(
        state({}, [], true),
        "actor-1",
        { assignedTo: "actor-1" },
        "actor-2"
      )
    ).toBe(false);
  });
});

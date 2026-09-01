import { describe, expect, it } from "vitest";

import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import {
  authorizeOperationalOverviewRead,
  isAuthorizedOperationalOverviewRead,
  OperationalOverviewAuthorizationError,
} from "../overview-authorization";
import {
  ALL_OVERVIEW_PERMISSIONS,
  overviewActorContext,
  overviewAuthorization,
} from "./overview-fixtures";

describe("operational overview authorization", () => {
  it("preauthorizes every explicit component independently in canonical order", async () => {
    const authorization = await overviewAuthorization({
      query: {
        components: ["work_due", "integration_attention"],
      },
    });

    expect(authorization.selections).toEqual([
      { component: "integration_attention", origin: "explicit" },
      { component: "work_due", origin: "explicit" },
    ]);
    expect(
      authorization.authorizedComponents.map((component) => ({
        component: component.component,
        scopes: component.requiredOAuthScopes,
        permissions: component.resolvedPermissionScopes,
      }))
    ).toEqual([
      {
        component: "integration_attention",
        scopes: ["ops.integrations.read", "ops.operations.read"],
        permissions: {
          "accounting.view": "all",
          "email.view": "all",
          "reports.view": "all",
          "settings.integrations": "all",
        },
      },
      {
        component: "work_due",
        scopes: ["ops.jobs.read", "ops.operations.read", "ops.tasks.read"],
        permissions: {
          "pipeline.view": "all",
          "projects.view": "all",
          "reports.view": "all",
          "tasks.view": "all",
        },
      },
    ]);
    expect(authorization.warnings).toEqual([]);
    expect(Object.isFrozen(authorization)).toBe(true);
    expect(Object.isFrozen(authorization.authorizedComponents)).toBe(true);
    expect(isAuthorizedOperationalOverviewRead(authorization)).toBe(true);
  });

  it("turns each denied default into one warning without an authority binding", async () => {
    const authorization = await overviewAuthorization({
      scopes: ["ops.integrations.read", "ops.operations.read"],
      permissions: [
        ["accounting.view", "all"],
        ["email.view", "own"],
        ["reports.view", "all"],
        ["settings.integrations", "all"],
      ],
    });

    expect(
      authorization.authorizedComponents.map(({ component }) => component)
    ).toEqual(["integration_attention"]);
    expect(authorization.warnings).toEqual([
      { code: "DEFAULT_COMPONENT_OMITTED", component: "financial_attention" },
      { code: "DEFAULT_COMPONENT_OMITTED", component: "schedule_readiness" },
      { code: "DEFAULT_COMPONENT_OMITTED", component: "stock_attention" },
      {
        code: "DEFAULT_COMPONENT_OMITTED",
        component: "unresolved_correspondence",
      },
      { code: "DEFAULT_COMPONENT_OMITTED", component: "work_due" },
    ]);
  });

  it("supports a real all-default-denied authorization for a warnings-only proof", async () => {
    const authorization = await overviewAuthorization({
      scopes: ["ops.operations.read"],
      permissions: [["reports.view", "all"]],
    });
    expect(authorization.authorizedComponents).toEqual([]);
    expect(authorization.warnings).toHaveLength(6);
    expect(isAuthorizedOperationalOverviewRead(authorization)).toBe(true);
  });

  it("fails any explicit denial before a repository can be called", async () => {
    const actorContext = await overviewActorContext({
      scopes: ["ops.operations.read"],
      permissions: [["reports.view", "all"]],
    });
    expect(() =>
      authorizeOperationalOverviewRead({
        query: { components: ["integration_attention", "work_due"] },
        actorContext,
      })
    ).toThrowError(OperationalOverviewAuthorizationError);
  });

  it("requires match-review project authority for unresolved correspondence", async () => {
    const actorContext = await overviewActorContext({
      scopes: ["ops.correspondence.read", "ops.operations.read"],
      permissions: [
        ["email.view", "all"],
        ["inbox.view", "all"],
        ["pipeline.view", "all"],
        ["reports.view", "all"],
      ],
    });
    expect(() =>
      authorizeOperationalOverviewRead({
        query: { components: ["unresolved_correspondence"] },
        actorContext,
      })
    ).toThrowError(OperationalOverviewAuthorizationError);
  });

  it("does not convert internal policy failures into omission warnings", async () => {
    const actorContext = await overviewActorContext({
      scopes: ["ops.operations.read"],
      permissions: ALL_OVERVIEW_PERMISSIONS,
      manifestRevision: "2026-08-22.capability-manifest.v7",
    });
    try {
      authorizeOperationalOverviewRead({ query: {}, actorContext });
      throw new Error("expected an authorization error");
    } catch (error) {
      expect(error).toBeInstanceOf(ActorAccessError);
      expect((error as ActorAccessError).code).toBe("INTERNAL");
    }
  });

  it("rejects forged actors and forged nominal authorizations", async () => {
    expect(() =>
      authorizeOperationalOverviewRead({
        query: {},
        actorContext: {} as never,
      })
    ).toThrowError(OperationalOverviewAuthorizationError);
    expect(isAuthorizedOperationalOverviewRead({})).toBe(false);
  });
});

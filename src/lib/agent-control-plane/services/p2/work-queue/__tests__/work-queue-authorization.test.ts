import { describe, expect, it } from "vitest";

import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import {
  ALL_OVERVIEW_PERMISSIONS,
  overviewActorContext,
} from "../../overview/__tests__/overview-fixtures";
import {
  authorizeWorkQueueRead,
  isAuthorizedWorkQueueRead,
  WorkQueueAuthorizationError,
} from "../work-queue-authorization";

const ALL_SCOPES = [
  "ops.correspondence.read",
  "ops.expenses.read",
  "ops.financial_documents.read",
  "ops.jobs.read",
  "ops.operations.read",
  "ops.payments.read",
  "ops.schedule.read",
  "ops.tasks.read",
];
const ALL_PERMISSIONS = [
  ...ALL_OVERVIEW_PERMISSIONS,
  ["projects.view_financials", "all"] as const,
];

describe("work queue authorization", () => {
  it("preauthorizes every explicit source independently before repository use", async () => {
    const authorization = authorizeWorkQueueRead({
      query: { sources: ["expense", "task", "match_review"] },
      actorContext: await overviewActorContext({
        scopes: ALL_SCOPES,
        permissions: ALL_PERMISSIONS,
      }),
    });
    expect(authorization.authorizedSources.map(({ source }) => source)).toEqual(
      ["task", "match_review", "expense"]
    );
    expect(authorization.warnings).toEqual([]);
    expect(isAuthorizedWorkQueueRead(authorization)).toBe(true);
    expect(Object.isFrozen(authorization)).toBe(true);
  });

  it("turns each nominally denied default into exactly one zero-signal warning", async () => {
    const authorization = authorizeWorkQueueRead({
      query: {},
      actorContext: await overviewActorContext({
        scopes: ["ops.operations.read", "ops.jobs.read"],
        permissions: [["pipeline.view", "all"]],
      }),
    });
    expect(authorization.authorizedSources.map(({ source }) => source)).toEqual(
      ["lead"]
    );
    expect(authorization.warnings).toHaveLength(8);
    expect(
      new Set(authorization.warnings.map(({ source }) => source)).size
    ).toBe(8);
    expect(new Set(authorization.warnings.map(({ code }) => code))).toEqual(
      new Set(["DEFAULT_COMPONENT_OMITTED"])
    );
  });

  it("fails an explicit denial and catches no internal policy error", async () => {
    const actor = await overviewActorContext({
      scopes: ["ops.operations.read"],
      permissions: [],
    });
    expect(() =>
      authorizeWorkQueueRead({
        query: { sources: ["task", "lead"] },
        actorContext: actor,
      })
    ).toThrowError(WorkQueueAuthorizationError);
    const wrongManifest = await overviewActorContext({
      scopes: ALL_SCOPES,
      permissions: ALL_PERMISSIONS,
      manifestRevision: "2026-08-22.capability-manifest.v7",
    });
    try {
      authorizeWorkQueueRead({ query: {}, actorContext: wrongManifest });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ActorAccessError);
      expect((error as ActorAccessError).code).toBe("INTERNAL");
    }
  });
});

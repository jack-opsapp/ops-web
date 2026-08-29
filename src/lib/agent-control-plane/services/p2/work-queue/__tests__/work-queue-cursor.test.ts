import { describe, expect, it } from "vitest";

import {
  ALL_OVERVIEW_PERMISSIONS,
  overviewActorContext,
} from "../../overview/__tests__/overview-fixtures";
import { authorizeWorkQueueRead } from "../work-queue-authorization";
import { createWorkQueueCursorService } from "../work-queue-cursor";

const REVISIONS = [
  { domain: "tasks", source_revision: 7 },
  { domain: "work_queue", source_revision: 11 },
] as const;
const READ_AT = "2026-08-29T23:30:00.000Z";
const PREDECESSOR = {
  order: [0, READ_AT, "task", "77777777-7777-4777-8777-777777777777"] as [
    number,
    string,
    string,
    string,
  ],
  tie_breaker: "77777777-7777-4777-8777-777777777777",
};

async function authorization(sources: readonly ("task" | "lead")[]) {
  return authorizeWorkQueueRead({
    query: { sources },
    actorContext: await overviewActorContext({
      scopes: ["ops.jobs.read", "ops.operations.read", "ops.tasks.read"],
      permissions: ALL_OVERVIEW_PERMISSIONS,
    }),
  });
}

describe("work queue cursor", () => {
  it("binds actor, exact source selection, revisions, ranking, and keyset", async () => {
    const auth = await authorization(["task"]);
    const cursors = createWorkQueueCursorService({
      keyId: "work-queue",
      key: new Uint8Array(32).fill(9),
    });
    const token = cursors.encode(
      {
        authorization: auth,
        sourceRevisions: REVISIONS,
        readAt: READ_AT,
        predecessor: PREDECESSOR,
      },
      1_000
    );
    expect(token.length).toBeGreaterThan(512);
    expect(token.length).toBeLessThanOrEqual(8_192);
    expect(cursors.decode({ authorization: auth, token }, 1_001)).toEqual({
      readAt: READ_AT,
      sourceRevisions: REVISIONS,
      predecessor: PREDECESSOR,
    });
    const otherSelection = await authorization(["lead"]);
    expect(() =>
      cursors.decode({ authorization: otherSelection, token }, 1_001)
    ).toThrow();
    for (const replayAuthorization of [
      {
        ...auth,
        oauthClientId: "99999999-9999-4999-8999-999999999999",
      },
      { ...auth, grantRevision: "c".repeat(32) },
      { ...auth, query: { ...auth.query, limit: 2 } },
      {
        ...auth,
        authorizedSources: auth.authorizedSources.map((source) => ({
          ...source,
          resolvedPermissionScopes: { "tasks.view": "assigned" as const },
        })),
      },
    ]) {
      expect(() =>
        cursors.decode(
          { authorization: replayAuthorization as typeof auth, token },
          1_001
        )
      ).toThrow();
    }
    expect(() =>
      cursors.decode({ authorization: auth, token: `${token}x` }, 1_001)
    ).toThrow();
    expect(() =>
      cursors.decode({ authorization: auth, token }, 2_000)
    ).toThrow();
  });
});

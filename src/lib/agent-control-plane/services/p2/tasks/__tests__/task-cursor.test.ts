import { describe, expect, it } from "vitest";

import { P2ReadCursorError } from "../../shared/cursor";
import {
  createTaskListCursorService,
  TASK_LIST_RANKING_REVISION,
} from "../task-cursor";
import {
  listTasksAuthorization,
  TASK_ID,
  TASK_READ_AT,
  TASK_SOURCE_REVISIONS,
} from "./task-fixtures";

const NOW = 1_800_000_000;

describe("P2 task list cursor", () => {
  it("signs and verifies the canonical task predecessor with all authority and query bindings", async () => {
    const authorization = await listTasksAuthorization({
      view: { kind: "status", states: ["active"] },
      limit: 20,
    });
    const cursors = createTaskListCursorService({
      keyId: "task-test",
      key: Buffer.alloc(32, 7),
    });
    const token = cursors.encode(
      {
        authorization,
        sourceRevisions: TASK_SOURCE_REVISIONS,
        readAt: TASK_READ_AT,
        predecessor: {
          order: ["2026-08-25", TASK_ID],
          tie_breaker: TASK_ID,
        },
      },
      NOW
    );
    const decoded = cursors.decode({ authorization, token }, NOW + 899);

    expect(decoded).toMatchObject({
      readAt: TASK_READ_AT,
      sourceRevisions: TASK_SOURCE_REVISIONS,
      predecessor: {
        order: ["2026-08-25", TASK_ID],
        tie_breaker: TASK_ID,
      },
    });
    expect(TASK_LIST_RANKING_REVISION).toBe("task-ranking:2026-08-22.v1");
    expect(Object.isFrozen(decoded)).toBe(true);
  });

  it("rejects forgery, expiry, filter/limit drift, and cross-actor authority drift", async () => {
    const authorization = await listTasksAuthorization({
      view: { kind: "actionable" },
      limit: 25,
    });
    const cursors = createTaskListCursorService({
      keyId: "task-test",
      key: Buffer.alloc(32, 8),
    });
    const token = cursors.encode(
      {
        authorization,
        sourceRevisions: TASK_SOURCE_REVISIONS,
        readAt: TASK_READ_AT,
        predecessor: {
          order: ["2026-08-25", TASK_ID],
          tie_breaker: TASK_ID,
        },
      },
      NOW
    );
    const forged = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    const changedQuery = await listTasksAuthorization({
      view: { kind: "actionable" },
      limit: 24,
    });

    expect(() =>
      cursors.decode({ authorization, token: forged }, NOW + 1)
    ).toThrow(P2ReadCursorError);
    expect(() => cursors.decode({ authorization, token }, NOW + 900)).toThrow(
      P2ReadCursorError
    );
    expect(() =>
      cursors.decode({ authorization: changedQuery, token }, NOW + 1)
    ).toThrow(P2ReadCursorError);
  });

  it("rejects open or malformed unsigned hints before any repository read", async () => {
    const authorization = await listTasksAuthorization();
    const cursors = createTaskListCursorService({
      keyId: "task-test",
      key: Buffer.alloc(32, 9),
    });
    for (const token of [
      "not-a-cursor",
      `ops_p2_cursor.${Buffer.from("{}").toString("base64url")}.signature`,
      `ops_p2_cursor.${Buffer.from(
        JSON.stringify({
          read_at: TASK_READ_AT,
          source_revisions: [{ domain: "catalog", source_revision: 1 }],
        })
      ).toString("base64url")}.signature`,
    ]) {
      expect(() => cursors.decode({ authorization, token }, NOW)).toThrow(
        P2ReadCursorError
      );
    }
  });

  it("refuses to sign an impossible date or a mismatched task tie-breaker", async () => {
    const authorization = await listTasksAuthorization();
    const cursors = createTaskListCursorService({
      keyId: "task-test",
      key: Buffer.alloc(32, 10),
    });
    for (const predecessor of [
      {
        order: ["2026-02-31", TASK_ID],
        tie_breaker: TASK_ID,
      },
      {
        order: ["2026-08-25", "99999999-9999-4999-8999-999999999999"],
        tie_breaker: TASK_ID,
      },
    ]) {
      expect(() =>
        cursors.encode(
          {
            authorization,
            sourceRevisions: TASK_SOURCE_REVISIONS,
            readAt: TASK_READ_AT,
            predecessor,
          },
          NOW
        )
      ).toThrow(P2ReadCursorError);
    }
  });
});

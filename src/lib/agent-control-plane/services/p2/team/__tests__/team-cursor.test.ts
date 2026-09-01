import { describe, expect, it } from "vitest";

import { P2ReadCursorError } from "../../shared/cursor";
import {
  createTeamDirectoryCursorService,
  TEAM_DIRECTORY_RANKING_REVISION,
} from "../team-cursor";
import {
  TEAM_MEMBER_ID,
  TEAM_READ_AT,
  TEAM_SOURCE_REVISIONS,
  teamDirectoryAuthorization,
} from "./team-fixtures";

const NOW = 1_800_000_000;

describe("P2 team-directory cursor", () => {
  it("signs canonical display-name ordering with authority, query, and revisions", async () => {
    const authorization = await teamDirectoryAuthorization({ limit: 20 });
    const cursors = createTeamDirectoryCursorService({
      keyId: "team-test",
      key: Buffer.alloc(32, 4),
    });
    const token = cursors.encode(
      {
        authorization,
        sourceRevisions: TEAM_SOURCE_REVISIONS,
        readAt: TEAM_READ_AT,
        predecessor: {
          order: ["Alex Morgan", TEAM_MEMBER_ID],
          tie_breaker: TEAM_MEMBER_ID,
        },
      },
      NOW
    );

    expect(cursors.decode({ authorization, token }, NOW + 899)).toMatchObject({
      readAt: TEAM_READ_AT,
      sourceRevisions: TEAM_SOURCE_REVISIONS,
      predecessor: {
        order: ["Alex Morgan", TEAM_MEMBER_ID],
        tie_breaker: TEAM_MEMBER_ID,
      },
    });
    expect(TEAM_DIRECTORY_RANKING_REVISION).toBe(
      "team-member-order:2026-08-22.v1"
    );
  });

  it("rejects forgery, expiry, query drift, revision drift, and malformed predecessors", async () => {
    const authorization = await teamDirectoryAuthorization({ limit: 25 });
    const cursors = createTeamDirectoryCursorService({
      keyId: "team-test",
      key: Buffer.alloc(32, 5),
    });
    const token = cursors.encode(
      {
        authorization,
        sourceRevisions: TEAM_SOURCE_REVISIONS,
        readAt: TEAM_READ_AT,
        predecessor: {
          order: ["Alex Morgan", TEAM_MEMBER_ID],
          tie_breaker: TEAM_MEMBER_ID,
        },
      },
      NOW
    );
    const changedQuery = await teamDirectoryAuthorization({ limit: 24 });
    const forged = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    expect(() =>
      cursors.decode({ authorization, token: forged }, NOW + 1)
    ).toThrow(P2ReadCursorError);
    expect(() => cursors.decode({ authorization, token }, NOW + 900)).toThrow(
      P2ReadCursorError
    );
    expect(() =>
      cursors.decode({ authorization: changedQuery, token }, NOW + 1)
    ).toThrow(P2ReadCursorError);
    expect(() =>
      cursors.encode(
        {
          authorization,
          sourceRevisions: [{ domain: "team", source_revision: 1 }],
          readAt: TEAM_READ_AT,
          predecessor: {
            order: ["Alex Morgan", TEAM_MEMBER_ID],
            tie_breaker: TEAM_MEMBER_ID,
          },
        },
        NOW
      )
    ).toThrow(P2ReadCursorError);
    expect(() =>
      cursors.encode(
        {
          authorization,
          sourceRevisions: TEAM_SOURCE_REVISIONS,
          readAt: TEAM_READ_AT,
          predecessor: {
            order: ["Alex Morgan", "99999999-9999-4999-8999-999999999999"],
            tie_breaker: TEAM_MEMBER_ID,
          },
        },
        NOW
      )
    ).toThrow(P2ReadCursorError);
  });

  it("rejects malformed unsigned hints before repository access", async () => {
    const authorization = await teamDirectoryAuthorization();
    const cursors = createTeamDirectoryCursorService({
      keyId: "team-test",
      key: Buffer.alloc(32, 6),
    });
    for (const token of [
      "not-a-cursor",
      `ops_p2_cursor.${Buffer.from("{}").toString("base64url")}.signature`,
      `ops_p2_cursor.${Buffer.from(
        JSON.stringify({
          read_at: TEAM_READ_AT,
          source_revisions: [{ domain: "team", source_revision: 1 }],
        })
      ).toString("base64url")}.signature`,
    ]) {
      expect(() => cursors.decode({ authorization, token }, NOW)).toThrow(
        P2ReadCursorError
      );
    }
  });
});

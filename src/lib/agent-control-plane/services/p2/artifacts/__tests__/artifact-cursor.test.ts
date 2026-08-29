import { describe, expect, it } from "vitest";

import { P2ReadCursorError } from "../../shared/cursor";
import {
  ARTIFACT_LIST_RANKING_REVISION,
  createArtifactListCursorService,
} from "../artifact-cursor";
import {
  ARTIFACT_EVIDENCE_REF,
  ARTIFACT_OCCURRED_AT,
  ARTIFACT_READ_AT,
  ARTIFACT_SOURCE_REVISIONS,
  listArtifactsAuthorization,
} from "./artifact-fixtures";

const NOW = 1_800_000_000;

describe("P2 artifact list cursor", () => {
  it("signs the newest-first source/evidence predecessor with every authority binding", async () => {
    const authorization = await listArtifactsAuthorization({
      job_ref: {
        kind: "project",
        id: "33333333-3333-4333-8333-333333333333",
      },
      source_kinds: ["project_photo", "project_note"],
      limit: 20,
    });
    const cursors = createArtifactListCursorService({
      keyId: "artifact-test",
      key: Buffer.alloc(32, 7),
    });
    const predecessor = {
      order: [ARTIFACT_OCCURRED_AT, "project_photo", ARTIFACT_EVIDENCE_REF],
      tie_breaker: ARTIFACT_EVIDENCE_REF,
    } as const;
    const token = cursors.encode(
      {
        authorization,
        sourceRevisions: ARTIFACT_SOURCE_REVISIONS,
        readAt: ARTIFACT_READ_AT,
        predecessor,
      },
      NOW
    );

    expect(cursors.decode({ authorization, token }, NOW + 899)).toMatchObject({
      readAt: ARTIFACT_READ_AT,
      sourceRevisions: ARTIFACT_SOURCE_REVISIONS,
      predecessor,
    });
    expect(ARTIFACT_LIST_RANKING_REVISION).toBe(
      "artifact-ranking:2026-08-22.v1"
    );
  });

  it("rejects forgery, expiry, job/source/limit drift, and stale source vectors", async () => {
    const authorization = await listArtifactsAuthorization();
    const cursors = createArtifactListCursorService({
      keyId: "artifact-test",
      key: Buffer.alloc(32, 8),
    });
    const token = cursors.encode(
      {
        authorization,
        sourceRevisions: ARTIFACT_SOURCE_REVISIONS,
        readAt: ARTIFACT_READ_AT,
        predecessor: {
          order: [ARTIFACT_OCCURRED_AT, "project_photo", ARTIFACT_EVIDENCE_REF],
          tie_breaker: ARTIFACT_EVIDENCE_REF,
        },
      },
      NOW
    );
    const forged = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    const changedQuery = await listArtifactsAuthorization({
      job_ref: authorization.query.job_ref,
      source_kinds: ["project_note"],
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

  it("rejects malformed unsigned hints before a repository read", async () => {
    const authorization = await listArtifactsAuthorization();
    const cursors = createArtifactListCursorService({
      keyId: "artifact-test",
      key: Buffer.alloc(32, 9),
    });
    for (const token of [
      "not-a-cursor",
      `ops_p2_cursor.${Buffer.from("{}").toString("base64url")}.signature`,
      `ops_p2_cursor.${Buffer.from(
        JSON.stringify({
          read_at: ARTIFACT_READ_AT,
          source_revisions: [{ domain: "catalog", source_revision: 1 }],
        })
      ).toString("base64url")}.signature`,
    ]) {
      expect(() => cursors.decode({ authorization, token }, NOW)).toThrow(
        P2ReadCursorError
      );
    }
  });
});

import { describe, expect, it } from "vitest";

import { P2ReadCursorError } from "../../shared/cursor";
import {
  createSiteVisitListCursorService,
  SITE_VISIT_LIST_RANKING_REVISION,
} from "../site-visit-cursor";
import {
  listSiteVisitsAuthorization,
  SITE_VISIT_ID,
  SITE_VISIT_READ_AT,
  SITE_VISIT_SOURCE_REVISIONS,
} from "./site-visit-fixtures";

const NOW = 1_800_000_000;

describe("P2 site-visit list cursor", () => {
  it("signs the exact booked_at predecessor and binds the full authority/query/revision vector", async () => {
    const authorization = await listSiteVisitsAuthorization({
      view: "booked_appointments",
      from: "2026-08-20T00:00:00.000Z",
      to: "2026-08-30T00:00:00.000Z",
      statuses: ["scheduled"],
      limit: 20,
    });
    const cursors = createSiteVisitListCursorService({
      keyId: "site-visit-test",
      key: Buffer.alloc(32, 7),
    });
    const token = cursors.encode(
      {
        authorization,
        sourceRevisions: SITE_VISIT_SOURCE_REVISIONS,
        readAt: SITE_VISIT_READ_AT,
        predecessor: {
          view: "booked_appointments",
          order: ["2026-08-24T09:00:00.000Z", SITE_VISIT_ID],
          tie_breaker: SITE_VISIT_ID,
        },
      },
      NOW
    );
    const decoded = cursors.decode({ authorization, token }, NOW + 899);

    expect(decoded).toMatchObject({
      readAt: SITE_VISIT_READ_AT,
      sourceRevisions: SITE_VISIT_SOURCE_REVISIONS,
      predecessor: {
        view: "booked_appointments",
        order: ["2026-08-24T09:00:00.000Z", SITE_VISIT_ID],
        tie_breaker: SITE_VISIT_ID,
      },
    });
    expect(SITE_VISIT_LIST_RANKING_REVISION).toBe(
      "site-visit-ranking:2026-08-22.v1"
    );
    expect(Object.isFrozen(decoded)).toBe(true);
  });

  it("rejects forgery, expiry, view/filter/limit drift, and a wrong revision domain", async () => {
    const authorization = await listSiteVisitsAuthorization({
      view: "visit_history",
      created_from: "2026-08-20T00:00:00.000Z",
      created_to: "2026-08-30T00:00:00.000Z",
      include_unlinked: false,
      limit: 25,
    });
    const cursors = createSiteVisitListCursorService({
      keyId: "site-visit-test",
      key: Buffer.alloc(32, 8),
    });
    const token = cursors.encode(
      {
        authorization,
        sourceRevisions: SITE_VISIT_SOURCE_REVISIONS,
        readAt: SITE_VISIT_READ_AT,
        predecessor: {
          view: "visit_history",
          order: ["2026-08-23T10:00:00.000Z", SITE_VISIT_ID],
          tie_breaker: SITE_VISIT_ID,
        },
      },
      NOW
    );
    const forged = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    const changedQuery = await listSiteVisitsAuthorization({
      view: "visit_history",
      created_from: "2026-08-20T00:00:00.000Z",
      created_to: "2026-08-30T00:00:00.000Z",
      include_unlinked: false,
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
    expect(() =>
      cursors.encode(
        {
          authorization,
          sourceRevisions: [{ domain: "artifacts", source_revision: 1 }],
          readAt: SITE_VISIT_READ_AT,
          predecessor: {
            view: "visit_history",
            order: ["2026-08-23T10:00:00.000Z", SITE_VISIT_ID],
            tie_breaker: SITE_VISIT_ID,
          },
        },
        NOW
      )
    ).toThrow(P2ReadCursorError);
  });

  it("rejects an impossible timestamp, mismatched view, or mismatched tie-breaker before signing", async () => {
    const authorization = await listSiteVisitsAuthorization();
    const cursors = createSiteVisitListCursorService({
      keyId: "site-visit-test",
      key: Buffer.alloc(32, 9),
    });
    const invalidPredecessors: {
      readonly view: "booked_appointments" | "visit_history";
      readonly order: [string, string];
      readonly tie_breaker: string;
    }[] = [
      {
        view: "booked_appointments",
        order: ["2026-02-31T09:00:00.000Z", SITE_VISIT_ID],
        tie_breaker: SITE_VISIT_ID,
      },
      {
        view: "visit_history",
        order: ["2026-08-24T09:00:00.000Z", SITE_VISIT_ID],
        tie_breaker: SITE_VISIT_ID,
      },
      {
        view: "booked_appointments",
        order: [
          "2026-08-24T09:00:00.000Z",
          "99999999-9999-4999-8999-999999999999",
        ],
        tie_breaker: SITE_VISIT_ID,
      },
    ];
    for (const predecessor of invalidPredecessors) {
      expect(() =>
        cursors.encode(
          {
            authorization,
            sourceRevisions: SITE_VISIT_SOURCE_REVISIONS,
            readAt: SITE_VISIT_READ_AT,
            predecessor,
          },
          NOW
        )
      ).toThrow(P2ReadCursorError);
    }
  });
});

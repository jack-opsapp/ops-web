import { describe, expect, it } from "vitest";

import { P2ReadCursorError } from "../../shared/cursor";
import {
  createTeamAvailabilityCursorService,
  teamAvailabilityAuthorityDigest,
  teamAvailabilityQueryHash,
} from "../availability-cursor";
import {
  AVAILABILITY_MEMBER_ID,
  AVAILABILITY_READ_AT,
  AVAILABILITY_SOURCE_REVISIONS,
  availabilityAuthorization,
  companyAvailabilityQuery,
} from "./availability-fixtures";

function cursors(seed: number) {
  return createTeamAvailabilityCursorService({
    keyId: `availability-key-${seed}`,
    key: new Uint8Array(32).fill(seed),
  });
}

describe("P2 team-availability cursor", () => {
  it("round-trips the canonical member predecessor and four-domain snapshot", async () => {
    const authorization = await availabilityAuthorization(
      companyAvailabilityQuery({ limit: 4 })
    );
    const service = cursors(3);
    const predecessor = {
      order: ["Alex Morgan", AVAILABILITY_MEMBER_ID] as const,
      tie_breaker: AVAILABILITY_MEMBER_ID,
    };
    const token = service.encode(
      {
        authorization,
        sourceRevisions: AVAILABILITY_SOURCE_REVISIONS,
        readAt: AVAILABILITY_READ_AT,
        predecessor,
      },
      1_793_534_400
    );
    expect(service.decode({ authorization, token }, 1_793_534_401)).toEqual({
      readAt: AVAILABILITY_READ_AT,
      sourceRevisions: AVAILABILITY_SOURCE_REVISIONS,
      predecessor,
    });
    expect(teamAvailabilityQueryHash(authorization)).toMatch(/^sha256:/);
    expect(teamAvailabilityAuthorityDigest(authorization)).toMatch(/^sha256:/);
  });

  it("rejects query, authority, revision, predecessor, and self-view reuse", async () => {
    const authorization = await availabilityAuthorization();
    const service = cursors(4);
    const token = service.encode(
      {
        authorization,
        sourceRevisions: AVAILABILITY_SOURCE_REVISIONS,
        readAt: AVAILABILITY_READ_AT,
        predecessor: {
          order: ["Alex Morgan", AVAILABILITY_MEMBER_ID],
          tie_breaker: AVAILABILITY_MEMBER_ID,
        },
      },
      1_793_534_400
    );
    const changedWindow = await availabilityAuthorization(
      companyAvailabilityQuery({ ends_on: "2026-11-04" })
    );
    expect(() =>
      service.decode({ authorization: changedWindow, token }, 1_793_534_401)
    ).toThrow(P2ReadCursorError);
    expect(() =>
      service.encode({
        authorization,
        sourceRevisions: [{ domain: "team", source_revision: 11 }],
        readAt: AVAILABILITY_READ_AT,
        predecessor: {
          order: ["Alex Morgan", AVAILABILITY_MEMBER_ID],
          tie_breaker: AVAILABILITY_MEMBER_ID,
        },
      })
    ).toThrow(P2ReadCursorError);
    expect(() =>
      service.encode({
        authorization,
        sourceRevisions: AVAILABILITY_SOURCE_REVISIONS,
        readAt: AVAILABILITY_READ_AT,
        predecessor: {
          order: ["Alex Morgan", AVAILABILITY_MEMBER_ID],
          tie_breaker: "99999999-9999-4999-8999-999999999999",
        },
      })
    ).toThrow(P2ReadCursorError);
    const self = await availabilityAuthorization({
      view: "self",
      starts_on: "2026-11-01",
      ends_on: "2026-11-03",
    });
    expect(() =>
      service.decode({ authorization: self, token }, 1_793_534_401)
    ).toThrow(P2ReadCursorError);
  });
});
